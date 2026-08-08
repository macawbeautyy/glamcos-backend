/**
 * Shared Razorpay helpers. Previously duplicated verbatim in jobController.js,
 * jobRegistrationController.js and paymentController.js — new Phase 2
 * monetization code (boost/featured-company purchases, and any future job
 * payment flow) should import from here instead of adding a 4th copy.
 * Existing controllers are left as-is per "do not rewrite working code."
 */
const crypto = require('crypto');
const ApiError = require('./ApiError');

let Razorpay = null;
try { Razorpay = require('razorpay'); } catch { Razorpay = null; }

function getRazorpayClient() {
  if (!Razorpay) throw ApiError.internal('Razorpay SDK not installed');
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw ApiError.internal('Razorpay credentials not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/**
 * Constant-time HMAC signature check for order+payment id pairs — the
 * standard Razorpay checkout verification. Uses timingSafeEqual (unlike the
 * plain `!==` comparisons elsewhere in the codebase) since this guards
 * money-moving state transitions.
 */
function verifyRazorpaySignature(orderId, paymentId, signature) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw ApiError.internal('Razorpay secret not configured');
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(String(signature || ''), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw ApiError.badRequest('Payment verification failed');
  }
  return true;
}

module.exports = { getRazorpayClient, verifyRazorpaySignature };
