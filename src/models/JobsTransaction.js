/**
 * JobsTransaction — payment ledger for every Jobs-module monetization flow
 * (subscriptions, unlock-credit bundles, job boosts, featured company).
 *
 * Before this model, subscription/bundle purchases left no independent
 * record — only the mutated EmployerProfile fields. This is the single
 * source of truth for "Payment History" / "Billing History" and for
 * idempotency (unique razorpayOrderId prevents a client retry from creating
 * a second paid row for the same order).
 *
 * Lifecycle: a row is created with status 'created' at order-creation time
 * (so "Pending" payments are real, not synthesized), then flipped to 'paid'
 * on successful verification, or 'failed'/'cancelled' if the client reports
 * that outcome. Candidate-unlock purchases (CandidateContact) are NOT
 * duplicated here — that model already serves as their ledger; this model
 * covers the flows that previously had none.
 */
const mongoose = require('mongoose');

const JobsTransactionSchema = new mongoose.Schema({
  employer:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  employerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerProfile' },

  kind: {
    type: String,
    enum: ['subscription', 'credit_bundle', 'job_boost', 'featured_company'],
    required: true,
    index: true,
  },

  // Only one of these is set, depending on `kind`.
  job:              { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  planKey:          { type: String, default: '' },        // subscription
  boostDurationDays:{ type: Number },                      // job_boost
  creditQty:        { type: Number },                      // credit_bundle
  featuredDurationDays: { type: Number },                  // featured_company

  amount:   { type: Number, required: true, default: 0 },  // rupees (matches CandidateContact.paidAmount convention)
  currency: { type: String, default: 'INR' },
  status: {
    type: String,
    enum: ['created', 'paid', 'failed', 'cancelled'],
    default: 'created',
    index: true,
  },
  description: { type: String, default: '' },

  razorpayOrderId:   { type: String, index: true },
  razorpayPaymentId: { type: String, default: '' },
  razorpaySignature: { type: String, default: '' },
  failureReason:     { type: String, default: '' },

  meta: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

// A given Razorpay order should only ever back one transaction row.
JobsTransactionSchema.index({ razorpayOrderId: 1 }, { unique: true, sparse: true });
// A given payment id should only ever be applied once — blocks replay of
// the same successful payment against a second verify call.
JobsTransactionSchema.index({ razorpayPaymentId: 1 }, { unique: true, sparse: true, partialFilterExpression: { razorpayPaymentId: { $type: 'string', $ne: '' } } });
JobsTransactionSchema.index({ employer: 1, createdAt: -1 });

module.exports = mongoose.model('JobsTransaction', JobsTransactionSchema);
