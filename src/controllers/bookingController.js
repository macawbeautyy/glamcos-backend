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
  const { service, stylist, date, time, amount, address, notes, serviceMode, homeAddress, paymentMode } = req.body;
  if (!service || !date || !time || !amount) throw new ApiError(400, 'service, date, time and amount are required');

  const booking = await Booking.create({
    user: req.user._id, service, stylist: stylist || null, date, time, amount,
    address: homeAddress || address, notes,
    serviceMode: serviceMode || 'salon',
    paymentMode: paymentMode || 'pay_at_salon',
  });
  await booking.populate([
    { path: 'service', select: 'name price image images duration category' },
    { path: 'stylist', select: 'name profileImage' },
  ]);
  try {
    await Notif.bookingReceived(req.user._id, { bookingId: booking._id.toString(), serviceName: booking.service?.name || 'your service', date, time });
  } catch (e) { logger.warn('[Booking] User notification failed:', e.message); }
  try {
    const providers = await Provider.find({ isOnline: true, isAvailable: true, status: 'active' }).select('user').lean();
    if (providers.length > 0) {
      const payload = { bookingId: booking._id.toString(), serviceName: booking.service?.name || 'a service', userFirstName: req.user.firstName || 'Customer', date, time };
      await Promise.allSettled(providers.map(p => Notif.newBookingRequest(p.user, payload).catch(() => {})));
      logger.info('[Booking] Notified ' + providers.length + ' providers of new booking ' + booking._id);
    }
  } catch (e) { logger.warn('[Booking] Provider notification failed:', e.message); }
  // Award first-booking bonus if this is the user's very first booking
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
    .populate('user', 'firstName lastName phone')
    .populate('service', 'name price image duration category')
    .populate('provider', 'displayName avatar')
    .sort({ createdAt: -1 }).limit(50);
  return ok(res, bookings, 'Provider bookings fetched');
});

exports.acceptBooking = asyncHandler(async (req, res) => {
  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can accept bookings');
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, status: 'pending', $or: [{ provider: null }, { provider: provider._id }] },
    { provider: provider._id, status: 'confirmed' }, { new: true }
  ).populate('user', 'firstName lastName phone').populate('service', 'name');
  if (!booking) throw new ApiError(404, 'Booking not found, already assigned, or not pending');
  try {
    await Notif.bookingConfirmed(booking.user._id, { bookingId: booking._id.toString(), serviceName: booking.service?.name || 'your service', date: booking.date });
  } catch (_) {}
  return ok(res, booking, 'Booking accepted');
});

exports.updateProviderBookingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['in-progress', 'completed'];
  if (!allowed.includes(status)) throw new ApiError(400, 'Status must be one of: ' + allowed.join(', '));
  const provider = await Provider.findOne({ user: req.user._id, status: 'active' });
  if (!provider) throw new ApiError(403, 'Only active providers can update booking status');
  const booking = await Booking.findOneAndUpdate(
    { _id: req.params.id, provider: provider._id }, { status }, { new: true }
  ).populate('user', 'firstName lastName phone').populate('service', 'name price');
  if (!booking) throw new ApiError(404, 'Booking not found or not assigned to you');
  if (status === 'completed') {
    Notif.serviceCompleted(booking.user._id, { bookingId: booking._id, serviceName: booking.service?.name || 'your service' }).catch(() => {});
    // Award loyalty points — fire-and-forget so booking response isn't delayed
    if (booking.amount > 0) {
      loyalty.earnFromBooking(booking.user._id, booking._id, booking.amount, 'basic')
        .catch((err) => logger.warn('[Loyalty] earn failed:', err.message));
    }
  } else if (status === 'in-progress') {
    Notif.providerOnTheWay(booking.user._id, { bookingId: booking._id, providerName: provider.displayName || 'Your provider', eta: '30 minutes' }).catch(() => {});
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
