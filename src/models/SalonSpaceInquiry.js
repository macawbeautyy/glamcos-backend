const mongoose = require('mongoose');

const salonSpaceInquirySchema = new mongoose.Schema({
  spaceId:   { type: String, default: 'general' },
  spaceTitle:{ type: String, default: '' },
  name:    { type: String, required: true, trim: true },
  phone:   { type: String, required: true, trim: true },
  email:   { type: String, trim: true, default: '' },
  city:    { type: String, trim: true, default: '' },
  message: { type: String, trim: true, default: '' },
  status:  { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' },
  adminNote: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SalonSpaceInquiry', salonSpaceInquirySchema);
