const mongoose = require('mongoose');

const franchiseListingSchema = new mongoose.Schema({
  // Franchise details
  franchiseName:   { type: String, required: true, trim: true },
  tagline:         { type: String, default: '', trim: true },
  description:     { type: String, default: '', trim: true },
  category:        { type: String, default: 'Beauty & Wellness', trim: true },
  tier:            { type: String, enum: ['starter', 'standard', 'premium'], default: 'starter' },

  // Investment
  investmentMin: { type: Number, default: 0 },
  investmentMax: { type: Number, default: 0 },
  roi:           { type: String, default: '' },
  breakEven:     { type: String, default: '' },

  // Location
  city:            { type: String, default: '', trim: true },
  locationsAvail:  [{ type: String }],

  // Support
  support: [{ type: String }],

  // Contact
  contactName:  { type: String, default: '', trim: true },
  contactPhone: { type: String, default: '', trim: true },
  contactEmail: { type: String, default: '', trim: true },

  // Owner
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Admin workflow
  status:    { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('FranchiseListing', franchiseListingSchema);
