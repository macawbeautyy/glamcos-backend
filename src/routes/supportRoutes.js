const express = require('express');
const router  = express.Router();
const { notifyAdmin, notifyUser, registerAdminDevice, getConversations } = require('../controllers/supportController');
const { protect, authorize } = require('../middleware/auth');

// User sends a message → push FCM to admin
router.post('/notify',          protect, notifyAdmin);

// Admin sends a reply → push Expo notification to user's device
// No auth guard: called from admin panel which uses its own session token
router.post('/notify-user',     notifyUser);

// Admin registers their device for push notifications
router.post('/register-device', protect, authorize('admin'), registerAdminDevice);

// Admin fet