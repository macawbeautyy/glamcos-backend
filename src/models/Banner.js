const mongoose = require('mongoose');

const BannerSchema = new mongoose.Schema({
  title:          { type: String, required: true, trim: true },
  subtitle:       { type: String, trim: true, default: '' },
  tag:            { type: String, trim: true, default: '' },
  image:          { type: String, default: '' },
  color:          { type: String, default: '#EDE9FE' },
  gradientColors: { type: [String], default: [] },
  gradientAngle:  { type: Number, default: 135 },
  accentColor:    { type: String, default: '#7C3AED' },
  link:           { type: String, default: '' },
  ctaText:        { type: String, trim: true, default: '' },
  ctaLink:        { type: String, trim: true, default: '' },
  isActive:       { type: Boolean, default: true },
  order:          { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Banner', BannerSchema);
