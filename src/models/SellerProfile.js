/**
 * SellerProfile — marketplace seller registration, onboarding and status tracking
 *
 * Onboarding Flow:
 *   Step 1: Business Information (GST, legal name, address)
 *   Step 2: Bank Account Details
 *   Final: Admin verification → approved / rejected
 */

const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  url:        { type: String, default: null },
  status:     { type: String, enum: ['pending', 'uploaded', 'approved', 'rejected'], default: 'pending' },
  uploadedAt: { type: Date, default: null },
  reviewNote: { type: String, default: null },
}, { _id: false });

const SellerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    // ── Onboarding Progress ────────────────────────────────────────────────────
    onboardingStep:      { type: Number, default: 0, min: 0, max: 3 },
    onboardingCompleted: { type: Boolean, default: false },

    // ── Business Info (Step 1) ─────────────────────────────────────────────────
    businessName: {
      type: String,
      trim: true,
      maxlength: 150,
      default: '',
    },
    legalBusinessName: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
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
      default: '',
    },
    phone: { type: String, trim: true, default: '' },

    // ── GST Details ────────────────────────────────────────────────────────────
    gstNumber: { type: String, trim: true, uppercase: true, default: null },
    gstin:     { type: String, trim: true, uppercase: true, default: null }, // legacy compat
    gstVerified: { type: Boolean, default: false },
    gstStatus: {
      type: String,
      enum: ['not_provided', 'pending_verification', 'verified', 'failed', 'manual_review'],
      default: 'not_provided',
    },
    gstFetchedData: {
      legalName:           { type: String, default: null },
      tradeName:           { type: String, default: null },
      gstStatus:           { type: String, default: null },
      registeredAddress:   { type: String, default: null },
      state:               { type: String, default: null },
      pincode:             { type: String, default: null },
      fetchedAt:           { type: Date,   default: null },
    },

    // ── Address ────────────────────────────────────────────────────────────────
    address: {  // legacy nested — kept for backward compat
      street:  { type: String, default: '' },
      city:    { type: String, default: '' },
      state:   { type: String, default: '' },
      pincode: { type: String, default: '' },
    },
    businessAddress: { type: String, trim: true, default: '' },
    businessState:   { type: String, trim: true, default: '' },
    businessCity:    { type: String, trim: true, default: '' },
    businessPincode: { type: String, trim: true, default: '' },

    // ── Documents ─────────────────────────────────────────────────────────────
    gstCertificate:           { type: DocumentSchema, default: () => ({}) },
    brandAuthorizationLetter: { type: DocumentSchema, default: () => ({}) },
    manufacturerAuthDocument: { type: DocumentSchema, default: () => ({}) },
    businessAddressProof:     { type: DocumentSchema, default: () => ({}) },

    panNumber: { type: String, trim: true, uppercase: true, default: null },

    // ── Bank Details (Step 2) ──────────────────────────────────────────────────
    bankAccount: {
      accountHolder:  { type: String, default: null },
      accountNumber:  { type: String, default: null },
      ifsc:           { type: String, uppercase: true, default: null },
      bankName:       { type: String, default: null },
      branchName:     { type: String, default: null },
      branchAddress:  { type: String, default: null },
      upiId:          { type: String, default: null },
    },
    // Flat mirror fields for easy admin querying
    bankName:      { type: String, default: null },
    branchName:    { type: String, default: null },
    branchAddress: { type: String, default: null },
    bankVerified: {
      type: String,
      enum: ['pending', 'verified', 'rejected'],
      default: 'pending',
    },

    // ── Wallet (manual payout model) ──────────────────────────────────────────
    wallet: {
      totalSales:       { type: Number, default: 0 },  // gross item sales (delivered, paid)
      totalCommission:  { type: Number, default: 0 },  // platform commission deducted
      pendingEarnings:  { type: Number, default: 0 },  // net earnings inside holding period
      availableBalance: { type: Number, default: 0 },  // matured, payable now (may go negative after refunds)
      totalPaidOut:     { type: Number, default: 0 },  // lifetime payouts marked paid
      refundDeductions: { type: Number, default: 0 },  // lifetime refund deductions
    },

    // ── Status ────────────────────────────────────────────────────────────────
    sellerStatus: {
      type: String,
      enum: ['incomplete', 'submitted', 'under_review', 'approved', 'rejected', 'suspended'],
      default: 'incomplete',
      index: true,
    },
    status: {  // legacy — synced with sellerStatus on save
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected', 'suspended'],
      default: 'pending',
      index: true,
    },
    rejectionReason:  { type: String, default: null },
    adminNotes:       { type: String, default: null },
    requestedChanges: { type: String, default: null },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: { type: Date, default: null },

    // ── Metrics ────────────────────────────────────────────────────────────────
    totalProducts: { type: Number, default: 0 },
    totalOrders:   { type: Number, default: 0 },
    totalRevenue:  { type: Number, default: 0 },
    rating:        { type: Number, default: 0, min: 0, max: 5 },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

SellerProfileSchema.index({ status: 1, createdAt: -1 });
SellerProfileSchema.index({ sellerStatus: 1, createdAt: -1 });
SellerProfileSchema.index({ gstNumber: 1 });

// ── Pre-save: sync legacy fields ──────────────────────────────────────────────
SellerProfileSchema.pre('save', function (next) {
  // Sync gstNumber <-> gstin
  if (this.isModified('gstNumber') && this.gstNumber) this.gstin = this.gstNumber;
  if (this.isModified('gstin') && this.gstin && !this.gstNumber) this.gstNumber = this.gstin;

  // Sync flat bank fields from nested bankAccount
  if (this.bankAccount) {
    if (this.bankAccount.bankName)      this.bankName      = this.bankAccount.bankName;
    if (this.bankAccount.branchName)    this.branchName    = this.bankAccount.branchName;
    if (this.bankAccount.branchAddress) this.branchAddress = this.bankAccount.branchAddress;
  }

  // Sync legacy address <-> flat fields (only if flat are empty)
  if (this.address) {
    if (!this.businessCity    && this.address.city)    this.businessCity    = this.address.city;
    if (!this.businessState   && this.address.state)   this.businessState   = this.address.state;
    if (!this.businessPincode && this.address.pincode) this.businessPincode = this.address.pincode;
    if (!this.businessAddress && this.address.street)  this.businessAddress = this.address.street;
  }

  // Sync sellerStatus <-> legacy status
  const FORWARD = { incomplete: 'pending', submitted: 'pending' };
  if (this.isModified('sellerStatus')) {
    this.status = FORWARD[this.sellerStatus] || this.sellerStatus;
  } else if (this.isModified('status') && !this.isModified('sellerStatus')) {
    if (this.status === 'pending' && this.sellerStatus === 'incomplete') {
      /* leave sellerStatus as-is */
    } else {
      this.sellerStatus = this.status === 'pending' ? 'submitted' : this.status;
    }
  }

  next();
});

module.exports = mongoose.model('SellerProfile', SellerProfileSchema);
