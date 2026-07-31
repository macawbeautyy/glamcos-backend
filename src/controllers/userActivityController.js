const UserActivityEvent = require('../models/UserActivityEvent');
const User              = require('../models/User');
const asyncHandler       = require('../utils/asyncHandler');
const ApiError           = require('../utils/ApiError');
const ApiResponse        = require('../utils/ApiResponse');

const ok = (res, data, msg = 'Success') => ApiResponse.success(res, { data, message: msg });

const MAX_BATCH = 200;

/**
 * Ingest a batch of activity events from the app (screen views + taps).
 * The client queues events locally and flushes them periodically, so this
 * is called with an array, not one event at a time.
 * @route POST /api/v1/activity/log
 * @body  { events: [{ type, screen, label, meta, clientAt, sessionId, platform }] }
 */
const logEvents = asyncHandler(async (req, res) => {
  const events = Array.isArray(req.body.events) ? req.body.events.slice(0, MAX_BATCH) : [];
  if (!events.length) throw ApiError.badRequest('events array is required');

  const docs = events
    .filter((e) => e && e.type && e.clientAt)
    .map((e) => ({
      user:      req.user.id,
      sessionId: e.sessionId || '',
      type:      e.type,
      screen:    e.screen || '',
      label:     e.label || '',
      meta:      e.meta,
      platform:  e.platform || '',
      clientAt:  new Date(e.clientAt),
    }));

  if (docs.length) await UserActivityEvent.insertMany(docs, { ordered: false }).catch(() => {});
  // Always 200 even on partial failure — activity logging must never block
  // or error out the app for the user.
  return ok(res, { logged: docs.length });
});

/**
 * Admin: get one user's activity timeline (screen visits + taps), newest
 * session first. Consecutive screen_view events are used to derive
 * "time spent on screen" as the gap to the next event's clientAt.
 * @route GET /api/v1/activity/admin/user/:userId
 * @query { page, limit, from, to }
 */
const adminGetUserActivity = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { page = 1, limit = 200, from, to } = req.query;

  const user = await User.findById(userId).select('firstName lastName email phone avatar role createdAt lastActive').lean();
  if (!user) throw ApiError.notFound('User not found');

  const filter = { user: userId };
  if (from || to) {
    filter.clientAt = {};
    if (from) filter.clientAt.$gte = new Date(from);
    if (to)   filter.clientAt.$lte = new Date(to);
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const [events, total] = await Promise.all([
    UserActivityEvent.find(filter).sort({ clientAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
    UserActivityEvent.countDocuments(filter),
  ]);

  // Compute "time spent" for screen_view events: gap to the chronologically
  // next event (events arrive newest-first, so "next" is the previous array index).
  const chrono = [...events].reverse(); // oldest -> newest
  const durationMap = new Map();
  for (let i = 0; i < chrono.length; i++) {
    const cur  = chrono[i];
    const next = chrono[i + 1];
    if (cur.type === 'screen_view' && next) {
      const ms = new Date(next.clientAt) - new Date(cur.clientAt);
      if (ms > 0 && ms < 1000 * 60 * 60 * 6) durationMap.set(String(cur._id), ms); // cap at 6h to ignore idle gaps
    }
  }

  const shaped = events.map((e) => ({
    _id:        e._id,
    type:       e.type,
    screen:     e.screen,
    label:      e.label,
    meta:       e.meta,
    platform:   e.platform,
    sessionId:  e.sessionId,
    clientAt:   e.clientAt,
    durationMs: durationMap.get(String(e._id)) || null,
  }));

  return ok(res, { user, events: shaped, total, page: +page, limit: +limit });
});

/**
 * Admin: quick per-user summary — most visited screens, total sessions,
 * last seen. Useful before drilling into the full timeline.
 * @route GET /api/v1/activity/admin/user/:userId/summary
 */
const adminGetUserActivitySummary = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const mongoose = require('mongoose');
  const uid = new mongoose.Types.ObjectId(userId);

  const [topScreens, sessionCount, lastEvent, firstEvent] = await Promise.all([
    UserActivityEvent.aggregate([
      { $match: { user: uid, type: 'screen_view' } },
      { $group: { _id: '$screen', visits: { $sum: 1 } } },
      { $sort: { visits: -1 } },
      { $limit: 10 },
    ]),
    UserActivityEvent.distinct('sessionId', { user: uid, sessionId: { $ne: '' } }),
    UserActivityEvent.findOne({ user: uid }).sort({ clientAt: -1 }).select('clientAt').lean(),
    UserActivityEvent.findOne({ user: uid }).sort({ clientAt: 1 }).select('clientAt').lean(),
  ]);

  return ok(res, {
    topScreens: topScreens.map((s) => ({ screen: s._id || '(unknown)', visits: s.visits })),
    sessionCount: sessionCount.length,
    lastSeen:  lastEvent?.clientAt  || null,
    firstSeen: firstEvent?.clientAt || null,
  });
});

module.exports = { logEvents, adminGetUserActivity, adminGetUserActivitySummary };
