const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  // Send
  sendToSingleUser, sendToMultipleUsers, broadcast,
  notifyProviders, notifyByCity, notifyInactive,
  // History & stats
  getHistory, getStats,
  // Open tracking (authenticated user)
  trackOpen,
  // Scheduled
  scheduleNotification, getScheduled, cancelScheduled,
  // Templates
  createTemplate, getTemplates, updateTemplate, deleteTemplate, sendFromTemplate,
  // User search
  searchUsersForNotif,
  // User inbox
  getMyNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
} = require('../controllers/notificationController');

const adminOnly = [protect, authorize('admin', 'superadmin')];
const userAuth  = [protect];

// ── Send endpoints ────────────────────────────────────────────────────────────
router.post('/send-user',      ...adminOnly, sendToSingleUser);
router.post('/send-users',     ...adminOnly, sendToMultipleUsers);
router.post('/broadcast',      ...adminOnly, broadcast);
router.post('/send-providers', ...adminOnly, notifyProviders);
router.post('/send-by-city',   ...adminOnly, notifyByCity);
router.post('/send-inactive',  ...adminOnly, notifyInactive);

// ── History & analytics ───────────────────────────────────────────────────────
router.get('/history',         ...adminOnly, getHistory);
router.get('/stats',           ...adminOnly, getStats);

// ── Open tracking (called by mobile app on notification tap) ──────────────────
router.post('/opened',         ...userAuth,  trackOpen);

// ── User notification inbox ───────────────────────────────────────────────────
router.get('/mine',            ...userAuth,  getMyNotifications);
router.get('/unread-count',    ...userAuth,  getUnreadCount);
router.patch('/:id/read',      ...userAuth,  markNotificationRead);
router.patch('/read-all',      ...userAuth,  markAllNotificationsRead);

// ── Scheduled notifications ───────────────────────────────────────────────────
router.post('/schedule',       ...adminOnly, scheduleNotification);
router.get('/scheduled',       ...adminOnly, getScheduled);
router.delete('/scheduled/:id',...adminOnly, cancelScheduled);

// ── Templates ─────────────────────────────────────────────────────────────────
router.post('/templates',         ...adminOnly, createTemplate);
router.get('/templates',          ...adminOnly, getTemplates);
router.put('/templates/:id',      ...adminOnly, updateTemplate);
router.delete('/templates/:id',   ...adminOnly, deleteTemplate);
router.post('/templates/:id/send',...adminOnly, sendFromTemplate);

// ── User search for targeting ─────────────────────────────────────────────────
router.get('/users/search',    ...adminOnly, searchUsersForNotif);

module.exports = router;
