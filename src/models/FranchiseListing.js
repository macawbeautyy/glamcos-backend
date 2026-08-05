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

  // Photos — Cloudinary secure_urls, first image is treated as the cover.
  images: [{ type: String }],

  // Optional franchise brochure/pitch-deck PDF — Cloudinary raw-resource URL.
  brochureUrl:  { type: String, default: '', trim: true },
  brochureName: { type: String, default: '', trim: true },

  // Contact
  contactName:  { type: String, default: '', trim: true },
  contactPhone: { type: String, default: '', trim: true },
  contactEmail: { type: String, default: '', trim: true },

  // Owner
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Admin workflow
  status:    { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },

  // Set to true whenever an owner edits an already-approved listing, so it
  // drops back into the pending queue for re-review without losing the fact
  // that it was live before (admin panel can badge these as "re-review").
  wasApprovedBeforeEdit: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('FranchiseListing', franchiseListingSchema);
