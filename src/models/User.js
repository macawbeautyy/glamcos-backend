const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');

const UserSchema = new mongoose.Schema(
  {
    // --- Identity ---
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    phone: {
      type: String,
      unique: true,
      sparse: true, // Allow multiple null values
      trim: true,
    },
    avatar: {
      type: String,
      default: null,
    },

    // --- Auth ---
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [8, 'Password must be at least 8 characters'],
      select: false, // Never return password in queries
    },
    refreshToken: {
      type: String,
      select: false,
    },

    // --- Role & Status ---
    role: {
      type: String,
      enum: {
        values: ['user', 'provider', 'vendor', 'admin', 'superadmin'],
        message: '{VALUE} is not a valid role',
      },
      default: 'user',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'banned', 'pending_verification'],
      default: 'active',
    },

    // --- Dual-Role System ---
    // Tracks where the user is in the provider onboarding funnel
    provider_status: {
      type: String,
      enum: ['none', 'pending', 'approved', 'rejected'],
      default: 'none',
    },
    // Which mode the user is currently operating in
    current_mode: {
      type: String,
      enum: ['user', 'provider'],
      default: 'user',
    },
    // Track if the "You're now a Provider" welcome modal has been shown
    provider_welcome_shown: {
      type: Boolean,
      default: false,
    },

    // --- Verification ---
    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },
    emailVerifyToken: String,
    emailVerifyExpire: Date,
    phoneOTP: String,
    phoneOTPExpire: Date,

    // --- Password Reset ---
    resetPasswordToken: String,
    resetPasswordExpire: Date,

    // --- Profile (shared across roles) ---
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: { type: String, default: 'IN' },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },

    // --- Provider-specific fields ---
    providerProfile: {
      businessName: String,
      description: String,
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      skills: [String],
      experience: Number, // years
      rating: { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 },
      totalBookings: { type: Number, default: 0 },
      completionRate: { type: Number, default: 0 },
      isAvailable: { type: Boolean, default: true },
      serviceRadius: { type: Number, default: 10 }, // km
      documents: [
        {
          type: { type: String }, // 'id', 'license', 'certification'
          url: String,
          verified: { type: Boolean, default: false },
        },
      ],
      bankDetails: {
        accountName: String,
        accountNumber: String,
        bankName: String,
        ifscCode: String,
      },
    },

    // --- Vendor-specific fields (marketplace sellers) ---
    vendorProfile: {
      shopName: String,
      shopDescription: String,
      shopLogo: String,
      shopBanner: String,
      categories: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
      rating: { type: Number, default: 0, min: 0, max: 5 },
      totalReviews: { type: Number, default: 0 },
      totalProducts: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },
      isVerified: { type: Boolean, default: false },
      commission: { type: Number, default: 15 }, // platform commission %
      gstNumber: String,
      panNumber: String,
    },

    // --- Metadata ---
    lastLogin: Date,
    loginCount: { type: Number, default: 0 },
    fcmTokens: [String], // Firebase push notification tokens
    deviceInfo: [
      {
        deviceId: String,
        platform: String, // 'ios', 'android', 'web'
        lastUsed: Date,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---- Indexes ----
// Note: email and phone already have indexes via unique:true in the schema definition
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ location: '2dsphere' });
UserSchema.index({ 'providerProfile.categories': 1, 'providerProfile.isAvailable': 1 });

// ---- Virtual: fullName ----
UserSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// ---- Pre-save: Hash password ----
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ---- Methods ----

/**
 * Compare entered password with hashed password
 */
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * Generate signed JWT access token
 */
UserSchema.methods.getSignedToken = function () {
  return jwt.sign(
    {
      id: this._id,
      role: this.role,
      email: this.email,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expire }
  );
};

/**
 * Generate refresh token
 */
UserSchema.methods.getRefreshToken = function () {
  return jwt.sign(
    { id: this._id },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpire }
  );
};

/**
 * Generate password reset token
 */
UserSchema.methods.getResetPasswordToken = function () {
  const crypto = require('crypto');
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.resetPasswordExpire = Date.now() + 30 * 60 * 1000; // 30 min

  return resetToken;
};

module.exports = mongoose.model('User', UserSchema);
