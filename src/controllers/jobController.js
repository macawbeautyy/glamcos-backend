const Job        = require('../models/Job');
const ApiError   = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

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
    applicant:   userId,
    coverLetter: req.body.coverLetter || req.body.coverNote || '',
    resumeUrl:   req.body.resumeUrl   || '',
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
  const job = await Job.findById(req.params.id).populate('applications.applicant', 'firstName lastName name email phone');
  if (!job) throw ApiError.notFound('Job not found');

  return ApiResponse.success(res, { data: job.applications, message: 'Applicants fetched' });
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
  return ApiResponse.success(res, { data: allApps, message: 'All applications fetched' });
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
};
