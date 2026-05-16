const mongoose = require('mongoose');

const NotificationLogSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  body:       { type: String, required: true },
  audience:   { type: String, required: true }, // 'user'|'users'|'all'|'providers'|'city'|'inactive'
  channel:    { type: String, default: 'default' },
  screen:     { type: String, default: 'Home' },
  imageUrl:   { type: String },
  sentBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  sentCount:  { type: Number, default: 0 },
  failCount:  { type: Number, default: 0 },
  removed:    { type: Number, default: 0 },  // stale tokens cleaned
  targetIds:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // for user/users sends
  city:       { type: String },
  daysSince:  { type: Number },
  openCount:  { type: Number, default: 0 },
  status:     { type: String, enum: ['sent','failed','partial'], default: 'sent' },
  meta:       { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

NotificationLogSchema.index({ createdAt: -1 });
NotificationLogSchema.index({ audience: 1, createdAt: -1 });
NotificationLogSchema.index({ sentBy: 1 });

module.exports = mongoose.model('NotificationLog', NotificationLogSchema);
