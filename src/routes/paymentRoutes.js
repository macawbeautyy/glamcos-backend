const express = require('express');
const router = express.Router();

const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  markRazorpayFailed,
  createRazorpayBookingOrder,
  verifyRazorpayBookingPayment,
  markRazorpayBookingFailed,
} = require('../controllers/paymentController');

const { protect } = require('../middleware/auth');

router.use(protect);

// Marketplace order payments
router.post('/razorpay/order',  createRazorpayOrder);
router.post('/razorpay/verify', verifyRazorpayPayment);
router.post('/razorpay/failed', markRazorpayFailed);

// Service booking payments
router.post('/razorpay/booking-order',  createRazorpayBookingOrder);
router.post('/razorpay/booking-verify', verifyRazorpayBookingPayment);
router.post('/razorpay/booking-failed', markRazorpayBookingFailed);

module.exports = router;
