const mongoose = require('mongoose');

const SubscriptionPlanSchema = new mongoose.Schema({
  planKey:     { type: String, enum: ['free', 'basic', 'premium'], required: true, unique: true },
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  price:       { type: Number, required: true },        // INR
  durationDays:{ type: Number, required: true },        // validity
  // -1 means unlimited.
  maxListings: { type: Number, required: true },
  featuredListings: { type: Number, default: 0 },
  urgentListings:   { type: Number, default: 0 },
  // Feature flags — drives server-side gating (see requirePlanFeature in
  // jobRegistrationController) so entitlements live in one data-driven
  // place instead of being hardcoded per planKey across controllers.
  candidateSearch:      { type: Boolean, default: false },
  unlimitedApplicants:  { type: Boolean, default: false },
  interviewScheduling:  { type: Boolean, default: false },
  verifiedBadge:        { type: Boolean, default: false },
  hiringAnalytics:      { type: Boolean, default: false },
  prioritySupport:      { type: Boolean, default: false },
  multiRecruiter:       { type: Boolean, default: false },
  multiBranch:          { type: Boolean, default: false },
  bulkHiring:           { type: Boolean, default: false },
  dedicatedSupport:     { type: Boolean, default: false },
  highlights:  [{ type: String }],                      // feature bullet points
  isActive:    { type: Boolean, default: true },
  sortOrder:   { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', SubscriptionPlanSchema);
