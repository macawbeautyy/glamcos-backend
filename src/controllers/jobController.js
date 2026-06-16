const Job              = require('../models/Job');
const CandidateContact = require('../models/CandidateContact');
const EmployerProfile  = require('../models/EmployerProfile');
const ApiError         = require('../utils/ApiError');
const ApiResponse      = require('../utils/ApiResponse');
const asyncHandler     = require('../utils/asyncHandler');
const crypto           = require('crypto');

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

  const filter = { isActive: true, adminStatus: 'approved' };

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

  return ApiResponse.success(res, { data: job, message: 'Job fetched successfully' });
});

// ── Post a job (authenticated) ─────────────────────────────────────────────────
const postJob = asyncHandler(async (req, res) => {
  const {
    title, salonName, companyName, location, jobType, salary,
    experience, categories: cats, skills, openings, deadline,
    description, contactEmail, isUrgent, isFeatured,
  } = req.body;

  if (!title || !(salonName || companyName)) {
    throw ApiError.badRequest('title and companyName are required');
  }

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
    // Check plan limits using a live DB count (ignores rejected/inactive jobs)
    const limits = empProfile.planLimits;
    const liveCount = await Job.countDocuments({
      postedBy:    req.user._id || req.user.id,
      adminStatus: { $in: ['pending_review', 'approved'] },
    });
    if (liveCount >= limits.maxListings) {
      throw ApiError.badRequest(
        `Your ${empProfile.subscriptionPlan} plan allows ${limits.maxListings} active listing${limits.maxListings !== 1 ? 's' : ''}. ` +
        `You already have ${liveCount} pending or live listing${liveCount !== 1 ? 's' : ''}. Please upgrade your plan or wait for existing listings to close.`
      );
    }
    empProfileForLink = empProfile;
  }

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
  const categoryVal = Array.isArray(cats) && cats.length > 0
    ? (CATEGORY_MAP[cats[0]] || 'other')
    : 'other';

  const skillArr = typeof skills === 'string'
    ? skills.split(',').map(s => s.trim()).filter(Boolean)
    : (Array.isArray(skills) ? skills : []);

  const job = await Job.create({
    title:        title.trim(),
    companyName:  (salonName || companyName || '').trim(),
    postedBy:     req.user?._id || req.user?.id || null,
    description:  description || '',
    location:     locationObj,
    jobType:      parseJobType(jobType),
    category:     categoryVal,
    salary:       parseSalary(salary),
    experience:   experience || '',
    skills:       skillArr,
    openings:     parseInt(openings) || 1,
    deadline:     deadline ? new Date(deadline) : undefined,
    contactEmail: contactEmail || '',
    isUrgent:     isUrgent  || false,
    isFeatured:   isFeatured || false,
  });

  // Link employer profile if exists
  if (empProfileForLink) {
    job.employerProfile = empProfileForLink._id;
    empProfileForLink.totalListings += 1;
    empProfileForLink.activeListings += 1;
    await Promise.all([job.save(), empProfileForLink.save()]);
  }

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
                   'isActive', 'isUrgent', 'isFeatured'];
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
const boostJob = asyncHandler(async (req, res) => {
  const job = await Job.findByIdAndUpdate(
    req.params.id,
    { isFeatured: true, isUrgent: true },
    { new: true }
  );
  if (!job) throw ApiError.notFound('Job not found');
  return ApiResponse.success(res, { data: job, message: 'Job boosted' });
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
    applicantName:  req.body.applicantName  || '',
    applicantPhone: req.body.applicantPhone || '',
    applicantEmail: req.body.applicantEmail || '',
    experience:     req.body.experience     || '',
  });
  job.applicationCount = job.applications.length;
  await job.save();

  return ApiResponse.success(res, { data: null, message: 'Application submitted successfully' });
});

// ── Get my applications (as job seeker) ────────────────────────────────────────
const getMyApplications = asyncHandler(async (req, res) => {
  const userId = req.user?._id?.toString() || req.user?.id;

  const jobs = await Job.find({ 'applications.applicant': userId })
    .select('title companyName location jobType salary applications createdAt');

  const applications = jobs.map(job => {
    const app = job.applications.find(a => a.applicant?.toString() === userId);
    return {
      _id:         app._id,
      job: {
        _id:         job._id,
        title:       job.title,
        companyName: job.companyName,
        location:    job.location,
        jobType:     job.jobType,
        salary:      job.salary,
      },
      status:    app.status,
      appliedAt: app.appliedAt,
    };
  });

  return ApiResponse.success(res, { data: applications, message: 'Applications fetched' });
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

  const applications = job.applications.map(app => {
    const unlocked = unlockedSet.has(String(app._id));
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
      unlocked,
      applicant: {
        _id:   u._id || a.applicant,
        name,
        email: unlocked ? email : maskEmail(email),
        phone: unlocked ? phone : maskPhone(phone),
      },
    };
  });

  return ApiResponse.success(res, { data: applications, message: 'Applicants fetched' });
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
  const { status } = req.body;

  const job = await Job.findOne({ 'applications._id': applicationId });
  if (!job) throw ApiError.notFound('Application not found');

  const app = job.applications.id(applicationId);
  app.status    = status;
  app.updatedAt = new Date();
  await job.save();

  return ApiResponse.success(res, { data: app, message: 'Application status updated' });
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

module.exports = {
  getJobs,
  getJobById,
  postJob,
  updateJob,
  deleteJob,
  boostJob,
  applyForJob,
  getMyApplications,
  getMyListings,
  getJobApplications,
  getAllApplications,
  updateApplicationStatus,
  createJobApplicantUnlockOrder,
  verifyJobApplicantUnlockPayment,
};
