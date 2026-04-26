/**
 * SellerProfile — marketplace seller registration and status tracking
 *
 * Flow:  user submits registration → status: pending
 *        admin approves → status: approved → user.role set to 'vendor'
 *        admin rejects  → status: rejected (can reapply)
 */

const mongoose = require('mongoose');

const SellerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    // ── Business Info ──────────────────────────────────────────────────────────
    businessName: {
      type: String,
      required: [true, 'Business name is required'],
      trim: true,
      maxlength: 150,
    },
    businessType: {
      type: String,
      enum: ['individual', 'company', 'partnership', 'llp'],
      default: 'individual',
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    phone: {
      type: String,
      required: [true, 'Business phone is required'],
      trim: true,
    },

    // ── Address ────────────────────────────────────────────────────────────────
    address: {
      street:  { type: String, default: '' },
      city:    { type: String, default: '' },
      state:   { type: String, default: '' },
      pincode: { type: String, default: '' },
    },

    // ── Documents ─────────────────────────────────────────────────────────────
    gstin:     { type: String, trim: true, uppercase: true, default: null },
    panNumber: { type: String, trim: true, uppercase: true, default: null },

    // ── Bank Details ──────────────────────────────────────────────────────────
    bankAccount: {
      accountNumber: { type: String, default: null },
      ifsc:          { type: String, uppercase: true, default: null },
      bankName:      { type: String, default: null },
      accountHolder: { type: String, default: null },
    },

    // ── Status ────────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason: { type: String, default: null },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: { type: Date, default: null },

    // ── Metrics (updated by product/order post-hooks) ──────────────────────────
    totalProducts: { type: Number, default: 0 },
    totalOrders:   { type: Number, default: 0 },
    totalRevenue:  { type: Number, default: 0 },
    rating:        { type: Number, default: 0, min: 0, max: 5 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

SellerProfileSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SellerProfile', SellerProfileSchema);
