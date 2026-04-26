const mongoose = require('mongoose');

const SubscriptionPlanSchema = new mongoose.Schema({
  planKey:     { type: String, enum: ['free', 'basic', 'premium'], required: true, unique: true },
  name:        { type: String, required: true },
  description: { type: String, default: '' },
  price:       { type: Number, required: true },        // INR
  durationDays:{ type: Number, required: true },        // validity
  maxListings: { type: Number, required: true },
  featuredListings: { type: Number, default: 0 },
  urgentListings:   { type: Number, default: 0 },
  highlights:  [{ type: String }],                      // feature bullet points
  isActive:    { type: Boolean, default: true },
  sortOrder:   { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionPlan', SubscriptionPlanSchema);
