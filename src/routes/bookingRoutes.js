const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  createBooking,
  getUserBookings,
  getProviderBookings,
  acceptBooking,
  rejectBooking,
  updateProviderBookingStatus,
  assignProvider,
  getAllBookings,
  updateBookingStatus,
  cancelBooking,
  getRebookingSuggestions,
} = require('../controllers/bookingController');

// ── User routes ───────────────────────────────────────────────────────────────
router.post('/',                          protect, createBooking);
router.get('/',                           protect, getUserBookings);
router.get('/rebooking-suggestions',      protect, getRebookingSuggestions);
router.put('/:id/cancel',                 protect, cancelBooking);

// ── Provider routes ───────────────────────────────────────────────────────────
// Provider sees their assigned bookings + pending pool
router.get('/provider',              protect, authorize('provider', 'admin', 'superadmin'), getProviderBookings);
// Provider accepts a pending booking
router.put('/:id/accept',            protect, authorize('provider', 'admin', 'superadmin'), acceptBooking);
// Provider rejects/releases a booking
router.put('/:id/reject',            protect, authorize('provider', 'admin', 'superadmin'), rejectBooking);
// Provider updates job progress (in-progress, completed)
router.put('/:id/provider-status',   protect, authorize('provider', 'admin', 'superadmin'), updateProviderBookingStatus);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin',                 protect, authorize('admin', 'superadmin'), getAllBookings);
router.put('/:id/status',            protect, authorize('admin', 'superadmin'), updateBookingStatus);
router.put('/:id/assign-provider',   protect, authorize('admin', 'superadmin'), assignProvider);

module.exports = router;
