const asyncHandler = require('../utils/asyncHandler');
const ApiError     = require('../utils/ApiError');
const ApiResponse  = require('../utils/ApiResponse');
const Booking      = require('../models/Booking');
const Provider     = require('../models/Provider');
const { Notif }    = require('../services/notifications');
const loyalty      = require('../services/loyalty');
const logger       = require('../utils/logger');

const ok      = (res, data, message = 'Success')  => ApiResponse.success(res, { data, message });
const created = (res, data, message = 'Created')  => ApiResponse.created(res, { data, message });

exports.createBooking = asyncHandler(async (req, res) => {
  const {
    service, stylist, date, time, amount, address, notes,
    serviceMode, homeAddress, paymentMode,
    userLat, userLng,  // customer GPS from mobile app
  } = req.body;
  if (!service || !date || !time || !amount) throw new ApiError(400, 'service, date, time and amount are required');

  const booking = await Booking.create({
    user: req.user._id, service, stylist: stylist || null, date, time, amount,
    address: homeAddress || address,
    homeAddress: homeAddress || undefined,
    notes,
    serviceMode: serviceMode || 'salon',
    paymentMode: paymentMode || 'pay_at_salon',
    userLocation: (userLat && userLng)
      ? { type: 'Point', coordinates: [parseFloat(userLng), parseFloat(userLat)] }
      : undefined,
  });
  await booking.populate([
    { path: 'service', select: 'name price image images duration category' },
    { path: 'stylist', select: 'name profileImage' },
  ]);

  try {
    await Notif.bookingReceived(req.user._id, { bookingId: booking._id.toString(), serviceName: booking.service?.name || 'your service', date, time });
  } catch (e) { logger.warn('[Booking] User notification failed:', e.message); }

  // ── Nearest-provider matching ───────────────────────────────────────────
  try {
    let providers;
    if (userLat && userLng) {
      const lat = parseFloat(userLat), lng = parseFloat(userLng);
      // Try 5 km first, expand to 20 km if nobody nearby
      for (const radiusKm of [5, 20]) {
        providers = await Provider.find({
          isOnline: true, isAvailable: true, status: 'active',
          location: { $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: radiusKm * 1000 } },
        }).select('user displayName').lean();
        if (providers.length > 0) {
          logger.info(`[Booking] ${providers.length} providers within ${radiusKm}km for booking ${booking._id}`);
          break;
        }
      }
    } else {
      providers = await Provider.find({ isOnline: true, isAvailable: true, status: 'active' }).select('user').lean();
      logger.info(`[Booking] No GPS — notifying all ${providers.length} online providers`);
    }

    if (providers && providers.length > 0) {
      const payload = {
        bookingId: booking._id.toString(),
        serviceName: booking.service?.name || 'a service',
        userFirstName: req.user.firstName || 'Customer',
        date, time,
        userLat: userLat || null,
        userLng: userLng || null,
      };
      await Promise.allSettled(providers.map(p => Notif.newBookingRequest(p.user, payload).catch(() => {})));
    }
  } catch (e) { logger.warn('[Booking] Provider notification failed:', e.message); }

  const prevCount = await Booking.countDocuments({ user: req.user._id, _id: { $ne: booking._id } });
  if (prevCount === 0) {
    loyalty.earnBonus(req.user._id, 'first_booking', booking._id).catch((e) => logger.warn('[Loyalty] first_booking bonus failed:', e.message));
  }
  return created(res, booking, 'Booking confirmed');
});

exports.getUserBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = { user: req.user._id };
  if (status) filter.status = status;
  const bookings = await Booking.find(filter)
    .populate('service', 'name price image images duration category')
    .populate('stylist', 'name profileImage rating')
    .populate('provider', 'displayName avatar rating')
    .sort({ createdAt: -1 }).limit(+limit).skip((+page - 1) * +limit);
  return ok(res, bookings, 'Bookings fetched');
});

exports.getProviderBookings = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const provider = await Provider.findOne({ user: req.user._id });
  if (!provider) throw new ApiError(404, 'Provider profile not found');
  const filter = status
    ? { provider: provider._id, status }
    : { $or: [{ provider: provider._id }, { provider: null, status: 'pending' }] };
  const bookings = await Booking.find(filter)
    .populate('user', 'firstName lastName phone avatar')
    .populate('service', 'name price image duration category')
    .populate('provider', 'displayName avatar')
    .select('+homeAddress +userLocation +address +serviceMode +notes')
    .sort({ createdAt: -1 }).limit(50);
  return ok(res, bookings, 'Provider bookings fetched');
});

exports.acceptBooking = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can accept bookings');

  // ── One-active-order rule ─────────────────────────────────────────────────
  const activeStatuses = ['confirmed', 'in-progress', 'reached'];
  const alreadyActive = await Booking.findOne({ provider: provider._id, status: { $in: activeStatuses } });
  if (alreadyActive) {
    throw new ApiError(409, 'You already have an active booking. Complete it before accepting a new one.');
  }

  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, status: 'pending', $or: [{ provider: null }, { provider: provider._id }] },
    { provider: provider._id, status: 'confirmed' }, { new: true }
  ).populate('user', 'firstName lastName phone')
   .populate('service', 'name price duration image')
   .populate('provider', 'displayName avatar');
  if (!booking) throw new ApiError(404, 'Booking not found, already assigned, or not pending');
  try {
    await Notif.bookingConfirmed(booking.user._id, { bookingId: booking._id.toString(), serviceName: booking.service?.name || 'your service', date: booking.date });
  } catch (_) {}
  return ok(res, booking, 'Booking accepted');
});

// ── Haversine distance in metres ──────────────────────────────────────────────
function distanceMetres(lat1, lng1, lat2, lng2) {
  const R    = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const REACHED_RADIUS_M = 50; // metres — provider must be within 50 m of user

exports.updateProviderBookingStatus = asyncHandler(async (req, res) => {
  const { status, providerLat, providerLng } = req.body;
  const allowed = ['in-progress', 'reached', 'completed'];
  if (!allowed.includes(status)) throw new ApiError(400, 'Status must be one of: ' + allowed.join(', '));

  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can update booking status');

  // ── Proximity gate for 'reached' ──────────────────────────────────────────
  if (status === 'reached') {
    const booking = await Booking.findOne({ _id: req.params.id, provider: provider._id });
    if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');

    const userCoords = booking.userLocation?.coordinates;
    if (userCoords?.length === 2 && providerLat && providerLng) {
      const [userLng, userLat] = userCoords; // GeoJSON: [lng, lat]
      const dist = distanceMetres(
        parseFloat(providerLat), parseFloat(providerLng),
        userLat, userLng
      );
      if (dist > REACHED_RADIUS_M) {
        throw new ApiError(400, `You are ${Math.round(dist)} m away. You must be within ${REACHED_RADIUS_M} m of the customer to mark as Reached.`);
      }
    }
    // No user GPS stored → allow without proximity check
  }

  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, provider: provider._id }, { status }, { new: true }
  ).populate('user', 'firstName lastName phone').populate('service', 'name price');
  if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');

  if (status === 'completed') {
    Notif.serviceCompleted(booking.user._id, { bookingId: booking._id, serviceName: booking.service?.name || 'your service' }).catch(() => {});
    if (booking.amount > 0) {
      loyalty.earnFromBooking(booking.user._id, booking._id, booking.amount, 'basic')
        .catch((err) => logger.warn('[Loyalty] earn failed:', err.message));
    }
  } else if (status === 'in-progress') {
    Notif.providerOnTheWay(booking.user._id, { bookingId: booking._id, providerName: provider.displayName || 'Your provider', eta: '30 minutes' }).catch(() => {});
  } else if (status === 'reached') {
    // Notify user that provider has arrived
    Notif.sendToUser(booking.user._id, {
      title: '🎉 Provider Arrived!',
      body:  `${provider.displayName || 'Your provider'} has arrived at your location.`,
      data:  { bookingId: booking._id.toString() },
    }).catch(() => {});
  }
  return ok(res, booking, 'Booking marked as ' + status);
});

exports.assignProvider = asyncHandler(async (req, res) => {
  const { providerId } = req.body;
  if (!providerId) throw new ApiError(400, 'providerId is required');
  const provider = await Provider.findById(providerId);
  if (!provider) throw new ApiError(404, 'Provider not found');
  const booking = await Booking.findByIdAndUpdate(
    req.params.id, { provider: providerId, status: 'confirmed' }, { new: true }
  ).populate('user', 'firstName lastName phone').populate('service', 'name price').populate('provider', 'displayName avatar');
  if (!booking) throw new ApiError(404, 'Booking not found');
  return ok(res, booking, 'Provider assigned');
});

exports.rejectBooking = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can reject bookings');
  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status === 'confirmed' && booking.provider?.toString() === provider._id.toString()) {
    booking.provider = null;
    booking.status   = 'pending';
    await booking.save();
    return ok(res, booking, 'Booking released — re-queued');
  }
  if (booking.status === 'pending' && !booking.provider) {
    return ok(res, booking, 'Booking skipped');
  }
  throw new ApiError(400, 'Cannot reject this booking in its current state');
});

exports.getAllBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (status) filter.status = status;
  const total    = await Booking.countDocuments(filter);
  const bookings = await Booking.find(filter)
    .populate('user', 'firstName lastName email phone')
    .populate('service', 'name price')
    .populate('stylist', 'name profileImage')
    .populate('provider', 'displayName avatar')
    .sort({ createdAt: -1 }).limit(+limit).skip((+page - 1) * +limit);
  return ok(res, { total, data: bookings }, 'All bookings fetched');
});

exports.updateBookingStatus = asyncHandler(async (req, res) => {
  const { status, cancelReason } = req.body;
  const update = { status };
  if (cancelReason) update.cancelReason = cancelReason;
  const booking = await Booking.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('service', 'name price')
    .populate('user', 'firstName lastName email phone')
    .populate('provider', 'displayName');
  if (!booking) throw new ApiError(404, 'Booking not found');
  return ok(res, booking, 'Booking status updated');
});

exports.cancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status === 'completed') throw new ApiError(400, 'Cannot cancel a completed booking');
  booking.status       = 'cancelled';
  booking.cancelReason = req.body.reason || 'Cancelled by user';
  await booking.save();
  Notif.bookingCancelled(booking.user, {
    bookingId: booking._id, serviceName: booking.service?.name || 'your service', reason: booking.cancelReason,
  }).catch(() => {});
  return ok(res, booking, 'Booking cancelled');
});

exports.getRebookingSuggestions = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ user: req.user._id, status: 'completed' })
    .sort({ createdAt: -1 }).limit(3)
    .populate('service', 'name price thumbnail category').lean();
  return ok(res, bookings, 'Rebooking suggestions');
});

exports.submitReview = asyncHandler(async (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) throw new ApiError(400, 'Rating must be a number between 1 and 5');
  const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });
  if (!booking) throw new ApiError(404, 'Booking not found');
  if (booking.status !== 'completed') throw new ApiError(400, 'You can only review a completed booking');
  if (booking.review && booking.review.rating) throw new ApiError(409, 'You have already submitted a review for this booking');
  booking.review = { rating: Number(rating), comment: (comment || '').trim().slice(0, 500), createdAt: new Date() };
  await booking.save();
  // Award loyalty bonus for writing a review (fire-and-forget)
  loyalty.earnBonus(req.user._id, 'write_review', booking._id).catch((e) => logger.warn('[Loyalty] review bonus failed:', e.message));
  return ok(res, booking.review, 'Review submitted successfully');
});
