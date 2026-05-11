const express = require('express');
const router  = express.Router();
const { notifyAdmin, registerAdminDevice, getConversations } = require('../controllers/supportController');
const { protect, adminOnly } = require('../middleware/auth');

// User sends a message → push FCM to admin (auth required so we know it's a real user)
router.post('/notify',          protect, notifyAdmin);

// Admin registers their device for push notifications
router.post('/register-device', protect, adminOnly, registerAdminDevice);

// Admin fetches all conversations (for web panel / fallback)
router.get('/conversations',    protect, adminOnly, getConversations);

module.exports = router;
