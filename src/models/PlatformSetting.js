/**
 * PlatformSetting — singleton document holding marketplace-wide config.
 * Currently: commission % and payout holding period (days).
 * Designed so Razorpay Route can be layered on later without schema change.
 */
const mongoose = require('mongoose');

const PlatformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true, index: true },

    // % of each item subtotal the platform keeps
    commissionPercent: { type: Number, default: 10, min: 0, max: 100 },

    // Days after delivery before earnings become payable
    payoutHoldingDays: { type: Number, default: 7, min: 0, max: 60 },

    // Minimum amount a seller may request for payout
    minPayoutAmount: { type: Number, default: 100, min: 0 },

    // Future: 'manual' | 'razorpay_route'
    settlementMode: { type: String, enum: ['manual', 'razorpay_route'], default: 'manual' },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Convenience: always fetch (or lazily create) the singleton
PlatformSettingSchema.statics.get = async function () {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) doc = await this.create({ key: 'global' });
  return doc;
};

module.exports = mongoose.model('PlatformSetting', PlatformSettingSchema);
