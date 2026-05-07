const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/salonPartnerController');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

// User routes
router.post('/',     optionalAuth, ctrl.apply);       // submit application (auth optional)
router.get('/my',    protect,      ctrl.myStatus);    // check own application status

// Admin routes
router.get('/',               protect, authorize('admin'), ctrl.list);
router.patch('/:id/status',   protect, authorize('admin'), ctrl.updateStatus);

module.exports = router;
