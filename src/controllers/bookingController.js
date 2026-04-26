const asyncHandler = require('../utils/asyncHandler');
const ApiError     = require('../utils/ApiError');
const ApiResponse  = require('../utils/ApiResponse');
const Booking      = require('../models/Booking');
const Provider     = require('../models/Provider');
const { Notif }    = require('../services/notifications');
const logger       = require('../utils/logger');

// ─── helpers ─────────────────────────────────────────────────────────────────
const ok      = (res, data, message = 'Success')  => ApiResponse.success(res, { data, message });
const created = (res, data, message = 'Created')  => ApiResponse.created(res, { data, message });

// POST /api/v1/bookings  — user creates booking
exports.createBooking = asyncHandler(async (req, res) => {
  const { service, stylist, date, time, amount, address, notes, serviceMode, homeAddress } = req.body;

  if (!service || !date || !time || !amount) {
    throw new ApiError(400, 'service, date, time and amount are required');
  }

  const booking = await Booking.create({
    user:        req.user._id,
    service,
    stylist:     stylist || null,
    date,
    time,
    amount,
    address:     homeAddress || address,
    notes,
    serviceMode: serviceMode || 'salon',
  });

  await booking.populate([
    { path: 'service', select: 'name price image images duration category' },
    { path: 'stylist', select: 'name profileImage' },
  ]);

  // ── Notify the USER that their booking was received ───────────────────────
  try {
    await Notif.bookingReceived(req.user._id, {
      bookingId:   booking._id.toString(),
      serviceName: booking.service?.name || 'your service',
      date,
      time,
    });
  } catch (e) {
    console.warn('[Booking] User notification failed:', e.message);
  }

  // ── Notify ALL online providers about the new request ────────────────────
  // Location-based: if booking has coordinates, find providers within serviceRadius
  try {
    let providerQuery = { isOnline: true, isAvailable: true, status: 'active' };

    const providers = await Provider.find(providerQuery).select('user').lean();

    if (providers.length > 0) {
      const notifPayload = {
        bookingId:     booking._id.toString(),
        serviceName:   booking.service?.name || 'a service',
        userFirstName: req.user.firstName || 'Customer',
        date,
        time,
      };

      // Notify all online providers in parallel
      const notifPromises = providers.map((p) =>
        Notif.newBookingRequest(p.user, notifPayload).catch(() => {})
      );
      await Promise.allSettled(notifPromises);

      logger.info(`[Booking] Notified ${providers.length} providers of new booking ${booking._id}`);
    }
  } catch (e) {
    console.warn('[Booking] Provider notification failed:', e.message);
  }

  return created(res, booking, 'Booking confirmed');
});

// GET /api/v1/bookings  — user's own bookings
exports.getUserBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = { user: req.user._id };
  if (status) filter.status = status;

  const bookings = await Booking.find(filter)
    .populate('service',  'name price image images duration category')
    .populate('stylist',  'name profileImage rating')
    .populate('provider', 'displayName avatar rating')
    .sort({ createdAt: -1 })
    .limit(+limit).skip((+page - 1) * +limit);

  return ok(res, bookings, 'Bookings fetched');
});

// GET /api/v1/bookings/provider  — provider sees bookings
// Shows: 1. Pending unassigned pool  2. Own assigned bookings
exports.getProviderBookings = asyncHandler(async (req, res) => {
  const { status } = req.query;

  const provider = await Provider.findOne({ user: req.user._id });
  if (!provider) throw new ApiError(404, 'Provider profile not found');

  let filter;
  if (status) {
    filter = { provider: provider._id, status };
  } else {
    filter = {
      $or: [
        { provider: provider._id },
        { provider: null, status: 'pending' },
      ],
    };
  }

  const bookings = await Booking.find(filter)
    .populate('user',     'firstName lastName phone')
    .populate('service',  'name price image duration category')
    .populate('provider', 'displayName avatar')
    .sort({ createdAt: -1 })
    .limit(50);

  return ok(res, bookings, 'Provider bookings fetched');
});

// PUT /api/v1/bookings/:id/accept  — provider accepts a pending booking
exports.acceptBooking = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can accept bookings');

  const booking = await Booking.findOneAndUpdate(
    {
      _id:    req.params.id,
      status: 'pending',
      $or:    [{ provider: null }, { provider: provider._id }],
    },
    { provider: provider._id, status: 'confirmed' },
    { new: true }
  ).populate('user', 'firstName lastName phone').populate('service', 'name');

  if (!booking) throw new ApiError(404, 'Booking not found, already assigned, or not pending');

  try {
    await Notif.bookingConfirmed(booking.user._id, {
      bookingId:   booking._id.toString(),
      serviceName: booking.service?.name || 'your service',
      date:        booking.date,
    });
  } catch (_) {}

  return ok(res, booking, 'Booking accepted');
});

// PUT /api/v1/bookings/:id/provider-status  — provider updates job progress
exports.updateProviderBookingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['in-progress', 'completed'];
  if (!allowed.includes(status)) {
    throw new ApiError(400, `Status must be one of: ${allowed.join(', ')}`);
  }

  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can update booking status');

  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, provider: provider._id },
    { status },
    { new: true }
  ).populate('user', 'firstName lastName phone').populate('service', 'name price');

  if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');

  return ok(res, booking, `Booking marked as ${status}`);
});

// PUT /api/v1/bookings/:id/assign-provider  — admin assigns a provider
exports.assignProvider = asyncHandler(async (req, res) => {
  const { providerId } = req.body;
  if (!providerId) throw new ApiError(400, 'providerId is required');

  const provider = await Provider.findById(providerId);
  if (!provider) throw new ApiError(404, 'Provider not found');

  const booking = await Booking.findByIdAndUpdate(
    req.params.id,
    { provider: providerId, status: 'confirmed' },
    { new: true }
  )
    .populate('user',     'firstName lastName phone')
    .populate('service',  'name price')
    .populate('provider', 'displayName avatar');

  if (!booking) throw new ApiError(404, 'Booking not found');

  return ok(res, booking, 'Provider assigned');
});

// PUT /api/v1/bookings/:id/reject  — provider rejects/releases a booking
exports.rejectBooking = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can reject bookings');

  const booking = await Booking.findById(req.params.id);
  if (!booking) throw new ApiError(404, 'Booking not found');

  // Release an accepted booking back to the pool
  if (booking.status === 'confirmed' && booking.provider?.toString() === provider._id.toString()) {
    booking.provider = null;
    booking.status   = 'pending';
    await booking.save();
    return ok(res, booking, 'Booking released — re-queued');
  }

  // Declining an unassigned pending booking — no-op
  if (booking.status === 'pending' && !booking.provider) {
    return ok(res, booking, 'Booking skipped');
  }

  throw new ApiError(400, 'Cannot reject this booking in its current state');
});

// GET /api/v1/bookings/admin  — admin sees all bookings
exports.getAllBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (status) filter.status = status;

  const total    = await Booking.countDocuments(filter);
  const bookings = await Booking.find(filter)
    .populate('user',     'firstName lastName email phone')
    .populate('service',  'name price')
    .populate('stylist',  'name profileImage')
    .populate('provider', 'displayName avatar')
    .sort({ createdAt: -1 })
    .limit(+limit).skip((+page - 1) * +limit);

  return ok(res, { total, data: bookings }, 'All bookings fetched');
});

// PUT /api/v1/bookings/:id/status  — admin updates status
exports.updateBookingStatus = asyncHandler(async (req, res) => {
  const { status, cancelReason } = req.body;
  const update = { status };
  if (cancelReason) update.cancelReason = cancelReason;

  const booking = await Booking.findByIdAndUpdate(req.params.id, update, { new: true })
    .populate('service', 'name price')
    .populate('user',    'firstName lastName email phone')
    .populate('provider', 'displayName');
  if (!booking) throw new ApiError(404, 'Booking not found');

  return ok(res, booking, 'Booking status updated');
});

// PUT /api/v1/bookings/:id/cancel  — user cancels own booking
exports.cancelBooking = asyncHandler(async (req, res) => {
  const booking = await Booking.findOne({ _id: req.params.id, user: req.user._id });
  if (!booking)                       throw new ApiError(404, 'Booking not found');
  if (booking.status === 'completed') throw new ApiError(400, 'Cannot cancel a completed booking');

  booking.status       = 'cancelled';
  booking.cancelReason = req.body.reason || 'Cancelled by user';
  await booking.save();

  return ok(res, booking, 'Booking cancelled');
});

// GET /api/v1/bookings/rebooking-suggestions
exports.getRebookingSuggestions = asyncHandler(async (req, res) => {
  const bookings = await Booking.find({ user: req.user._id, status: 'completed' })
    .sort({ createdAt: -1 })
    .limit(3)
    .populate('service', 'name price thumbnail category')
    .lean();

  return ok(res, bookings, 'Rebooking suggestions');
});
