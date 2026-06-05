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
  address:     { type: String },
  homeAddress: { type: String }, // Full text address for home-visit bookings
  notes:       { type: String },
  // Service mode: 'salon' (user visits) | 'home' (provider visits)
  serviceMode: { type: String, enum: ['salon', 'home'], default: 'salon' },
  status: {
    type: String,
    // reached = provider arrived at user location (verified by GPS proximity)
    enum: ['pending', 'confirmed', 'in-progress', 'reached', 'completed', 'cancelled'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'refunded'],
    default: 'pending',
  },
  paymentMode: {
    type: String,
    enum: ['pay_at_salon', 'pay_online'],
    default: 'pay_at_salon',
  },
  razorpayOrderId:   { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },
  cancelReason: { type: String },
  // Customer GPS at time of booking — used for nearest-provider matching
  userLocation: {
    type:        { type: String, enum: ['Point'] },
    coordinates: [Number], // [longitude, latitude]
  },
  // User rating after service completion
  review: {
    rating:    { type: Number, min: 1, max: 5 },
    comment:   { type: String, maxlength: 500 },
    createdAt: { type: Date },
  },
}, { timestamps: true });

BookingSchema.index({ user: 1, createdAt: -1 });
BookingSchema.index({ status: 1 });
BookingSchema.index({ provider: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', BookingSchema);