const mongoose = require('mongoose');

const StylistSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  phone:           { type: String, trim: true },
  email:           { type: String, trim: true, lowercase: true, unique: true },
  experience:      { type: Number, default: 0 },
  skills:          [String],
  specializations: [String],
  bio:             { type: String },
  profileImage:    { type: String },
  portfolio:       [String],
  aadhaar:         { type: String },
  pan:             { type: String },
  location:        { type: String },
  bankDetails: {
    accountNumber: String,
    ifsc:          String,
    accountName:   String,
    bankName:      String,
  },
  rating:        { type: Number, default: 0, min: 0, max: 5 },
  reviewsCount:  { type: Number, default: 0 },
  totalBookings: { type: Number, default: 0 },
  isAvailable:   { type: Boolean, default: true },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  rejectionReason: { type: String },
}, { timestamps: true });

StylistSchema.index({ status: 1, rating: -1 });

module.exports = mongoose.model('Stylist', StylistSchema);