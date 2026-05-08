const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salonAppointmentController');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

router.get('/salons',                    ctrl.listSalons);
router.get('/slots/:partnerId',          ctrl.getSlots);
router.post('/create-order',             optionalAuth, ctrl.createOrder);
router.post('/verify-and-book',          optionalAuth, ctrl.verifyAndBook);
router.post('/',                         optionalAuth, ctrl.book);
router.get('/my',                        protect, ctrl.myAppointments);
router.get('/owner',                     protect, ctrl.ownerDashboard);
router.patch('/owner/mark-seen',         protect, ctrl.markOwnerSeen);
router.get('/partner/:partnerId',        protect, authorize('admin','superadmin'), ctrl.partnerAppointments);
router.patch('/:id/cancel',             protect, ctrl.cancel);

module.exports = router;
