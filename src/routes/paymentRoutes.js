const express = require('express');
const router = express.Router();

const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  markRazorpayFailed,
} = require('../controllers/paymentController');

const { protect } = require('../middleware/auth');

router.use(protect);

router.post('/razorpay/order',  createRazorpayOrder);
router.post('/razorpay/verify', verifyRazorpayPayment);
router.post('/razorpay/failed', markRazorpayFailed);

module.exports = router;
