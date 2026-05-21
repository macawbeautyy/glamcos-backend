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
    if (!userPushToken || typeof userPushToken !== 'string') {
      return ApiResponse.success(res, { notified: 0, message: 'No push token for this user' });
    }

    // 2. Send push via Expo Push API (works for both Expo & bare workflow)
    const body = message.length > 100 ? message.slice(0, 97) + '...' : message;

    const expoResp = await fetch('https://exp.host/--/api/v2/push/send', {
      method:  'POST',
      headers: {
        'Accept':       'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to:          userPushToken,
        title:       '💬 MACAW Support replied',
        body,
        data:        { screen: 'SupportChat', type: 'support_reply' },
        sound:       'default',
        channelId:   'support',
        priority:    'high',
      }),
    });

    const result = await expoResp.json();
    return ApiResponse.success(res, { notified: 1, result });

  } catch (err) {
    console.error('[Support notifyUser Error]', err.message);
    return ApiResponse.success(res, { notified: 0, error: err.message });
  }
});

// ── GET /support/conversations ────────────────────────────────────────────────
// Admin fetches paginated conversation list (fallback for web panel).
// The mobile admin inbox uses Firestore directly for real-time updates.

const getConversations = asyncHandler(async (req, res) => {
  const { status = 'all', limit = 30, lastDoc } = req.query;

  let query = db.collection('support_conversations')
    .orderBy('lastMessageAt', 'desc')
    .limit(Number(limit));

  if (status !== 'all') {
    query = query.where('status', '==', status);
  }

  const snap  = await query.get();
  const convs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  return ApiResponse.success(res, { conversations: convs, count: convs.length });
});

module.exports = { notifyAdmin, notifyUser, registerAdminDevice, getConversations };
