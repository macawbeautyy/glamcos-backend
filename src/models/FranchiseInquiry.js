const mongoose = require('mongoose');

const franchiseInquirySchema = new mongoose.Schema({
  franchiseId:   { type: String, default: 'general' },
  franchiseName: { type: String, default: 'MACAW Franchise' },
  name:    { type: String, required: true, trim: true },
  phone:   { type: String, required: true, trim: true },
  email:   { type: String, trim: true, default: '' },
  city:    { type: String, trim: true, default: '' },
  message: { type: String, trim: true, default: '' },
  status:  { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' },
  adminNote: { type: String, default: '' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

module.exports = mongoose.model('FranchiseInquiry', franchiseInquirySchema);
