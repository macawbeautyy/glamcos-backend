/**
 * PayoutRequest — seller asks for a manual payout of their available balance.
 * Status flow: pending → approved → paid
 *                       ↘ rejected
 */
const mongoose = require('mongoose');

const PayoutRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, unique: true, index: true },

    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    amount: { type: Number, required: true, min: 1 },

    // Snapshot of bank details at request time (audit safety)
    bankSnapshot: {
      accountHolder: { type: String, default: null },
      accountNumber: { type: String, default: null },
      ifsc:          { type: String, default: null },
      bankName:      { type: String, default: null },
      upiId:         { type: String, default: null },
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'paid'],
      default: 'pending',
      index: true,
    },

    sellerNote: { type: String, default: '' },

    // Admin workflow trail
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },

    paidBy:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    paidAt:          { type: Date, default: null },
    payoutReference: { type: String, default: null },   // UTR / transaction id
    paymentMode:     { type: String, enum: ['bank_transfer', 'upi', 'other', null], default: null },
    adminNotes:      { type: String, default: null },
  },
  { timestamps: true }
);

PayoutRequestSchema.index({ status: 1, createdAt: -1 });

PayoutRequestSchema.pre('save', function (next) {
  if (!this.requestNumber) {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
    this.requestNumber = `PAY-${yy}${mm}${dd}-${rand}`;
  }
  next();
});

module.exports = mongoose.model('PayoutRequest', PayoutRequestSchema);
