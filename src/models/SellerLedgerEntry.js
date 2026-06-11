/**
 * SellerLedgerEntry — immutable double-entry style ledger for seller wallets.
 *
 * Credit types : sale_credit (net earning after commission), adjustment_credit (bonus)
 * Debit types  : commission (informational, paired with sale gross), refund, payout, adjustment_debit
 *
 * sale_credit entries carry the holding-period metadata:
 *   availableAt — date the earning matures
 *   released    — whether it has been moved from Pending → Available
 */
const mongoose = require('mongoose');

const SellerLedgerEntrySchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    type: {
      type: String,
      enum: ['sale_credit', 'commission', 'refund', 'payout', 'adjustment_credit', 'adjustment_debit'],
      required: true,
      index: true,
    },
    direction: { type: String, enum: ['credit', 'debit'], required: true },

    // Always positive; direction says which way it moves
    amount: { type: Number, required: true, min: 0 },

    // For sale_credit: breakdown snapshot
    grossAmount:       { type: Number, default: null }, // item subtotal
    commissionPercent: { type: Number, default: null },
    commissionAmount:  { type: Number, default: null },

    description: { type: String, default: '' },
    referenceId: { type: String, default: null, index: true }, // orderNumber / payout ref / manual ref

    // Relations
    order:         { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
    orderItem:     { type: mongoose.Schema.Types.ObjectId, default: null }, // line item _id
    payoutRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'PayoutRequest', default: null },

    // Holding period (sale_credit only)
    availableAt: { type: Date, default: null, index: true },
    released:    { type: Boolean, default: false, index: true },
    releasedAt:  { type: Date, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

SellerLedgerEntrySchema.index({ seller: 1, createdAt: -1 });
// Idempotency guard: one earning credit per order line per seller
SellerLedgerEntrySchema.index(
  { seller: 1, order: 1, orderItem: 1, type: 1 },
  { unique: true, partialFilterExpression: { order: { $type: 'objectId' }, orderItem: { $type: 'objectId' } } }
);

module.exports = mongoose.model('SellerLedgerEntry', SellerLedgerEntrySchema);
