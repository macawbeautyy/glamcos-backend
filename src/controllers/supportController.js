/**
 * Support Chat Controller
 *
 * Routes:
 *  POST /api/v1/support/notify          – user sends message → push FCM to all admin devices
 *  POST /api/v1/support/register-device – admin registers FCM token for push notifications
 *  GET  /api/v1/support/conversations   – admin fetches paginated conversation list
 */

const admin        = require('../config/firebase');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse  = require('../utils/ApiResponse');

const db = admin.firestore();

// ── POST /support/notify ──────────────────────────────────────────────────────
// Called by the mobile app whenever a USER sends a support message.
// Sends a push notification to every registered admin device.

const notifyAdmin = asyncHandler(async (req, res) => {
  const { userId, userName, userEmail, message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ success: false, message: 'userId and message are required' });
  }

  try {
    // 1. Collect all registered admin FCM tokens
    const snap   = await db.collection('admin_devices').get();
    const tokens = snap.docs
      .map(d => d.data().fcmToken)
      .filter(t => typeof t === 'string' && t.length > 0);

    if (tokens.length === 0) {
      // No admin devices registered yet — still return 200 so user chat isn't blocked
      return ApiResponse.success(res, { notified: 0, message: 'No admin devices registered' });
    }

    // 2. Send multicast FCM push
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title: `💬 Support: ${userName || 'User'}`,
        body:  message.length > 80 ? message.slice(0, 77) + '...' : message,
      },
      data: {
        type:      'support_message',
        userId,
        userName:  userName  || '',
        userEmail: userEmail || '',
        screen:    'SupportInbox',
      },
      android: {
        priority: 'high',
        notification: { channelId: 'support', sound: 'default' },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    });

    // 3. Clean up invalid tokens
    const invalidTokens = [];
    result.responses.forEach((r, idx) => {
      if (!r.success && (
        r.error?.code === 'messaging/registration-token-not-registered' ||
        r.error?.code === 'messaging/invalid-registration-token'
      )) {
        invalidTokens.push(tokens[idx]);
      }
    });

    if (invalidTokens.length > 0) {
      const batch = db.batch();
      const stale = await db.collection('admin_devices')
        .where('fcmToken', 'in', invalidTokens.slice(0, 10)).get();
      stale.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    }

    return ApiResponse.success(res, {
      notified: result.successCount,
      failed:   result.failureCount,
    });

  } catch (err) {
    // Don't block the user's chat experience if FCM fails
    console.error('[Support FCM Error]', err.message);
    return ApiResponse.success(res, { notified: 0, error: err.message });
  }
});

// ── POST /support/register-device ────────────────────────────────────────────
// Admin app calls this on login to register their FCM token.

const registerAdminDevice = asyncHandler(async (req, res) => {
  const { fcmToken, deviceId, adminName } = req.body;

  if (!fcmToken || !deviceId) {
    return res.status(400).json({ success: false, message: 'fcmToken and deviceId are required' });
  }

  await db.collection('admin_devices').doc(deviceId).set({
    fcmToken,
    deviceId,
    adminName:   adminName || 'Admin',
    registeredAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeen:     admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return ApiResponse.success(res, { message: 'Device registered for admin push notifications' });
});

// ── POST /support/notify-user ─────────────────────────────────────────────────
// Called by the admin panel whenever an ADMIN sends a support reply.
// Sends a push notification to the user's device via Expo Push API.

const notifyUser = asyncHandler(async (req, res) => {
  const { userId, message } = req.body;

  if (!userId || !message) {
    return res.status(400).json({ success: false, message: 'userId and message are required' });
  }

  try {
    // 1. Get the user's push token from the Firestore conversation doc
    const convDoc = await db.collection('support_conversations').doc(userId).get();
    if (!convDoc.exists) {
      return ApiResponse.success(res, { notified: 0, message: 'Conversation not found' });
    }

    const userPushToken = convDoc.data()?.userPushToken;
    if (!user