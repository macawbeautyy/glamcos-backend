/**
 * Loyalty Points Engine
 *
 * Rules:
 *  - Earn 5% of booking amount as points (1 point = ₹0.50)
 *  - Points expire after 12 months
 *  - Subscription plan multipliers apply at earn time
 *  - Cannot redeem more points than booking amount covers
 *  - Minimum 100 points required to redeem
 */

const User               = require('../models/User');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const ApiError           = require('../utils/ApiError');

const POINT_VALUE   = 0.50;   // ₹ per point
const BASE_RATE     = 0.05;   // 5% of booking amount → points
const MIN_REDEEM    = 100;    // minimum points to redeem at once
const EXPIRY_MONTHS = 12;

const PLAN_MULTIPLIERS = {
  basic: 1.0,
  pro:   1.5,
  elite: 2.0,
};

const BONUS_EVENTS = {
  first_booking: 200,
  write_review:  50,
  refer_friend:  500,
  birthday:      300,
};

/**
 * Calculate how many points a booking earns.
 * @param {number} amount - booking amount in ₹
 * @param {string} planName - user's subscription plan
 */
function calculateEarnedPoints(amount, planName = 'basic') {
  const multiplier = PLAN_MULTIPLIERS[planName] ?? 1.0;
  return Math.floor(amount * BASE_RATE * 2 * multiplier); // *2: each ₹1 → 0.1 points at 5%
}

/**
 * Award points to a user after a completed booking.
 */
async function earnFromBooking(userId, bookingId, amount, planName) {
  const points = calculateEarnedPoints(amount, planName);
  if (points <= 0) return { points: 0 };

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { loyaltyPoints: points } },
    { new: true }
  );

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + EXPIRY_MONTHS);

  await LoyaltyTransaction.create({
    user:        userId,
    bookingId,
    points,
    type:        'earn',
    description: `Earned for booking`,
    balance:     user.loyaltyPoints,
    expiresAt,
  });

  return { points, newBalance: user.loyaltyPoints };
}

/**
 * Award bonus points for a specific event (first booking, referral, etc.).
 */
async function earnBonus(userId, eventType, referenceId = null) {
  const points = BONUS_EVENTS[eventType];
  if (!points) throw new Error(`Unknown bonus event: ${eventType}`);

  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { loyaltyPoints: points } },
    { new: true }
  );

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + EXPIRY_MONTHS);

  await LoyaltyTransaction.create({
    user:        userId,
    referenceId,
    points,
    type:        'bonus',
    description: `Bonus: ${eventType.replace(/_/g, ' ')}`,
    balance:     user.loyaltyPoints,
    expiresAt,
  });

  return { points, newBalance: user.loyaltyPoints };
}

/**
 * Validate and lock points for redemption (call during checkout).
 * Returns the ₹ discount amount.
 */
async function validateRedemption(userId, pointsToUse) {
  if (pointsToUse < MIN_REDEEM) {
    throw ApiError.badRequest(`Minimum ${MIN_REDEEM} points required to redeem`);
  }

  const user = await User.findById(userId).select('loyaltyPoints');
  if (!user) throw ApiError.notFound('User not found');

  if (user.loyaltyPoints < pointsToUse) {
    throw ApiError.badRequest(
      `Insufficient points. You have ${user.loyaltyPoints} points.`
    );
  }

  const discount = parseFloat((pointsToUse * POINT_VALUE).toFixed(2));
  return { discount, pointsToUse };
}

/**
 * Deduct points after a successful booking with redemption.
 */
async function redeemPoints(userId, bookingId, pointsToUse) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $inc: { loyaltyPoints: -pointsToUse } },
    { new: true }
  );

  await LoyaltyTransaction.create({
    user:        userId,
    bookingId,
    points:      -pointsToUse,
    type:        'redeem',
    description: `Redeemed on booking`,
    balance:     user.loyaltyPoints,
  });

  const discount = parseFloat((pointsToUse * POINT_VALUE).toFixed(2));
  return { discount, newBalance: user.loyaltyPoints };
}

/**
 * Get loyalty summary for a user (balance, tier, history).
 */
async function getLoyaltySummary(userId) {
  const user = await User.findById(userId).select('loyaltyPoints subscriptionPlan');
  const transactions = await LoyaltyTransaction.find({ user: userId })
    .sort('-createdAt')
    .limit(20)
    .lean();

  const totalEarned  = transactions.filter(t => t.points > 0).reduce((s, t) => s + t.points, 0);
  const totalRedeemed = Math.abs(transactions.filter(t => t.points < 0).reduce((s, t) => s + t.points, 0));
  const cashValue    = parseFloat((user.loyaltyPoints * POINT_VALUE).toFixed(2));

  // Tier thresholds
  let tier = 'Bronze';
  if (totalEarned >= 5000) tier = 'Gold';
  else if (totalEarned >= 2000) tier = 'Silver';

  return {
    balance:       user.loyaltyPoints,
    cashValue,
    tier,
    totalEarned,
    totalRedeemed,
    pointValue:    POINT_VALUE,
    minRedeem:     MIN_REDEEM,
    multiplier:    PLAN_MULTIPLIERS[user.subscriptionPlan] ?? 1.0,
    transactions,
  };
}

module.exports = {
  calculateEarnedPoints,
  earnFromBooking,
  earnBonus,
  validateRedemption,
  redeemPoints,
  getLoyaltySummary,
  POINT_VALUE,
  MIN_REDEEM,
  BONUS_EVENTS,
};
