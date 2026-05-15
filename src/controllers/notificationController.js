/**
 * Admin Notification Controller
 * Provides endpoints for admins to send targeted push notifications.
 *
 * Routes:
 *   POST /api/v1/notifications/send-user         — send to a single user
 *   POST /api/v1/notifications/send-users        — send to list of userIds
 *   POST /api/v1/notifications/broadcast         — send to all users (with optional role/city filter)
 *   POST /api/v1/notifications/send-providers    — send to all providers
 *   POST /api/v1/notifications/send-inactive     — send to users inactive for N days
 */

const asyncHandler  = require('../utils/asyncHandler');
const ApiError      = require('../utils/ApiError');
const ApiResponse   = require('../utils/ApiResponse');
const {
  sendToUser,
  sendToUsers,
  sendToAllUsers,
  sendToProviders,
  sendToCity,
  sendToInactiveUsers,
  CH,
} = require('../services/notifications');

// ── POST /send-user ──────────────────────────────────────────────────────────
const sendToSingleUser = asyncHandler(async (req, res) => {
  const { userId, title, body, screen, channel } = req.body;
  if (!userId || !title || !body) {
    throw ApiError.badRequest('userId, title and body are required');
  }

  const result = await sendToUser(userId, {
    title,
    body,
    data:    { screen: screen || 'Home' },
    channel: channel || CH.DEFAULT,
  });

  return ApiResponse.success(res, { data: result, message: `Notification sent (${result.sent} tokens)` });
});

// ── POST /send-users ─────────────────────────────────────────────────────────
const sendToMultipleUsers = asyncHandler(async (req, res) => {
  const { userIds, title, body, screen, channel } = req.body;
  if (!Array.isArray(userIds) || !userIds.length || !title || !body) {
    throw ApiError.badRequest('userIds (array), title and body are required');
  }
  if (userIds.length > 500) {
    throw ApiError.badRequest('Max 500 userIds per request');
  }

  const result = await sendToUsers(userIds, {
    title,
    body,
    data:    { screen: screen || 'Home' },
    channel: channel || CH.DEFAULT,
  });

  return ApiResponse.success(res, { data: result, message: `Notification sent (${result.sent} tokens)` });
});

// ── POST /broadcast ──────────────────────────────────────────────────────────
const broadcast = asyncHandler(async (req, res) => {
  const { title, body, screen, channel, role, city } = req.body;
  if (!title || !body) {
    throw ApiError.badRequest('title and body are required');
  }

  const filter = {};
  if (role) filter.role = role;
  if (city) filter['location.city'] = { $regex: new RegExp(`^${city}$`, 'i') };

  const result = await sendToAllUsers(
    { title, body, data: { screen: screen || 'Home' }, channel: channel || CH.PROMOTIONS },
    filter
  );

  return ApiResponse.success(res, { data: result, message: `Broadcast sent (${result.sent} tokens)` });
});

// ── POST /send-providers ─────────────────────────────────────────────────────
const notifyProviders = asyncHandler(async (req, res) => {
  const { title, body, screen } = req.body;
  if (!title || !body) throw ApiError.badRequest('title and body are required');

  const result = await sendToProviders({
    title,
    body,
    data:    { screen: screen || 'ProviderDashboard' },
    channel: CH.PROVIDER,
  });

  return ApiResponse.success(res, { data: result, message: `Provider notification sent (${result.sent} tokens)` });
});

// ── POST /send-by-city ───────────────────────────────────────────────────────
const notifyByCity = asyncHandler(async (req, res) => {
  const { city, title, body, screen } = req.body;
  if (!city || !title || !body) throw ApiError.badRequest('city, title and body are required');

  const result = await sendToCity(city, {
    title,
    body,
    data:    { screen: screen || 'Home' },
    channel: CH.PROMOTIONS,
  });

  return ApiResponse.success(res, { data: result, message: `City notification sent to ${city} (${result.sent} tokens)` });
});

// ── POST /send-inactive ──────────────────────────────────────────────────────
const notifyInactive = asyncHandler(async (req, res) => {
  const { daysSince = 14, title, body, screen } = req.body;
  if (!title || !body) throw ApiError.badRequest('title and body are required');
  if (daysSince < 1 || daysSince > 365) throw ApiError.badRequest('daysSince must be 1–365');

  const result = await sendToInactiveUsers(Number(daysSince), {
    title,
    body,
    data:    { screen: screen || 'Home' },
    channel: CH.PROMOTIONS,
  });

  return ApiResponse.success(res, { data: result, message: `Re-engagement sent (${result.sent} tokens)` });
});

module.exports = {
  sendToSingleUser,
  sendToMultipleUsers,
  broadcast,
  notifyProviders,
  notifyByCity,
  notifyInactive,
};
