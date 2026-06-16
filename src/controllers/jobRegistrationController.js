const EmployerProfile   = require('../models/EmployerProfile');
const JobSeekerProfile  = require('../models/JobSeekerProfile');
const SubscriptionPlan  = require('../models/SubscriptionPlan');
const Job               = require('../models/Job');
const CandidateContact  = require('../models/CandidateContact');
const crypto            = require('crypto');
const mongoose          = require('mongoose');

let Razorpay = null;
try { Razorpay = require('razorpay'); } catch { Razorpay = null; }

function getRazorpayClient() {
  if (!Razorpay) throw ApiError.internal('Razorpay SDK not installed on the server');
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw ApiError.internal('Razorpay credentials not configured');
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}
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
    fullName, phone, email, dateOfBirth, gender, profilePhoto,
    title, bio, specializations, skills, certifications, experience, currentCity,
    languages, preferredJobTypes, workMode, expectedSalary, cvUrl, cvFilename,
    portfolioPhotos, portfolioUrls, education,
    previousWork, needsAccommodation, accommodationNotes, galleryPhotos,
  } = req.body;

  if (!fullName) throw ApiError.badRequest('Full name is required');

  const data = {
    user: uid, fullName, phone, email, dateOfBirth, gender, profilePhoto,
    title, bio, specializations, skills, certifications, experience, currentCity,
    languages, preferredJobTypes, workMode, expectedSalary, cvUrl, cvFilename,
    portfolioPhotos: portfolioPhotos || portfolioUrls, // accept both names
    education,
    previousWork, needsAccommodation, accommodationNotes, galleryPhotos,
  };

  const profile = await JobSeekerProfile.findOneAndUpdate(
    { user: uid },
    data,
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );

  // Candidate profiles go live immediately — no admin approval gate.
  // Admin can still reject bad profiles from the panel if needed.
  if (profile.status !== 'approved') {
    profile.status = 'approved';
    profile.rejectionReason = '';
    await profile.save();
  }

  return ApiResponse.success(res, {
    data: profile,
    message: 'Profile saved and live — employers can now see your profile',
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

  // Paid plans must go through Razorpay (/subscribe/order + /subscribe/verify)
  if (plan.price > 0) {
    throw ApiError.badRequest('This plan requires payment. Use the payment flow in the app.');
  }

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

function presentCandidate(profile, { unlocked, shortlisted }) {
  const o = profile.toObject ? profile.toObject() : profile;
  const userDoc = o.user && typeof o.user === 'object' ? o.user : null;
  // Contact info only shown after employer has paid ₹499 for this specific profile
  const showContact = Boolean(unlocked);
  const base = {
    id: o._id,
    userId: userDoc?._id || o.user,
    fullName: o.fullName,
    profilePhoto: o.profilePhoto || null,
    galleryPhotos: o.galleryPhotos || [],
    title: o.title,
    bio: o.bio,
    specializations: o.specializations || [],
    skills: o.skills || [],
    certifications: o.certifications || [],
    languages: o.languages || [],
    workMode: o.workMode || null,
    experience: o.experience,
    currentCity: o.currentCity,
    gender: o.gender || null,
    preferredJobTypes: o.preferredJobTypes || [],
    expectedSalary: o.expectedSalary || null,
    education: o.education || [],
    previousWork: o.previousWork || [],
    needsAccommodation: Boolean(o.needsAccommodation),
    accommodationNotes: o.accommodationNotes || '',
    portfolioPhotos: o.portfolioPhotos || [],
    profileCompleteness: o.profileCompleteness,
    memberSince: o.createdAt,
    unlocked: Boolean(unlocked),
    shortlisted: Boolean(shortlisted),
  };
  if (showContact) {
    base.phone = o.phone || userDoc?.phone || null;
    base.email = userDoc?.email || o.email || null;
    base.cvUrl = o.cvUrl || null;
    base.cvFilename = o.cvFilename || null;
  } else {
    base.phone = maskPhone(o.phone || userDoc?.phone);
    base.email = maskEmail(userDoc?.email || o.email);
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

  const { search, city, skill, page = 1, limit = 20, exclude, shortlistedOnly } = req.query;
  const filter = { status: 'approved' };
  if (city)  filter.currentCity = new RegExp(city, 'i');
  if (skill) filter.skills = new RegExp(skill, 'i');
  if (search) {
    const rx = new RegExp(search, 'i');
    filter.$or = [{ fullName: rx }, { title: rx }, { skills: rx }, { currentCity: rx }, { bio: rx }];
  }

  // Candidates this employer has already swiped on (accept/shortlist) are
  // permanently hidden (they're in shortlist). REJECTED candidates are hidden
  // for REJECT_COOLDOWN_MS (24 h) then automatically reappear — so employers
  // don't exhaust their candidate pool after one swipe session.
  // Pass `exclude=false` to show all; `shortlistedOnly=true` for shortlist view.
  const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
  const cooldownCutoff = new Date(Date.now() - REJECT_COOLDOWN_MS);
  const myContacts = await CandidateContact.find({ employer: userId(req) }).select('seekerProfile action createdAt');
  // Only exclude recently-rejected candidates (within cooldown window)
  const rejectedSet   = new Set(
    myContacts.filter((c) => c.action === 'reject' && new Date(c.createdAt) > cooldownCutoff)
      .map((c) => String(c.seekerProfile))
  );
  const unlockedSet   = new Set(myContacts.filter((c) => c.action === 'unlock' || c.action === 'hire').map((c) => String(c.seekerProfile)));
  const shortlistedSet= new Set(myContacts.filter((c) => c.action === 'shortlist').map((c) => String(c.seekerProfile)));

  if (shortlistedOnly === 'true') {
    filter._id = { $in: Array.from(shortlistedSet) };
  } else if (exclude !== 'false') {
    const seenSet = new Set([...rejectedSet, ...shortlistedSet]);
    if (seenSet.size) filter._id = { $nin: Array.from(seenSet) };
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

  const data = profiles.map((pr) =>
    presentCandidate(pr, {
      unlocked: unlockedSet.has(String(pr._id)),
      shortlisted: shortlistedSet.has(String(pr._id)),
    })
  );

  return res.json({
    success: true,
    data,
    total,
    meta: { subscribed, plan: employer.subscriptionPlan, expiresAt: employer.subscriptionExpiresAt },
  });
});

/**
 * Employer: swipe on a candidate card — 'reject' hides them from the deck
 * permanently, 'accept' shortlists them (and unlocks contact details right
 * away if the employer already holds an active subscription).
 * @body { action: 'accept' | 'reject' }
 */
const swipeCandidate = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const subscribed = hasActiveSubscription(employer);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  const action = req.body?.action === 'accept' ? 'accept' : 'reject';

  if (action === 'reject') {
    await CandidateContact.create({
      employer: userId(req),
      seeker: profile.user?._id || profile.user,
      seekerProfile: profile._id,
      action: 'reject',
      planAtTime: employer.subscriptionPlan,
    });
    return ApiResponse.success(res, { data: { id: profile._id, status: 'rejected' }, message: 'Candidate passed' });
  }

  // accept → shortlist (+ auto-unlock if subscribed)
  await CandidateContact.create({
    employer: userId(req),
    seeker: profile.user?._id || profile.user,
    seekerProfile: profile._id,
    action: 'shortlist',
    planAtTime: employer.subscriptionPlan,
  });
  if (subscribed) {
    await CandidateContact.create({
      employer: userId(req),
      seeker: profile.user?._id || profile.user,
      seekerProfile: profile._id,
      action: 'unlock',
      planAtTime: employer.subscriptionPlan,
    });
  }

  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: false, shortlisted: true }),
    message: subscribed ? 'Candidate shortlisted — contact unlocked' : 'Candidate shortlisted',
  });
});

/** Employer: single candidate (same masking rules) */
const getCandidateById = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const subscribed = hasActiveSubscription(employer);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  const contacts = await CandidateContact.find({ employer: userId(req), seekerProfile: profile._id }).select('action');
  const unlocked = contacts.some((c) => c.action === 'unlock' || c.action === 'hire');
  const shortlisted = contacts.some((c) => c.action === 'shortlist');
  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked, shortlisted }),
    message: 'Candidate',
  });
});

/**
 * Employer: mark a candidate as hired (no payment — already unlocked).
 * Contact unlock is now pay-per-profile via unlock/order + unlock/verify.
 * @body { action: 'hire' }
 */
const contactCandidate = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  // Only 'hire' action allowed here (unlock is via paid flow)
  await CandidateContact.create({
    employer: userId(req),
    seeker: profile.user?._id || profile.user,
    seekerProfile: profile._id,
    action: 'hire',
    planAtTime: 'per_profile',
    paidAmount: 0,
  });
  employer.totalHires = (employer.totalHires || 0) + 1;
  await employer.save();

  // Check if already unlocked to return contact
  const prior = await CandidateContact.findOne({ employer: userId(req), seekerProfile: profile._id, action: { $in: ['unlock', 'hire'] } });
  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: Boolean(prior), shortlisted: false }),
    message: 'Marked as hired',
  });
});

/**
 * Employer: unlock one candidate's contact details.
 * If the employer has prepaid unlock credits, deduct one and return the
 * candidate data immediately (no Razorpay needed).
 * Otherwise create a Razorpay order for ₹499 and return the order details.
 * @route POST /api/v1/job-registration/candidates/:id/unlock/order
 */
const createUnlockOrder = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  // Already unlocked?
  const existing = await CandidateContact.findOne({
    employer: userId(req),
    seekerProfile: profile._id,
    action: { $in: ['unlock', 'hire'] },
  });
  if (existing) throw ApiError.badRequest('You have already unlocked this candidate');

  // ── Use a prepaid credit if available ────────────────────────────────────
  if (employer.unlockCredits > 0) {
    employer.unlockCredits -= 1;
    await employer.save();

    await CandidateContact.create({
      employer: userId(req),
      seeker: profile.user?._id || profile.user,
      seekerProfile: profile._id,
      action: 'unlock',
      planAtTime: 'credit',
      paidAmount: 0, // paid at bundle purchase time
    });

    return ApiResponse.success(res, {
      data: {
        creditUsed: true,
        creditsRemaining: employer.unlockCredits,
        candidate: presentCandidate(profile, { unlocked: true, shortlisted: false }),
      },
      message: `1 credit used — contact unlocked. ${employer.unlockCredits} credit(s) remaining.`,
    });
  }

  // ── No credits — create Razorpay order ───────────────────────────────────
  const client = getRazorpayClient();
  const UNLOCK_PRICE = 49900; // ₹499 in paise
  const rzpOrder = await client.orders.create({
    amount: UNLOCK_PRICE,
    currency: 'INR',
    receipt: `UNLOCK-${Date.now().toString(36).toUpperCase()}`,
    notes: {
      type: 'candidate_unlock',
      seekerProfileId: String(profile._id),
      employerId: userId(req),
    },
  });

  return ApiResponse.success(res, {
    data: {
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      candidateName: profile.fullName,
    },
    message: 'Unlock order created — complete payment to view contact details',
  });
});

/**
 * Employer: verify Razorpay payment and unlock the candidate's contact details.
 * @route POST /api/v1/job-registration/candidates/:id/unlock/verify
 * @body  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyUnlockPayment = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
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

  if (expected !== razorpaySignature) {
    throw ApiError.badRequest('Payment verification failed — signature mismatch');
  }

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  // Record the unlock (idempotent — skip if already recorded)
  const existing = await CandidateContact.findOne({
    employer: userId(req),
    seekerProfile: profile._id,
    action: { $in: ['unlock', 'hire'] },
  });
  if (!existing) {
    await CandidateContact.create({
      employer: userId(req),
      seeker: profile.user?._id || profile.user,
      seekerProfile: profile._id,
      action: 'unlock',
      planAtTime: 'per_profile',
      paidAmount: 499,
      razorpayPaymentId,
      razorpayOrderId,
    });
  }

  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: true, shortlisted: false }),
    message: 'Payment verified — contact details unlocked',
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
//  SUBSCRIPTION PAYMENTS (Razorpay)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Create a Razorpay order for a paid subscription plan.
 * @route POST /api/v1/job-registration/subscribe/order
 * @body  { planKey }
 */
const createSubscriptionOrder = asyncHandler(async (req, res) => {
  const { planKey } = req.body;
  const plan = await SubscriptionPlan.findOne({ planKey, isActive: true });
  if (!plan) throw ApiError.notFound('Plan not found');
  if (plan.price <= 0) throw ApiError.badRequest('This plan is free — no payment needed');

  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) throw ApiError.badRequest('Register as an employer first');
  if (profile.status !== 'approved') throw ApiError.badRequest('Your employer account must be approved before subscribing');

  const client = getRazorpayClient();
  const rzpOrder = await client.orders.create({
    amount: Math.round(plan.price * 100),
    currency: 'INR',
    receipt: `JOBSUB-${Date.now().toString(36).toUpperCase()}`,
    notes: { type: 'job_subscription', planKey, userId: userId(req) },
  });

  return ApiResponse.success(res, {
    data: {
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      plan: { planKey: plan.planKey, name: plan.name, price: plan.price, durationDays: plan.durationDays },
    },
    message: 'Subscription order created',
  });
});

/**
 * Verify Razorpay payment and activate the plan.
 * @route POST /api/v1/job-registration/subscribe/verify
 * @body  { planKey, razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifySubscriptionPayment = asyncHandler(async (req, res) => {
  const { planKey, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!planKey || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest('planKey, razorpayOrderId, razorpayPaymentId and razorpaySignature are required');
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw ApiError.internal('Razorpay secret not configured');

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  if (expected !== razorpaySignature) {
    throw ApiError.badRequest('Payment signature verification failed');
  }

  const plan = await SubscriptionPlan.findOne({ planKey, isActive: true });
  if (!plan) throw ApiError.notFound('Plan not found');

  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) throw ApiError.badRequest('Employer profile not found');

  const expiresAt = new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000);
  profile.subscriptionPlan      = plan.planKey;
  profile.subscriptionExpiresAt = expiresAt;
  profile.subscriptionPaidAt    = new Date();
  profile.subscriptionAmount    = plan.price;
  await profile.save();

  return ApiResponse.success(res, {
    data: { plan: plan.planKey, expiresAt, paymentId: razorpayPaymentId },
    message: `${plan.name} plan activated`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  UNLOCK CREDIT BUNDLES
// ══════════════════════════════════════════════════════════════════════════════

const BUNDLE_OPTIONS = {
  1:  { paise: 49900,  label: '1 Unlock Credit'  },
  5:  { paise: 200000, label: '5 Unlock Credits' },
  10: { paise: 350000, label: '10 Unlock Credits' },
};

/**
 * Create a Razorpay order to purchase an unlock credit bundle.
 * @route POST /api/v1/job-registration/credits/order
 * @body  { qty: 1 | 5 | 10 }
 */
const createBundleOrder = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const qty = parseInt(req.body?.qty);
  const bundle = BUNDLE_OPTIONS[qty];
  if (!bundle) throw ApiError.badRequest('qty must be 1, 5, or 10');

  const client = getRazorpayClient();
  const rzpOrder = await client.orders.create({
    amount: bundle.paise,
    currency: 'INR',
    receipt: `BUNDLE${qty}-${Date.now().toString(36).toUpperCase()}`,
    notes: { type: 'unlock_bundle', qty: String(qty), employerId: userId(req) },
  });

  return ApiResponse.success(res, {
    data: {
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      qty,
      label: bundle.label,
    },
    message: `Bundle order created — pay to receive ${qty} unlock credit(s)`,
  });
});

/**
 * Verify bundle payment and credit the employer's account.
 * @route POST /api/v1/job-registration/credits/verify
 * @body  { qty, razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyBundlePayment = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const { qty: rawQty, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  const qty = parseInt(rawQty);

  if (!BUNDLE_OPTIONS[qty] || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest('qty, razorpayOrderId, razorpayPaymentId and razorpaySignature are required');
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw ApiError.internal('Razorpay secret not configured');

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  if (expected !== razorpaySignature) throw ApiError.badRequest('Payment verification failed — signature mismatch');

  // Add credits to employer wallet
  employer.unlockCredits = (employer.unlockCredits || 0) + qty;
  await employer.save();

  return ApiResponse.success(res, {
    data: { unlockCredits: employer.unlockCredits, qty, paymentId: razorpayPaymentId },
    message: `${qty} unlock credit(s) added to your account`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  ADMIN — MANUAL CANDIDATE LISTING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Admin: manually add a candidate profile (walk-in / WhatsApp CV etc.)
 * Created pre-approved with a synthetic user id (no app account needed).
 * @route POST /api/v1/job-registration/admin/seekers
 */
const adminCreateSeeker = asyncHandler(async (req, res) => {
  const {
    fullName, phone, email, currentCity, title, bio, gender,
    skills, experience, expectedSalary, cvUrl, preferredJobTypes,
  } = req.body;

  if (!fullName || !fullName.trim()) throw ApiError.badRequest('fullName is required');
  if (!phone || !/^[6-9]\d{9}$/.test(String(phone).trim())) {
    throw ApiError.badRequest('A valid 10-digit phone number is required');
  }

  const dup = await JobSeekerProfile.findOne({ phone: String(phone).trim(), isManual: true });
  if (dup) throw ApiError.badRequest(`A manual candidate with this phone already exists (${dup.fullName})`);

  const profile = await JobSeekerProfile.create({
    user: new mongoose.Types.ObjectId(),   // synthetic — no app account
    isManual: true,
    fullName: fullName.trim(),
    phone: String(phone).trim(),
    email: (email || '').trim(),
    currentCity: (currentCity || '').trim(),
    title: (title || '').trim(),
    bio: (bio || '').trim(),
    gender: gender || '',
    skills: Array.isArray(skills) ? skills : String(skills || '').split(',').map((x) => x.trim()).filter(Boolean),
    experience: (experience || '').trim(),
    expectedSalary: expectedSalary || { min: 0, max: 0 },
    cvUrl: (cvUrl || '').trim(),
    preferredJobTypes: preferredJobTypes || [],
    status: 'approved',          // admin-added → instantly visible to employers
    reviewedBy: userId(req),
    reviewedAt: new Date(),
  });

  return ApiResponse.created(res, { data: profile, message: 'Candidate added and approved' });
});

/** Admin: delete a candidate profile */
const adminDeleteSeeker = asyncHandler(async (req, res) => {
  const profile = await JobSeekerProfile.findByIdAndDelete(req.params.id);
  if (!profile) throw ApiError.notFound('Candidate profile not found');
  return ApiResponse.success(res, { data: { id: req.params.id }, message: 'Candidate deleted' });
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
  createSubscriptionOrder,
  verifySubscriptionPayment,
  createBundleOrder,
  verifyBundlePayment,
  adminCreateSeeker,
  adminDeleteSeeker,
  getCandidates,
  getCandidateById,
  contactCandidate,
  createUnlockOrder,
  verifyUnlockPayment,
  swipeCandidate,
  getMyCandidateContacts,
  adminReviewSeeker,
  registerEmployer, getMyEmployerProfile, updateEmployerProfile,
  upsertSeekerProfile, getMySeekerProfile,
  getPlans, subscribeToPlan,
  adminGetEmployers, adminReviewEmployer,
  adminGetPendingJobs, adminReviewJob,
  adminUpdatePlan, adminGetSeekers,
};
