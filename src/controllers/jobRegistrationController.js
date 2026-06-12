const EmployerProfile   = require('../models/EmployerProfile');
const JobSeekerProfile  = require('../models/JobSeekerProfile');
const SubscriptionPlan  = require('../models/SubscriptionPlan');
const Job               = require('../models/Job');
const CandidateContact  = require('../models/CandidateContact');
const ApiError          = require('../utils/ApiError');
const ApiResponse       = require('../utils/ApiResponse');
const asyncHandler      = require('../utils/asyncHandler');

// ─── Helper ───────────────────────────────────────────────────────────────────
const userId = (req) => req.user?._id?.toString() || req.user?.id;

// ══════════════════════════════════════════════════════════════════════════════
//  EMPLOYER REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

/** Register as employer */
const registerEmployer = asyncHandler(async (req, res) => {
  const uid = userId(req);
  const existing = await EmployerProfile.findOne({ user: uid });
  if (existing) {
    // Return existing profile
    return ApiResponse.success(res, { data: existing, message: 'Profile already exists' });
  }

  const {
    businessName, businessType, phone, email, website,
    gstNumber, address, description,
  } = req.body;

  if (!businessName) throw ApiError.badRequest('Business name is required');

  const profile = await EmployerProfile.create({
    user: uid, businessName, businessType, phone, email,
    website, gstNumber, address, description,
    status: 'pending',
  });

  return ApiResponse.created(res, { data: profile, message: 'Registration submitted. Awaiting admin approval.' });
});

/** Get my employer profile */
const getMyEmployerProfile = asyncHandler(async (req, res) => {
  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) return ApiResponse.success(res, { data: null, message: 'No profile found' });
  return ApiResponse.success(res, { data: profile });
});

/** Update employer profile */
const updateEmployerProfile = asyncHandler(async (req, res) => {
  const allowed = ['businessName', 'businessType', 'phone', 'email', 'website',
                   'gstNumber', 'address', 'description', 'logoUrl'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const profile = await EmployerProfile.findOneAndUpdate(
    { user: userId(req) },
    updates,
    { new: true, runValidators: true }
  );
  if (!profile) throw ApiError.notFound('Profile not found');
  return ApiResponse.success(res, { data: profile, message: 'Profile updated' });
});

// ══════════════════════════════════════════════════════════════════════════════
//  JOB SEEKER PROFILE
// ══════════════════════════════════════════════════════════════════════════════

/** Create / update seeker profile */
const upsertSeekerProfile = asyncHandler(async (req, res) => {
  const uid = userId(req);
  const {
    fullName, phone, dateOfBirth, gender, profilePhoto,
    title, bio, skills, experience, currentCity,
    preferredJobTypes, expectedSalary, cvUrl, cvFilename,
    portfolioUrls, education,
  } = req.body;

  if (!fullName) throw ApiError.badRequest('Full name is required');

  const data = {
    user: uid, fullName, phone, dateOfBirth, gender, profilePhoto,
    title, bio, skills, experience, currentCity,
    preferredJobTypes, expectedSalary, cvUrl, cvFilename,
    portfolioUrls, education,
  };

  const profile = await JobSeekerProfile.findOneAndUpdate(
    { user: uid },
    data,
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  // A rejected candidate who updates their profile goes back into review
  if (profile.status === 'rejected') {
    profile.status = 'pending';
    profile.rejectionReason = '';
    await profile.save();
  }

  return ApiResponse.success(res, {
    data: profile,
    message: profile.status === 'approved'
      ? 'Profile saved successfully'
      : 'Profile saved — awaiting admin approval before employers can see it',
  });
});

/** Get my seeker profile */
const getMySeekerProfile = asyncHandler(async (req, res) => {
  const profile = await JobSeekerProfile.findOne({ user: userId(req) });
  return ApiResponse.success(res, { data: profile });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SUBSCRIPTION PLANS
// ══════════════════════════════════════════════════════════════════════════════

/** Get all active plans */
const getPlans = asyncHandler(async (req, res) => {
  let plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });

  // Seed defaults if none exist
  if (plans.length === 0) {
    await SubscriptionPlan.insertMany([
      {
        planKey: 'free', name: 'Free', price: 0, durationDays: 365,
        maxListings: 1, featuredListings: 0, urgentListings: 0,
        highlights: ['1 active job listing', 'Basic visibility', 'Email support'],
        sortOrder: 0,
      },
      {
        planKey: 'basic', name: 'Basic', price: 999, durationDays: 90,
        maxListings: 5, featuredListings: 1, urgentListings: 2,
        highlights: ['5 active job listings', '1 Featured listing', '2 Urgent listings', 'Priority support'],
        sortOrder: 1,
      },
      {
        planKey: 'premium', name: 'Premium', price: 2499, durationDays: 90,
        maxListings: 20, featuredListings: 5, urgentListings: 10,
        highlights: ['20 active job listings', '5 Featured listings', '10 Urgent listings', 'Dedicated support', 'Analytics dashboard'],
        sortOrder: 2,
      },
    ]);
    plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });
  }

  return ApiResponse.success(res, { data: plans });
});

/** Subscribe to a plan (records payment intent — actual payment handled externally) */
const subscribeToPlan = asyncHandler(async (req, res) => {
  const { planKey } = req.body;
  const plan = await SubscriptionPlan.findOne({ planKey, isActive: true });
  if (!plan) throw ApiError.notFound('Plan not found');

  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) throw ApiError.badRequest('Please register as an employer first');
  if (profile.status !== 'approved') throw ApiError.badRequest('Your employer account must be approved before subscribing');

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + plan.durationDays);

  profile.subscriptionPlan      = plan.planKey;
  profile.subscriptionExpiresAt = expiresAt;
  profile.subscriptionPaidAt    = new Date();
  profile.subscriptionAmount    = plan.price;
  await profile.save();

  return ApiResponse.success(res, {
    data: profile,
    message: `Subscribed to ${plan.name} plan successfully`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  CANDIDATE BROWSING (Employer side) — the earning model
//  Employers browse approved candidate profiles freely, but contact details
//  (phone, email, CV) are masked until they hold an active paid subscription.
// ══════════════════════════════════════════════════════════════════════════════

const hasActiveSubscription = (employer) =>
  employer &&
  employer.subscriptionPlan &&
  employer.subscriptionPlan !== 'free' &&
  employer.subscriptionExpiresAt &&
  new Date(employer.subscriptionExpiresAt) > new Date();

const maskPhone = (p) => (p ? String(p).replace(/.(?=.{2})/g, '•') : null);
const maskEmail = (e) => {
  if (!e) return null;
  const [u, d] = String(e).split('@');
  if (!d) return '••••';
  return `${u.slice(0, 2)}••••@${d}`;
};

function presentCandidate(profile, { unlocked }) {
  const o = profile.toObject ? profile.toObject() : profile;
  const userDoc = o.user && typeof o.user === 'object' ? o.user : null;
  const base = {
    id: o._id,
    userId: userDoc?._id || o.user,
    fullName: o.fullName,
    profilePhoto: o.profilePhoto || null,
    title: o.title,
    bio: o.bio,
    skills: o.skills || [],
    experience: o.experience,
    currentCity: o.currentCity,
    gender: o.gender || null,
    preferredJobTypes: o.preferredJobTypes || [],
    expectedSalary: o.expectedSalary || null,
    education: o.education || [],
    portfolioUrls: o.portfolioUrls || [],
    profileCompleteness: o.profileCompleteness,
    memberSince: o.createdAt,
    unlocked: Boolean(unlocked),
  };
  if (unlocked) {
    base.phone = o.phone || userDoc?.phone || null;
    base.email = userDoc?.email || null;
    base.cvUrl = o.cvUrl || null;
    base.cvFilename = o.cvFilename || null;
  } else {
    base.phone = maskPhone(o.phone || userDoc?.phone);
    base.email = maskEmail(userDoc?.email);
    base.cvUrl = null;
    base.cvLocked = Boolean(o.cvUrl);
  }
  return base;
}

/** Resolve the calling employer (must be approved) */
async function requireApprovedEmployer(req) {
  const employer = await EmployerProfile.findOne({ user: userId(req) });
  if (!employer) throw ApiError.forbidden('Register as an employer to browse candidates');
  if (employer.status !== 'approved') {
    throw ApiError.forbidden('Your employer account must be approved by admin first');
  }
  return employer;
}

/** Employer: browse approved candidate profiles (contact details masked unless subscribed) */
const getCandidates = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const subscribed = hasActiveSubscription(employer);

  const { search, city, skill, page = 1, limit = 20 } = req.query;
  const filter = { status: 'approved' };
  if (city)  filter.currentCity = new RegExp(city, 'i');
  if (skill) filter.skills = new RegExp(skill, 'i');
  if (search) {
    const rx = new RegExp(search, 'i');
    filter.$or = [{ fullName: rx }, { title: rx }, { skills: rx }, { currentCity: rx }, { bio: rx }];
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [profiles, total] = await Promise.all([
    JobSeekerProfile.find(filter)
      .populate('user', 'email phone')
      .sort({ profileCompleteness: -1, updatedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    JobSeekerProfile.countDocuments(filter),
  ]);

  // Already-unlocked candidates stay unlocked for this employer
  const unlockedSet = new Set(
    (await CandidateContact.find({ employer: userId(req) }).select('seekerProfile'))
      .map((c) => String(c.seekerProfile))
  );

  const data = profiles.map((pr) =>
    presentCandidate(pr, { unlocked: subscribed && unlockedSet.has(String(pr._id)) })
  );

  return res.json({
    success: true,
    data,
    total,
    meta: { subscribed, plan: employer.subscriptionPlan, expiresAt: employer.subscriptionExpiresAt },
  });
});

/** Employer: single candidate (same masking rules) */
const getCandidateById = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const subscribed = hasActiveSubscription(employer);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  const already = await CandidateContact.findOne({ employer: userId(req), seekerProfile: profile._id });
  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: subscribed && Boolean(already) }),
    message: 'Candidate',
  });
});

/**
 * Employer: unlock a candidate's contact details (subscription required)
 * or mark them as hired. Every action is recorded for the admin audit trail.
 * @body { action: 'unlock' | 'hire' }
 */
const contactCandidate = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  if (!hasActiveSubscription(employer)) {
    throw ApiError.forbidden('An active subscription is required to view candidate contact details');
  }

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  const action = req.body?.action === 'hire' ? 'hire' : 'unlock';
  await CandidateContact.create({
    employer: userId(req),
    seeker: profile.user?._id || profile.user,
    seekerProfile: profile._id,
    action,
    planAtTime: employer.subscriptionPlan,
  });
  if (action === 'hire') {
    employer.totalHires = (employer.totalHires || 0) + 1;
    await employer.save();
  }

  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: true }),
    message: action === 'hire' ? 'Marked as hired' : 'Contact details unlocked',
  });
});

/** Employer: list of candidates I have unlocked / hired */
const getMyCandidateContacts = asyncHandler(async (req, res) => {
  const contacts = await CandidateContact.find({ employer: userId(req) })
    .sort({ createdAt: -1 })
    .limit(200)
    .populate({ path: 'seekerProfile', select: 'fullName title currentCity profilePhoto phone cvUrl' })
    .populate('seeker', 'email phone');
  return ApiResponse.success(res, { data: contacts, message: 'My candidate contacts' });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN — EMPLOYER APPROVALS
// ══════════════════════════════════════════════════════════════════════════════

/** Admin: list all employer registrations */
const adminGetEmployers = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [profiles, total] = await Promise.all([
    EmployerProfile.find(filter)
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    EmployerProfile.countDocuments(filter),
  ]);

  return res.json({ success: true, data: profiles, total });
});

/** Admin: approve or reject employer */
const adminReviewEmployer = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body; // action: 'approve' | 'reject'

  const profile = await EmployerProfile.findById(id);
  if (!profile) throw ApiError.notFound('Profile not found');

  if (action === 'approve') {
    profile.status     = 'approved';
    profile.reviewedBy = userId(req);
    profile.reviewedAt = new Date();
    // Auto-assign free plan if none
    if (!profile.subscriptionPlan) profile.subscriptionPlan = 'free';
  } else if (action === 'reject') {
    profile.status          = 'rejected';
    profile.rejectionReason = reason || 'Application not approved';
    profile.reviewedBy      = userId(req);
    profile.reviewedAt      = new Date();
  } else {
    throw ApiError.badRequest('action must be approve or reject');
  }

  await profile.save();
  return ApiResponse.success(res, { data: profile, message: `Employer ${action}d` });
});

/** Admin: list job listings (all statuses or filtered) */
const adminGetPendingJobs = asyncHandler(async (req, res) => {
  const { status = 'pending_review', page = 1, limit = 200 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = {};
  // 'all' means no status filter — return every job regardless of adminStatus
  if (status && status !== 'all') {
    filter.adminStatus = status;
  }

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .populate('postedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    Job.countDocuments(filter),
  ]);

  return res.json({ success: true, data: jobs, total });
});

/** Admin: approve or reject a job listing */
const adminReviewJob = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  const job = await Job.findById(id);
  if (!job) throw ApiError.notFound('Job not found');

  const prevStatus = job.adminStatus;

  if (action === 'approve') {
    job.adminStatus = 'approved';
    job.isActive    = true;
  } else if (action === 'reject') {
    job.adminStatus       = 'rejected';
    job.isActive          = false;
    job.adminRejectReason = reason || 'Listing not approved';

    // Decrement employer activeListings so they can re-post
    if (job.postedBy && prevStatus !== 'rejected') {
      await EmployerProfile.findOneAndUpdate(
        { user: job.postedBy },
        { $inc: { activeListings: -1 } }
      );
    }
  } else {
    throw ApiError.badRequest('action must be approve or reject');
  }

  await job.save();
  return ApiResponse.success(res, { data: job, message: `Job listing ${action}d` });
});

/** Admin: update subscription plan config */
const adminUpdatePlan = asyncHandler(async (req, res) => {
  const { planKey } = req.params;
  const allowed = ['name', 'description', 'price', 'durationDays', 'maxListings',
                   'featuredListings', 'urgentListings', 'highlights', 'isActive'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  const plan = await SubscriptionPlan.findOneAndUpdate({ planKey }, updates, { new: true });
  if (!plan) throw ApiError.notFound('Plan not found');
  return ApiResponse.success(res, { data: plan, message: 'Plan updated' });
});

/** Admin: get job seeker profiles */
const adminGetSeekers = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [profiles, total] = await Promise.all([
    JobSeekerProfile.find().populate('user', 'name email').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
    JobSeekerProfile.countDocuments(),
  ]);
  return res.json({ success: true, data: profiles, total });
});


/** Admin: approve or reject a candidate profile */
const adminReviewSeeker = asyncHandler(async (req, res) => {
  const { action, reason } = req.body; // 'approve' | 'reject'
  const profile = await JobSeekerProfile.findById(req.params.id);
  if (!profile) throw ApiError.notFound('Candidate profile not found');

  if (action === 'approve') {
    profile.status = 'approved';
  } else if (action === 'reject') {
    profile.status = 'rejected';
    profile.rejectionReason = reason || 'Profile not approved';
  } else {
    throw ApiError.badRequest('action must be approve or reject');
  }
  profile.reviewedBy = userId(req);
  profile.reviewedAt = new Date();
  await profile.save();

  return ApiResponse.success(res, { data: profile, message: `Candidate ${action}d` });
});

module.exports = {
  getCandidates,
  getCandidateById,
  contactCandidate,
  getMyCandidateContacts,
  adminReviewSeeker,
  registerEmployer, getMyEmployerProfile, updateEmployerProfile,
  upsertSeekerProfile, getMySeekerProfile,
  getPlans, subscribeToPlan,
  adminGetEmployers, adminReviewEmployer,
  adminGetPendingJobs, adminReviewJob,
  adminUpdatePlan, adminGetSeekers,
};
