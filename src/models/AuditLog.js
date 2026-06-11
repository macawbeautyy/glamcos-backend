/**
 * AuditLog — records every sensitive admin action (payouts, bank edits, settings).
 */
const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
  {
    action:   { type: String, required: true, index: true }, // e.g. payout.approve
    actor:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    actorRole:{ type: String, default: null },

    targetType: { type: String, default: null },  // PayoutRequest | SellerProfile | PlatformSetting
    targetId:   { type: String, default: null, index: true },

    meta: { type: Object, default: {} },
    ip:   { type: String, default: null },
  },
  { timestamps: true }
);

AuditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
