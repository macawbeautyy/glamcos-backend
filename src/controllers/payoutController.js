/**
 * payoutController — seller wallet, payout requests, admin payout management,
 * platform settings (commission) and finance reports.
 *
 * Manual payout model: all customer money lands in the platform Razorpay
 * account; sellers are paid manually after admin approval. Designed so
 * Razorpay Route can replace the "Mark as Paid" step later without any
 * database changes (settlementMode flag on PlatformSetting).
 */
const mongoose = require('mongoose');
const Order             = require('../models/Order');
const SellerProfile     = require('../models/SellerProfile');
const SellerLedgerEntry = require('../models/SellerLedgerEntry');
const PayoutRequest     = require('../models/PayoutRequest');
const PlatformSetting   = require('../models/PlatformSetting');
const AuditLog          = require('../models/AuditLog');
const User              = require('../models/User');
const ApiError          = require('../utils/ApiError');
const ApiResponse       = require('../utils/ApiResponse');
const asyncHandler      = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/helpers');
const wallet            = require('../services/walletService');

const maskAccount = (acc) =>
  acc ? `XXXXXX${String(acc).slice(-4)}` : null;

const audit = (req, action, targetType, targetId, meta = {}) =>
  AuditLog.create({
    action,
    actor: req.user.id,
    actorRole: req.user.role,
    targetType,
    targetId: String(targetId || ''),
    meta,
    ip: req.ip || req.headers['x-forwarded-for'] || null,
  }).catch(() => {});

/* ════════════════════════════ SELLER ENDPOINTS ═══════════════════════════ */

/**
 * @desc  Seller wallet summary
 * @route GET /api/v1/payouts/wallet
 */
const getMyWallet = asyncHandler(async (req, res) => {
  const [w, settings, pendingReq] = await Promise.all([
    wallet.getWallet(req.user.id),
    PlatformSetting.get(),
    PayoutRequest.findOne({ seller: req.user.id, status: { $in: ['pending', 'approved'] } })
      .sort({ createdAt: -1 }),
  ]);
  return ApiResponse.success(res, {
    data: {
      ...w,
      commissionPercent: settings.commissionPercent,
      holdingDays:       settings.payoutHoldingDays,
      minPayoutAmount:   settings.minPayoutAmount,
      activeRequest: pendingReq
        ? { id: pendingReq._id, requestNumber: pendingReq.requestNumber, amount: pendingReq.amount, status: pendingReq.status, requestedAt: pendingReq.createdAt }
        : null,
    },
    message: 'Wallet',
  });
});

/**
 * @desc  Seller ledger (paginated, filterable by type)
 * @route GET /api/v1/payouts/ledger
 */
const getMyLedger = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { seller: req.user.id };
  if (req.query.type) filter.type = req.query.type;

  const [entries, total] = await Promise.all([
    SellerLedgerEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SellerLedgerEntry.countDocuments(filter),
  ]);
  return ApiResponse.paginated(res, { data: entries, page, limit, total, message: 'Ledger' });
});

/**
 * @desc  Create a payout request
 * @route POST /api/v1/payouts/request
 * @body  { amount, note? }
 */
const createPayoutRequest = asyncHandler(async (req, res) => {
  const amount = wallet.round2(Number(req.body.amount));
  if (!amount || amount <= 0) throw ApiError.badRequest('A valid amount is required');

  const profile = await SellerProfile.findOne({ user: req.user.id });
  if (!profile) throw ApiError.notFound('Seller profile not found');
  if (!['approved'].includes(profile.sellerStatus)) {
    throw ApiError.forbidden('Only approved sellers can request payouts');
  }
  if (!profile.bankAccount?.accountNumber || !profile.bankAccount?.ifsc) {
    throw ApiError.badRequest('Add your bank details before requesting a payout');
  }

  const settings = await PlatformSetting.get();
  if (amount < settings.minPayoutAmount) {
    throw ApiError.badRequest(`Minimum payout amount is ₹${settings.minPayoutAmount}`);
  }

  const available = wallet.round2(profile.wallet?.availableBalance || 0);
  if (amount > available) {
    throw ApiError.badRequest(`Requested amount exceeds available balance (₹${available})`);
  }

  // One open request at a time prevents over-requesting the same balance
  const open = await PayoutRequest.findOne({
    seller: req.user.id,
    status: { $in: ['pending', 'approved'] },
  });
  if (open) {
    throw ApiError.badRequest(`You already have an open payout request (${open.requestNumber})`);
  }

  const request = await PayoutRequest.create({
    seller: req.user.id,
    amount,
    sellerNote: String(req.body.note || '').slice(0, 500),
    bankSnapshot: {
      accountHolder: profile.bankAccount.accountHolder,
      accountNumber: profile.bankAccount.accountNumber,
      ifsc:          profile.bankAccount.ifsc,
      bankName:      profile.bankAccount.bankName,
      upiId:         profile.bankAccount.upiId || null,
    },
  });

  return ApiResponse.created(res, { data: request, message: 'Payout request submitted' });
});

/**
 * @desc  Seller's payout request history
 * @route GET /api/v1/payouts/requests
 */
const getMyPayoutRequests = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { seller: req.user.id };
  if (req.query.status) filter.status = req.query.status;

  const [requests, total] = await Promise.all([
    PayoutRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    PayoutRequest.countDocuments(filter),
  ]);

  // Mask account numbers in seller view too
  const data = requests.map((r) => {
    const o = r.toObject();
    if (o.bankSnapshot) o.bankSnapshot.accountNumber = maskAccount(o.bankSnapshot.accountNumber);
    return o;
  });
  return ApiResponse.paginated(res, { data, page, limit, total, message: 'Payout requests' });
});

/* ════════════════════════════ ADMIN ENDPOINTS ════════════════════════════ */

/**
 * @desc  List payout requests (admin) — filter by status
 * @route GET /api/v1/payouts/admin/requests?status=pending
 */
const adminGetPayoutRequests = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.seller) filter.seller = req.query.seller;

  const [requests, total] = await Promise.all([
    PayoutRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('seller', 'firstName lastName email phone')
      .populate('approvedBy rejectedBy paidBy', 'firstName lastName email'),
    PayoutRequest.countDocuments(filter),
  ]);

  // Attach live wallet + masked bank info per request
  const sellerIds = [...new Set(requests.map((r) => String(r.seller?._id || r.seller)))];
  const profiles = await SellerProfile.find({ user: { $in: sellerIds } })
    .select('user businessName wallet bankAccount bankVerified');
  const byUser = Object.fromEntries(profiles.map((p) => [String(p.user), p]));

  const data = requests.map((r) => {
    const o = r.toObject();
    const p = byUser[String(r.seller?._id || r.seller)];
    o.sellerProfile = p
      ? {
          businessName: p.businessName,
          wallet: p.wallet,
          bankVerified: p.bankVerified,
          bankAccountName: p.bankAccount?.accountHolder || null,
          accountNumberMasked: maskAccount(p.bankAccount?.accountNumber),
          ifsc: p.bankAccount?.ifsc || null,
          bankName: p.bankAccount?.bankName || null,
          upiId: p.bankAccount?.upiId || null,
        }
      : null;
    if (o.bankSnapshot) o.bankSnapshot.accountNumberMasked = maskAccount(o.bankSnapshot.accountNumber);
    return o;
  });

  return ApiResponse.paginated(res, { data, page, limit, total, message: 'Payout requests' });
});

/**
 * @desc  Approve a pending request
 * @route PATCH /api/v1/payouts/admin/requests/:id/approve
 */
const adminApprovePayout = asyncHandler(async (req, res) => {
  const request = await PayoutRequest.findOneAndUpdate(
    { _id: req.params.id, status: 'pending' },           // atomic guard
    { $set: { status: 'approved', approvedBy: req.user.id, approvedAt: new Date(), adminNotes: req.body.note || null } },
    { new: true }
  ).populate('seller', 'firstName lastName email');
  if (!request) throw ApiError.badRequest('Request not found or not in pending state');

  await audit(req, 'payout.approve', 'PayoutRequest', request._id, { amount: request.amount, requestNumber: request.requestNumber });
  return ApiResponse.success(res, { data: request, message: 'Payout request approved' });
});

/**
 * @desc  Reject a pending/approved request
 * @route PATCH /api/v1/payouts/admin/requests/:id/reject
 * @body  { reason }
 */
const adminRejectPayout = asyncHandler(async (req, res) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw ApiError.badRequest('A rejection reason is required');

  const request = await PayoutRequest.findOneAndUpdate(
    { _id: req.params.id, status: { $in: ['pending', 'approved'] } },
    { $set: { status: 'rejected', rejectedBy: req.user.id, rejectedAt: new Date(), rejectionReason: reason } },
    { new: true }
  ).populate('seller', 'firstName lastName email');
  if (!request) throw ApiError.badRequest('Request not found or already finalised');

  await audit(req, 'payout.reject', 'PayoutRequest', request._id, { amount: request.amount, reason });
  return ApiResponse.success(res, { data: request, message: 'Payout request rejected' });
});

/**
 * @desc  Mark an approved request as PAID — moves the money in the ledger.
 * @route PATCH /api/v1/payouts/admin/requests/:id/paid
 * @body  { payoutReference, paymentMode?, note? }
 */
const adminMarkPayoutPaid = asyncHandler(async (req, res) => {
  const payoutReference = String(req.body.payoutReference || '').trim();
  if (!payoutReference) throw ApiError.badRequest('payoutReference (UTR / transaction id) is required');

  // Atomic status flip prevents duplicate payouts even with double-clicks
  const request = await PayoutRequest.findOneAndUpdate(
    { _id: req.params.id, status: 'approved' },
    {
      $set: {
        status: 'paid',
        paidBy: req.user.id,
        paidAt: new Date(),
        payoutReference,
        paymentMode: req.body.paymentMode || 'bank_transfer',
        adminNotes: req.body.note || undefined,
      },
    },
    { new: true }
  ).populate('seller', 'firstName lastName email');
  if (!request) throw ApiError.badRequest('Request not found or not in approved state (approve it first)');

  // Deduct from wallet + ledger entry
  await wallet.incWallet(request.seller._id, {
    'wallet.availableBalance': -request.amount,
    'wallet.totalPaidOut':      request.amount,
  });
  await SellerLedgerEntry.create({
    seller: request.seller._id,
    type: 'payout',
    direction: 'debit',
    amount: request.amount,
    description: `Payout ${request.requestNumber} — ref ${payoutReference}`,
    referenceId: payoutReference,
    payoutRequest: request._id,
    createdBy: req.user.id,
  });

  await audit(req, 'payout.mark_paid', 'PayoutRequest', request._id, {
    amount: request.amount, payoutReference, requestNumber: request.requestNumber,
  });
  return ApiResponse.success(res, { data: request, message: 'Payout marked as paid' });
});

/**
 * @desc  Full ledger for one seller (admin "View Seller Ledger")
 * @route GET /api/v1/payouts/admin/sellers/:sellerId/ledger
 */
const adminGetSellerLedger = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { seller: req.params.sellerId };
  if (req.query.type) filter.type = req.query.type;

  const [entries, total, w, user, profile] = await Promise.all([
    SellerLedgerEntry.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    SellerLedgerEntry.countDocuments(filter),
    wallet.getWallet(req.params.sellerId),
    User.findById(req.params.sellerId).select('firstName lastName email phone'),
    SellerProfile.findOne({ user: req.params.sellerId }).select('businessName'),
  ]);

  return ApiResponse.paginated(res, {
    data: entries, page, limit, total, message: 'Seller ledger',
  });
  // (wallet & seller info available via /admin/sellers/:id/wallet if needed)
});

/**
 * @desc  Wallet + bank summary for one seller (admin)
 * @route GET /api/v1/payouts/admin/sellers/:sellerId/wallet
 */
const adminGetSellerWallet = asyncHandler(async (req, res) => {
  const [w, user, profile] = await Promise.all([
    wallet.getWallet(req.params.sellerId),
    User.findById(req.params.sellerId).select('firstName lastName email phone'),
    SellerProfile.findOne({ user: req.params.sellerId }).select('businessName bankAccount bankVerified'),
  ]);
  return ApiResponse.success(res, {
    data: {
      wallet: w,
      seller: user,
      businessName: profile?.businessName || null,
      bank: profile?.bankAccount
        ? { ...profile.bankAccount.toObject?.() || profile.bankAccount, accountNumberMasked: maskAccount(profile.bankAccount.accountNumber) }
        : null,
      bankVerified: profile?.bankVerified || 'pending',
    },
    message: 'Seller wallet',
  });
});

/**
 * @desc  List all sellers' bank details (admin)
 * @route GET /api/v1/payouts/admin/bank-details
 */
const adminGetBankDetails = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { 'bankAccount.accountNumber': { $ne: null } };
  if (req.query.verified) filter.bankVerified = req.query.verified;

  const [profiles, total] = await Promise.all([
    SellerProfile.find(filter)
      .select('user businessName bankAccount bankVerified wallet')
      .populate('user', 'firstName lastName email phone')
      .sort({ updatedAt: -1 }).skip(skip).limit(limit),
    SellerProfile.countDocuments(filter),
  ]);

  const data = profiles.map((p) => {
    const o = p.toObject();
    if (o.bankAccount) o.bankAccount.accountNumberMasked = maskAccount(o.bankAccount.accountNumber);
    return o;
  });
  return ApiResponse.paginated(res, { data, page, limit, total, message: 'Seller bank details' });
});

/**
 * @desc  Verify / edit a seller's bank details (admin)
 * @route PATCH /api/v1/payouts/admin/sellers/:sellerId/bank
 * @body  { accountHolder?, accountNumber?, ifsc?, bankName?, upiId?, bankVerified? }
 */
const adminUpdateSellerBank = asyncHandler(async (req, res) => {
  const profile = await SellerProfile.findOne({ user: req.params.sellerId });
  if (!profile) throw ApiError.notFound('Seller profile not found');

  const { accountHolder, accountNumber, ifsc, bankName, upiId, bankVerified } = req.body;
  profile.bankAccount = profile.bankAccount || {};
  if (accountHolder !== undefined) profile.bankAccount.accountHolder = accountHolder;
  if (accountNumber !== undefined) profile.bankAccount.accountNumber = accountNumber;
  if (ifsc          !== undefined) profile.bankAccount.ifsc          = ifsc;
  if (bankName      !== undefined) profile.bankAccount.bankName      = bankName;
  if (upiId         !== undefined) profile.bankAccount.upiId         = upiId;
  if (bankVerified && ['pending', 'verified', 'rejected'].includes(bankVerified)) {
    profile.bankVerified = bankVerified;
  }
  await profile.save();

  await audit(req, 'seller.bank_update', 'SellerProfile', profile._id, {
    sellerId: req.params.sellerId, bankVerified: profile.bankVerified,
  });
  const o = profile.toObject();
  if (o.bankAccount) o.bankAccount.accountNumberMasked = maskAccount(o.bankAccount.accountNumber);
  return ApiResponse.success(res, { data: o, message: 'Bank details updated' });
});

/**
 * @desc  Manual wallet adjustment — bonus credit or debit (admin)
 * @route POST /api/v1/payouts/admin/sellers/:sellerId/adjustment
 * @body  { amount, direction: 'credit'|'debit', description }
 */
const adminCreateAdjustment = asyncHandler(async (req, res) => {
  const amount = wallet.round2(Number(req.body.amount));
  const { direction, description = '' } = req.body;
  if (!amount || amount <= 0) throw ApiError.badRequest('A valid amount is required');
  if (!['credit', 'debit'].includes(direction)) throw ApiError.badRequest("direction must be 'credit' or 'debit'");

  const entry = await SellerLedgerEntry.create({
    seller: req.params.sellerId,
    type: direction === 'credit' ? 'adjustment_credit' : 'adjustment_debit',
    direction,
    amount,
    description: description || `Manual ${direction} by admin`,
    referenceId: `ADJ-${Date.now()}`,
    createdBy: req.user.id,
  });
  await wallet.incWallet(req.params.sellerId, {
    'wallet.availableBalance': direction === 'credit' ? amount : -amount,
  });

  await audit(req, 'wallet.adjustment', 'SellerProfile', req.params.sellerId, { amount, direction, description });
  return ApiResponse.created(res, { data: entry, message: 'Adjustment recorded' });
});

/* ═════════════════════════════ SETTINGS ══════════════════════════════════ */

/**
 * @desc  Read platform payout settings
 * @route GET /api/v1/payouts/admin/settings
 */
const adminGetSettings = asyncHandler(async (req, res) => {
  const settings = await PlatformSetting.get();
  return ApiResponse.success(res, { data: settings, message: 'Settings' });
});

/**
 * @desc  Update commission % / holding period / min payout
 * @route PUT /api/v1/payouts/admin/settings
 */
const adminUpdateSettings = asyncHandler(async (req, res) => {
  const settings = await PlatformSetting.get();
  const { commissionPercent, payoutHoldingDays, minPayoutAmount } = req.body;

  if (commissionPercent !== undefined) {
    const v = Number(commissionPercent);
    if (Number.isNaN(v) || v < 0 || v > 100) throw ApiError.badRequest('commissionPercent must be 0-100');
    settings.commissionPercent = v;
  }
  if (payoutHoldingDays !== undefined) {
    const v = Number(payoutHoldingDays);
    if (Number.isNaN(v) || v < 0 || v > 60) throw ApiError.badRequest('payoutHoldingDays must be 0-60');
    settings.payoutHoldingDays = v;
  }
  if (minPayoutAmount !== undefined) {
    const v = Number(minPayoutAmount);
    if (Number.isNaN(v) || v < 0) throw ApiError.badRequest('minPayoutAmount must be >= 0');
    settings.minPayoutAmount = v;
  }
  settings.updatedBy = req.user.id;
  await settings.save();

  await audit(req, 'settings.update', 'PlatformSetting', settings._id, {
    commissionPercent: settings.commissionPercent,
    payoutHoldingDays: settings.payoutHoldingDays,
    minPayoutAmount:   settings.minPayoutAmount,
  });
  return ApiResponse.success(res, { data: settings, message: 'Settings updated' });
});

/* ═════════════════════════════ REPORTS ═══════════════════════════════════ */

/**
 * @desc  Admin finance report — GMV, commission, payouts, refunds, per-seller revenue
 * @route GET /api/v1/payouts/admin/reports?from=&to=
 */
const adminGetReports = asyncHandler(async (req, res) => {
  const range = {};
  if (req.query.from) range.$gte = new Date(req.query.from);
  if (req.query.to)   { const t = new Date(req.query.to); t.setHours(23, 59, 59, 999); range.$lte = t; }
  const dateMatch = Object.keys(range).length ? { createdAt: range } : {};

  const [gmvAgg, ledgerAgg, payoutAgg, sellerWise] = await Promise.all([
    // GMV: paid orders total
    Order.aggregate([
      { $match: { 'payment.status': { $in: ['paid', 'refunded', 'partial_refund'] }, ...dateMatch } },
      { $group: { _id: null, gmv: { $sum: '$total' }, orders: { $sum: 1 } } },
    ]),
    // Ledger sums by type
    SellerLedgerEntry.aggregate([
      { $match: { ...dateMatch } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Payout request pipeline state
    PayoutRequest.aggregate([
      { $match: { ...dateMatch } },
      { $group: { _id: '$status', total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
    // Seller-wise revenue (top 50 by gross sales)
    SellerLedgerEntry.aggregate([
      { $match: { type: 'sale_credit', ...dateMatch } },
      { $group: {
          _id: '$seller',
          grossSales: { $sum: '$grossAmount' },
          commission: { $sum: '$commissionAmount' },
          netEarnings:{ $sum: '$amount' },
          orders:     { $sum: 1 },
      } },
      { $sort: { grossSales: -1 } },
      { $limit: 50 },
      { $lookup: { from: 'sellerprofiles', localField: '_id', foreignField: 'user', as: 'profile' } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $project: {
          grossSales: 1, commission: 1, netEarnings: 1, orders: 1,
          businessName: { $arrayElemAt: ['$profile.businessName', 0] },
          sellerName: { $concat: [
            { $ifNull: [{ $arrayElemAt: ['$user.firstName', 0] }, ''] }, ' ',
            { $ifNull: [{ $arrayElemAt: ['$user.lastName', 0] }, ''] },
          ] },
          email: { $arrayElemAt: ['$user.email', 0] },
      } },
    ]),
  ]);

  const byType   = Object.fromEntries(ledgerAgg.map((l) => [l._id, { total: l.total, count: l.count }]));
  const byStatus = Object.fromEntries(payoutAgg.map((p) => [p._id, { total: p.total, count: p.count }]));

  // Live wallet totals across all sellers (not date-filtered — current state)
  const walletAgg = await SellerProfile.aggregate([
    { $group: {
        _id: null,
        pendingEarnings:  { $sum: '$wallet.pendingEarnings' },
        availableBalance: { $sum: '$wallet.availableBalance' },
        totalPaidOut:     { $sum: '$wallet.totalPaidOut' },
    } },
  ]);

  return ApiResponse.success(res, {
    data: {
      gmv:              gmvAgg[0]?.gmv || 0,
      paidOrders:       gmvAgg[0]?.orders || 0,
      commissionEarned: byType.commission?.total || 0,
      sellerEarnings:   byType.sale_credit?.total || 0,
      refundDeductions: byType.refund?.total || 0,
      payoutsPaid:      byType.payout?.total || 0,
      requests: {
        pending:  byStatus.pending  || { total: 0, count: 0 },
        approved: byStatus.approved || { total: 0, count: 0 },
        paid:     byStatus.paid     || { total: 0, count: 0 },
        rejected: byStatus.rejected || { total: 0, count: 0 },
      },
      walletTotals: walletAgg[0] || { pendingEarnings: 0, availableBalance: 0, totalPaidOut: 0 },
      sellerWise,
    },
    message: 'Finance report',
  });
});

/**
 * @desc  Seller's own reports (sales / earnings / payouts summary)
 * @route GET /api/v1/payouts/reports?from=&to=
 */
const getMyReports = asyncHandler(async (req, res) => {
  const range = {};
  if (req.query.from) range.$gte = new Date(req.query.from);
  if (req.query.to)   { const t = new Date(req.query.to); t.setHours(23, 59, 59, 999); range.$lte = t; }
  const dateMatch = Object.keys(range).length ? { createdAt: range } : {};
  const sellerId = new mongoose.Types.ObjectId(req.user.id);

  const [ledgerAgg, w] = await Promise.all([
    SellerLedgerEntry.aggregate([
      { $match: { seller: sellerId, ...dateMatch } },
      { $group: { _id: '$type', total: { $sum: '$amount' }, gross: { $sum: '$grossAmount' }, count: { $sum: 1 } } },
    ]),
    wallet.getWallet(req.user.id),
  ]);
  const byType = Object.fromEntries(ledgerAgg.map((l) => [l._id, l]));

  return ApiResponse.success(res, {
    data: {
      wallet: w,
      sales:      { gross: byType.sale_credit?.gross || 0, net: byType.sale_credit?.total || 0, items: byType.sale_credit?.count || 0 },
      commission: byType.commission?.total || 0,
      refunds:    byType.refund?.total || 0,
      payouts:    byType.payout?.total || 0,
    },
    message: 'Seller report',
  });
});

/**
 * @desc  Audit trail for payout actions (admin)
 * @route GET /api/v1/payouts/admin/audit-logs
 */
const adminGetAuditLogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.action)   filter.action = { $regex: req.query.action, $options: 'i' };
  if (req.query.targetId) filter.targetId = req.query.targetId;

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit)
      .populate('actor', 'firstName lastName email'),
    AuditLog.countDocuments(filter),
  ]);
  return ApiResponse.paginated(res, { data: logs, page, limit, total, message: 'Audit logs' });
});

module.exports = {
  // Seller
  getMyWallet,
  getMyLedger,
  createPayoutRequest,
  getMyPayoutRequests,
  getMyReports,
  // Admin
  adminGetPayoutRequests,
  adminApprovePayout,
  adminRejectPayout,
  adminMarkPayoutPaid,
  adminGetSellerLedger,
  adminGetSellerWallet,
  adminGetBankDetails,
  adminUpdateSellerBank,
  adminCreateAdjustment,
  adminGetSettings,
  adminUpdateSettings,
  adminGetReports,
  adminGetAuditLogs,
};
