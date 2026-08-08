const Job              = require('../models/Job');
const CandidateContact = require('../models/CandidateContact');
const EmployerProfile  = require('../models/EmployerProfile');
const JobSeekerProfile = require('../models/JobSeekerProfile');
const ApiError         = require('../utils/ApiError');
const ApiResponse      = require('../utils/ApiResponse');
const asyncHandler     = require('../utils/asyncHandler');
const crypto           = require('crypto');
// Reused rather than duplicated — see the comment on the export in
// jobRegistrationController for why.
const { presentCandidate, recordProfileViews, hasActiveSubscription, getEmployerPlanDoc } = require('./jobRegistrationController');

let Razorpay = null;
try { Razorpay = require('razorpay'); } catch { Razorpay = null; }
function getRazorpayClient() {
  if (!Razorpay) throw ApiError.internal('Razorpay SDK not installed');
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw ApiError.internal('Razorpay credentials not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

const maskPhone = (p) => p ? String(p).replace(/.(?=.{2})/g, '•') : '••••••••';
const maskEmail = (e) => {
  if (!e) return '••••@•••.•••';
  const [u, d] = String(e).split('@');
  if (!d) return '••••';
  return `${u.slice(0, 2)}••••@${d}`;
};

// ── Helper ─────────────────────────────────────────────────────────────────────
const JOB_TYPE_MAP = {
  'Full Time':  'full_time',
  'Part Time':  'part_time',
  'Freelance':  'freelance',
  'Internship': 'internship',
  'Contract':   'contract',
};

const CATEGORY_MAP = {
  'Hair':       'hair_stylist',
  'Nails':      'nail_technician',
  'Makeup':     'makeup_artist',
  'Spa':        'spa_therapist',
  'Management': 'salon_manager',
  'Fitness':    'fitness_trainer',
  // No dedicated enum values for these — they land in 'other', which is
  // browsable via the "Other" filter chip in the app.
  'Skin':       'other',
  'Grooming':   'other',
};

function parseJobType(val) {
  if (!val) return 'full_time';
  return JOB_TYPE_MAP[val] || val.toLowerCase().replace(' ', '_') || 'full_time';
}

function parseSalary(str) {
  if (!str) return { min: 0, max: 0 };
  const nums = str.match(/[\d,]+/g) || [];
  const clean = nums.map(n => parseInt(n.replace(/,/g, ''), 10));
  return { min: clean[0] || 0, max: clean[1] || clean[0] || 0 };
}

// ── Get all jobs (public) ─────────────────────────────────────────────────────
const getJobs = asyncHandler(async (req, res) => {
  const page     = Math.max(1, parseInt(req.query.page)  || 1);
  const limit    = Math.min(50, parseInt(req.query.limit) || 10);
  const skip     = (page - 1) * limit;

  // Lazily clear any boosts that expired since the last read — bulk update
  // instead of per-document saves so a busy jobs feed stays fast. No cron
  // job needed; this runs on the read path that actually cares about it.
  await Job.updateMany(
    { isFeatured: true, boostExpiresAt: { $lt: new Date() } },
    { $set: { isFeatured: false, isUrgent: false } }
  ).catch(() => {});

  // Candidates only ever see live listings — drafts/paused/closed are excluded.
  const filter = { isActive: true, adminStatus: 'approved', lifecycleStatus: 'active' };

  if (req.query.category && req.query.category !== 'all') {
    filter.category = req.query.category;
  }
  if (req.query.jobType) filter.jobType = req.query.jobType;

  // Text search
  if (req.query.q) {
    filter.$text = { $search: req.query.q };
  }

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .sort({ isFeatured: -1, isUrgent: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('-applications'),
    Job.countDocuments(filter),
  ]);

  return res.status(200).json({
    success: true,
    status:  200,
    message: 'Jobs fetched successfully',
    data: {
      jobs,
      pagination: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    },
  });
});

// ── Get single job ─────────────────────────────────────────────────────────────
const getJobById = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');
  await clearExpiredBoostIfNeeded(job);

  return ApiResponse.success(res, { data: job, message: 'Job fetched successfully' });
});

// ── Post a job (authenticated) ─────────────────────────────────────────────────
const postJob = asyncHandler(async (req, res) => {
  const {
    title, salonName, companyName, location, jobType, salary,
    experience, categories: cats, skills, openings, deadline,
    description, contactEmail, isUrgent, isFeatured,
    // Post Job wizard fields
    category, requirements, lifecycleStatus, applicationQuestions,
    subCategory, companyBranch, workMode, incentives, workingHours, weeklyOff,
    benefits, experienceLevel, education, languages, immediateJoiner,
    portfolioRequired, ownToolsRequired, genderPreference, agePreference,
    additionalRequirements,
  } = req.body;

  if (!title) throw ApiError.badRequest('title is required');

  // Check employer registration
  let empProfileForLink = null;
  if (req.user) {
    const EmployerProfile = require('../models/EmployerProfile');
    const empProfile = await EmployerProfile.findOne({ user: req.user._id || req.user.id });
    if (!empProfile) {
      throw ApiError.badRequest('Please register as an employer before posting jobs');
    }
    if (empProfile.status !== 'approved') {
      throw ApiError.badRequest('Your employer account is pending admin approval');
    }
    // Check plan limits using a live DB count (ignores rejected/inactive jobs).
    // maxListings: -1 means unlimited (Professional/Business plans) — skip
    // the cap entirely rather than comparing against -1.
    const limits = empProfile.planLimits;
    if (limits.maxListings !== -1) {
      const liveCount = await Job.countDocuments({
        postedBy:    req.user._id || req.user.id,
        adminStatus: { $in: ['pending_review', 'approved'] },
      });
      if (liveCount >= limits.maxListings) {
        throw ApiError.badRequest(
          `Your ${empProfile.subscriptionPlan === 'free' ? 'Free' : empProfile.subscriptionPlan} plan allows ${limits.maxListings} active listing${limits.maxListings !== 1 ? 's' : ''}. ` +
          `You already have ${liveCount} pending or live listing${liveCount !== 1 ? 's' : ''}. Upgrade to Professional or Business for unlimited job listings.`
        );
      }
    }
    empProfileForLink = empProfile;
  }

  // The wizard posts on behalf of the logged-in employer and doesn't ask for a
  // company name — it's already on their profile. Only error if we truly can't
  // resolve one from anywhere.
  const resolvedCompany = (salonName || companyName || empProfileForLink?.businessName || '').trim();
  if (!resolvedCompany) throw ApiError.badRequest('companyName is required');

  // Parse location string like "Mumbai, Maharashtra" into { city, state }
  let locationObj = { city: '', state: '' };
  const locStr = location || '';
  if (locStr.includes(',')) {
    const [city, ...rest] = locStr.split(',');
    locationObj = { city: city.trim(), state: rest.join(',').trim() };
  } else {
    locationObj = { city: locStr.trim(), state: '' };
  }

  // Map category labels to enum values
  // The wizard sends a single `category` enum directly; the older form sends
  // `categories` labels that need mapping.
  const VALID_CATEGORIES = Job.schema.path('category').enumValues;
  const categoryVal = (category && VALID_CATEGORIES.includes(category))
    ? category
    : (Array.isArray(cats) && cats.length > 0 ? (CATEGORY_MAP[cats[0]] || 'other') : 'other');

  const skillArr = typeof skills === 'string'
    ? skills.split(',').map(s => s.trim()).filter(Boolean)
    : (Array.isArray(skills) ? skills : []);

  const job = await Job.create({
    title:        title.trim(),
    companyName:  resolvedCompany,
    postedBy:     req.user?._id || req.user?.id || null,
    description:  description || '',
    location:     locationObj,
    jobType:      parseJobType(jobType),
    category:     categoryVal,
    salary:       parseSalary(salary),
    experience:   experience || '',
    skills:       skillArr,
    openings:     parseInt(openings) || 1,
    // Guard against free-text deadlines like "asap" — Invalid Date would
    // throw a Mongoose cast error and fail the whole post.
    deadline:     (() => {
      if (!deadline) return undefined;
      const d = new Date(deadline);
      return isNaN(d.getTime()) ? undefined : d;
    })(),
    contactEmail: contactEmail || '',
    isUrgent:     isUrgent  || false,
    isFeatured:   isFeatured || false,

    requirements: requirements || '',
    // Only ever 'draft' or 'active' at creation time.
    lifecycleStatus: lifecycleStatus === 'draft' ? 'draft' : 'active',
    applicationQuestions: Array.isArray(applicationQuestions) ? applicationQuestions : [],
    subCategory:   subCategory   || '',
    companyBranch: companyBranch || '',
    workMode:      workMode      || '',
    incentives:    incentives    || '',
    workingHours:  workingHours  || '',
    weeklyOff:     weeklyOff     || '',
    benefits:      Array.isArray(benefits)  ? benefits  : [],
    experienceLevel: experienceLevel || '',
    education:       education       || '',
    languages:     Array.isArray(languages) ? languages : [],
    immediateJoiner:   !!immediateJoiner,
    portfolioRequired: !!portfolioRequired,
    ownToolsRequired:  !!ownToolsRequired,
    genderPreference:  genderPreference || '',
    agePreference:     agePreference    || '',
    additionalRequirements: additionalRequirements || '',
  });

  // Link employer profile if exists
  if (empProfileForLink) {
    job.employerProfile = empProfileForLink._id;
    empProfileForLink.totalListings += 1;
    empProfileForLink.activeListings += 1;
    await Promise.all([job.save(), empProfileForLink.save()]);
  }

  require('../services/whatsappNotify').sendWhatsAppAlert(
    `💼 New Job listing posted\n${job.title} @ ${job.companyName}`
  ).catch(() => {});
  return ApiResponse.created(res, { data: job, message: 'Job posted successfully' });
});

// ── Update a job (owner only) ──────────────────────────────────────────────────
const updateJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');

  const userId = req.user?._id?.toString() || req.user?.id;
  if (job.postedBy?.toString() !== userId && req.user?.role !== 'admin') {
    throw ApiError.forbidden('Not authorized to edit this job');
  }

  const allowed = ['title', 'description', 'jobType', 'salary', 'experience',
                   'skills', 'openings', 'deadline', 'contactEmail',
                   'isActive', 'isUrgent', 'isFeatured',
                   'category', 'requirements', 'lifecycleStatus',
                   'applicationQuestions', 'subCategory', 'companyBranch',
                   'workMode', 'incentives', 'workingHours', 'weeklyOff',
                   'benefits', 'experienceLevel', 'education', 'languages',
                   'immediateJoiner', 'portfolioRequired', 'ownToolsRequired',
                   'genderPreference', 'agePreference', 'additionalRequirements'];
  allowed.forEach(key => {
    if (req.body[key] !== undefined) job[key] = req.body[key];
  });

  await job.save();
  return ApiResponse.success(res, { data: job, message: 'Job updated successfully' });
});

// ── Delete / deactivate a job ──────────────────────────────────────────────────
const deleteJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');

  const userId = req.user?._id?.toString() || req.user?.id;
  if (job.postedBy?.toString() !== userId && req.user?.role !== 'admin') {
    throw ApiError.forbidden('Not authorized');
  }

  job.isActive = false;
  await job.save();

  return ApiResponse.success(res, { data: null, message: 'Job removed' });
});

// ── Boost (mark as featured) ───────────────────────────────────────────────────
// Admin-only free instant boost (e.g. promotional/editorial placements).
// Employers must go through createBoostOrder/verifyBoostOrder below — Phase 2
// monetization makes boosting a paid one-time purchase, not a free action.
const boostJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');

  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  if (!isAdmin) {
    throw ApiError.forbidden('Boosting a job requires a paid purchase — use the Boost Job flow in the app.');
  }

  job.isFeatured = true;
  job.isUrgent   = true;
  job.boostExpiresAt = undefined; // admin boosts don't expire automatically
  await job.save();
  return ApiResponse.success(res, { data: job, message: 'Job boosted' });
});

// ── Paid Boost Job purchase ────────────────────────────────────────────────────
const BOOST_PRICES = { 3: 299, 7: 599, 15: 999 }; // INR, per duration in days

/**
 * @route POST /api/v1/jobs/:id/boost/order
 * @body { days: 3 | 7 | 15 }
 */
const createBoostOrder = asyncHandler(async (req, res) => {
  const { getRazorpayClient } = require('../utils/razorpay');
  const JobsTransaction = require('../models/JobsTransaction');
  const EmployerProfile = require('../models/EmployerProfile');

  const userId = req.user?._id?.toString() || req.user?.id;
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');
  if (job.postedBy?.toString() !== userId) throw ApiError.forbidden('Not authorized to boost this job');

  const days = Number(req.body?.days);
  const price = BOOST_PRICES[days];
  if (!price) throw ApiError.badRequest(`days must be one of: ${Object.keys(BOOST_PRICES).join(', ')}`);

  const employerProfile = await EmployerProfile.findOne({ user: userId });

  const client = getRazorpayClient();
  const rzpOrder = await client.orders.create({
    amount: price * 100,
    currency: 'INR',
    receipt: `BOOST-${Date.now().toString(36).toUpperCase()}`,
    notes: { type: 'job_boost', jobId: String(job._id), days, employerId: userId },
  });

  await JobsTransaction.create({
    employer: userId,
    employerProfile: employerProfile?._id,
    kind: 'job_boost',
    job: job._id,
    boostDurationDays: days,
    amount: price,
    status: 'created',
    description: `Job Boost — ${days} Days (${job.title})`,
    razorpayOrderId: rzpOrder.id,
  });

  return ApiResponse.success(res, {
    data: { razorpayOrderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, keyId: process.env.RAZORPAY_KEY_ID, days, price },
    message: 'Boost order created',
  });
});

/**
 * @route POST /api/v1/jobs/:id/boost/verify
 * @body { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyBoostOrder = asyncHandler(async (req, res) => {
  const { verifyRazorpaySignature } = require('../utils/razorpay');
  const JobsTransaction = require('../models/JobsTransaction');

  const userId = req.user?._id?.toString() || req.user?.id;
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest('razorpayOrderId, razorpayPaymentId and razorpaySignature are required');
  }

  const txn = await JobsTransaction.findOne({ razorpayOrderId, employer: userId, kind: 'job_boost' });
  if (!txn) throw ApiError.notFound('Boost order not found');
  if (txn.status === 'paid') {
    // Idempotent — client retried after already succeeding.
    return ApiResponse.success(res, { data: { jobId: txn.job, boostExpiresAt: txn.meta?.boostExpiresAt }, message: 'Already boosted' });
  }

  verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

  const job = await Job.findById(txn.job);
  if (!job) throw ApiError.notFound('Job not found');

  const now = new Date();
  const base = job.boostExpiresAt && job.boostExpiresAt > now ? job.boostExpiresAt : now;
  const boostExpiresAt = new Date(base.getTime() + txn.boostDurationDays * 86400000);
  job.isFeatured = true;
  job.isUrgent = true;
  job.boostExpiresAt = boostExpiresAt;
  await job.save();

  txn.status = 'paid';
  txn.razorpayPaymentId = razorpayPaymentId;
  txn.razorpaySignature = razorpaySignature;
  txn.meta = { ...(txn.meta || {}), boostExpiresAt };
  await txn.save();

  return ApiResponse.success(res, { data: { job, boostExpiresAt }, message: 'Job boosted — now featured' });
});

/**
 * Lazily clears an expired boost on read, so featured placement never
 * outlives what was paid for without needing a cron job. Called from
 * getJobs (per-item, best-effort) and getJobById.
 */
async function clearExpiredBoostIfNeeded(job) {
  if (job?.isFeatured && job.boostExpiresAt && job.boostExpiresAt < new Date()) {
    job.isFeatured = false;
    job.isUrgent = false;
    await job.save().catch(() => {});
  }
  return job;
}

/**
 * Duplicate a job as a fresh draft (owner/admin only).
 *
 * Deliberately does NOT copy applications, applicationCount, boost flags or
 * moderation state — a clone is a new listing that must be reviewed on its
 * own merits, and inheriting another job's applicants would be wrong.
 */
const duplicateJob = asyncHandler(async (req, res) => {
  const source = await Job.findById(req.params.id);
  if (!source) throw ApiError.notFound('Job not found');

  const uid = req.user?._id?.toString() || req.user?.id;
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  if (source.postedBy?.toString() !== uid && !isAdmin) {
    throw ApiError.forbidden('Not authorized to duplicate this job');
  }

  const clone = source.toObject();
  ['_id', 'createdAt', 'updatedAt', '__v', 'applications', 'applicationCount',
   'adminStatus', 'adminRejectReason', 'closedAt'].forEach(k => delete clone[k]);

  const job = await Job.create({
    ...clone,
    title: `${source.title} (Copy)`,
    lifecycleStatus: 'draft',
    isActive: false,
    isFeatured: false,
    isUrgent: false,
  });

  return ApiResponse.created(res, { data: job, message: 'Job duplicated as draft' });
});

// ── Apply for a job ────────────────────────────────────────────────────────────
const applyForJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job || !job.isActive) throw ApiError.notFound('Job not found or inactive');

  const userId = req.user?._id?.toString() || req.user?.id;
  const already = job.applications.some(a => a.applicant?.toString() === userId);
  if (already) throw ApiError.badRequest('You have already applied for this job');

  job.applications.push({
    applicant:      userId,
    coverLetter:    req.body.coverLetter    || req.body.coverNote    || '',
    resumeUrl:      req.body.resumeUrl      || '',
    resumeName:     req.body.resumeName     || '',
    applicantName:  req.body.applicantName  || '',
    applicantPhone: req.body.applicantPhone || '',
    applicantEmail: req.body.applicantEmail || '',
    experience:     req.body.experience     || '',
    portfolioPhotos: Array.isArray(req.body.portfolioPhotos) ? req.body.portfolioPhotos : [],
    answers:         Array.isArray(req.body.answers) ? req.body.answers : [],
  });
  job.applicationCount = job.applications.length;
  await job.save();

  return ApiResponse.success(res, { data: null, message: 'Application submitted successfully' });
});

// Interview types the ScheduleInterview / InterviewDetails screens use —
// distinct from the shorter in_person/video_call/phone_call set used
// elsewhere; kept as free strings on the schema so either UI can write here.
const INTERVIEW_TYPE_LABELS = { video: 'Video Call', video_call: 'Video Call', phone: 'Phone Call', phone_call: 'Phone Call', in_person: 'In-Person' };

/**
 * Shapes one application's interview fields into exactly the flat names
 * InterviewDetailsScreen / ScheduleInterviewScreen read (interviewDate,
 * interviewTime, interviewType, meetingLink, instructions, ...) — done here
 * once so neither screen needs to know the underlying Mongoose field names
 * (interviewScheduledAt, interviewMode, interviewMeetingLink, interviewNotes).
 */
function presentInterviewFields(a) {
  const dt = a.interviewScheduledAt ? new Date(a.interviewScheduledAt) : null;
  return {
    interviewDate: dt ? dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
    interviewTime: dt ? dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '',
    interviewScheduledAt: a.interviewScheduledAt || null,
    interviewType: a.interviewMode || 'video',
    meetingLink: a.interviewMeetingLink || '',
    location: a.interviewLocation || '',
    instructions: a.interviewNotes || '',
    interviewers: a.interviewers || [],
    rescheduleRequested: Boolean(a.rescheduleRequested),
    rescheduleRequestNote: a.rescheduleRequestNote || '',
    respondedAt: a.respondedAt || null,
    cancelReason: a.cancelReason || '',
    hireRating: a.hireRating || null,
    hireFeedback: a.hireFeedback || '',
  };
}

// ── Get my applications (as job seeker) ────────────────────────────────────────
const getMyApplications = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString() || req.user?.id;

  const jobs = await Job.find({ 'applications.applicant': userId })
    .select('title companyName location jobType salary applications createdAt postedBy employerProfile')
    .populate('postedBy', 'phone email')
    .populate('employerProfile', 'businessName phone email logoUrl');

  const applications = jobs.map(job => {
    const app = job.applications.find(a => a.applicant?.toString() === userId);
    const a = app.toObject ? app.toObject() : app;
    // Recruiter contact unlocks for the candidate once they've accepted the
    // interview (or it's since progressed to completed/hired) — the mirror
    // image of the candidate-contact unlock the employer gets on scheduling.
    const recruiterUnlocked = ['accepted', 'completed', 'hired'].includes(a.status);
    const emp = job.employerProfile || {};
    const posted = job.postedBy || {};

    return {
      _id:         a._id,
      job: {
        _id:         job._id,
        title:       job.title,
        companyName: job.companyName,
        location:    job.location,
        jobType:     job.jobType,
        salary:      job.salary,
      },
      // Flat convenience fields InterviewDetailsScreen (candidate view) reads.
      jobTitle:    job.title,
      jobCity:     job.location?.city || '',
      companyName: job.companyName,
      recruiterId: emp._id || posted._id || null,
      recruiterPhone: recruiterUnlocked ? (emp.phone || posted.phone || '') : '',
      recruiterEmail: recruiterUnlocked ? (emp.email || posted.email || '') : '',
      status:    a.status,
      appliedAt: a.appliedAt,
      resumeName: a.resumeName || '',
      portfolioPhotos: a.portfolioPhotos || [],
      coverNote: a.coverLetter || '',
      ...presentInterviewFields(a),
    };
  });

  return ApiResponse.success(res, { data: applications, message: 'Applications fetched' });
});

/**
 * Candidate: withdraw their own application.
 *
 * Keeps the record (so the employer sees it was withdrawn rather than having
 * it silently vanish mid-conversation) and just flips the status. Refuses once
 * the employer has already hired, since that's no longer the candidate's call.
 */
const withdrawApplication = asyncHandler(async (req, res) => {
  const uid = req.user?._id?.toString() || req.user?.id;
  const { applicationId } = req.params;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const app = job.applications.id(applicationId);
  if (!app) throw ApiError.notFound('Application not found');
  // Only the applicant may withdraw — never the employer or a passer-by.
  if (String(app.applicant) !== String(uid)) {
    throw ApiError.forbidden('You can only withdraw your own application');
  }
  if (app.status === 'hired') {
    throw ApiError.badRequest('You have already been hired for this role — contact the employer directly');
  }
  if (app.status === 'withdrawn') {
    return ApiResponse.success(res, { data: { _id: app._id, status: 'withdrawn' }, message: 'Already withdrawn' });
  }

  app.status = 'withdrawn';
  app.withdrawnAt = new Date();
  app.updatedAt = new Date();
  // Withdrawn applications shouldn't inflate the employer's applicant count.
  job.applicationCount = Math.max(0, (job.applicationCount || 1) - 1);
  await job.save();

  return ApiResponse.success(res, {
    data: { _id: app._id, status: app.status },
    message: 'Application withdrawn',
  });
});

/**
 * Candidate: permanently remove their application record.
 *
 * Only allowed once it's reached a terminal state (withdrawn/rejected, or
 * an interview that ended without a hire: declined/cancelled) — deleting an
 * active application or one still in a live interview flow would erase it
 * from the employer's pipeline without warning.
 */
const deleteApplication = asyncHandler(async (req, res) => {
  const uid = req.user?._id?.toString() || req.user?.id;
  const { applicationId } = req.params;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const app = job.applications.id(applicationId);
  if (!app) throw ApiError.notFound('Application not found');
  if (String(app.applicant) !== String(uid)) {
    throw ApiError.forbidden('You can only delete your own application');
  }
  if (!['withdrawn', 'rejected', 'declined', 'cancelled'].includes(app.status)) {
    throw ApiError.badRequest('Withdraw the application before deleting it');
  }

  app.deleteOne();
  await job.save();

  return ApiResponse.success(res, { data: { _id: applicationId }, message: 'Application deleted' });
});

// ── Get my job listings (as employer) ─────────────────────────────────────────
const getMyListings = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString() || req.user?.id;
  const jobs   = await Job.find({ postedBy: userId }).sort({ createdAt: -1 });
  return ApiResponse.success(res, { data: jobs, message: 'Listings fetched' });
});

// ── Get applicants for a specific job ─────────────────────────────────────────
const getJobApplications = asyncHandler(async (req, res) => {
  const ownerId = req.user?._id?.toString() || req.user?.id;
  const job = await Job.findById(req.params.id).populate('applications.applicant', 'name firstName lastName email phone');
  if (!job) throw ApiError.notFound('Job not found');

  // Only the employer who posted the job (or admin) may see applicants
  if (job.postedBy?.toString() !== ownerId && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    throw ApiError.forbidden('Access denied');
  }

  // Which applications has this employer already unlocked?
  const unlockedContacts = await CandidateContact.find({
    employer: ownerId,
    jobApplicationId: { $in: job.applications.map(a => a._id) },
    action: 'unlock',
  }).select('jobApplicationId');
  const unlockedSet = new Set(unlockedContacts.map(c => String(c.jobApplicationId)));

  // Contact unlocks either because the employer paid for it, or — the real
  // rule for this flow — because an interview has been scheduled (any point
  // from 'interview' through to 'hired' in the lifecycle keeps it unlocked).
  const INTERVIEW_LIFECYCLE = ['interview', 'accepted', 'declined', 'completed', 'cancelled', 'hired'];

  // "Limited Applicant Visibility" on the Free plan — cap how many
  // applicants are returned rather than masking fields (unlike contact
  // unlock). Professional/Business see everyone via unlimitedApplicants.
  const FREE_APPLICANT_VISIBILITY_LIMIT = 10;
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  let visibleApplications = job.applications;
  let limited = false;
  let totalApplicants = job.applications.length;
  if (!isAdmin) {
    const EmployerProfile = require('../models/EmployerProfile');
    const employerProfile = await EmployerProfile.findOne({ user: ownerId });
    const planDoc = await getEmployerPlanDoc(employerProfile);
    if (!planDoc?.unlimitedApplicants && totalApplicants > FREE_APPLICANT_VISIBILITY_LIMIT) {
      // Newest first, same ordering the client applies anyway.
      visibleApplications = [...job.applications]
        .sort((a, b) => new Date(b.appliedAt || b.createdAt) - new Date(a.appliedAt || a.createdAt))
        .slice(0, FREE_APPLICANT_VISIBILITY_LIMIT);
      limited = true;
    }
  }

  const applications = visibleApplications.map(app => {
    const unlocked = unlockedSet.has(String(app._id)) || INTERVIEW_LIFECYCLE.includes(app.status);
    const a = app.toObject ? app.toObject() : app;
    const u = a.applicant || {};
    const phone = u.phone || a.applicantPhone || '';
    const email = u.email || a.applicantEmail || '';
    const name  = u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || a.applicantName || 'Applicant';

    return {
      _id:         a._id,
      status:      a.status,
      appliedAt:   a.appliedAt,
      coverLetter: a.coverLetter,
      experience:  a.experience,
      resumeUrl:   unlocked ? a.resumeUrl : null,
      resumeName:  a.resumeName || '',
      portfolioPhotos: a.portfolioPhotos || [],
      answers:         a.answers || [],
      recruiterNotes:       a.recruiterNotes || '',
      reportCount:          (a.reports || []).length,
      unlocked,
      ...presentInterviewFields(a),
      // Flat convenience fields — the Applicant List / Candidate Profile
      // screens read these directly; kept alongside `applicant.*` below so
      // the older JobApplicantsScreen (still registered, unused by any nav
      // now) doesn't break.
      applicantName:  name,
      applicantEmail: unlocked ? email : maskEmail(email),
      applicantPhone: unlocked ? phone : maskPhone(phone),
      applicant: {
        _id:   u._id || a.applicant,
        name,
        email: unlocked ? email : maskEmail(email),
        phone: unlocked ? phone : maskPhone(phone),
      },
    };
  });

  return ApiResponse.success(res, {
    data: applications,
    message: 'Applicants fetched',
    meta: { totalApplicants, visibleCount: applications.length, limited },
  });
});

// ── Admin: get ALL applications across all jobs ───────────────────────────────
const getAllApplications = asyncHandler(async (req, res) => {
  const jobs = await Job.find({ 'applications.0': { $exists: true } })
    .select('title employerName employer applications')
    .populate('applications.applicant', 'firstName lastName name email phone')
    .lean();

  const allApps = [];
  jobs.forEach(job => {
    (job.applications || []).forEach(app => {
      allApps.push({
        ...app,
        job: { _id: job._id, title: job.title, employer: job.employer, employerName: job.employerName },
      });
    });
  });

  allApps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return ApiResponse.success(res, { data: allApps, message: 'All applications' });
});

// ── Update application status ─────────────────────────────────────────────────
const updateApplicationStatus = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { status, rating, feedback, cancelReason } = req.body;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  // Only the employer who posted the job (or an admin) may change an
  // application's status — otherwise any logged-in user could tamper
  // with other employers' applicants. Note: 'accepted'/'declined' are
  // deliberately NOT in ALLOWED_STATUSES below — those are candidate-only
  // actions and go through respondToInterview, which checks the candidate
  // owns the application instead of this employer-ownership check.
  const userId  = req.user?._id?.toString() || req.user?.id;
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  if (job.postedBy?.toString() !== userId && !isAdmin) {
    throw ApiError.forbidden('Not authorized to update this application');
  }

  // 'interview' is intentionally settable here too (not just via
  // scheduleInterview below) so a recruiter can undo/change it via the
  // generic status path if needed; scheduleInterview is the richer path
  // that also records date/mode/location. 'completed'/'cancelled' come from
  // the recruiter's "Mark Completed" / "Cancel Interview" actions.
  const ALLOWED_STATUSES = ['applied', 'viewed', 'shortlisted', 'interview', 'completed', 'cancelled', 'rejected', 'hired'];
  if (!ALLOWED_STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }

  const app = job.applications.id(applicationId);
  if (status === 'viewed' && app.status !== 'applied') {
    // Never downgrade a further-along status (shortlisted/interview/etc)
    // back to "viewed" just because the recruiter re-opened the profile.
    return ApiResponse.success(res, { data: app, message: 'Application status unchanged' });
  }
  if (status === 'viewed' && !app.viewedAt) app.viewedAt = new Date();
  if (status === 'cancelled') { app.cancelledAt = new Date(); app.cancelReason = cancelReason || ''; }
  // Close Job → Candidate Hired carries an optional rating/feedback from
  // the same modal — persisted here rather than a separate endpoint since
  // it's set atomically with the hire.
  if (status === 'hired') {
    if (rating != null) app.hireRating = Math.max(1, Math.min(5, Number(rating) || 5));
    if (feedback != null) app.hireFeedback = String(feedback).slice(0, 1000);
  }
  app.status    = status;
  app.updatedAt = new Date();
  await job.save();

  if (app.applicant) {
    const { Notif } = require('../services/notifications');
    const payload = { jobTitle: job.title, companyName: job.companyName };
    if (status === 'shortlisted') Notif.jobApplicationShortlisted(app.applicant, payload).catch(() => {});
    else if (status === 'rejected') Notif.jobApplicationRejected(app.applicant, payload).catch(() => {});
    else if (status === 'hired') Notif.jobApplicationHired(app.applicant, payload).catch(() => {});
    else if (status === 'cancelled') Notif.jobInterviewCancelled?.(app.applicant, { ...payload, reason: app.cancelReason }).catch(() => {});
  }

  return ApiResponse.success(res, { data: { ...(app.toObject ? app.toObject() : app), ...presentInterviewFields(app.toObject ? app.toObject() : app) }, message: 'Application status updated' });
});

// ── Job Applicant Contact Unlock (credits-first, Razorpay fallback) ──────────
const UNLOCK_PRICE_JOB = 49900; // ₹499 in paise

/**
 * Create a Razorpay order (or use credit) to unlock a job applicant's contact.
 * @route POST /api/v1/jobs/:id/applications/:applicationId/unlock/order
 */
const createJobApplicantUnlockOrder = asyncHandler(async (req, res) => {
  const ownerId = req.user?._id?.toString() || req.user?.id;
  const { id: jobId, applicationId } = req.params;

  const job = await Job.findById(jobId);
  if (!job) throw ApiError.notFound('Job not found');
  if (job.postedBy?.toString() !== ownerId) throw ApiError.forbidden('Access denied');

  const app = job.applications.id(applicationId);
  if (!app) throw ApiError.notFound('Application not found');

  // Already unlocked?
  const existing = await CandidateContact.findOne({
    employer: ownerId,
    jobApplicationId: applicationId,
    action: 'unlock',
  });
  if (existing) throw ApiError.badRequest('Already unlocked');

  // ── Use a prepaid credit if available ────────────────────────────────────
  const employer = await EmployerProfile.findOne({ user: ownerId });
  if (employer && employer.unlockCredits > 0) {
    employer.unlockCredits -= 1;
    await employer.save();

    await CandidateContact.create({
      employer: ownerId,
      seeker: app.applicant,
      jobId,
      jobApplicationId: applicationId,
      action: 'unlock',
      planAtTime: 'credit',
      paidAmount: 0,
    });

    const User = require('../models/User');
    const userDoc = await User.findById(app.applicant).select('email phone').lean();

    return ApiResponse.success(res, {
      data: {
        creditUsed: true,
        creditsRemaining: employer.unlockCredits,
        applicationId,
        phone: userDoc?.phone || app.applicantPhone || null,
        email: userDoc?.email || app.applicantEmail || null,
        resumeUrl: app.resumeUrl || null,
      },
      message: `1 credit used. ${employer.unlockCredits} remaining.`,
    });
  }

  // ── No credits — create Razorpay order ───────────────────────────────────
  const client = getRazorpayClient();
  const rzpOrder = await client.orders.create({
    amount: UNLOCK_PRICE_JOB,
    currency: 'INR',
    receipt: `JAPP-${Date.now().toString(36).toUpperCase()}`,
    notes: { type: 'job_applicant_unlock', jobId, applicationId, employerId: ownerId },
  });

  return ApiResponse.success(res, {
    data: {
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      applicationId,
    },
    message: 'Unlock order created',
  });
});

/**
 * Verify payment and unlock job applicant contact.
 * @route POST /api/v1/jobs/:id/applications/:applicationId/unlock/verify
 */
const verifyJobApplicantUnlockPayment = asyncHandler(async (req, res) => {
  const ownerId = req.user?._id?.toString() || req.user?.id;
  const { id: jobId, applicationId } = req.params;
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
  if (expected !== razorpaySignature) throw ApiError.badRequest('Payment verification failed');

  const job = await Job.findById(jobId);
  if (!job) throw ApiError.notFound('Job not found');
  if (job.postedBy?.toString() !== ownerId) throw ApiError.forbidden('Access denied');

  const app = job.applications.id(applicationId);
  if (!app) throw ApiError.notFound('Application not found');

  const alreadyUnlocked = await CandidateContact.findOne({
    employer: ownerId, jobApplicationId: applicationId, action: 'unlock',
  });
  if (!alreadyUnlocked) {
    await CandidateContact.create({
      employer: ownerId,
      seeker: app.applicant,
      jobId,
      jobApplicationId: applicationId,
      action: 'unlock',
      planAtTime: 'per_profile',
      paidAmount: 499,
      razorpayPaymentId,
      razorpayOrderId,
    });
  }

  const User = require('../models/User');
  const userDoc = await User.findById(app.applicant).select('email phone').lean();

  return ApiResponse.success(res, {
    data: {
      applicationId,
      phone: userDoc?.phone || app.applicantPhone || null,
      email: userDoc?.email || app.applicantEmail || null,
      resumeUrl: app.resumeUrl || null,
    },
    message: 'Payment verified — contact unlocked',
  });
});

/**
 * Recruiter: schedule an interview with an applicant.
 * This is the real unlock trigger for contact details (see getJobApplications
 * / getCandidateForApplication) — no payment required once an interview is
 * booked, per product rule.
 * @route PATCH /api/v1/jobs/applications/:applicationId/schedule-interview
 */
const scheduleInterview = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { scheduledAt, mode, location, meetingLink, interviewers, notes } = req.body;

  if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) {
    throw ApiError.badRequest('A valid scheduledAt date/time is required');
  }

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const userId  = req.user?._id?.toString() || req.user?.id;
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  if (job.postedBy?.toString() !== userId && !isAdmin) {
    throw ApiError.forbidden('Not authorized to schedule for this application');
  }

  // Interview Scheduling is a Professional/Business feature per the
  // monetization model — Free-plan employers get a clear paywall error
  // rather than the action silently working.
  if (!isAdmin) {
    const EmployerProfile = require('../models/EmployerProfile');
    const employerProfile = await EmployerProfile.findOne({ user: userId });
    const planDoc = await getEmployerPlanDoc(employerProfile);
    if (!planDoc?.interviewScheduling) {
      // "Upgrade required:" prefix is a stable, grep-able marker the mobile
      // app matches on to show a paywall instead of a generic error toast —
      // see PAYWALL_MESSAGE_PREFIX in mobile-user/src/utils/entitlements.js.
      throw ApiError.forbidden('Upgrade required: Interview scheduling is a Professional/Business feature.');
    }
  }

  const app = job.applications.id(applicationId);
  const wasScheduledBefore = Boolean(app.interviewScheduledAt);
  if (['rejected', 'withdrawn'].includes(app.status)) {
    throw ApiError.badRequest(`Cannot schedule an interview for a ${app.status} application`);
  }

  // Also covers "Reschedule" from InterviewDetailsScreen — re-running this
  // endpoint resets status back to 'interview' (pending candidate response
  // again) and clears any outstanding reschedule request/prior response.
  app.status = 'interview';
  app.interviewScheduledAt = new Date(scheduledAt);
  app.interviewMode = mode || '';
  app.interviewLocation = location || '';
  app.interviewMeetingLink = meetingLink || '';
  if (Array.isArray(interviewers)) {
    app.interviewers = interviewers
      .filter(it => it && it.name)
      .map(it => ({ name: String(it.name), role: it.role || '', primary: Boolean(it.primary) }));
  }
  app.interviewNotes = notes || '';
  app.rescheduleRequested = false;
  app.rescheduleRequestNote = '';
  app.respondedAt = null;
  app.updatedAt = new Date();
  await job.save();

  if (app.applicant) {
    const { Notif } = require('../services/notifications');
    const payload = { jobTitle: job.title, companyName: job.companyName, scheduledAt: app.interviewScheduledAt };
    if (wasScheduledBefore) Notif.jobInterviewRescheduled?.(app.applicant, payload).catch(() => {});
    else Notif.jobInterviewScheduled?.(app.applicant, payload).catch(() => {});
  }

  const a = app.toObject ? app.toObject() : app;
  return ApiResponse.success(res, { data: { ...a, ...presentInterviewFields(a) }, message: 'Interview scheduled — contact details unlocked' });
});

/**
 * Candidate: accept or decline a scheduled interview. Ownership-checked
 * against the applicant, mirroring withdrawApplication — this is why it's
 * a separate endpoint from updateApplicationStatus (employer-only).
 * @route PATCH /api/v1/jobs/applications/:applicationId/interview/respond
 * @body { response: 'accepted' | 'declined' }
 */
const respondToInterview = asyncHandler(async (req, res) => {
  const uid = req.user?._id?.toString() || req.user?.id;
  const { applicationId } = req.params;
  const { response } = req.body;

  if (!['accepted', 'declined'].includes(response)) {
    throw ApiError.badRequest("response must be 'accepted' or 'declined'");
  }

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const app = job.applications.id(applicationId);
  if (String(app.applicant) !== String(uid)) {
    throw ApiError.forbidden('You can only respond to your own interview invite');
  }
  if (app.status !== 'interview') {
    throw ApiError.badRequest(`Cannot respond — this interview is currently "${app.status}"`);
  }

  app.status = response;
  app.respondedAt = new Date();
  app.updatedAt = new Date();
  await job.save();

  const { Notif } = require('../services/notifications');
  const payload = { jobTitle: job.title, companyName: job.companyName, candidateName: app.applicantName };
  if (job.postedBy) {
    if (response === 'accepted') Notif.jobInterviewAccepted?.(job.postedBy, payload).catch(() => {});
    else Notif.jobInterviewDeclined?.(job.postedBy, payload).catch(() => {});
  }

  const a = app.toObject ? app.toObject() : app;
  return ApiResponse.success(res, {
    data: { ...a, ...presentInterviewFields(a) },
    message: response === 'accepted' ? 'Interview accepted — recruiter contact unlocked' : 'Interview declined',
  });
});

/**
 * Candidate: request a reschedule without changing the interview status —
 * just flags it for the recruiter, who re-runs scheduleInterview to clear it.
 * @route PATCH /api/v1/jobs/applications/:applicationId/interview/request-reschedule
 * @body { note }
 */
const requestInterviewReschedule = asyncHandler(async (req, res) => {
  const uid = req.user?._id?.toString() || req.user?.id;
  const { applicationId } = req.params;
  const { note } = req.body;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const app = job.applications.id(applicationId);
  if (String(app.applicant) !== String(uid)) {
    throw ApiError.forbidden('You can only request a reschedule for your own interview');
  }
  if (app.status !== 'interview') {
    throw ApiError.badRequest(`Cannot request a reschedule — this interview is currently "${app.status}"`);
  }

  app.rescheduleRequested = true;
  app.rescheduleRequestNote = note || '';
  app.rescheduleRequestedAt = new Date();
  app.updatedAt = new Date();
  await job.save();

  if (job.postedBy) {
    const { Notif } = require('../services/notifications');
    Notif.jobInterviewRescheduleRequested?.(job.postedBy, { jobTitle: job.title, candidateName: app.applicantName, note: app.rescheduleRequestNote }).catch(() => {});
  }

  return ApiResponse.success(res, { data: { _id: app._id, rescheduleRequested: true }, message: 'Reschedule request sent to the recruiter' });
});

/**
 * Recruiter: save/update private notes on an applicant. Never shown to the
 * candidate — enforced by never returning this field from any candidate-
 * facing endpoint (getMyApplications, etc).
 * @route PATCH /api/v1/jobs/applications/:applicationId/notes
 */
const updateApplicationNotes = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { notes } = req.body;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const userId = req.user?._id?.toString() || req.user?.id;
  if (job.postedBy?.toString() !== userId && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    throw ApiError.forbidden('Not authorized to update notes on this application');
  }

  const app = job.applications.id(applicationId);
  app.recruiterNotes = typeof notes === 'string' ? notes : '';
  app.updatedAt = new Date();
  await job.save();

  return ApiResponse.success(res, { data: { _id: app._id, recruiterNotes: app.recruiterNotes }, message: 'Notes saved' });
});

/**
 * Recruiter: report a candidate/applicant for review. Mirrors Reel.js's
 * embedded reports[] pattern rather than a new top-level Report model.
 * @route POST /api/v1/jobs/applications/:applicationId/report
 */
const reportApplicant = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const { reason } = req.body;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const userId = req.user?._id?.toString() || req.user?.id;
  if (job.postedBy?.toString() !== userId && req.user?.role !== 'admin' && req.user?.role !== 'superadmin') {
    throw ApiError.forbidden('Not authorized to report this application');
  }

  const app = job.applications.id(applicationId);
  app.reports.push({ reportedBy: userId, reason: reason || 'Not specified', reportedAt: new Date() });
  await job.save();

  return ApiResponse.success(res, { data: { _id: app._id, reportCount: app.reports.length }, message: 'Reported — our team will review this profile' });
});

/**
 * Recruiter: fetch the applicant's full seeker-profile data (skills,
 * education, portfolio, certifications, etc) merged with this specific
 * application's data (resume for this application, screening answers,
 * status, interview info). Reuses presentCandidate/recordProfileViews from
 * jobRegistrationController so this data isn't duplicated or reshaped twice.
 * @route GET /api/v1/jobs/:id/applications/:applicationId/candidate
 */
const getCandidateForApplication = asyncHandler(async (req, res) => {
  const { id: jobId, applicationId } = req.params;
  const ownerId = req.user?._id?.toString() || req.user?.id;

  const job = await Job.findById(jobId);
  if (!job) throw ApiError.notFound('Job not found');
  const isAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
  if (job.postedBy?.toString() !== ownerId && !isAdmin) throw ApiError.forbidden('Access denied');

  const app = job.applications.id(applicationId);
  if (!app) throw ApiError.notFound('Application not found');

  const unlockedByPayment = await CandidateContact.exists({
    employer: ownerId,
    $or: [{ jobApplicationId: applicationId }, { seeker: app.applicant }],
    action: { $in: ['unlock', 'hire'] },
  });
  const unlocked = Boolean(unlockedByPayment) || ['interview', 'accepted', 'declined', 'completed', 'cancelled', 'hired'].includes(app.status);

  const seekerProfile = await JobSeekerProfile.findOne({ user: app.applicant }).populate('user', 'email phone');

  let candidate = null;
  if (seekerProfile) {
    candidate = presentCandidate(seekerProfile, { unlocked, shortlisted: app.status === 'shortlisted' });
    // Only count towards the candidate's analytics if this employer's
    // account is genuinely approved — mirrors the rule everywhere else
    // profile views are recorded.
    const employer = await EmployerProfile.findOne({ user: ownerId });
    if (employer && employer.status === 'approved') {
      recordProfileViews(seekerProfile, { employerUserId: ownerId, employerProfileId: employer._id, kind: 'view' });
    }
  }

  const a = app.toObject ? app.toObject() : app;
  return ApiResponse.success(res, {
    data: {
      candidate, // null if the applicant never completed a seeker profile — screen falls back to application-only fields
      application: {
        _id: a._id,
        status: a.status,
        appliedAt: a.appliedAt,
        coverLetter: a.coverLetter,
        experience: a.experience,
        applicantName: a.applicantName,
        resumeUrl: unlocked ? a.resumeUrl : null,
        resumeName: a.resumeName || '',
        portfolioPhotos: a.portfolioPhotos || [],
        answers: a.answers || [],
        recruiterNotes: a.recruiterNotes || '',
        reportCount: (a.reports || []).length,
        unlocked,
        applicantPhone: unlocked ? (a.applicantPhone || '') : maskPhone(a.applicantPhone),
        applicantEmail: unlocked ? (a.applicantEmail || '') : maskEmail(a.applicantEmail),
        ...presentInterviewFields(a),
      },
    },
    message: 'Candidate profile fetched',
  });
});

/**
 * Admin: manually add a job listing (no employer account needed).
 * Created pre-approved and immediately live.
 * @route POST /api/v1/jobs/admin
 */
const adminCreateJob = asyncHandler(async (req, res) => {
  const {
    title, companyName, description, requirements,
    city, state, jobType, category, skills,
    salaryMin, salaryMax, experience, openings,
    contactEmail, isFeatured, isUrgent,
  } = req.body;

  if (!title || !String(title).trim()) throw ApiError.badRequest('title is required');
  if (!companyName || !String(companyName).trim()) throw ApiError.badRequest('companyName is required');

  const job = await Job.create({
    title: String(title).trim(),
    companyName: String(companyName).trim(),
    postedBy: req.user?._id || req.user?.id,
    description: description || '',
    requirements: requirements || '',
    location: { city: city || '', state: state || '', address: '' },
    jobType: jobType || 'full_time',
    category: category || 'other',
    salary: { min: Number(salaryMin) || 0, max: Number(salaryMax) || 0, currency: 'INR', period: 'month' },
    experience: experience || '',
    skills: Array.isArray(skills) ? skills : String(skills || '').split(',').map((s) => s.trim()).filter(Boolean),
    openings: Number(openings) || 1,
    contactEmail: contactEmail || '',
    isActive: true,
    isFeatured: !!isFeatured,
    isUrgent: !!isUrgent,
    adminStatus: 'approved',
  });

  return ApiResponse.created(res, { data: job, message: 'Job added and approved' });
});

module.exports = {
  getJobs,
  getJobById,
  postJob,
  updateJob,
  deleteJob,
  boostJob,
  duplicateJob,
  applyForJob,
  getMyApplications,
  withdrawApplication,
  deleteApplication,
  getMyListings,
  getJobApplications,
  getAllApplications,
  updateApplicationStatus,
  createJobApplicantUnlockOrder,
  verifyJobApplicantUnlockPayment,
  scheduleInterview,
  respondToInterview,
  requestInterviewReschedule,
  updateApplicationNotes,
  reportApplicant,
  getCandidateForApplication,
  createBoostOrder,
  verifyBoostOrder,
  adminCreateJob,
};
