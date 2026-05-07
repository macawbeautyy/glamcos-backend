const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/salonAppointmentController');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

router.get('/salons',               ctrl.listSalons);                          // list approved salons
router.get('/slots/:partnerId',     ctrl.getSlots);                            // available slots
router.post('/',                    optionalAuth, ctrl.book);                  // book a slot
router.get('/my',                   protect, ctrl.myAppointments);             // user's bookings
router.get('/partner/:partnerId',   protect, authorize('admin', 'superadmin'), ctrl.partnerAppointments);
router.patch('/:id/cancel',         protect, ctrl.cancel);                     // cancel

module.exports = router;
