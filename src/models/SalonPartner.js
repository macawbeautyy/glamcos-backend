const mongoose = require('mongoose');

const salonPartnerSchema = new mongoose.Schema({
  // Owner info
  ownerName:   { type: String, required: true, trim: true },
  phone:       { type: String, required: true, trim: true },
  email:       { type: String, trim: true, lowercase: true },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  // Salon info
  salonName:   { type: String, required: true, trim: true },
  yearsOld:    { type: Number, required: true },          // how old the salon is
  address:     { type: String, required: true, trim: true },
  city:        { type: String, required: true, trim: true },
  pincode:     { type: String, required: true, trim: true },

  // Business info
  avgMonthlySale: { type: Number, required: true },       // in ₹
  seatingCapacity:{ type: Number, required: true },       // number of chairs
  hasGst:      { type: Boolean, default: false },
  gstNumber:   { type: String, trim: true },
  services:    [{ type: String }],                        // e.g. ['Hair', 'Nails', 'Skin']

  // Appointment booking interest
  enableBooking: { type: Boolean, default: true },

  // Map coordinates (auto-filled on approval via geocoding)
  lat:         { type: Number },
  lng:         { type: Number },

  // Status
  status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  adminNote:   { type: String },
  reviewedAt:  { type: Date },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('SalonPartner', salonPartnerSchema);
