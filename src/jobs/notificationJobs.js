/**
 * Scheduled push notification jobs.
 *
 * Requires: npm install node-cron
 * If node-cron is not installed, jobs are silently skipped so the server
 * still boots in environments where scheduling is not needed.
 *
 * Schedule overview:
 *   – Daily 10:00 AM IST  → Re-engage users inactive for 7+ days
 *   – Daily 06:00 PM IST  → Abandoned-booking reminder (pending bookings > 2 hrs old)
 *   – Weekly Monday 09:00 → Subscription-expiry warnings (≤ 3 days left)
 */

let cron = null;
try {
  cron = require('node-cron');
} catch {
  // node-cron not installed — jobs disabled
}

const User    = require('../models/User');
const Booking = require('../models/Booking');
const logger  = require('../utils/logger');
const { sendToUser, Notif } = require('../services/notifications');

// ── Re-engagement: inactive 7+ days ──────────────────────────────────────────
async function runInactiveReminder() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    const users = await User.find({
      lastLogin:  { $lt: cutoff },
      fcmTokens:  { $exists: true, $not: { $size: 0 } },
      status:     { $ne: 'banned' },
      role:       'user',
    }).select('_id firstName').limit(500).lean();

    logger.info(`[NotifJob] Inactive reminder — ${users.length} users`);

    for (const u of users) {
      await Notif.inactiveReminder(u._id, { userName: u.firstName }).catch(() => {});
    }
  } catch (err) {
    logger.error('[NotifJob] Inactive reminder failed:', err.message);
  }
}

// ── Abandoned booking reminder ────────────────────────────────────────────────
async function runAbandonedBookingReminder() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const bookings = await Booking.find({
      status:      'pending',
      paymentMode: 'pay_online',
      paymentStatus: { $ne: 'paid' },
      createdAt:   { $lt: twoHoursAgo, $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .populate('service', 'name')
      .limit(200)
      .lean();

    logger.info(`[NotifJob] Abandoned booking reminder — ${bookings.length} bookings`);

    for (const b of bookings) {
      await Notif.abandonedBookingReminder(b.user, {
        serviceName: b.service?.name || 'your service',
      }).catch(() => {});
    }
  } catch (err) {
    logger.error('[NotifJob] Abandoned booking reminder failed:', err.message);
  }
}

// ── Register cron jobs ────────────────────────────────────────────────────────
function startNotificationJobs() {
  if (!cron) {
    logger.warn('[NotifJob] node-cron not installed — scheduled notification jobs disabled. Run: npm install node-cron');
    return;
  }

  // Daily 10:00 AM IST (04:30 UTC)
  cron.schedule('30 4 * * *', () => {
    logger.info('[NotifJob] Running: inactive user reminder');
    runInactiveReminder();
  }, { timezone: 'Asia/Kolkata' });

  // Daily 6:00 PM IST (12:30 UTC)
  cron.schedule('30 12 * * *', () => {
    logger.info('[NotifJob] Running: abandoned booking reminder');
    runAbandonedBookingReminder();
  }, { timezone: 'Asia/Kolkata' });

  logger.info('[NotifJob] Scheduled notification jobs registered ✓');
}

module.exports = { startNotificationJobs };
