const mongoose = require('mongoose');

const salonSpaceListingSchema = new mongoose.Schema({
  // Listing details
  title:       { type: String, required: true, trim: true },
  description: { type: String, default: '', trim: true },
  spaceType:   { type: String, enum: ['chair', 'room', 'station', 'full_salon'], default: 'chair' },
  listingType: { type: String, enum: ['rent', 'lease', 'sale'], default: 'rent' },
  price:       { type: Number, default: 0 },
  area:        { type: String, default: '', trim: true },  // e.g. "Bandra, Mumbai"
  city:        { type: String, default: '', trim: true },
  address:     { type: String, default: '', trim: true },
  amenities:   [{ type: String }],
  images:      [{ type: String }],

  // Contact
  contactName:  { type: String, default: '', trim: true },
  contactPhone: { type: String, default: '', trim: true },
  contactEmail: { type: String, default: '', trim: true },

  // Owner (the user who submitted)
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Admin workflow
  status:    { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  adminNote: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SalonSpaceListing', salonSpaceListingSchema);
