const mongoose = require('mongoose');

const NotificationOpenEventSchema = new mongoose.Schema({
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationLog' },
  screen:         { type: String },
  platform:       { type: String }, // 'ios'|'android'
  openedAt:       { type: Date, default: Date.now },
}, { timestamps: false });

NotificationOpenEventSchema.index({ userId: 1, openedAt: -1 });
NotificationOpenEventSchema.index({ notificationId: 1 });
NotificationOpenEventSchema.index({ openedAt: -1 });

module.exports = mongoose.model('NotificationOpenEvent', NotificationOpenEventSchema);
