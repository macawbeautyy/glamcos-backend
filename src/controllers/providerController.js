/**
 * Provider Onboarding + Management Controller
 *
 * Routes:
 *  POST   /api/v1/providers/apply          – Step 1+2: basic + professional
 *  POST   /api/v1/providers/kyc            – Step 3: KYC doc URLs
 *  POST   /api/v1/providers/bank           – Step 4: bank details
 *  GET    /api/v1/providers/me             – get own provider profile
 *  PUT    /api/v1/providers/availability   – toggle online/offline
 *  GET    /api/v1/providers/dashboard      – dashboard summary (today stats)
 *  GET    /api/v1/providers/earnings       – earnings breakdown
 *
 *  Admin:
 *  GET    /api/v1/providers/admin/pending  – pending approval queue
 *  GET    /api/v1/providers/admin/all      – all providers (with filter by status)
 *  PUT    /api/v1/providers/admin/:id/approve
 *  PUT    /api/v1/providers/admin/:id/reject
 */

const Provider  = require('../models/Provider');
const Booking   = require('../models/Booking');
const User      = require('../models/User');
const ApiError  = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { firestoreSet, firestoreIncrement, firestoreAdd } = require('../config/firebase');
const { Notif } = require('../services/notifications');

// ── User: Apply as Provider ───────────────────────────────────────────────────

const applyAsProvider = asyncHandler(async (req, res) => {
  const existing = await Provider.findOne({ user: req.user.id });
  if (existing) {
    return ApiResponse.success(res, { data: existing, message: 'Application exists' });
  }

  const {
    displayName, bio, avatar, city, pincode, dateOfBirth,
    servicesOffered, categories, experience, certifications,
  } = req.body;

  const provider = await Provider.create({
    user: req.user.id,
    displayName, bio, avatar, city, pincode, dateOfBirth,
    servicesOffered, categories, experience, certifications,
    status:         'pending',
    onboardingStep: 2,
  });

  await User.findByIdAndUpdate(req.user.id, { provider_status: 'pending' });

  try {
    await firestoreIncrement('admin_metrics', new Date().toISOString().slice(0, 10), 'pendingProviders');
    await firestoreAdd('admin_events', {
      type:        'new_provider_application',
      providerId:  provider._id.toString(),
      displayName: displayName || 'Unknown',
    });
  } catch (fbErr) {
    console.warn('[Firebase] firestoreAdd/Increment skipped:', fbErr.message);
  }

  return ApiResponse.created(res, {
    data: provider,
    message: 'Application submitted. Please complete KYC next.',
  });
});

// ── User: Submit KYC ──────────────────────────────────────────────────────────

const submitKYC = asyncHandler(async (req, res) => {
  const { aadhaarFront, aadhaarBack, pan, selfie } = req.body;

  const provider = await Provider.findOneAndUpdate(
    { user: req.user.id },
    {
      kycDocs: { aadhaarFront, aadhaarBack, pan, selfie },
      status:  'kyc_pending',
      onboardingStep: 3,
    },
    { new: true, runValidators: true }
  );

  if (!provider) throw ApiError.notFound('Provider application not found');

  return ApiResponse.success(res, {
    data: provider,
    message: 'KYC documents submitted',
  });
});

// ── User: Submit Bank Details ─────────────────────────────────────────────────

const submitBankDetails = asyncHandler(async (req, res) => {
  const { accountHolderName, bankName, accountNumber, ifscCode, accountType } = req.body;

  const provider = await Provider.findOneAndUpdate(
    { user: req.user.id },
    {
      bankDetails: { accountHolderName, bankName, accountNumber, ifscCode, accountType },
      onboardingStep: 4,
    },
    { new: true }
  );

  if (!provider) throw ApiError.notFound('Provider application not found');

  return ApiResponse.success(res, {
    data: provider,
    message: 'Bank details saved. Application is under review.',
  });
});

// ── User: Get own provider profile ───────────────────────────────────────────

const getMyProviderProfile = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user.id })
    .populate('servicesOffered', 'name price thumbnail')
    .populate('categories', 'name icon');

  if (!provider) {
    return ApiResponse.success(res, { data: null, message: 'No application found' });
  }

  return ApiResponse.success(res, { data: provider, message: 'Provider profile' });
});

// ── Provider: Toggle availability ────────────────────────────────────────────

const updateAvailability = asyncHandler(async (req, res) => {
  const { isAvailable, isOnline, lat, lng } = req.body;

  const provider = await Provider.findOneAndUpdate(
    { user: req.user.id, status: 'active' },
    { isAvailable, isOnline },
    { new: true }
  );

  if (!provider) throw ApiError.forbidden('Only active providers can toggle availability');

  try {
    await firestoreSet('provider_presence', provider._id.toString(), {
      isOnline:    !!isOnline,
      isAvailable: !!isAvailable,
      lat:         lat || null,
      lng:         lng || null,
      providerId:  provider._id.toString(),
    });
  } catch (fbErr) {
    console.warn('[Firebase] firestoreSet skipped:', fbErr.message);
  }

  return ApiResponse.success(res, {
    data: { isAvailable: provider.isAvailable, isOnline: provider.isOnline },
    message: `You are now ${isOnline ? 'online' : 'offline'}`,
  });
});

// ── Provider: Dashboard summary ───────────────────────────────────────────────

const getProviderDashboard = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user.id });
  if (!provider) throw ApiError.notFound('Provider profile not found');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayBookings, pendingBookings, allTime] = await Promise.allSettled([
    Booking.find({ provider: provider._id, createdAt: { $gte: today } })
      .populate('user', 'firstName lastName')
      .populate('service', 'name price')
      .sort('date')
      .lean(),
    Booking.countDocuments({ provider: provider._id, status: 'pending' }),
    Booking.aggregate([
      { $match: { provider: provider._id, status: 'completed' } },
      { $group: { _id: null, revenue: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const todayData    = todayBookings.status === 'fulfilled' ? todayBookings.value : [];
  const todayRevenue = todayData
    .filter(b => b.status === 'completed')
    .reduce((sum, b) => sum + (b.amount || 0), 0);

  return ApiResponse.success(res, {
    data: {
      provider: {
        displayName:   provider.displayName,
        rating:        provider.rating,
        isAvailable:   provider.isAvailable,
        walletBalance: provider.walletBalance,
      },
      today: {
        bookings: todayData,
        revenue:  todayRevenue,
        count:    todayData.length,
      },
      pending: pendingBookings.status === 'fulfilled' ? pendingBookings.value : 0,
      allTime: allTime.status === 'fulfilled' && allTime.value[0]
        ? allTime.value[0]
        : { revenue: 0, count: 0 },
    },
    message: 'Dashboard loaded',
  });
});

// ── Provider: Earnings breakdown ──────────────────────────────────────────────

const getProviderEarnings = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user.id });
  if (!provider) throw ApiError.notFound('Provider not found');

  const { period = 'week' } = req.query;

  const from = new Date();
  if (period === 'week')  from.setDate(from.getDate() - 7);
  if (period === 'month') from.setMonth(from.getMonth() - 1);
  if (period === 'year')  from.setFullYear(from.getFullYear() - 1);

  const bookings = await Booking.find({
    provider:  provider._id,
    status:    'completed',
    createdAt: { $gte: from },
  }).select('amount date createdAt').sort('createdAt').lean();

  const byDay = {};
  bookings.forEach((b) => {
    const day = new Date(b.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + (b.amount || 0);
  });

  const chartData    = Object.entries(byDay).map(([date, revenue]) => ({ date, revenue }));
  const totalRevenue = bookings.reduce((s, b) => s + (b.amount || 0), 0);

  return ApiResponse.success(res, {
    data: {
      totalRevenue,
      totalBookings: bookings.length,
      walletBalance: provider.walletBalance,
      chartData,
      period,
    },
    message: 'Earnings fetched',
  });
});

// ── Admin: Pending approval queue ─────────────────────────────────────────────

const getPendingProviders = asyncHandler(async (req, res) => {
  const providers = await Provider.find({ status: { $in: ['pending', 'kyc_pending'] } })
    .sort({ createdAt: 1 })
    .populate('user', 'firstName lastName email phone')
    .lean();

  return ApiResponse.success(res, {
    data: providers,
    message: `${providers.length} pending applications`,
  });
});

// ── Admin: Get ALL providers (filterable by status) ───────────────────────────

const getAllProviders = asyncHandler(async (req, res) => {
  const { status } = req.query;

  const filter = {};
  if (status && status !== 'all') {
    // Support comma-separated statuses: ?status=pending,kyc_pending
    const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
    filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
  }

  const providers = await Provider.find(filter)
    .sort({ createdAt: -1 })
    .populate('user', 'firstName lastName email phone status createdAt')
    .lean();

  return ApiResponse.success(res, {
    data: providers,
    message: `${providers.length} providers found`,
  });
});

// ── Admin: Approve Provider ───────────────────────────────────────────────────

const approveProvider = asyncHandler(async (req, res) => {
  const provider = await Provider.findByIdAndUpdate(
    req.params.id,
    {
      status:     'active',
      approvedBy: req.user.id,
      approvedAt: new Date(),
      rejectionReason: null,
    },
    { new: true }
  ).populate('user', 'firstName email fcmTokens');

  if (!provider) throw ApiError.notFound('Provider not found');

  await User.findByIdAndUpdate(provider.user._id, {
    role:                   'provider',
    provider_status:        'approved',
    provider_welcome_shown: false,
  });

  try {
    await firestoreIncrement('admin_metrics', new Date().toISOString().slice(0, 10), 'activeProviders');
  } catch (fbErr) {
    console.warn('[Firebase] firestoreIncrement skipped:', fbErr.message);
  }

  try {
    await Notif.providerApproved(provider.user._id);
  } catch (notifErr) {
    console.warn('[Notif] providerApproved skipped:', notifErr.message);
  }

  return ApiResponse.success(res, { data: provider, message: 'Provider approved' });
});

// ── Admin: Reject Provider ────────────────────────────────────────────────────

const rejectProvider = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason) throw ApiError.badRequest('Rejection reason is required');

  const provider = await Provider.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', rejectionReason: reason },
    { new: true }
  ).populate('user', 'firstName email fcmTokens');

  if (!provider) throw ApiError.notFound('Provider not found');

  await User.findByIdAndUpdate(provider.user._id, {
    provider_status: 'rejected',
  });

  try {
    await Notif.providerRejected(provider.user._id, { reason });
  } catch (notifErr) {
    console.warn('[Notif] providerRejected skipped:', notifErr.message);
  }

  return ApiResponse.success(res, { data: provider, message: 'Provider rejected' });
});

// ── User: Get Provider Status (called on every app open) ──────────────────────

const getProviderStatus = asyncHandler(async (req, res) => {
  const user     = await User.findById(req.user.id);
  const provider = await Provider.findOne({ user: req.user.id }).select('status rejectionReason');

  return ApiResponse.success(res, {
    data: {
      provider_status:        user?.provider_status || 'none',
      current_mode:           user?.current_mode    || 'user',
      provider_welcome_shown: user?.provider_welcome_shown || false,
      rejection_reason:       provider?.rejectionReason || null,
    },
    message: 'Provider status fetched',
  });
});

// ── User / Provider: Switch between user / provider mode ──────────────────────

const switchMode = asyncHandler(async (req, res) => {
  const { mode } = req.body;

  if (!['user', 'provider'].includes(mode)) {
    throw ApiError.badRequest('mode must be "user" or "provider"');
  }

  const user = await User.findById(req.user.id);

  if (mode === 'provider' && user.provider_status !== 'approved') {
    throw ApiError.forbidden('Your provider application has not been approved yet');
  }

  const updates = { current_mode: mode };

  if (mode === 'provider' && !user.provider_welcome_shown) {
    updates.provider_welcome_shown = true;
  }

  await User.findByIdAndUpdate(req.user.id, updates);

  return ApiResponse.success(res, {
    data: { current_mode: mode },
    message: `Switched to ${mode} mode`,
  });
});

// ── User: Acknowledge Provider Welcome Modal ──────────────────────────────────

const acknowledgeProviderWelcome = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { provider_welcome_shown: true });
  return ApiResponse.success(res, { data: null, message: 'Welcome acknowledged' });
});

// ── Provider: Update services offered ────────────────────────────────────────
// PUT /api/v1/providers/services
const updateServicesOffered = asyncHandler(async (req, res) => {
  const { servicesOffered } = req.body;
  if (!Array.isArray(servicesOffered)) {
    throw new ApiError(400, 'servicesOffered must be an array of service IDs');
  }

  const provider = await Provider.findOneAndUpdate(
    { user: req.user.id },
    { servicesOffered },
    { new: true }
  ).populate('servicesOffered', 'name price thumbnail');

  if (!provider) throw new ApiError(404, 'Provider profile not found');

  return ApiResponse.success(res, {
    data: provider.servicesOffered,
    message: 'Services updated successfully',
  });
});

// ── Provider: Get reviews for my bookings ─────────────────────────────────────
// GET /api/v1/providers/reviews
const getProviderReviews = asyncHandler(async (req, res) => {
  const Booking = require('../models/Booking');

  // Find the provider record linked to this user
  const providerRecord = await Provider.findOne({ user: req.user.id }).lean();
  if (!providerRecord) {
    return ApiResponse.success(res, { data: [], message: 'No provider profile found' });
  }

  // Find all completed bookings assigned to this provider that have a review
  const bookings = await Booking.find({
    provider: providerRecord._id,
    status: 'completed',
    'review.rating': { $exists: true, $ne: null },
  })
    .populate('user',    'firstName lastName')
    .populate('service', 'name')
    .sort({ 'review.createdAt': -1 })
    .lean();

  // Shape into the format the provider panel expects
  const reviews = bookings.map((b) => ({
    _id:         b._id,
    rating:      b.review.rating,
    review:      b.review.comment || '',
    user:        b.user  || { firstName: 'Anonymous', lastName: '' },
    serviceName: b.service?.name || 'Service',
    createdAt:   b.review.createdAt || b.updatedAt,
  }));

  return ApiResponse.success(res, { data: reviews, message: 'Reviews fetched' });
});

// ── Portfolio: Upload ─────────────────────────────────────────────────────────
const uploadPortfolioImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image file provided');

  const axios    = require('axios');
  const FormData = require('form-data');
  const path     = require('path');

  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  const apiKey       = process.env.CLOUDINARY_API_KEY;
  const apiSecret    = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName) throw ApiError.serviceUnavailable('Image storage not configured');

  const userId = req.user.id;
  const ext    = path.extname(req.file.originalname) || '.jpg';
  const folder = `portfolio/${userId}`;
  const form   = new FormData();
  form.append('file', req.file.buffer, { filename: `portfolio_${Date.now()}${ext}`, contentType: req.file.mimetype || 'image/jpeg' });
  form.append('resource_type', 'image');
  form.append('folder', folder);

  let imageUrl;
  if (uploadPreset) {
    form.append('upload_preset', uploadPreset);
    const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, form, {
      headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 60_000,
    });
    imageUrl = r.data.secure_url;
  } else if (apiKey && apiSecret) {
    const crypto    = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign    = `folder=${folder}&resource_type=image&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, form, {
      headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 60_000,
    });
    imageUrl = r.data.secure_url;
  } else {
    throw ApiError.serviceUnavailable('Cloudinary credentials not configured');
  }

  // Append to provider's portfolio (max 10 items)
  const provider = await Provider.findOne({ user: userId });
  if (!provider) throw ApiError.notFound('Provider profile not found');
  if ((provider.portfolio || []).length >= 10) throw ApiError.badRequest('Portfolio limit reached (max 10 photos)');

  provider.portfolio.push({ url: imageUrl, caption: req.body.caption || '', uploadedAt: new Date() });
  await provider.save();

  return ApiResponse.success(res, {
    data: { imageUrl, portfolio: provider.portfolio },
    message: 'Portfolio photo uploaded successfully',
  });
});

// ── Portfolio: Delete by index ────────────────────────────────────────────────
const deletePortfolioImage = asyncHandler(async (req, res) => {
  const index = parseInt(req.params.index, 10);
  const provider = await Provider.findOne({ user: req.user.id });
  if (!provider) throw ApiError.notFound('Provider profile not found');
  if (isNaN(index) || index < 0 || index >= (provider.portfolio || []).length) {
    throw ApiError.badRequest('Invalid portfolio index');
  }
  provider.portfolio.splice(index, 1);
  await provider.save();
  return ApiResponse.success(res, { data: { portfolio: provider.portfolio }, message: 'Photo removed' });
});

// ── Update provider GPS location ──────────────────────────────────────────────
// Called by provider app every ~30s while online so nearest-provider queries work
const updateProviderLocation = asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;
  if (!lat || !lng) throw ApiError.badRequest('lat and lng are required');
  const provider = await Provider.findOneAndUpdate(
    { user: req.user._id },
    {
      location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
      locationUpdatedAt: new Date(),
    },
    { new: true }
  );
  if (!provider) throw ApiError.notFound('Provider profile not found');
  return ApiResponse.success(res, { data: { location: provider.location }, message: 'Location updated' });
});

module.exports = {
  applyAsProvider,
  submitKYC,
  submitBankDetails,
  getMyProviderProfile,
  updateAvailability,
  updateProviderLocation,
  getProviderDashboard,
  getProviderEarnings,
  getPendingProviders,
  getAllProviders,
  approveProvider,
  rejectProvider,
  getProviderStatus,
  switchMode,
  acknowledgeProviderWelcome,
  getProviderReviews,
  updateServicesOffered,
  uploadPortfolioImage,
  deletePortfolioImage,
};
