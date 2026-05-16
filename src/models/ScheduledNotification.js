const mongoose = require('mongoose');

const ScheduledNotificationSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  body:        { type: String, required: true },
  screen:      { type: String, default: 'Home' },
  channel:     { type: String, default: 'default' },
  imageUrl:    { type: String },
  audience:    { type: String, required: true },
  city:        { type: String },
  daysSince:   { type: Number },
  targetIds:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  scheduledAt: { type: Date, required: true },
  timezone:    { type: String, default: 'Asia/Kolkata' },
  status:      { type: String, enum: ['pending','sent','failed','cancelled'], default: 'pending' },
  createdBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sentAt:      { type: Date },
  logId:       { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationLog' },
  retries:     { type: Number, default: 0 },
}, { timestamps: true });

ScheduledNotificationSchema.index({ scheduledAt: 1, status: 1 });

module.exports = mongoose.model('ScheduledNotification', ScheduledNotificationSchema);
