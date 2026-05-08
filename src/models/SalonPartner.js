const mongoose = require('mongoose');

const staffSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  role:        { type: String, default: 'Stylist', trim: true },
  bio:         { type: String, trim: true },
  specialties: [{ type: String }],
  color:       { type: String, default: '#7C3AED' },
}, { _id: true });

const salonPartnerSchema = new mongoose.Schema({
  // Owner info
  ownerName:   { type: String, required: true, trim: true },
  phone:       { type: String, required: true, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Salon info
  salonName:   { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  yearsOld:    { type: Number, required: true },
  openHours:   { type: String, default: '9:00 AM – 9:00 PM' },
  address:     { type: String, required: true, trim: true },
  city:        { type: String, required: true, trim: true },
  pincode:     { type: String, required: true, trim: true },

  // Business info
  avgMonthlySale:  { type: Number, required: true },
  seatingCapacity: { type: Number, required: true },
  hasGst:      { type: Boolean, default: false },
  gstNumber:   { type: String, trim: true },
  services:    [{ type: String }],

  // Appointment booking
  enableBooking: { type: Boolean, default: true },

  // Map coordinates
  lat: { type: Number },
  lng: { type: Number },

  // Staff members (managed by owner after approval)
  staff: [staffSchema],

  // Salon images (base64 or URLs, max 6)
  images: [{ type: String }],

  // Status
  status:     { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  adminNote:  { type: String },
  reviewedAt: { type: Date },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('SalonPartner', salonPartnerSchema);
