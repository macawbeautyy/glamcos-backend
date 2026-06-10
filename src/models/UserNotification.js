const mongoose = require('mongoose');

const UserNotificationSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:    { type: String, required: true },
  body:     { type: String, required: true },
  type:     { type: String },               // e.g. 'order_placed', 'seller_document_reviewed'
  screen:   { type: String, default: 'Home' }, // target screen for navigation
  params:   { type: mongoose.Schema.Types.Mixed, default: {} }, // extra nav params (ids etc.)
  imageUrl: { type: String },
  channel:  { type: String, default: 'default' },
  read:     { type: Boolean, default: false, index: true },
  readAt:   { type: Date },
}, { timestamps: true });

UserNotificationSchema.index({ user: 1, createdAt: -1 });
UserNotificationSchema.index({ user: 1, read: 1 });

module.exports = mongoose.model('UserNotification', UserNotificationSchema);
