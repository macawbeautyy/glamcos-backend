const mongoose = require('mongoose');

const providerSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      unique:   true,
    },

    // ── Onboarding Step 1: Basic Info ──────────────────────────────────────
    displayName:  { type: String, trim: true },
    bio:          { type: String, maxlength: 500 },
    avatar:       { type: String, default: '' }, // Firebase Storage URL
    city:         { type: String, trim: true },
    pincode:      { type: String, trim: true },
    dateOfBirth:  { type: Date },

    // ── Onboarding Step 2: Professional Details ────────────────────────────
    servicesOffered: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Service' }],
    categories:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    experience:      { type: Number, default: 0 }, // years
    certifications:  [{ name: String, issuedBy: String, year: Number }],
    portfolio:       [{ url: String, caption: String, uploadedAt: Date }], // up to 10

    // ── Onboarding Step 3: KYC ─────────────────────────────────────────────
    kycDocs: {
      aadhaarFront: { type: String, default: '' },
      aadhaarBack:  { type: String, default: '' },
      pan:          { type: String, default: '' },
      selfie:       { type: String, default: '' },
    },

    // ── Onboarding Step 4: Bank Details ────────────────────────────────────
    bankDetails: {
      accountHolderName: { type: String },
      bankName:          { type: String },
      accountNumber:     { type: String },
      ifscCode:          { type: String },
      accountType:       { type: String, enum: ['savings', 'current'], default: 'savings' },
      verified:          { type: Boolean, default: false },
    },

    // ── Status ─────────────────────────────────────────────────────────────
    status: {
      type:    String,
      enum:    ['pending', 'kyc_pending', 'approved', 'active', 'suspended', 'rejected'],
      default: 'pending',
      index:   true,
    },
    onboardingStep: {
      type:    Number,
      default: 1, // 1-5
    },
    rejectionReason: { type: String },
    approvedBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt:      { type: Date },

    // ── Real-time Availability ─────────────────────────────────────────────
    isAvailable: { type: Boolean, default: false },
    isOnline:    { type: Boolean, default: false },
    workingHours: {
      mon: { from: String, to: String, off: Boolean },
      tue: { from: String, to: String, off: Boolean },
      wed: { from: String, to: String, off: Boolean },
      thu: { from: String, to: String, off: Boolean },
      fri: { from: String, to: String, off: Boolean },
      sat: { from: String, to: String, off: Boolean },
      sun: { from: String, to: String, off: Boolean },
    },

    // ── Stats ──────────────────────────────────────────────────────────────
    rating:          { type: Number, default: 0, min: 0, max: 5 },
    totalReviews:    { type: Number, default: 0 },
    totalBookings:   { type: Number, default: 0 },
    completedBookings: { type: Number, default: 0 },
    totalEarnings:   { type: Number, default: 0 },
    walletBalance:   { type: Number, default: 0 },
  },
  { timestamps: true }
);

providerSchema.index({ status: 1, createdAt: -1 });
providerSchema.index({ city: 1, isAvailable: 1 });

module.exports = mongoose.model('Provider', providerSchema);
