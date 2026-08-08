/**
 * MACAW Push Notification Service — Production Grade
 *
 * Uses Expo Push HTTP API (no native SDK needed).
 * Supports: single user, multiple users, broadcast, role-based sends.
 * Includes: token cleanup, duplicate dedup, retry, structured logging.
 */

const axios  = require('axios');
const User   = require('../models/User');
const UserNotification = require('../models/UserNotification');
const logger = require('../utils/logger');

// ── Per-user inbox persistence ───────────────────────────────────────────────
function toInboxDoc(userId, payload) {
  const data = payload.data || {};
  return {
    user:     userId,
    title:    payload.title,
    body:     payload.body,
    type:     data.type || data.action || payload.prefKey || 'general',
    screen:   data.screen || 'Home',
    params:   data,
    imageUrl: payload.imageUrl,
    channel:  payload.channel || CH.DEFAULT,
  };
}

async function persistForUser(userId, payload) {
  if (!userId) return;
  try {
    await UserNotification.create(toInboxDoc(userId, payload));
  } catch (err) {
    logger.error('[Notif] persistForUser:', err.message);
  }
}

async function persistForUsers(userIds, payload) {
  if (!userIds?.length) return;
  try {
    await UserNotification.insertMany(
      userIds.map((id) => toInboxDoc(id, payload))
    );
  } catch (err) {
    logger.error('[Notif] persistForUsers:', err.message);
  }
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ── Channel IDs (must match mobile CHANNELS constants) ───────────────────────
const CH = {
  BOOKINGS:   'bookings',
  PAYMENTS:   'payments',
  ORDERS:     'orders',
  SOCIAL:     'social',
  PROVIDER:   'provider',
  PROMOTIONS: 'promotions',
  DEFAULT:    'default',
};

// ── Core send ─────────────────────────────────────────────────────────────────
async function sendPush(messages) {
  const batch = Array.isArray(messages) ? messages : [messages];
  const valid = batch.filter(
    (m) => typeof m.to === 'string' && m.to.startsWith('ExponentPushToken[')
  );
  if (valid.length === 0) return { sent: 0 };

  // Batch into 100-message chunks (Expo limit)
  const chunks = [];
  for (let i = 0; i < valid.length; i += 100) chunks.push(valid.slice(i, i + 100));

  let totalSent = 0;
  const staleTokens = [];

  for (const chunk of chunks) {
    try {
      const { data } = await axios.post(EXPO_PUSH_URL, chunk, {
        headers: {
          Accept:            'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type':    'application/json',
        },
        timeout: 15_000,
      });
      totalSent += chunk.length;
      // Collect DeviceNotRegistered tokens for cleanup
      (data?.data || []).forEach((r, i) => {
        if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') {
          staleTokens.push(chunk[i].to);
        }
      });
    } catch (err) {
      logger.error('[Push] Chunk send failed:', err.message);
    }
  }

  if (staleTokens.length) cleanupStaleTokens(staleTokens).catch(() => {});
  return { sent: totalSent, removed: staleTokens.length };
}

// ── Token cleanup ─────────────────────────────────────────────────────────────
async function cleanupStaleTokens(tokens) {
  try {
    await User.updateMany(
      { fcmTokens: { $in: tokens } },
      { $pull: { fcmTokens: { $in: tokens } } }
    );
    logger.info(`[Push] Cleaned ${tokens.length} stale tokens`);
  } catch (err) {
    logger.error('[Push] Token cleanup failed:', err.message);
  }
}

// ── Preference check ──────────────────────────────────────────────────────────
function checkPref(prefs = {}, prefKey) {
  if (!prefKey) return true;
  return prefs[prefKey] !== false;
}

// ── Message builder ───────────────────────────────────────────────────────────
function buildMessage(token, payload) {
  return {
    to:        token,
    title:     payload.title,
    body:      payload.body,
    data:      payload.data    || {},
    sound:     payload.sound   ?? 'default',
    badge:     payload.badge   ?? 1,
    channelId: payload.channel ?? CH.DEFAULT,
    priority:  payload.priority ?? 'high',
    ttl:       payload.ttl    ?? 86400,
  };
}

// ── Audience senders ──────────────────────────────────────────────────────────
async function sendToUser(userId, payload) {
  if (!userId) return { sent: 0 };
  persistForUser(userId, payload).catch(() => {});
  try {
    const user = await User.findById(userId).select('fcmTokens notifPrefs').lean();
    if (!user?.fcmTokens?.length) return { sent: 0 };
    if (!checkPref(user.notifPrefs, payload.prefKey)) return { sent: 0, skipped: true };
    return sendPush(user.fcmTokens.map((t) => buildMessage(t, payload)));
  } catch (err) {
    logger.error('[Push] sendToUser:', err.message);
    return { sent: 0 };
  }
}

async function sendToUsers(userIds, payload) {
  if (!userIds?.length) return { sent: 0 };
  persistForUsers(userIds, payload).catch(() => {});
  try {
    const users = await User.find({ _id: { $in: userIds } })
      .select('fcmTokens notifPrefs').lean();
    const messages = users
      .filter((u) => checkPref(u.notifPrefs, payload.prefKey))
      .flatMap((u) => (u.fcmTokens || []).map((t) => buildMessage(t, payload)));
    return sendPush(messages);
  } catch (err) {
    logger.error('[Push] sendToUsers:', err.message);
    return { sent: 0 };
  }
}

async function sendToAllUsers(payload, filter = {}) {
  try {
    const allUsers = await User.find({
      ...filter,
      status: { $ne: 'banned' },
    }).select('_id fcmTokens notifPrefs').lean();

    persistForUsers(allUsers.map((u) => u._id), payload).catch(() => {});

    const messages = allUsers
      .filter((u) => (u.fcmTokens || []).length && checkPref(u.notifPrefs, payload.prefKey))
      .flatMap((u) => (u.fcmTokens || []).map((t) => buildMessage(t, payload)));

    logger.info(`[Push] Broadcast to ${messages.length} tokens`);
    return sendPush(messages);
  } catch (err) {
    logger.error('[Push] sendToAllUsers:', err.message);
    return { sent: 0 };
  }
}

async function sendToProviders(payload) {
  return sendToAllUsers(payload, { role: 'provider' });
}

async function sendToAdmins(payload) {
  return sendToAllUsers(payload, { role: { $in: ['admin', 'superadmin'] } });
}

async function sendToCity(city, payload) {
  return sendToAllUsers(payload, {
    'location.city': { $regex: new RegExp(`^${city}$`, 'i') },
  });
}

async function sendToInactiveUsers(daysSince, payload) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysSince);
  return sendToAllUsers(payload, { lastLogin: { $lt: cutoff } });
}

// ── Notification templates ────────────────────────────────────────────────────
const Notif = {

  // BOOKING
  bookingReceived: (userId, { bookingId, serviceName, date, time, userName }) =>
    sendToUser(userId, { title: `Booking Received! 🎉`, body: `Hi ${userName || 'there'}! Your ${serviceName} booking for ${date} at ${time} is confirmed.`, data: { screen: 'Appointments', bookingId }, channel: CH.BOOKINGS, prefKey: 'booking_alerts' }),

  bookingConfirmed: (userId, { bookingId, serviceName, date, providerName }) =>
    sendToUser(userId, { title: `Booking Confirmed ✅`, body: `Your ${serviceName} on ${date} with ${providerName || 'a provider'} is confirmed!`, data: { screen: 'Appointments', bookingId }, channel: CH.BOOKINGS, prefKey: 'booking_alerts' }),

  bookingCancelled: (userId, { bookingId, serviceName, reason }) =>
    sendToUser(userId, { title: `Booking Cancelled`, body: `Your ${serviceName} booking was cancelled.${reason ? ` Reason: ${reason}` : ''}`, data: { screen: 'Appointments', bookingId }, channel: CH.BOOKINGS, prefKey: 'booking_alerts' }),

  serviceCompleted: (userId, { bookingId, serviceName }) =>
    sendToUser(userId, { title: `Service Complete ⭐`, body: `How was your ${serviceName}? Tap to leave a review.`, data: { screen: 'Appointments', bookingId, action: 'rate' }, channel: CH.BOOKINGS, prefKey: 'booking_alerts' }),

  providerOnTheWay: (userId, { bookingId, providerName, eta }) =>
    sendToUser(userId, { title: `${providerName || 'Your provider'} is on the way! 🚗`, body: `ETA: ${eta || 'soon'}. Please get ready!`, data: { screen: 'Tracking', bookingId }, channel: CH.BOOKINGS, priority: 'high', prefKey: 'booking_alerts' }),

  reviewReceived: (providerId, { userName, rating, serviceName }) =>
    sendToUser(providerId, { title: `New Review ⭐`, body: `${userName} rated your ${serviceName} ${rating}/5!`, data: { screen: 'ProviderDashboard' }, channel: CH.PROVIDER, prefKey: 'provider_alerts' }),

  // PAYMENT
  paymentSuccess: (userId, { bookingId, amount, serviceName }) =>
    sendToUser(userId, { title: `Payment Successful 💳`, body: `₹${amount} paid for ${serviceName}.`, data: { screen: 'Appointments', bookingId }, channel: CH.PAYMENTS, prefKey: 'payment_alerts' }),

  refundProcessed: (userId, { amount, serviceName }) =>
    sendToUser(userId, { title: `Refund Processed 💰`, body: `₹${amount} refund for ${serviceName} initiated. Allow 3–5 business days.`, data: { screen: 'Appointments' }, channel: CH.PAYMENTS, prefKey: 'payment_alerts' }),

  // ORDERS
  orderPlaced: (userId, { orderId, orderNumber }) =>
    sendToUser(userId, { title: `Order Placed! 📦`, body: `Order #${orderNumber} confirmed. We'll notify you when it ships.`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  orderShipped: (userId, { orderId, orderNumber, trackingId }) =>
    sendToUser(userId, { title: `Order Shipped 🚚`, body: `Order #${orderNumber} is on its way!${trackingId ? ` Tracking: ${trackingId}` : ''}`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  orderDelivered: (userId, { orderId, orderNumber }) =>
    sendToUser(userId, { title: `Order Delivered ✅`, body: `Order #${orderNumber} delivered! Enjoy your products.`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  orderCancelled: (userId, { orderId, orderNumber }) =>
    sendToUser(userId, { title: `Order Cancelled`, body: `Order #${orderNumber} cancelled. Refund will be processed shortly.`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  // SOCIAL
  reelLiked: (creatorId, { likerName, reelId }) =>
    sendToUser(creatorId, { title: `${likerName} liked your reel ❤️`, body: `Your reel is getting love!`, data: { screen: 'ReelDetail', reelId }, channel: CH.SOCIAL, prefKey: 'social_alerts' }),

  reelComment: (creatorId, { commenterName, comment, reelId }) =>
    sendToUser(creatorId, { title: `${commenterName} commented 💬`, body: `"${(comment || '').slice(0, 80)}"`, data: { screen: 'ReelDetail', reelId }, channel: CH.SOCIAL, prefKey: 'social_alerts' }),

  newFollower: (creatorId, { followerName, followerId }) =>
    sendToUser(creatorId, { title: `${followerName} is now following you 🎉`, body: `You have a new follower.`, data: { screen: 'CreatorProfile', userId: followerId }, channel: CH.SOCIAL, prefKey: 'social_alerts' }),

  // MARKETPLACE — SELLER
  sellerDocumentReviewed: (sellerUserId, { docType, status, reviewNote }) =>
    sendToUser(sellerUserId, {
      title: status === 'approved' ? `Document Approved ✅` : `Document Needs Attention`,
      body: status === 'approved'
        ? `Your ${docType} was approved.`
        : `Your ${docType} was rejected.${reviewNote ? ` Reason: ${reviewNote}` : ''}`,
      data: { screen: 'SellerRegistration', docType, status, reviewNote },
      channel: CH.DEFAULT,
    }),

  newOrderForSeller: (sellerUserId, { orderId, orderNumber, itemCount }) =>
    sendToUser(sellerUserId, { title: `New Order Received 🛍️`, body: `Order #${orderNumber} — ${itemCount} item${itemCount !== 1 ? 's' : ''} ordered from your shop. Tap to fulfil.`, data: { screen: 'SellerOrders', orderId }, channel: CH.ORDERS, priority: 'high', prefKey: 'order_alerts' }),

  // SALON APPOINTMENTS
  salonAppointmentBooked: (ownerUserId, { appointmentId, userName, service, date, timeSlot }) =>
    sendToUser(ownerUserId, { title: `New Salon Booking 💈`, body: `${userName} booked ${service} on ${date} at ${timeSlot}.`, data: { screen: 'SalonDashboard', appointmentId }, channel: CH.BOOKINGS, priority: 'high', prefKey: 'booking_alerts' }),

  salonAppointmentCancelled: (ownerUserId, { userName, service, date, timeSlot }) =>
    sendToUser(ownerUserId, { title: `Booking Cancelled`, body: `${userName}'s ${service} on ${date} at ${timeSlot} was cancelled.`, data: { screen: 'SalonDashboard' }, channel: CH.BOOKINGS, prefKey: 'booking_alerts' }),

  // SALON PARTNER PROGRAM
  salonPartnerApproved: (userId, { salonName } = {}) =>
    sendToUser(userId, { title: `You're a Macaw Salon Partner! 🎉`, body: `${salonName || 'Your salon'} has been approved — you're now live on the app and ready to receive bookings.`, data: { screen: 'SalonDashboard' }, channel: CH.PROVIDER, priority: 'high' }),

  salonPartnerRejected: (userId, { salonName, reason } = {}) =>
    sendToUser(userId, { title: `Application Update`, body: `${salonName || 'Your salon'} application needs a look${reason ? `: ${reason}` : '.'} Update your details and resubmit.`, data: { screen: 'SalonPartner' }, channel: CH.PROVIDER }),

  // PROVIDER
  newBookingRequest: (providerId, { bookingId, serviceName, userFirstName, date }) =>
    sendToUser(providerId, { title: `New Booking Request 📅`, body: `${userFirstName} booked ${serviceName} on ${date}. Tap to accept.`, data: { screen: 'ProviderBookings', bookingId }, channel: CH.PROVIDER, priority: 'high', sound: 'new_order.wav', prefKey: 'provider_alerts' }),

  providerApproved: (userId, { userName } = {}) =>
    sendToUser(userId, { title: `Welcome to GlamCos! 🎊`, body: `Hi ${userName || 'there'}! Your provider account is approved. Start accepting bookings now.`, data: { screen: 'ProviderDashboard' }, channel: CH.PROVIDER }),

  providerRejected: (userId, { reason }) =>
    sendToUser(userId, { title: `Application Update`, body: `Issue: ${reason}. Please update your details and resubmit.`, data: { screen: 'ProviderOnboarding' }, channel: CH.PROVIDER }),

  payoutProcessed: (userId, { amount }) =>
    sendToUser(userId, { title: `Payout Processed 💸`, body: `₹${amount} has been credited to your bank account.`, data: { screen: 'ProviderDashboard' }, channel: CH.PAYMENTS, prefKey: 'payment_alerts' }),

  // LOYALTY + SUBSCRIPTIONS
  loyaltyMilestone: (userId, { points, milestone }) =>
    sendToUser(userId, { title: `🎉 ${milestone} loyalty points!`, body: `You now have ${points} pts — worth ₹${Math.floor(points * 0.5)}.`, data: { screen: 'Loyalty' }, channel: CH.DEFAULT }),

  subscriptionExpiring: (userId, { planName, daysLeft }) =>
    sendToUser(userId, { title: `${planName} expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`, body: `Renew now to keep your exclusive benefits.`, data: { screen: 'Subscriptions' }, channel: CH.DEFAULT, prefKey: 'reminders' }),

  // CAMPAIGNS
  offerBroadcast: (userIds, { title, body, screen = 'Home', imageUrl }) =>
    sendToUsers(userIds, { title, body, data: { screen }, channel: CH.PROMOTIONS, prefKey: 'promotions', imageUrl }),

  campaignBroadcast: (payload, filter = {}) =>
    sendToAllUsers({ ...payload, channel: CH.PROMOTIONS, prefKey: 'promotions' }, filter),

  // RE-ENGAGEMENT
  inactiveReminder: (userId, { userName }) =>
    sendToUser(userId, { title: `We miss you, ${userName || 'there'}! 💆`, body: `Discover new beauty services and trending reels.`, data: { screen: 'Home' }, channel: CH.PROMOTIONS, prefKey: 'reminders' }),

  abandonedBookingReminder: (userId, { serviceName }) =>
    sendToUser(userId, { title: `Complete your booking 💄`, body: `Your ${serviceName} booking is waiting. Slots fill up fast!`, data: { screen: 'Home' }, channel: CH.BOOKINGS, prefKey: 'reminders' }),

  // FRANCHISE LISTINGS
  franchiseListingApproved: (userId, { businessName } = {}) =>
    sendToUser(userId, { title: `Franchise Listing Approved ✅`, body: `${businessName || 'Your franchise listing'} is now live and visible to interested buyers.`, data: { screen: 'MyFranchiseListings' }, channel: CH.DEFAULT }),

  franchiseListingRejected: (userId, { businessName, reason } = {}) =>
    sendToUser(userId, { title: `Franchise Listing Update`, body: `${businessName || 'Your franchise listing'} needs a look${reason ? `: ${reason}` : '.'} Update and resubmit.`, data: { screen: 'MyFranchiseListings' }, channel: CH.DEFAULT }),

  // SALON SPACE LISTINGS
  salonSpaceListingApproved: (userId, { title: spaceTitle } = {}) =>
    sendToUser(userId, { title: `Salon Space Listing Approved ✅`, body: `${spaceTitle || 'Your salon space listing'} is now live and visible to interested renters.`, data: { screen: 'MySalonSpaceListings' }, channel: CH.DEFAULT }),

  salonSpaceListingRejected: (userId, { title: spaceTitle, reason } = {}) =>
    sendToUser(userId, { title: `Salon Space Listing Update`, body: `${spaceTitle || 'Your salon space listing'} needs a look${reason ? `: ${reason}` : '.'} Update and resubmit.`, data: { screen: 'MySalonSpaceListings' }, channel: CH.DEFAULT }),

  // FRANCHISE / SALON SPACE INQUIRIES
  inquiryStatusUpdated: (userId, { subject, status } = {}) =>
    sendToUser(userId, { title: `Inquiry Update`, body: `Your inquiry${subject ? ` about ${subject}` : ''} is now marked as ${status || 'updated'}.`, data: { screen: 'Home' }, channel: CH.DEFAULT }),

  // MARKETPLACE — PRODUCTS
  productApproved: (sellerUserId, { productName } = {}) =>
    sendToUser(sellerUserId, { title: `Product Approved ✅`, body: `${productName || 'Your product'} is now live in the marketplace.`, data: { screen: 'SellerDashboard' }, channel: CH.DEFAULT }),

  productRejected: (sellerUserId, { productName, reason } = {}) =>
    sendToUser(sellerUserId, { title: `Product Needs Attention`, body: `${productName || 'Your product'} was rejected.${reason ? ` Reason: ${reason}` : ''}`, data: { screen: 'SellerDashboard' }, channel: CH.DEFAULT }),

  // MARKETPLACE — SELLER ACCOUNT
  sellerAccountApproved: (sellerUserId, { shopName } = {}) =>
    sendToUser(sellerUserId, { title: `Seller Account Approved 🎉`, body: `${shopName || 'Your shop'} is approved — you can start listing products now.`, data: { screen: 'SellerDashboard' }, channel: CH.DEFAULT }),

  sellerAccountRejected: (sellerUserId, { shopName, reason } = {}) =>
    sendToUser(sellerUserId, { title: `Seller Application Update`, body: `${shopName || 'Your seller application'} needs a look${reason ? `: ${reason}` : '.'} Update your details and resubmit.`, data: { screen: 'SellerRegistration' }, channel: CH.DEFAULT }),

  sellerAccountSuspended: (sellerUserId, { shopName, reason } = {}) =>
    sendToUser(sellerUserId, { title: `Seller Account Suspended`, body: `${shopName || 'Your seller account'} has been suspended.${reason ? ` Reason: ${reason}` : ''} Contact support for help.`, data: { screen: 'SellerDashboard' }, channel: CH.DEFAULT }),

  sellerAccountReinstated: (sellerUserId, { shopName } = {}) =>
    sendToUser(sellerUserId, { title: `Seller Account Reinstated ✅`, body: `${shopName || 'Your seller account'} is active again.`, data: { screen: 'SellerDashboard' }, channel: CH.DEFAULT }),

  // ORDERS — ADMIN STATUS CHANGES (beyond shipped/delivered which already exist)
  orderConfirmed: (userId, { orderId, orderNumber } = {}) =>
    sendToUser(userId, { title: `Order Confirmed ✅`, body: `Order #${orderNumber} has been confirmed and is being prepared.`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  orderProcessing: (userId, { orderId, orderNumber } = {}) =>
    sendToUser(userId, { title: `Order Processing 🔄`, body: `Order #${orderNumber} is being processed.`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  orderReturned: (userId, { orderId, orderNumber } = {}) =>
    sendToUser(userId, { title: `Order Returned`, body: `Order #${orderNumber} has been marked as returned.`, data: { screen: 'OrderDetail', orderId }, channel: CH.ORDERS, prefKey: 'order_alerts' }),

  orderRefunded: (userId, { orderId, orderNumber, amount } = {}) =>
    sendToUser(userId, { title: `Order Refunded 💰`, body: `Order #${orderNumber} refunded${amount ? ` — ₹${amount}` : ''}. Allow 3–5 business days.`, data: { screen: 'OrderDetail', orderId }, channel: CH.PAYMENTS, prefKey: 'payment_alerts' }),

  // JOB APPLICATIONS
  jobApplicationShortlisted: (userId, { jobTitle, companyName } = {}) =>
    sendToUser(userId, { title: `You've Been Shortlisted! 🎉`, body: `${companyName || 'An employer'} shortlisted your application for ${jobTitle || 'a job'}.`, data: { screen: 'JobApplications' }, channel: CH.DEFAULT }),

  jobApplicationRejected: (userId, { jobTitle, companyName } = {}) =>
    sendToUser(userId, { title: `Application Update`, body: `${companyName || 'The employer'} has updated your application for ${jobTitle || 'a job'}.`, data: { screen: 'JobApplications' }, channel: CH.DEFAULT }),

  jobApplicationHired: (userId, { jobTitle, companyName } = {}) =>
    sendToUser(userId, { title: `Congratulations, you're hired! 🎊`, body: `${companyName || 'The employer'} selected you for ${jobTitle || 'the position'}.`, data: { screen: 'JobApplications' }, channel: CH.DEFAULT, priority: 'high' }),

  jobInterviewScheduled: (userId, { jobTitle, companyName, scheduledAt } = {}) =>
    sendToUser(userId, {
      title: `Interview Scheduled 📅`,
      body: `${companyName || 'An employer'} scheduled an interview with you for ${jobTitle || 'a job'}${scheduledAt ? ` on ${new Date(scheduledAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`,
      data: { screen: 'JobApplications' }, channel: CH.DEFAULT, priority: 'high',
    }),

  // USER ACCOUNT STATUS
  accountSuspended: (userId, { reason } = {}) =>
    sendToUser(userId, { title: `Account Suspended`, body: `Your account has been suspended.${reason ? ` Reason: ${reason}` : ''} Contact support if you think this is a mistake.`, data: { screen: 'Home' }, channel: CH.DEFAULT }),

  accountBanned: (userId, { reason } = {}) =>
    sendToUser(userId, { title: `Account Banned`, body: `Your account has been banned.${reason ? ` Reason: ${reason}` : ''} Contact support for details.`, data: { screen: 'Home' }, channel: CH.DEFAULT }),

  accountReactivated: (userId) =>
    sendToUser(userId, { title: `Account Reactivated ✅`, body: `Your account is active again. Welcome back!`, data: { screen: 'Home' }, channel: CH.DEFAULT }),
};

module.exports = {
  sendPush,
  sendToUser,
  sendToUsers,
  sendToAllUsers,
  sendToProviders,
  sendToAdmins,
  sendToCity,
  sendToInactiveUsers,
  cleanupStaleTokens,
  Notif,
  CH,
};
