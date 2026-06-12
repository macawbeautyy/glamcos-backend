/**
 * walletService — core money-movement logic for the manual payout model.
 *
 * Flow:
 *   Order line delivered (online-paid)  → creditEarningForItem()
 *       gross = item.subtotal, commission = gross * pct, net = gross - commission
 *       wallet.pendingEarnings += net   (ledger: sale_credit + commission)
 *   After holding period                → releaseMaturedEarnings() (cron)
 *       pendingEarnings -= net, availableBalance += net
 *   Refund / return / cancellation     → applyRefundForItem()
 *       deducts net from pending or available (negative balance allowed)
 *   Admin "Mark as Paid"               → handled in payoutController (ledger: payout)
 *
 * All wallet mutations use atomic $inc updates on SellerProfile.wallet and an
 * immutable SellerLedgerEntry trail. The unique index on
 * {seller, order, orderItem, type} makes earning credits idempotent.
 */
const SellerProfile    = require('../models/SellerProfile');
const SellerLedgerEntry= require('../models/SellerLedgerEntry');
const PlatformSetting  = require('../models/PlatformSetting');
const logger           = require('../utils/logger');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function incWallet(sellerId, inc) {
  await SellerProfile.updateOne({ user: sellerId }, { $inc: inc });
}

/**
 * Credit a seller's wallet for one delivered, online-paid order line.
 * Safe to call multiple times — duplicate calls hit the unique index and no-op.
 */
async function creditEarningForItem(order, item) {
  try {
    if (!order || !item || !item.seller) return null;
    if (order.payment?.method === 'cod') return null;          // platform never held COD money
    if (order.payment?.status !== 'paid') return null;          // only settled online payments

    const settings  = await PlatformSetting.get();
    const pct       = settings.commissionPercent;
    const gross     = round2(item.subtotal);
    const commission= round2((gross * pct) / 100);
    const net       = round2(gross - commission);
    const availableAt = new Date(Date.now() + settings.payoutHoldingDays * 24 * 60 * 60 * 1000);

    let entry;
    try {
      entry = await SellerLedgerEntry.create({
        seller: item.seller,
        type: 'sale_credit',
        direction: 'credit',
        amount: net,
        grossAmount: gross,
        commissionPercent: pct,
        commissionAmount: commission,
        description: `Earning for order ${order.orderNumber} — ${item.name} × ${item.quantity}`,
        referenceId: order.orderNumber,
        order: order._id,
        orderItem: item._id,
        availableAt,
      });
    } catch (e) {
      if (e.code === 11000) return null; // already credited — idempotent
      throw e;
    }

    // Credit the wallet as soon as the sale_credit entry is recorded, so a
    // failure below (informational commission entry) can never leave the
    // ledger and wallet balance out of sync.
    await incWallet(item.seller, {
      'wallet.totalSales':      gross,
      'wallet.totalCommission': commission,
      'wallet.pendingEarnings': net,
    });

    // Informational commission debit (gross − commission = net credited above)
    try {
      await SellerLedgerEntry.create({
        seller: item.seller,
        type: 'commission',
        direction: 'debit',
        amount: commission,
        grossAmount: gross,
        commissionPercent: pct,
        description: `Platform commission (${pct}%) on order ${order.orderNumber} — ${item.name}`,
        referenceId: order.orderNumber,
        order: order._id,
        orderItem: null, // keep unique index free for sale_credit
      });
    } catch (e) {
      // Wallet balance already credited above — don't let this fail the call.
      logger.error(`[Wallet] commission ledger entry failed for order ${order.orderNumber}: ${e.message}`);
    }

    logger.info(`[Wallet] +₹${net} pending for seller ${item.seller} (order ${order.orderNumber})`);
    return entry;
  } catch (err) {
    logger.error(`[Wallet] creditEarningForItem failed: ${err.message}`);
    return null;
  }
}

/** Credit every delivered line of an order (used when whole order flips to delivered). */
async function creditEarningsForOrder(order) {
  for (const item of order.items || []) {
    if (item.status === 'delivered') {
      // eslint-disable-next-line no-await-in-loop
      await creditEarningForItem(order, item);
    }
  }
}

/**
 * Reverse an earning when an item is refunded / returned / order cancelled.
 * - If earning not yet released → deduct from pendingEarnings
 * - If already released (or paid out) → deduct from availableBalance (may go negative;
 *   recovered from future earnings)
 */
async function applyRefundForItem(order, item, reason = 'Refund') {
  try {
    const earning = await SellerLedgerEntry.findOne({
      seller: item.seller,
      order: order._id,
      orderItem: item._id,
      type: 'sale_credit',
    });
    if (!earning) return null; // nothing was credited — nothing to reverse

    // Guard against double-refunding the same line
    const already = await SellerLedgerEntry.findOne({
      seller: item.seller, order: order._id, type: 'refund',
      referenceId: `${order.orderNumber}:${item._id}`,
    });
    if (already) return null;

    const net = earning.amount;

    await SellerLedgerEntry.create({
      seller: item.seller,
      type: 'refund',
      direction: 'debit',
      amount: net,
      description: `${reason} — order ${order.orderNumber} — ${item.name}`,
      referenceId: `${order.orderNumber}:${item._id}`,
      order: order._id,
    });

    const inc = { 'wallet.refundDeductions': net };
    if (earning.released) inc['wallet.availableBalance'] = -net;
    else                  inc['wallet.pendingEarnings']  = -net;
    await incWallet(item.seller, inc);

    logger.info(`[Wallet] -₹${net} (${reason}) for seller ${item.seller} (order ${order.orderNumber})`);
    return true;
  } catch (err) {
    logger.error(`[Wallet] applyRefundForItem failed: ${err.message}`);
    return null;
  }
}

/** Reverse all credited lines of an order (whole-order refund/cancel). */
async function applyRefundForOrder(order, reason = 'Order refunded') {
  for (const item of order.items || []) {
    // eslint-disable-next-line no-await-in-loop
    await applyRefundForItem(order, item, reason);
  }
}

/**
 * Cron task: move matured earnings Pending → Available.
 * Runs hourly; processes every unreleased sale_credit whose availableAt has passed.
 */
async function releaseMaturedEarnings() {
  const due = await SellerLedgerEntry.find({
    type: 'sale_credit',
    released: false,
    availableAt: { $lte: new Date() },
  }).limit(500);

  let count = 0;
  for (const entry of due) {
    // Atomic claim so concurrent runs never double-release
    const claimed = await SellerLedgerEntry.findOneAndUpdate(
      { _id: entry._id, released: false },
      { $set: { released: true, releasedAt: new Date() } },
      { new: true }
    );
    if (!claimed) continue;

    await incWallet(entry.seller, {
      'wallet.pendingEarnings':  -entry.amount,
      'wallet.availableBalance':  entry.amount,
    });
    count += 1;
  }
  if (count) logger.info(`[Wallet] Released ${count} matured earning(s) to Available`);
  return count;
}

/** Read a seller's wallet (creating profile defaults if missing). */
async function getWallet(sellerId) {
  const profile = await SellerProfile.findOne({ user: sellerId }).select('wallet bankAccount bankVerified businessName');
  const w = profile?.wallet || {};
  return {
    totalSales:       round2(w.totalSales || 0),
    totalCommission:  round2(w.totalCommission || 0),
    pendingEarnings:  round2(w.pendingEarnings || 0),
    availableBalance: round2(w.availableBalance || 0),
    totalPaidOut:     round2(w.totalPaidOut || 0),
    refundDeductions: round2(w.refundDeductions || 0),
    bankVerified:     profile?.bankVerified || 'pending',
    hasBankDetails:   Boolean(profile?.bankAccount?.accountNumber && profile?.bankAccount?.ifsc),
  };
}

module.exports = {
  round2,
  incWallet,
  creditEarningForItem,
  creditEarningsForOrder,
  applyRefundForItem,
  applyRefundForOrder,
  releaseMaturedEarnings,
  getWallet,
};
