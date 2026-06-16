/**
 * CandidateContact — records every time an employer unlocks / contacts /
 * hires a candidate. Powers the subscription earning model audit trail.
 */
const mongoose = require('mongoose');

const CandidateContactSchema = new mongoose.Schema({
  employer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  seeker:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  seekerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'JobSeekerProfile' },
  // For job-applicant unlocks (employer unlocks contact of someone who applied to their job)
  jobId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Job' },
  jobApplicationId:{ type: mongoose.Schema.Types.ObjectId },
  action:   { type: String, enum: ['unlock', 'hire', 'reject', 'shortlist'], default: 'unlock' },
  planAtTime: { type: String, default: null },
  paidAmount: { type: Number, default: 0 },
  razorpayPaymentId: { type: String, default: '' },
  razorpayOrderId:   { type: String, default: '' },
}, { timestamps: true });

CandidateContactSchema.index({ employer: 1, seeker: 1 }, { unique: false });
CandidateContactSchema.index({ employer: 1, jobApplicationId: 1 });
CandidateContactSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CandidateContact', CandidateContactSchema);
