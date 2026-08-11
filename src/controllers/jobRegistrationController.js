const EmployerProfile   = require('../models/EmployerProfile');
const JobSeekerProfile  = require('../models/JobSeekerProfile');
const SubscriptionPlan  = require('../models/SubscriptionPlan');
const Job               = require('../models/Job');
const CandidateContact  = require('../models/CandidateContact');
const ProfileView       = require('../models/ProfileView');
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

  const {
    businessName, businessType, phone, email, website,
    gstNumber, address, description,
  } = req.body;

  if (existing) {
    // Rejected employers may RE-APPLY: update their profile with the new
    // details and put them back in the review queue. Without this, the
    // "Re-apply" button in the app was a dead end (profile already existed,
    // so re-registration was silently ignored and status stayed 'rejected').
    if (existing.status === 'rejected') {
      if (!businessName) throw ApiError.badRequest('Business name is required');
      existing.businessName    = businessName;
      if (businessType !== undefined) existing.businessType = businessType;
      if (phone        !== undefined) existing.phone        = phone;
      if (email        !== undefined) existing.email        = email;
      if (website      !== undefined) existing.website      = website;
      if (gstNumber    !== undefined) existing.gstNumber    = gstNumber;
      if (address      !== undefined) existing.address      = address;
      if (description  !== undefined) existing.description  = description;
      existing.status          = 'pending';
      existing.rejectionReason = '';
      await existing.save();
      return ApiResponse.success(res, { data: existing, message: 'Re-application submitted. Awaiting admin approval.' });
    }
    // Pending / approved — return existing profile unchanged
    return ApiResponse.success(res, { data: existing, message: 'Profile already exists' });
  }

  if (!businessName) throw ApiError.badRequest('Business name is required');

  const profile = await EmployerProfile.create({
    user: uid, businessName, businessType, phone, email,
    website, gstNumber, address, description,
    status: 'pending',
  });

  require('../services/whatsappNotify').sendWhatsAppAlert(
    `🏢 New Employer registration\n${businessName}${phone ? `\n📞 ${phone}` : ''}`
  ).catch(() => {});
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
    previousWork, needsAccommodation, accommodationNotes, galleryPhotos, isPublished,
  } = req.body;

  if (!fullName) throw ApiError.badRequest('Full name is required');

  const isNewProfile = !(await JobSeekerProfile.exists({ user: uid }));

  const data = {
    user: uid, fullName, phone, email, dateOfBirth, gender, profilePhoto,
    title, bio, specializations, skills, certifications, experience, currentCity,
    languages, preferredJobTypes, workMode, expectedSalary, cvUrl, cvFilename,
    portfolioPhotos: portfolioPhotos || portfolioUrls, // accept both names
    education,
    previousWork, needsAccommodation, accommodationNotes, galleryPhotos,
  };
  // Respect the publish flag the client sends (Publish / save-as-draft).
  if (typeof isPublished === 'boolean') data.isPublished = isPublished;

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

  if (isNewProfile) {
    require('../services/whatsappNotify').sendWhatsAppAlert(
      `🔍 New Job Seeker profile\n${fullName}${currentCity ? ` · 📍 ${currentCity}` : ''}`
    ).catch(() => {});
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

/**
 * Seeker: profile insights for the candidate dashboard.
 *
 * Every number here is derived from real recruiter activity — there are no
 * synthetic/estimated values:
 *   profileViews       distinct approved employers who opened the full profile
 *   searchAppearances  distinct approved employers whose search surfaced it
 *   recruiterSaves     CandidateContact rows with action 'shortlist'
 *   profileRank        rank by 30-day views among published+approved peers
 *                      sharing the candidate's primary specialization
 *
 * A candidate with no profile yet gets zeros rather than a 404, so the
 * dashboard can render before onboarding is finished.
 */
const getSeekerInsights = asyncHandler(async (req, res) => {
  const profile = await JobSeekerProfile.findOne({ user: userId(req) });
  if (!profile) {
    return ApiResponse.success(res, {
      data: { profileViews: 0, searchAppearances: 0, recruiterSaves: 0, profileRank: null, categoryTotal: 0, windowDays: 30 },
      message: 'No seeker profile yet',
    });
  }

  const windowDays = 30;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [profileViews, searchAppearances, recruiterSaves] = await Promise.all([
    ProfileView.countDocuments({ seekerProfile: profile._id, kind: 'view',   createdAt: { $gte: since } }),
    ProfileView.countDocuments({ seekerProfile: profile._id, kind: 'search', createdAt: { $gte: since } }),
    CandidateContact.countDocuments({ seekerProfile: profile._id, action: 'shortlist' }),
  ]);

  // Rank within the candidate's primary specialization. Only meaningful once
  // the profile is live to employers, so unpublished profiles get null.
  let profileRank = null;
  let categoryTotal = 0;
  const primary = (profile.specializations || [])[0];
  if (primary && profile.isPublished && profile.status === 'approved') {
    const peers = await JobSeekerProfile
      .find({ specializations: primary, status: 'approved', isPublished: true })
      .select('_id');
    categoryTotal = peers.length;

    if (categoryTotal > 1) {
      const peerIds = peers.map((p) => p._id);
      const counts = await ProfileView.aggregate([
        { $match: { seekerProfile: { $in: peerIds }, kind: 'view', createdAt: { $gte: since } } },
        { $group: { _id: '$seekerProfile', n: { $sum: 1 } } },
      ]);
      const byId = new Map(counts.map((c) => [String(c._id), c.n]));
      const mine = byId.get(String(profile._id)) || 0;
      // Rank = how many peers are strictly ahead, +1.
      const ahead = peerIds.reduce((acc, id) => acc + ((byId.get(String(id)) || 0) > mine ? 1 : 0), 0);
      profileRank = ahead + 1;
    }
  }

  return ApiResponse.success(res, {
    data: { profileViews, searchAppearances, recruiterSaves, profileRank, categoryTotal, windowDays },
    message: 'Profile insights',
  });
});

/**
 * Upload CV file (PDF/DOC/DOCX) or a photo/scan of the CV (image).
 * Uploads to Cloudinary and returns the URL — caller must still save it
 * onto the profile via upsertSeekerProfile (same pattern as avatar upload).
 */
const uploadSeekerCV = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file provided');

  const axios    = require('axios');
  const FormData = require('form-data');
  const path     = require('path');

  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  const apiKey       = process.env.CLOUDINARY_API_KEY;
  const apiSecret    = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName) throw ApiError.serviceUnavailable('File storage not configured');

  const uid          = userId(req);
  const isImage       = req.file.mimetype.startsWith('image/');
  const resourceType  = isImage ? 'image' : 'raw';
  const ext           = path.extname(req.file.originalname) || (isImage ? '.jpg' : '.pdf');
  const originalName  = req.file.originalname || `cv${ext}`;
  const folder         = `cvs/${uid}`;
  const publicFilename = `cv_${uid}_${Date.now()}${ext}`;

  const form = new FormData();
  form.append('file', req.file.buffer, { filename: publicFilename, contentType: req.file.mimetype });
  form.append('resource_type', resourceType);
  form.append('folder', folder);

  let fileUrl;
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;
  if (uploadPreset) {
    form.append('upload_preset', uploadPreset);
    const r = await axios.post(endpoint, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 60_000 });
    fileUrl = r.data.secure_url;
  } else if (apiKey && apiSecret) {
    const crypto2   = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign    = `folder=${folder}&resource_type=${resourceType}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto2.createHash('sha1').update(toSign).digest('hex');
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    const r = await axios.post(endpoint, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 60_000 });
    fileUrl = r.data.secure_url;
  } else {
    throw ApiError.serviceUnavailable('Cloudinary credentials not configured');
  }

  return ApiResponse.success(res, {
    data: { cvUrl: fileUrl, cvFilename: originalName },
    message: 'CV uploaded successfully',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SUBSCRIPTION PLANS
// ══════════════════════════════════════════════════════════════════════════════

// Phase 2 monetization plan definitions — displayed as Free / Professional /
// Business. planKey values stay 'free'/'basic'/'premium' (see EmployerProfile
// comment) to avoid a data migration; only labels/limits/features changed.
const PLAN_DEFS = [
  {
    planKey: 'free', name: 'Free', price: 0, durationDays: 365,
    maxListings: 2, featuredListings: 0, urgentListings: 0,
    candidateSearch: false, unlimitedApplicants: false, interviewScheduling: false,
    verifiedBadge: false, hiringAnalytics: false, prioritySupport: false,
    multiRecruiter: false, multiBranch: false, bulkHiring: false, dedicatedSupport: false,
    highlights: ['2 active job listings', 'Basic company profile', 'Limited applicant visibility', 'Limited candidate search'],
    sortOrder: 0,
  },
  {
    planKey: 'basic', name: 'Professional', price: 999, durationDays: 30,
    maxListings: -1, featuredListings: 1, urgentListings: 2,
    candidateSearch: true, unlimitedApplicants: true, interviewScheduling: true,
    verifiedBadge: true, hiringAnalytics: true, prioritySupport: true,
    multiRecruiter: false, multiBranch: false, bulkHiring: false, dedicatedSupport: false,
    highlights: ['Unlimited job listings', 'Unlimited applicants', 'Candidate search', 'Interview scheduling', 'Verified recruiter badge', 'Featured company eligibility', 'Hiring analytics', 'Priority support'],
    sortOrder: 1,
  },
  {
    planKey: 'premium', name: 'Business', price: 2999, durationDays: 30,
    maxListings: -1, featuredListings: 5, urgentListings: 10,
    candidateSearch: true, unlimitedApplicants: true, interviewScheduling: true,
    verifiedBadge: true, hiringAnalytics: true, prioritySupport: true,
    multiRecruiter: true, multiBranch: true, bulkHiring: true, dedicatedSupport: true,
    highlights: ['Everything in Professional', 'Multiple recruiters', 'Multiple branches', 'Advanced analytics', 'Bulk hiring', 'Team members', 'Dedicated support'],
    sortOrder: 2,
  },
];

/** Get all active plans */
const getPlans = asyncHandler(async (req, res) => {
  let plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });

  // Upsert so an already-seeded deployment picks up limit/feature changes on
  // redeploy too, not just a genuinely-empty collection.
  if (plans.length === 0 || plans.length < PLAN_DEFS.length) {
    await Promise.all(PLAN_DEFS.map((def) =>
      SubscriptionPlan.updateOne({ planKey: def.planKey }, { $set: def }, { upsert: true })
    ));
    plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });
  }

  return ApiResponse.success(res, { data: plans });
});

/** Resolve the calling employer's active plan doc (falls back to 'free' definition if unseeded). */
async function getEmployerPlanDoc(employer) {
  const planKey = employer?.subscriptionPlan || 'free';
  const isActive = hasActiveSubscription(employer);
  const plan = await SubscriptionPlan.findOne({ planKey: isActive ? planKey : 'free' });
  return plan || PLAN_DEFS.find((p) => p.planKey === (isActive ? planKey : 'free'));
}

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

  const JobsTransaction = require('../models/JobsTransaction');
  await JobsTransaction.create({
    employer: userId(req),
    employerProfile: profile._id,
    kind: 'subscription',
    planKey: plan.planKey,
    amount: 0,
    status: 'paid',
    description: `${plan.name} Plan (Free)`,
  }).catch(() => {}); // history is best-effort — never block the subscription itself

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

/**
 * Record profile views for candidate insights.
 *
 * ONLY call this from endpoints already behind `requireApprovedEmployer` —
 * that's what guarantees a stat is only counted when a real, admin-approved
 * hiring company/person looked at the profile.
 *
 * Fire-and-forget on purpose: analytics must never fail or slow down the
 * employer's request. Duplicate-key errors (code 11000) are the expected
 * "already counted today" path and are swallowed.
 *
 * @param {Array<{_id, user}>} profiles  candidate profiles that were seen
 * @param {'view'|'search'} kind
 */
async function recordProfileViews(profiles, { employerUserId, employerProfileId, kind }) {
  try {
    const list = (Array.isArray(profiles) ? profiles : [profiles]).filter(Boolean);
    if (!list.length || !employerUserId) return;

    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const rows = list
      // Never count an employer viewing their own linked seeker profile.
      .filter((p) => String(p.user?._id || p.user || '') !== String(employerUserId))
      .map((p) => ({
        seekerProfile: p._id,
        seeker: p.user?._id || p.user || undefined,
        employer: employerUserId,
        employerProfile: employerProfileId,
        kind,
        dayKey,
      }));
    if (!rows.length) return;

    // ordered:false → one duplicate doesn't abort the rest of the batch.
    await ProfileView.insertMany(rows, { ordered: false });
  } catch (err) {
    if (err?.code !== 11000 && !err?.writeErrors) {
      console.warn('[recordProfileViews] skipped:', err.message);
    }
  }
}

/** Employer: browse approved candidate profiles (contact details masked unless subscribed) */
const getCandidates = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const subscribed = hasActiveSubscription(employer);
  const planDoc = await getEmployerPlanDoc(employer);
  // "Limited Candidate Search" (Free) vs full Candidate Search (Professional/
  // Business, per planDoc.candidateSearch): free-tier employers can still
  // browse, but without text/skill search filters and a smaller page size —
  // real search capability, not just masked contact info.
  const canSearch = Boolean(planDoc?.candidateSearch);

  const { search, city, skill, page = 1, limit = 20, exclude, shortlistedOnly } = req.query;
  const effectiveLimit = canSearch ? Math.min(50, parseInt(limit) || 20) : Math.min(5, parseInt(limit) || 5);
  // Employers see approved candidates that the candidate has PUBLISHED.
  const filter = { status: 'approved', isPublished: true };
  if (canSearch) {
    if (city)  filter.currentCity = new RegExp(city, 'i');
    if (skill) filter.skills = new RegExp(skill, 'i');
    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [{ fullName: rx }, { title: rx }, { skills: rx }, { currentCity: rx }, { bio: rx }];
    }
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
  const shortlistedSet= new Set(myContacts.filter((c) => c.action === 'shortlist').map((c) => String(c.seekerProfile)));

  if (shortlistedOnly === 'true') {
    filter._id = { $in: Array.from(shortlistedSet) };
  } else if (exclude !== 'false') {
    const seenSet = new Set([...rejectedSet, ...shortlistedSet]);
    if (seenSet.size) filter._id = { $nin: Array.from(seenSet) };
  }

  const skip = canSearch ? (parseInt(page) - 1) * effectiveLimit : 0; // free tier: no pagination, just the first page
  const [profiles, total] = await Promise.all([
    JobSeekerProfile.find(filter)
      .populate('user', 'email phone')
      .sort({ profileCompleteness: -1, updatedAt: -1 })
      .skip(skip)
      .limit(effectiveLimit),
    JobSeekerProfile.countDocuments(filter),
  ]);

  // Contact details never unlock from Browse Candidates — the only unlock
  // path is: recruiter schedules an interview → candidate accepts it. See
  // jobController.js scheduleInterview / respondToInterview.
  const data = profiles.map((pr) =>
    presentCandidate(pr, {
      unlocked: false,
      shortlisted: shortlistedSet.has(String(pr._id)),
    })
  );

  // Surfacing in an approved employer's browse/search results counts as a
  // "Search Appearance" — weaker than a profile view, tracked separately.
  recordProfileViews(profiles, {
    employerUserId: userId(req),
    employerProfileId: employer._id,
    kind: 'search',
  });

  return res.json({
    success: true,
    data,
    total,
    meta: {
      subscribed, plan: employer.subscriptionPlan, expiresAt: employer.subscriptionExpiresAt,
      canSearch, limited: !canSearch,
    },
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

  // accept → shortlist (contact stays locked — only an accepted interview
  // ever reveals contact details, see scheduleInterview/respondToInterview)
  await CandidateContact.create({
    employer: userId(req),
    seeker: profile.user?._id || profile.user,
    seekerProfile: profile._id,
    action: 'shortlist',
    planAtTime: employer.subscriptionPlan,
  });

  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: false, shortlisted: true }),
    message: 'Candidate shortlisted',
  });
});

/** Employer: single candidate (same masking rules) */
const getCandidateById = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

  const contacts = await CandidateContact.find({ employer: userId(req), seekerProfile: profile._id }).select('action');
  // Contact is never unlocked from Browse Candidates — only an accepted
  // interview reveals it (see jobController.js respondToInterview).
  const unlocked = false;
  const shortlisted = contacts.some((c) => c.action === 'shortlist');

  // Counts toward the candidate's "Profile Views" — we're past
  // requireApprovedEmployer, so this is a genuine approved-recruiter view.
  recordProfileViews(profile, {
    employerUserId: userId(req),
    employerProfileId: employer._id,
    kind: 'view',
  });

  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked, shortlisted }),
    message: 'Candidate',
  });
});

/**
 * Employer: mark a candidate as hired from the Browse Candidates list. This
 * is a record-keeping action only — it does not reveal contact details.
 * Contact only ever unlocks via the interview flow (recruiter schedules →
 * candidate accepts), see jobController.js respondToInterview.
 * @body { action: 'hire' }
 */
const contactCandidate = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);

  const profile = await JobSeekerProfile.findOne({ _id: req.params.id, status: 'approved' })
    .populate('user', 'email phone');
  if (!profile) throw ApiError.notFound('Candidate not found');

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

  return ApiResponse.success(res, {
    data: presentCandidate(profile, { unlocked: false, shortlisted: false }),
    message: 'Marked as hired',
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

  const JobsTransaction = require('../models/JobsTransaction');
  await JobsTransaction.create({
    employer: userId(req),
    employerProfile: profile._id,
    kind: 'subscription',
    planKey: plan.planKey,
    amount: plan.price,
    status: 'created',
    description: `${plan.name} Plan — ${plan.durationDays} days`,
    razorpayOrderId: rzpOrder.id,
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

  const JobsTransaction = require('../models/JobsTransaction');
  const txn = await JobsTransaction.findOne({ razorpayOrderId, employer: userId(req), kind: 'subscription' });
  if (!txn) throw ApiError.notFound('Subscription order not found');
  if (txn.status === 'paid') {
    // Idempotent — client retried after this already succeeded.
    return ApiResponse.success(res, { data: { plan: txn.planKey, expiresAt: txn.meta?.expiresAt, paymentId: txn.razorpayPaymentId }, message: 'Already activated' });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) throw ApiError.internal('Razorpay secret not configured');

  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
  if (expected !== razorpaySignature) {
    txn.status = 'failed';
    txn.failureReason = 'Signature mismatch';
    await txn.save();
    throw ApiError.badRequest('Payment signature verification failed');
  }

  const plan = await SubscriptionPlan.findOne({ planKey, isActive: true });
  if (!plan) throw ApiError.notFound('Plan not found');

  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) throw ApiError.badRequest('Employer profile not found');

  // Renewing before expiry extends the remaining time instead of discarding
  // it — renewing the same plan a week early shouldn't cost you that week.
  const now = new Date();
  const base = profile.subscriptionExpiresAt && profile.subscriptionExpiresAt > now && profile.subscriptionPlan === plan.planKey
    ? profile.subscriptionExpiresAt
    : now;
  const expiresAt = new Date(base.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
  profile.subscriptionPlan      = plan.planKey;
  profile.subscriptionExpiresAt = expiresAt;
  profile.subscriptionPaidAt    = new Date();
  profile.subscriptionAmount    = plan.price;
  profile.autoRenew             = true; // a fresh purchase implicitly re-enables renewal reminders
  await profile.save();

  txn.status = 'paid';
  txn.razorpayPaymentId = razorpayPaymentId;
  txn.razorpaySignature = razorpaySignature;
  txn.meta = { ...(txn.meta || {}), expiresAt };
  await txn.save();

  return ApiResponse.success(res, {
    data: { plan: plan.planKey, expiresAt, paymentId: razorpayPaymentId },
    message: `${plan.name} plan activated`,
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  FEATURED COMPANY (one-time purchase, separate from per-job boosts)
// ══════════════════════════════════════════════════════════════════════════════

const FEATURED_COMPANY_PRICES = { 30: 999 }; // INR per duration in days — single 30-day option

/**
 * @route POST /api/v1/job-registration/employer/featured/order
 * @body  { days: 7 | 15 | 30 }
 */
const createFeaturedCompanyOrder = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const days = Number(req.body?.days);
  const price = FEATURED_COMPANY_PRICES[days];
  if (!price) throw ApiError.badRequest(`days must be one of: ${Object.keys(FEATURED_COMPANY_PRICES).join(', ')}`);

  const client = getRazorpayClient();
  const rzpOrder = await client.orders.create({
    amount: price * 100,
    currency: 'INR',
    receipt: `FEAT-${Date.now().toString(36).toUpperCase()}`,
    notes: { type: 'featured_company', days, employerId: userId(req) },
  });

  const JobsTransaction = require('../models/JobsTransaction');
  await JobsTransaction.create({
    employer: userId(req),
    employerProfile: employer._id,
    kind: 'featured_company',
    featuredDurationDays: days,
    amount: price,
    status: 'created',
    description: `Featured Company — ${days} Days`,
    razorpayOrderId: rzpOrder.id,
  });

  return ApiResponse.success(res, {
    data: { razorpayOrderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, keyId: process.env.RAZORPAY_KEY_ID, days, price },
    message: 'Featured Company order created',
  });
});

/**
 * @route POST /api/v1/job-registration/employer/featured/verify
 * @body  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
 */
const verifyFeaturedCompanyOrder = asyncHandler(async (req, res) => {
  const employer = await requireApprovedEmployer(req);
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw ApiError.badRequest('razorpayOrderId, razorpayPaymentId and razorpaySignature are required');
  }

  const JobsTransaction = require('../models/JobsTransaction');
  const txn = await JobsTransaction.findOne({ razorpayOrderId, employer: userId(req), kind: 'featured_company' });
  if (!txn) throw ApiError.notFound('Featured Company order not found');
  if (txn.status === 'paid') {
    return ApiResponse.success(res, { data: { isFeaturedCompany: true, featuredCompanyExpiresAt: employer.featuredCompanyExpiresAt }, message: 'Already featured' });
  }

  try {
    require('../utils/razorpay').verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);
  } catch (e) {
    txn.status = 'failed';
    txn.failureReason = 'Signature mismatch';
    await txn.save();
    throw e;
  }

  const now = new Date();
  const base = employer.isFeaturedCompany && employer.featuredCompanyExpiresAt > now ? employer.featuredCompanyExpiresAt : now;
  employer.isFeaturedCompany = true;
  employer.featuredCompanyExpiresAt = new Date(base.getTime() + txn.featuredDurationDays * 86400000);
  await employer.save();

  txn.status = 'paid';
  txn.razorpayPaymentId = razorpayPaymentId;
  txn.razorpaySignature = razorpaySignature;
  await txn.save();

  return ApiResponse.success(res, {
    data: { isFeaturedCompany: true, featuredCompanyExpiresAt: employer.featuredCompanyExpiresAt },
    message: 'Company is now featured',
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  PAYMENT HISTORY, ENTITLEMENTS, AUTO-RENEW
// ══════════════════════════════════════════════════════════════════════════════

/** @route GET /api/v1/job-registration/employer/transactions */
const getMyTransactions = asyncHandler(async (req, res) => {
  const JobsTransaction = require('../models/JobsTransaction');
  const transactions = await JobsTransaction.find({ employer: userId(req) })
    .sort({ createdAt: -1 })
    .populate('job', 'title')
    .limit(200);
  return ApiResponse.success(res, { data: transactions, message: 'Payment history' });
});

/**
 * Single source of truth the client uses to decide what to gate/paywall —
 * lets the UI show an upgrade prompt proactively instead of guessing from
 * a 403 response. Mirrors the same checks the individual endpoints enforce
 * server-side (this endpoint is advisory only; every gated action still
 * re-checks entitlement itself).
 * @route GET /api/v1/job-registration/employer/entitlements
 */
const getEntitlements = asyncHandler(async (req, res) => {
  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) {
    return ApiResponse.success(res, {
      data: { registered: false, plan: 'free', subscribed: false },
      message: 'Not registered as an employer',
    });
  }
  const subscribed = hasActiveSubscription(profile);
  const planDoc = await getEmployerPlanDoc(profile);
  const activeListings = await Job.countDocuments({
    postedBy: userId(req),
    adminStatus: { $in: ['pending_review', 'approved'] },
  });

  return ApiResponse.success(res, {
    data: {
      registered: true,
      plan: profile.subscriptionPlan,
      planName: planDoc?.name,
      subscribed,
      subscriptionExpiresAt: profile.subscriptionExpiresAt,
      autoRenew: profile.autoRenew,
      isFeaturedCompany: Boolean(profile.isFeaturedCompany && profile.featuredCompanyExpiresAt > new Date()),
      featuredCompanyExpiresAt: profile.featuredCompanyExpiresAt,
      maxListings: planDoc?.maxListings,
      activeListings,
      canSearchCandidates: Boolean(planDoc?.candidateSearch),
      unlimitedApplicants: Boolean(planDoc?.unlimitedApplicants),
      canScheduleInterview: Boolean(planDoc?.interviewScheduling),
      verifiedBadge: Boolean(planDoc?.verifiedBadge),
      canViewAnalytics: Boolean(planDoc?.hiringAnalytics),
    },
    message: 'Entitlements',
  });
});

/**
 * Toggle renewal reminders. IMPORTANT: this app has no Razorpay Subscriptions
 * (recurring billing) integration — every payment here is a one-time order.
 * There is no live recurring charge to actually cancel. This flag only
 * controls whether the app nudges the employer to renew as expiry
 * approaches. TODO(backend): if true auto-billing is required, integrate
 * Razorpay Subscriptions API (recurring mandates) — a materially different
 * payment flow from the one-time orders used everywhere else in this app.
 * @route PATCH /api/v1/job-registration/employer/auto-renew
 * @body  { autoRenew: boolean }
 */
const setAutoRenew = asyncHandler(async (req, res) => {
  const profile = await EmployerProfile.findOne({ user: userId(req) });
  if (!profile) throw ApiError.badRequest('Register as an employer first');
  profile.autoRenew = Boolean(req.body?.autoRenew);
  await profile.save();
  return ApiResponse.success(res, {
    data: { autoRenew: profile.autoRenew },
    message: profile.autoRenew ? 'Renewal reminders enabled' : 'Renewal reminders turned off',
  });
});

/**
 * Public: companies that have actually paid for Featured Company placement
 * and haven't expired. The Jobs Home "Featured Companies" carousel
 * previously had no backend/subscription concept at all — it was purely a
 * client-side grouping of job listings by company name. This is the real,
 * paid-for list; the client falls back to that grouping only when this
 * returns too few results to fill the carousel.
 * @route GET /api/v1/job-registration/employers/featured
 */
const getFeaturedCompanies = asyncHandler(async (req, res) => {
  const employers = await EmployerProfile.find({
    status: 'approved',
    isFeaturedCompany: true,
    featuredCompanyExpiresAt: { $gt: new Date() },
  })
    .select('businessName logoUrl address.city featuredCompanyExpiresAt')
    .sort({ featuredCompanyExpiresAt: -1 })
    .limit(20);

  return ApiResponse.success(res, {
    data: employers.map((e) => ({
      employerId: e._id,
      name: e.businessName,
      logoUrl: e.logoUrl || null,
      city: e.address?.city || '',
    })),
    message: 'Featured companies',
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
    isPublished: true,
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

/**
 * Admin: permanently delete an employer.
 * Removes the EmployerProfile itself and every Job it posted (so no
 * orphaned listings survive it), so the admin has full control to remove
 * a business from the platform entirely — not just approve/reject.
 */
const adminDeleteEmployer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const profile = await EmployerProfile.findById(id);
  if (!profile) throw ApiError.notFound('Employer not found');

  const { deletedCount: jobsDeleted } = await Job.deleteMany({ employerProfile: id });
  await EmployerProfile.findByIdAndDelete(id);

  return ApiResponse.success(res, {
    data: { deletedEmployerId: id, jobsDeleted },
    message: `Employer "${profile.businessName}" and ${jobsDeleted} job listing(s) deleted`,
  });
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

    // If this job was previously rejected, its activeListings slot was
    // released — re-claim it so the counter stays consistent.
    if (job.postedBy && prevStatus === 'rejected') {
      await EmployerProfile.findOneAndUpdate(
        { user: job.postedBy },
        { $inc: { activeListings: 1 } }
      );
    }
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

/** Admin: edit a specific job listing's fields */
const adminEditJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');

  const simple = ['title', 'companyName', 'description', 'jobType', 'category',
                  'experience', 'contactEmail', 'isFeatured', 'isUrgent', 'isActive'];
  simple.forEach((k) => { if (req.body[k] !== undefined) job[k] = req.body[k]; });

  if (req.body.openings !== undefined) job.openings = parseInt(req.body.openings) || 1;
  if (req.body.skills !== undefined) {
    job.skills = Array.isArray(req.body.skills)
      ? req.body.skills
      : String(req.body.skills).split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (req.body.location !== undefined) {
    job.location = { ...job.location?.toObject?.() ?? job.location, ...req.body.location };
  }
  if (req.body.salary !== undefined) {
    job.salary = { ...(job.salary?.toObject?.() ?? job.salary), ...req.body.salary };
  }
  if (req.body.deadline !== undefined) {
    const d = new Date(req.body.deadline);
    job.deadline = req.body.deadline && !isNaN(d.getTime()) ? d : undefined;
  }

  await job.save();
  return ApiResponse.success(res, { data: job, message: 'Job updated' });
});

/** Admin: permanently delete a specific job listing */
const adminDeleteJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id);
  if (!job) throw ApiError.notFound('Job not found');

  // Release the employer's activeListings slot if the job was counting against it
  if (job.postedBy && ['pending_review', 'approved'].includes(job.adminStatus)) {
    await EmployerProfile.findOneAndUpdate(
      { user: job.postedBy },
      { $inc: { activeListings: -1 } }
    );
  }

  await Job.findByIdAndDelete(req.params.id);
  return ApiResponse.success(res, { data: { id: req.params.id }, message: 'Job deleted' });
});

/** Admin: edit a specific candidate profile's fields */
const adminEditSeeker = asyncHandler(async (req, res) => {
  const profile = await JobSeekerProfile.findById(req.params.id);
  if (!profile) throw ApiError.notFound('Candidate profile not found');

  const simple = ['fullName', 'phone', 'email', 'currentCity', 'title', 'bio',
                  'gender', 'experience', 'cvUrl', 'workMode', 'isPublished'];
  simple.forEach((k) => { if (req.body[k] !== undefined) profile[k] = req.body[k]; });

  ['skills', 'certifications', 'specializations', 'languages', 'preferredJobTypes'].forEach((k) => {
    if (req.body[k] !== undefined) {
      profile[k] = Array.isArray(req.body[k])
        ? req.body[k]
        : String(req.body[k]).split(',').map((s) => s.trim()).filter(Boolean);
    }
  });
  if (req.body.expectedSalary !== undefined) {
    profile.expectedSalary = {
      min: Number(req.body.expectedSalary?.min) || 0,
      max: Number(req.body.expectedSalary?.max) || 0,
    };
  }

  await profile.save();
  return ApiResponse.success(res, { data: profile, message: 'Candidate profile updated' });
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
    profile.isPublished = true;
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
  adminCreateSeeker,
  adminDeleteSeeker,
  getCandidates,
  getCandidateById,
  contactCandidate,
  swipeCandidate,
  getMyCandidateContacts,
  adminReviewSeeker,
  registerEmployer, getMyEmployerProfile, updateEmployerProfile,
  upsertSeekerProfile, getMySeekerProfile, uploadSeekerCV, getSeekerInsights,
  getPlans, subscribeToPlan,
  createFeaturedCompanyOrder, verifyFeaturedCompanyOrder, getFeaturedCompanies,
  getMyTransactions, getEntitlements, setAutoRenew,
  adminGetEmployers, adminReviewEmployer, adminDeleteEmployer,
  adminGetPendingJobs, adminReviewJob,
  adminEditJob, adminDeleteJob, adminEditSeeker,
  adminUpdatePlan, adminGetSeekers,
  // Reused by jobController for the recruiter Candidate Profile screen so
  // an applicant's rich seeker-profile data (skills/education/portfolio/etc)
  // isn't duplicated onto the Application sub-document.
  presentCandidate, recordProfileViews,
  // Reused by jobController for Phase 2 feature-gating (scheduleInterview,
  // getJobApplications applicant-visibility cap) so plan entitlement logic
  // has exactly one implementation.
  hasActiveSubscription, getEmployerPlanDoc,
};
