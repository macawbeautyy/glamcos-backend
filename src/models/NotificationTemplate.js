const mongoose = require('mongoose');

const NotificationTemplateSchema = new mongoose.Schema({
  name:        { type: String, required: true, unique: true },
  title:       { type: String, required: true },
  body:        { type: String, required: true },
  screen:      { type: String, default: 'Home' },
  url:         { type: String },
  channel:     { type: String, default: 'default' },
  imageUrl:    { type: String },
  category:    { type: String, default: 'general' }, // booking|payment|promo|re-engagement|general
  variables:   [String], // e.g. ['userName','serviceName']
  isActive:    { type: Boolean, default: true },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  useCount:    { type: Number, default: 0 },
}, { timestamps: true });

NotificationTemplateSchema.index({ category: 1 });
NotificationTemplateSchema.index({ isActive: 1 });

module.exports = mongoose.model('NotificationTemplate', NotificationTemplateSchema);
