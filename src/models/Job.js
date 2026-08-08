const mongoose = require('mongoose');

// ── Job Application sub-schema ────────────────────────────────────────────────
const ApplicationSchema = new mongoose.Schema({
  applicant: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  coverLetter: { type: String, default: '' },
  resumeUrl:   { type: String, default: '' },
  // Extra fields sent from the apply modal (name, phone, email, experience)
  applicantName:  { type: String, default: '' },
  applicantPhone: { type: String, default: '' },
  applicantEmail: { type: String, default: '' },
  experience:     { type: String, default: '' },
  status: {
    type: String,
    // 'withdrawn' is candidate-initiated; the rest are employer-initiated.
    enum: ['applied', 'shortlisted', 'rejected', 'hired', 'withdrawn'],
    default: 'applied',
  },
  withdrawnAt: { type: Date },
  appliedAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { _id: true });

// ── Job Schema ────────────────────────────────────────────────────────────────
const JobSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  companyName: { type: String, required: true, trim: true },   // salon / business name
  postedBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

  description: { type: String, default: '' },
  requirements:{ type: String, default: '' },

  location: {
    city:    { type: String, default: '' },
    state:   { type: String, default: '' },
    address: { type: String, default: '' },
  },

  jobType: {
    type: String,
    enum: ['full_time', 'part_time', 'freelance', 'internship', 'contract'],
    default: 'full_time',
  },

  category: {
    type: String,
    enum: ['hair_stylist', 'makeup_artist', 'nail_technician', 'spa_therapist',
           'salon_manager', 'fitness_trainer', 'other'],
    default: 'other',
  },

  salary: {
    min:      { type: Number, default: 0 },
    max:      { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    period:   { type: String, default: 'month' },
  },

  experience: { type: String, default: '' },   // e.g. "1-2 years"
  skills:     [{ type: String, trim: true }],
  openings:   { type: Number, default: 1 },
  deadline:   { type: Date },
  contactEmail: { type: String, default: '' },

  // Recruiter-facing lifecycle, distinct from `adminStatus` (moderation) and
  // `isActive` (legacy visibility flag). Drafts are never shown to candidates.
  lifecycleStatus: {
    type: String,
    enum: ['draft', 'active', 'paused', 'closed'],
    default: 'active',
    index: true,
  },
  closedAt: { type: Date },

  // ── Extended details captured by the Post Job wizard ──────────────────────
  subCategory:      { type: String, default: '' },
  companyBranch:    { type: String, default: '' },
  workMode:         { type: String, default: '' },   // on_site | home_service | both
  incentives:       { type: String, default: '' },
  workingHours:     { type: String, default: '' },
  weeklyOff:        { type: String, default: '' },
  benefits:         [{ type: String }],
  experienceLevel:  { type: String, default: '' },
  education:        { type: String, default: '' },
  languages:        [{ type: String }],
  immediateJoiner:   { type: Boolean, default: false },
  portfolioRequired: { type: Boolean, default: false },
  ownToolsRequired:  { type: Boolean, default: false },
  genderPreference:  { type: String, default: '' },
  agePreference:     { type: String, default: '' },
  additionalRequirements: { type: String, default: '' },

  // Employer-defined screening questions shown in the candidate apply flow.
  // `mapsToField` lets the app pre-fill from the seeker profile / past answers.
  applicationQuestions: [{
    id:          { type: String },
    label:       { type: String },
    type:        { type: String, default: 'text' },
    required:    { type: Boolean, default: false },
    mapsToField: { type: String, default: '' },
    options:     [{ type: String }],
  }],

  isActive:   { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  isUrgent:   { type: Boolean, default: false },

  adminStatus: {
    type: String,
    enum: ['pending_review', 'approved', 'rejected'],
    default: 'pending_review',
  },
  adminRejectReason: { type: String, default: '' },
  employerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerProfile' },

  applicationCount: { type: Number, default: 0 },
  applications: [ApplicationSchema],
}, {
  timestamps: true,
  toJSON:  { virtuals: true },
  toObject:{ virtuals: true },
});

// Text search index
JobSchema.index({ title: 'text', companyName: 'text', description: 'text' });
JobSchema.index({ category: 1, isActive: 1 });
JobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Job', JobSchema);
