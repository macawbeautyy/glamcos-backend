const mongoose = require('mongoose');

const salonAppointmentSchema = new mongoose.Schema({
  partnerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'SalonPartner', required: true },
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userName:    { type: String, required: true },
  userPhone:   { type: String, required: true },
  service:     { type: String, required: true },
  date:        { type: String, required: true },   // 'YYYY-MM-DD'
  timeSlot:    { type: String, required: true },   // 'HH:MM'
  tokenAmount: { type: Number, default: 0 },
  status:      { type: String, enum: ['booked','confirmed','completed','cancelled'], default: 'booked' },
  note:        { type: String },
}, { timestamps: true });

// Prevent double booking same slot at same salon
salonAppointmentSchema.index({ partnerId: 1, date: 1, timeSlot: 1 }, { unique: true });

module.exports = mongoose.model('SalonAppointment', salonAppointmentSchema);
