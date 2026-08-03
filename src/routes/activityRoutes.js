const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const { logEvents, adminGetUserActivity, adminGetUserActivitySummary, adminGetRecentUsers } = require('../controllers/userActivityController');

// Any authenticated user can log their own activity
router.post('/log', protect, logEvents);

// Admin: recently-active users list (sidebar default view)
router.get('/admin/recent-users',         protect, authorize('admin', 'superadmin'), adminGetRecentUsers);

// Admin: read a specific user's activity
router.get('/admin/user/:userId',         protect, authorize('admin', 'superadmin'), adminGetUserActivity);
router.get('/admin/user/:userId/summary', protect, authorize('admin', 'superadmin'), adminGetUserActivitySummary);

module.exports = router;
