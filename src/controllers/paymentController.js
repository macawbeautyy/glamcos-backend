const crypto = require('crypto');
const Order = require('../models/Order');
const Booking = require('../models/Booking');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Razorpay integration.
 *
 * Flow:
 *   1. Client places an order via POST /orders (status=pending, payment.status=pending).
 *   2. Client hits POST /payments/razorpay/order with orderId to get a Razorpay order_id.
 *   3. Client opens the Razorpay checkout SDK using that order_id.
 *   4. On success, Razorpay returns razorpay_order_id / razorpay_payment_id / razorpay_signature.
 *   5. Client hits POST /payments/razorpay/verify with those three fields;
 *      server verifies HMAC and marks the order paid + confirmed.
 *
 * We DO NOT keep the SDK as a hard dependency — if `razorpay` is not installed,
 * `createRazorpayOrder` will return a clear error telling the operator to install it.
 */

let Razorpay = null;
try {
  // eslint-disable-next-line global-require, import/no-unresolved
  Razorpay = require('razorpay');
} catch {
  // Install with: npm install razorpay
  Razorpay = null;
}

function getRazorpayClient() {
  if (!Razorpay) {
    throw ApiError.internal(
      'Razorpay SDK not installed on the server. Run: npm install razorpay'
    );
  }
  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    throw ApiError.internal(
      'Razorpay credentials not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
    );
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * @desc    Create a Razorpay order for an existing DB order.
 * @route   POST /api/v1/payments/razorpay/order
 * @access  Private
 * @body    { orderId }
 */
const createRazorpayOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) throw ApiError.badRequest('orderId is required');

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only pay for your own orders');
  }
  if (order.payment.status === 'paid') {
    throw ApiError.badRequest('This order is already paid');
  }
  if (order.payment.method !== 'razorpay') {
    throw ApiError.badRequest('This order is not paying via Razorpay');
  }

  const client = getRazorpayClient();

  // Razorpay expects amount in the smallest currency unit (paise for INR).
  const amountPaise = Math.round(order.total * 100);

  const rzpOrder = await client.orders.create({
    amount:   amountPaise,
    currency: order.currency || 'INR',
    receipt:  order.orderNumber,
    notes: {
      orderId:     order._id.toString(),
      orderNumber: order.orderNumber,
      userId:      req.user.id,
    },
  });

  order.payment.razorpayOrderId = rzpOrder.id;
  await order.save();

  return ApiResponse.success(res, {
    data: {
      razorpayOrderId: rzpOrder.id,
      amount:          rzpOrder.amount,
      currency:        rzpOrder.currency,
      keyId:           process.env.RAZORPAY_KEY_ID,
      orderId:         order._id,
      orderNumber:     order.orderNumber,
    },
    message: 'Razorpay order created',
  });
});

/**
 * @desc    Verify Razorpay payment signature and mark order paid.
 * @route   POST /api/v1/payments/razorpay/verify
 * @access  Private
 * @body    { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyRazorpayPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest(
      'razorpayOrderId, razorpayPaymentId and razorpaySignature are required'
    );
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw ApiError.internal('Razorpay secret not configured');
  }

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const valid = crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(razorpaySignature, 'hex')
  );

  if (!valid) {
    throw ApiError.badRequest('Invalid payment signature');
  }

  const order = await Order.findOne({ 'payment.razorpayOrderId': razorpayOrderId });
  if (!order) throw ApiError.notFound('Order not found for this Razorpay order id');
  if (order.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You cannot verify another user\'s payment');
  }

  // Idempotent: if already paid, just return success.
  if (order.payment.status !== 'paid') {
    order.payment.razorpayPaymentId = razorpayPaymentId;
    order.payment.razorpaySignature = razorpaySignature;
    order.payment.status            = 'paid';
    order.payment.paidAt            = new Date();
    if (order.status === 'pending') order.status = 'confirmed';
    await order.save();
  }

  return ApiResponse.success(res, {
    data: {
      orderId:     order._id,
      orderNumber: order.orderNumber,
      status:      order.status,
      payment:     order.payment,
    },
    message: 'Payment verified successfully',
  });
});

/**
 * @desc    Mark a Razorpay payment as failed (called from the client when checkout
 *          SDK reports failure). Does not affect the order record much — we just
 *          record the reason for support triage.
 * @route   POST /api/v1/payments/razorpay/failed
 * @access  Private
 * @body    { orderId, reason? }
 */
const markRazorpayFailed = asyncHandler(async (req, res) => {
  const { orderId, reason = 'Payment failed' } = req.body;
  if (!orderId) throw ApiError.badRequest('orderId is required');

  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only update your own orders');
  }
  if (order.payment.status === 'paid') {
    throw ApiError.badRequest('This order is already paid');
  }

  order.payment.status        = 'failed';
  order.payment.failureReason = String(reason).slice(0, 500);
  await order.save();

  return ApiResponse.success(res, {
    data: { orderId: order._id, payment: order.payment },
    message: 'Payment failure recorded',
  });
});

/**
 * @desc    Create a Razorpay order for a service booking.
 * @route   POST /api/v1/payments/razorpay/booking-order
 * @access  Private
 * @body    { bookingId, amount }   amount in rupees
 */
const createRazorpayBookingOrder = asyncHandler(async (req, res) => {
  const { bookingId, amount } = req.body;
  if (!bookingId) throw ApiError.badRequest('bookingId is required');
  if (!amount || amount <= 0) throw ApiError.badRequest('amount must be a positive number');

  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only pay for your own bookings');
  }
  if (booking.paymentStatus === 'paid') {
    throw ApiError.badRequest('This booking is already paid');
  }

  const client = getRazorpayClient();
  const amountPaise = Math.round(amount * 100);

  const rzpOrder = await client.orders.create({
    amount:   amountPaise,
    currency: 'INR',
    receipt:  `booking_${booking._id}`,
    notes: {
      bookingId: booking._id.toString(),
      userId:    req.user.id,
    },
  });

  booking.razorpayOrderId = rzpOrder.id;
  booking.paymentMode     = 'pay_online';
  await booking.save();

  return ApiResponse.success(res, {
    data: {
      razorpayOrderId: rzpOrder.id,
      amount:          rzpOrder.amount,
      currency:        rzpOrder.currency,
      keyId:           process.env.RAZORPAY_KEY_ID,
      bookingId:       booking._id,
    },
    message: 'Razorpay booking order created',
  });
});

/**
 * @desc    Verify Razorpay payment for a service booking.
 * @route   POST /api/v1/payments/razorpay/booking-verify
 * @access  Private
 * @body    { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyRazorpayBookingPayment = asyncHandler(async (req, res) => {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest('razorpayOrderId, razorpayPaymentId and razorpaySignature are required');
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw ApiError.internal('Razorpay secret not configured');

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  const valid = crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(razorpaySignature, 'hex')
  );

  if (!valid) throw ApiError.badRequest('Invalid payment signature');

  const booking = await Booking.findOne({ razorpayOrderId });
  if (!booking) throw ApiError.notFound('Booking not found for this Razorpay order id');
  if (booking.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You cannot verify another user\'s payment');
  }

  if (booking.paymentStatus !== 'paid') {
    booking.razorpayPaymentId = razorpayPaymentId;
    booking.razorpaySignature = razorpaySignature;
    booking.paymentStatus     = 'paid';
    if (booking.status === 'pending') booking.status = 'confirmed';
    await booking.save();
  }

  return ApiResponse.success(res, {
    data: { bookingId: booking._id, status: booking.status, paymentStatus: booking.paymentStatus },
    message: 'Booking payment verified successfully',
  });
});

/**
 * @desc    Mark a booking payment as failed.
 * @route   POST /api/v1/payments/razorpay/booking-failed
 * @access  Private
 * @body    { bookingId, reason? }
 */
const markRazorpayBookingFailed = asyncHandler(async (req, res) => {
  const { bookingId, reason = 'Payment failed' } = req.body;
  if (!bookingId) throw ApiError.badRequest('bookingId is required');

  const booking = await Booking.findById(bookingId);
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only update your own bookings');
  }

  // Optionally keep booking alive so user can retry with pay_at_salon
  booking.paymentStatus = 'pending';
  await booking.save();

  return ApiResponse.success(res, {
    data: { bookingId: booking._id },
    message: 'Payment failure recorded',
  });
});

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  markRazorpayFailed,
  createRazorpayBookingOrder,
  verifyRazorpayBookingPayment,
  markRazorpayBookingFailed,
};
