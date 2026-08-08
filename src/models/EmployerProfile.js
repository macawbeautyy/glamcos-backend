const mongoose = require('mongoose');

const EmployerProfileSchema = new mongoose.Schema({
  user:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName: { type: String, required: true, trim: true },
  businessType: { type: String, enum: ['salon', 'spa', 'parlour', 'gym', 'clinic', 'academy', 'other'], default: 'salon' },
  phone:        { type: String, default: '' },
  email:        { type: String, default: '' },
  website:      { type: String, default: '' },
  gstNumber:    { type: String, default: '' },
  address: {
    street: { type: String, default: '' },
    city:   { type: String, default: '' },
    state:  { type: String, default: '' },
    pincode:{ type: String, default: '' },
  },
  description:  { type: String, default: '' },
  logoUrl:      { type: String, default: '' },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'suspended'],
    default: 'pending',
  },
  rejectionReason: { type: String, default: '' },
  reviewedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt:   { type: Date },

  // Subscription — plan keys are legacy internal values (free/basic/premium);
  // Phase 2 monetization displays these as Free / Professional / Business
  // everywhere in the UI. Keeping the enum values unchanged avoids a data
  // migration across every existing subscribed employer.
  subscriptionPlan: { type: String, enum: ['free', 'basic', 'premium'], default: 'free' },
  subscriptionExpiresAt: { type: Date },
  subscriptionPaidAt:    { type: Date },
  subscriptionAmount:    { type: Number, default: 0 },
  // Renewal reminders only — this app has no recurring/auto-billing
  // integration (Razorpay Subscriptions API isn't wired up), so this does
  // NOT cancel a real recurring charge. See jobRegistrationController's
  // cancelAutoRenew for the documented limitation.
  autoRenew: { type: Boolean, default: true },

  // Prepaid unlock credits (buy bundles, deduct per unlock)
  unlockCredits: { type: Number, default: 0 },

  // One-time "Featured Company" purchase — separate from job-level boosts,
  // surfaces the company in the Featured Companies carousel.
  isFeaturedCompany:       { type: Boolean, default: false },
  featuredCompanyExpiresAt:{ type: Date },

  // Usage tracking
  activeListings: { type: Number, default: 0 },
  totalListings:  { type: Number, default: 0 },
  totalHires:     { type: Number, default: 0 },
}, { timestamps: true });

EmployerProfileSchema.index({ user: 1 });
EmployerProfileSchema.index({ status: 1 });

// Plan limits — mirrors SubscriptionPlan collection's seed defaults
// (getPlans in jobRegistrationController). maxListings: -1 means unlimited.
// Keep these two in sync if pricing/limits change.
EmployerProfileSchema.virtual('planLimits').get(function () {
  const plans = {
    free:    { maxListings: 2,  featured: 0,  price: 0 },
    basic:   { maxListings: -1, featured: 1,  price: 999 },
    premium: { maxListings: -1, featured: 5,  price: 2499 },
  };
  return plans[this.subscriptionPlan] || plans.free;
});

EmployerProfileSchema.set('toJSON',  { virtuals: true });
EmployerProfileSchema.set('toObject',{ virtuals: true });

module.exports = mongoose.model('EmployerProfile', EmployerProfileSchema);
