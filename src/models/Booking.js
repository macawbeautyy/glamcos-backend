const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User',     required: true },
  service:  { type: mongoose.Schema.Types.ObjectId, ref: 'Service',  required: true },
  // Provider assigned to this booking (dual-role system)
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', default: null },
  stylist:  { type: mongoose.Schema.Types.ObjectId, ref: 'Stylist' },
  date:    { type: String, required: true },
  time:    { type: String, required: true },
  amount:  { type: Number, required: true },
  address: { type: String },
  notes:   { type: String },
  // Service mode: 'salon' (user visits) | 'home' (provider visits)
  serviceMode: { type: String, enum: ['salon', 'home'], default: 'salon' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'in-progress', 'completed', 'cancelled'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending',
  },
  cancelReason: { type: String },
}, { timestamps: true });

BookingSchema.index({ user: 1, createdAt: -1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ provider: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', BookingSchema);