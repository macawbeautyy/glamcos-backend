const mongoose = require('mongoose');

// One row per screen-view or tap. Screen-view duration is computed on read
// (gap to the next event in the same session) rather than stored, so the
// client doesn't need to know how long a screen was open before logging it.
const UserActivityEventSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId: { type: String, default: '' }, // groups events from one app open
  type:      { type: String, enum: ['screen_view', 'tap', 'app_open', 'app_close'], required: true },
  screen:    { type: String, default: '' }, // route name, e.g. "HomeScreen"
  label:     { type: String, default: '' }, // tapped element, e.g. "job_apply_button"
  meta:      { type: mongoose.Schema.Types.Mixed, default: undefined },
  platform:  { type: String, default: '' }, // 'ios' | 'android' | 'web'
  clientAt:  { type: Date, required: true }, // timestamp from the device, not server receipt time
}, { timestamps: { createdAt: 'receivedAt', updatedAt: false } });

UserActivityEventSchema.index({ user: 1, clientAt: 1 });
UserActivityEventSchema.index({ clientAt: -1 });
// Auto-expire raw events after 90 days to keep the collection bounded —
// adjust or remove if you want to keep full history forever.
UserActivityEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

module.exports = mongoose.model('UserActivityEvent', UserActivityEventSchema);
