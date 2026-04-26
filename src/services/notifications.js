/**
 * Push Notification Service
 * Uses Expo Push Notification API (works with both Android FCM + iOS APNs).
 * No native Firebase SDK required — just HTTP to Expo's endpoint.
 */

const axios  = require('axios');
const User   = require('../models/User');
const logger = require('../utils/logger');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Send a push notification to one or many Expo push tokens.
 *
 * @param {object|object[]} messages — single message or array
 * Each message: { to, title, body, data, sound, badge, channelId }
 */
async function sendPush(messages) {
  const batch = Array.isArray(messages) ? messages : [messages];

  // Filter out invalid tokens silently
  const valid = batch.filter(
    (m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken[')
  );

  if (valid.length === 0) return { sent: 0 };

  try {
    const { data } = await axios.post(EXPO_PUSH_URL, valid, {
      headers: {
        Accept:         'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
    return { sent: valid.length, receipts: data.data };
  } catch (err) {
    logger.error('[Push] Send failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

/**
 * Notify a user by their MongoDB user ID (looks up fcmToken internally).
 */
async function notifyUser(userId, { title, body, data = {}, sound = 'default' }) {
  const user = await User.findById(userId).select('fcmTokens').lean();
  if (!user?.fcmTokens?.length) return;
  // Send to all registered devices for this user
  const messages = user.fcmTokens.map((token) => ({ to: token, title, body, data, sound }));
  return sendPush(messages);
}

/**
 * Notify multiple users at once (batch lookup).
 */
async function notifyUsers(userIds, payload) {
  const users = await User.find({ _id: { $in: userIds } })
    .select('fcmTokens').lean();

  const messages = users
    .flatMap((u) => (u.fcmTokens || []).map((token) => ({ to: token, ...payload })));

  return sendPush(messages);
}

// ── Pre-built notification templates ─────────────────────────────────────────

const Notif = {
  // Sent immediately when a booking is created — lets user know we received it
  bookingReceived: (userId, { bookingId, serviceName, date, time }) =>
    notifyUser(userId, {
      title: `Booking Received! 🎉`,
      body:  `We got your ${serviceName} booking for ${date} at ${time}. A provider will confirm shortly.`,
      data:  { screen: 'Appointments', bookingId },
    }),

  bookingConfirmed: (userId, { bookingId, serviceName, date }) =>
    notifyUser(userId, {
      title: `Booking Confirmed ✅`,
      body:  `Your ${serviceName} is booked for ${date}. A provider has been assigned.`,
      data:  { screen: 'Appointments', bookingId },
    }),

  providerOnTheWay: (userId, { bookingId, providerName, eta }) =>
    notifyUser(userId, {
      title: `${providerName} is on the way! 🚗`,
      body:  `Estimated arrival: ${eta}. Get ready!`,
      data:  { screen: 'Tracking', bookingId },
    }),

  serviceCompleted: (userId, { bookingId, serviceName }) =>
    notifyUser(userId, {
      title: `Service Completed ⭐`,
      body:  `How was your ${serviceName}? Tap to leave a review.`,
      data:  { screen: 'Appointments', bookingId, action: 'rate' },
    }),

  loyaltyMilestone: (userId, { points, milestone }) =>
    notifyUser(userId, {
      title: `🎉 You've earned ${milestone} loyalty points!`,
      body:  `You now have ${points} total points — worth ₹${Math.floor(points * 0.5)}.`,
      data:  { screen: 'Loyalty' },
    }),

  newBookingRequest: (providerId, { bookingId, serviceName, userFirstName, date }) =>
    notifyUser(providerId, {
      title: `New Booking Request 📅`,
      body:  `${userFirstName} booked ${serviceName} on ${date}.`,
      data:  { screen: 'ProviderBookings', bookingId },
    }),

  providerApproved: (userId) =>
    notifyUser(userId, {
      title: `Welcome to GlamCos! 🎊`,
      body:  `Your provider account is approved. Start accepting bookings now.`,
      data:  { screen: 'ProviderDashboard' },
    }),

  providerRejected: (userId, { reason }) =>
    notifyUser(userId, {
      title: `Application Update`,
      body:  `Issue found: ${reason}. Please update your details and resubmit.`,
      data:  { screen: 'ProviderOnboarding' },
    }),

  subscriptionExpiring: (userId, { planName, daysLeft }) =>
    notifyUser(userId, {
      title: `Your ${planName} plan expires in ${daysLeft} days`,
      body:  `Renew now to keep your exclusive benefits and discounts.`,
      data:  { screen: 'Subscriptions' },
    }),

  offerBroadcast: (userIds, { title, body, screen = 'Home' }) =>
    notifyUsers(userIds, { title, body, data: { screen } }),
};

module.exports = { sendPush, notifyUser, notifyUsers, Notif };
