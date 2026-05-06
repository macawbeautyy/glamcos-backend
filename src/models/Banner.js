const mongoose = require('mongoose');

const BannerSchema = new mongoose.Schema({
  title:    { type: String, required: true, trim: true },
  subtitle: { type: String },
  tag:      { type: String },
  image:    { type: String, default: '' },
  color:    { type: String, default: 'rgba(108,99,255,0.75)' },
  link:     { type: String },
  isActive: { type: Boolean, default: true },
  order:    { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Banner', BannerSchema);