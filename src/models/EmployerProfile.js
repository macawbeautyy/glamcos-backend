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

  // Subscription
  subscriptionPlan: { type: String, enum: ['free', 'basic', 'premium'], default: 'free' },
  subscriptionExpiresAt: { type: Date },
  subscriptionPaidAt:    { type: Date },
  subscriptionAmount:    { type: Number, default: 0 },

  // Usage tracking
  activeListings: { type: Number, default: 0 },
  totalListings:  { type: Number, default: 0 },
  totalHires:     { type: Number, default: 0 },
}, { timestamps: true });

EmployerProfileSchema.index({ user: 1 });
EmployerProfileSchema.index({ status: 1 });

// Plan limits
EmployerProfileSchema.virtual('planLimits').get(function () {
  const plans = {
    free:    { maxListings: 1,  featured: 0,  price: 0 },
    basic:   { maxListings: 5,  featured: 1,  price: 999 },
    premium: { maxListings: 20, featured: 5,  price: 2499 },
  };
  return plans[this.subscriptionPlan] || plans.free;
});

EmployerProfileSchema.set('toJSON',  { virtuals: true });
EmployerProfileSchema.set('toObject',{ virtuals: true });

module.exports = mongoose.model('EmployerProfile', EmployerProfileSchema);
