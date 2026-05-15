const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  sendToSingleUser,
  sendToMultipleUsers,
  broadcast,
  notifyProviders,
  notifyByCity,
  notifyInactive,
} = require('../controllers/notificationController');

// All notification admin endpoints require admin or superadmin
const adminOnly = [protect, authorize('admin', 'superadmin')];

router.post('/send-user',      ...adminOnly, sendToSingleUser);
router.post('/send-users',     ...adminOnly, sendToMultipleUsers);
router.post('/broadcast',      ...adminOnly, broadcast);
router.post('/send-providers', ...adminOnly, notifyProviders);
router.post('/send-by-city',   ...adminOnly, notifyByCity);
router.post('/send-inactive',  ...adminOnly, notifyInactive);

module.exports = router;
