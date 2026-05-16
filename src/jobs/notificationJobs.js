/**
 * Scheduled push notification jobs.
 *
 * Requires: npm install node-cron
 * If node-cron is not installed, jobs are silently skipped so the server
 * still boots in environments where scheduling is not needed.
 *
 * Schedule overview:
 *   – Every minute             -> Process pending ScheduledNotification records
 *   – Daily 10:00 AM IST       -> Re-engage users inactive for 7+ days
 *   – Daily 06:00 PM IST       -> Abandoned-booking reminder (pending bookings > 2 hrs old)
 */

let cron = null;
try {
  cron = require('node-cron');
} catch {
  // node-cron not installed -- jobs disabled
}

const User                  = require('../models/User');
const Booking               = require('../models/Booking');
const ScheduledNotification = require('../models/ScheduledNotification');
const NotificationLog       = require('../models/NotificationLog');
const logger                = require('../utils/logger');
const { sendToUser, sendToUsers, sendToAllUsers, sendToProviders, sendToCity, sendToInactiveUsers, Notif } = require('../services/notifications');

// Process DB-scheduled notifications
async function processScheduledNotifications() {
  try {
    const now = new Date();
    const due = await ScheduledNotification.find({
      status:      'pending',
      scheduledAt: { $lte: now },
    }).limit(50).lean();

    if (!due.length) return;
    logger.info('[NotifJob] Processing ' + due.length + ' scheduled notification(s)');

    for (const sn of due) {
      // Mark as sent immediately to prevent double-fire under concurrent workers
      await ScheduledNotification.findByIdAndUpdate(sn._id, { status: 'sent', sentAt: new Date() });

      try {
        const payload = {
          title:   sn.title,
          body:    sn.body,
          data:    { screen: sn.screen || 'Home' },
          channel: sn.channel || 'default',
          ...(sn.imageUrl && { imageUrl: sn.imageUrl }),
        };

        let result = { sent: 0, removed: 0 };
        switch (sn.audience) {
          case 'user':
            if (sn.targetIds && sn.targetIds[0]) result = await sendToUser(sn.targetIds[0], payload);
            break;
          case 'users':
            if (sn.targetIds && sn.targetIds.length) result = await sendToUsers(sn.targetIds, payload);
            break;
          case 'all':
            result = await sendToAllUsers(payload, {});
            break;
          case 'providers':
            result = await sendToProviders(payload);
            break;
          case 'city':
            if (sn.city) result = await sendToCity(sn.city, payload);
            break;
          case 'inactive':
            result = await sendToInactiveUsers(sn.daysSince || 14, payload);
            break;
          default:
            logger.warn('[NotifJob] Unknown audience: ' + sn.audience);
        }

        const log = await NotificationLog.create({
          title:     sn.title,
          body:      sn.body,
          audience:  sn.audience,
          channel:   sn.channel || 'default',
          screen:    sn.screen || 'Home',
          imageUrl:  sn.imageUrl,
          sentBy:    sn.createdBy,
          sentCount: result.sent || 0,
          removed:   result.removed || 0,
          city:      sn.city,
          daysSince: sn.daysSince,
          targetIds: sn.targetIds || [],
        });

        await ScheduledNotification.findByIdAndUpdate(sn._id, { logId: log._id });
        logger.info('[NotifJob] Scheduled notif ' + sn._id + ' sent -- ' + (result.sent || 0) + ' tokens');
      } catch (err) {
        logger.error('[NotifJob] Failed to send scheduled notif ' + sn._id + ': ' + err.message);
        await ScheduledNotification.findByIdAndUpdate(sn._id, {
          status: 'failed',
          $inc:   { retries: 1 },
        });
      }
    }
  } catch (err) {
    logger.error('[NotifJob] processScheduledNotifications error: ' + err.message);
  }
}

// Re-engagement: inactive 7+ days
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

    logger.info('[NotifJob] Inactive reminder -- ' + users.length + ' users');

    for (const u of users) {
      await Notif.inactiveReminder(u._id, { userName: u.firstName }).catch(() => {});
    }
  } catch (err) {
    logger.error('[NotifJob] Inactive reminder failed: ' + err.message);
  }
}

// Abandoned booking reminder
async function runAbandonedBookingReminder() {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const bookings = await Booking.find({
      status:        'pending',
      paymentMode:   'pay_online',
      paymentStatus: { $ne: 'paid' },
      createdAt:     { $lt: twoHoursAgo, $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .populate('service', 'name')
      .limit(200)
      .lean();

    logger.info('[NotifJob] Abandoned booking reminder -- ' + bookings.length + ' bookings');

    for (const b of bookings) {
      await Notif.abandonedBookingReminder(b.user, {
        serviceName: b.service && b.service.name ? b.service.name : 'your service',
      }).catch(() => {});
    }
  } catch (err) {
    logger.error('[NotifJob] Abandoned booking reminder failed: ' + err.message);
  }
}

// Register cron jobs
function startNotificationJobs() {
  if (!cron) {
    logger.warn('[NotifJob] node-cron not installed -- scheduled notification jobs disabled. Run: npm install node-cron');
    return;
  }

  // Every minute -- process DB-scheduled notifications
  cron.schedule('* * * * *', () => {
    processScheduledNotifications();
  });

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

  logger.info('[NotifJob] Scheduled notification jobs registered');
}

module.exports = { startNotificationJobs };
