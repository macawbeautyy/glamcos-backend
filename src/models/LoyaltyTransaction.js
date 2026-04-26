const mongoose = require('mongoose');

const loyaltyTransactionSchema = new mongoose.Schema(
  {
    user: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
      index:    true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'Booking',
    },
    referenceId: {
      type: String, // for non-booking events (e.g. referral code)
    },
    points: {
      type:     Number,
      required: true,
      // positive = earned, negative = redeemed/expired
    },
    type: {
      type:     String,
      enum:     ['earn', 'redeem', 'bonus', 'expire', 'admin_adjust'],
      required: true,
    },
    description: {
      type:    String,
      default: '',
    },
    balance: {
      type:     Number, // user's balance AFTER this transaction
      required: true,
    },
    expiresAt: {
      type: Date, // only set for earned points
    },
  },
  { timestamps: true }
);

loyaltyTransactionSchema.index({ user: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ expiresAt: 1 }, { sparse: true });

module.exports = mongoose.model('LoyaltyTransaction', loyaltyTransactionSchema);
