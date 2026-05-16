const asyncHandler          = require('../utils/asyncHandler');
const ApiError              = require('../utils/ApiError');
const ApiResponse           = require('../utils/ApiResponse');
const User                  = require('../models/User');
const NotificationLog       = require('../models/NotificationLog');
const ScheduledNotification = require('../models/ScheduledNotification');
const NotificationTemplate  = require('../models/NotificationTemplate');
const NotificationOpenEvent = require('../models/NotificationOpenEvent');
const {
  sendToUser, sendToUsers, sendToAllUsers,
  sendToProviders, sendToCity, sendToInactiveUsers, CH,
} = require('../services/notifications');

// ── helpers ───────────────────────────────────────────────────────────────────
const ok      = (res, data, msg = 'Success') => ApiResponse.success(res, { data, message: msg });
const created = (res, data, msg = 'Created') => ApiResponse.created(res, { data, message: msg });

async function doSend(audience, payload, opts = {}) {
  let result;
  if (audience === 'user')      result = await sendToUser(opts.userId, payload);
  else if (audience === 'users')result = await sendToUsers(opts.userIds, payload);
  else if (audience === 'all')  result = await sendToAllUsers(payload, opts.filter || {});
  else if (audience === 'providers') result = await sendToProviders(payload);
  else if (audience === 'city') result = await sendToCity(opts.city, payload);
  else if (audience === 'inactive') result = await sendToInactiveUsers(opts.daysSince || 14, payload);
  else throw ApiError.badRequest('Invalid audience');
  return result;
}

async function logSend(data) {
  try { return await NotificationLog.create(data); } catch { return null; }
}

// ── SEND ENDPOINTS ─────────────────────────────────────────────────────────────
const sendToSingleUser = asyncHandler(async (req, res) => {
  const { userId, title, body, screen, channel, imageUrl } = req.body;
  if (!userId || !title || !body) throw ApiError.badRequest('userId, title and body are required');
  const payload = { title, body, data: { screen: screen||'Home' }, channel: channel||CH.DEFAULT, ...(imageUrl&&{imageUrl}) };
  const result  = await doSend('user', payload, { userId });
  await logSend({ title, body, audience:'user', channel:channel||'default', screen:screen||'Home', imageUrl, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0, targetIds:[userId] });
  return ok(res, result, `Sent (${result.sent} tokens)`);
});

const sendToMultipleUsers = asyncHandler(async (req, res) => {
  const { userIds, title, body, screen, channel, imageUrl } = req.body;
  if (!Array.isArray(userIds)||!userIds.length||!title||!body) throw ApiError.badRequest('userIds[], title, body required');
  if (userIds.length > 1000) throw ApiError.badRequest('Max 1000 userIds per request');
  const payload = { title, body, data: { screen: screen||'Home' }, channel: channel||CH.DEFAULT };
  const result  = await doSend('users', payload, { userIds });
  await logSend({ title, body, audience:'users', channel:channel||'default', screen:screen||'Home', imageUrl, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0, targetIds:userIds });
  return ok(res, result, `Sent (${result.sent} tokens)`);
});

const broadcast = asyncHandler(async (req, res) => {
  const { title, body, screen, channel, imageUrl, role, city } = req.body;
  if (!title||!body) throw ApiError.badRequest('title and body are required');
  const filter = {};
  if (role) filter.role = role;
  if (city) filter['location.city'] = { $regex: new RegExp(`^${city}$`,'i') };
  const payload = { title, body, data: { screen: screen||'Home' }, channel: channel||CH.PROMOTIONS };
  const result  = await doSend('all', payload, { filter });
  await logSend({ title, body, audience:'all', channel:channel||'promotions', screen:screen||'Home', imageUrl, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0, city });
  return ok(res, result, `Broadcast sent (${result.sent} tokens)`);
});

const notifyProviders = asyncHandler(async (req, res) => {
  const { title, body, screen, imageUrl } = req.body;
  if (!title||!body) throw ApiError.badRequest('title and body are required');
  const payload = { title, body, data: { screen: screen||'ProviderDashboard' }, channel: CH.PROVIDER };
  const result  = await doSend('providers', payload);
  await logSend({ title, body, audience:'providers', channel:'provider', screen:screen||'ProviderDashboard', imageUrl, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0 });
  return ok(res, result, `Provider notification sent (${result.sent} tokens)`);
});

const notifyByCity = asyncHandler(async (req, res) => {
  const { city, title, body, screen, imageUrl } = req.body;
  if (!city||!title||!body) throw ApiError.badRequest('city, title, body required');
  const payload = { title, body, data: { screen: screen||'Home' }, channel: CH.PROMOTIONS };
  const result  = await doSend('city', payload, { city });
  await logSend({ title, body, audience:'city', channel:'promotions', screen:screen||'Home', imageUrl, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0, city });
  return ok(res, result, `City notification sent to ${city}`);
});

const notifyInactive = asyncHandler(async (req, res) => {
  const { daysSince=14, title, body, screen, imageUrl } = req.body;
  if (!title||!body) throw ApiError.badRequest('title and body are required');
  if (daysSince<1||daysSince>365) throw ApiError.badRequest('daysSince must be 1–365');
  const payload = { title, body, data: { screen: screen||'Home' }, channel: CH.PROMOTIONS };
  const result  = await doSend('inactive', payload, { daysSince: Number(daysSince) });
  await logSend({ title, body, audience:'inactive', channel:'promotions', screen:screen||'Home', imageUrl, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0, daysSince });
  return ok(res, result, `Re-engagement sent (${result.sent} tokens)`);
});

// ── HISTORY ────────────────────────────────────────────────────────────────────
const getHistory = asyncHandler(async (req, res) => {
  const { page=1, limit=20, audience, search } = req.query;
  const filter = {};
  if (audience) filter.audience = audience;
  if (search)   filter.$or = [
    { title: { $regex: search, $options:'i' } },
    { body:  { $regex: search, $options:'i' } },
  ];
  const [logs, total] = await Promise.all([
    NotificationLog.find(filter)
      .populate('sentBy','firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((+page-1)*+limit).limit(+limit).lean(),
    NotificationLog.countDocuments(filter),
  ]);
  return ok(res, { logs, total, page:+page, limit:+limit });
});

// ── STATS ─────────────────────────────────────────────────────────────────────
const getStats = asyncHandler(async (_req, res) => {
  const now   = new Date();
  const today = new Date(now); today.setHours(0,0,0,0);
  const week  = new Date(now); week.setDate(week.getDate()-7);
  const inactive14 = new Date(now); inactive14.setDate(inactive14.getDate()-14);

  const [
    totalLogs, todayLogs, weekLogs,
    totalSent, openCount,
    usersWithTokens, providersWithTokens,
    inactiveUsers,
    cityAgg,
  ] = await Promise.all([
    NotificationLog.countDocuments(),
    NotificationLog.countDocuments({ createdAt: { $gte: today } }),
    NotificationLog.countDocuments({ createdAt: { $gte: week } }),
    NotificationLog.aggregate([{ $group: { _id:null, sent:{ $sum:'$sentCount' }, removed:{ $sum:'$removed' } } }]),
    NotificationOpenEvent.countDocuments(),
    User.countDocuments({ fcmTokens: { $exists:true, $not:{ $size:0 } }, status:{ $ne:'banned' } }),
    User.countDocuments({ fcmTokens: { $exists:true, $not:{ $size:0 } }, role:'provider' }),
    User.countDocuments({ lastLogin: { $lt: inactive14 }, role:'user', status:{ $ne:'banned' } }),
    NotificationLog.aggregate([
      { $match: { city: { $exists:true, $ne:null } } },
      { $group: { _id:'$city', count:{ $sum:1 } } },
      { $sort: { count:-1 } }, { $limit: 5 },
    ]),
  ]);

  const agg = totalSent[0] || { sent:0, removed:0 };
  const deliveryRate = agg.sent > 0 ? Math.round((agg.sent/(agg.sent+agg.removed))*100) : 0;
  const openRate     = agg.sent > 0 ? Math.round((openCount/agg.sent)*100) : 0;

  return ok(res, {
    totalNotifications: totalLogs,
    notificationsToday: todayLogs,
    notificationsThisWeek: weekLogs,
    totalTokensReached: agg.sent,
    staleTokensRemoved: agg.removed,
    deliveryRate,
    openCount,
    openRate,
    activeDevices: usersWithTokens,
    providerDevices: providersWithTokens,
    inactiveUsers,
    topCities: cityAgg.map(c => ({ city: c._id, count: c.count })),
  });
});

// ── OPEN TRACKING ─────────────────────────────────────────────────────────────
const trackOpen = asyncHandler(async (req, res) => {
  const { notificationId, screen, platform } = req.body;
  await NotificationOpenEvent.create({
    userId: req.user.id,
    notificationId: notificationId || null,
    screen, platform,
  });
  if (notificationId) {
    await NotificationLog.findByIdAndUpdate(notificationId, { $inc: { openCount:1 } }).catch(()=>{});
  }
  return ok(res, null, 'Tracked');
});

// ── SCHEDULED NOTIFICATIONS ───────────────────────────────────────────────────
const scheduleNotification = asyncHandler(async (req, res) => {
  const { title, body, screen, channel, imageUrl, audience, city, daysSince, targetIds, scheduledAt, timezone } = req.body;
  if (!title||!body||!audience||!scheduledAt) throw ApiError.badRequest('title, body, audience, scheduledAt required');
  const at = new Date(scheduledAt);
  if (at <= new Date()) throw ApiError.badRequest('scheduledAt must be in the future');
  const sn = await ScheduledNotification.create({
    title, body, screen:screen||'Home', channel:channel||'default', imageUrl,
    audience, city, daysSince, targetIds,
    scheduledAt: at, timezone: timezone||'Asia/Kolkata',
    createdBy: req.user.id,
  });
  return created(res, sn, 'Notification scheduled');
});

const getScheduled = asyncHandler(async (req, res) => {
  const { status='pending' } = req.query;
  const items = await ScheduledNotification.find({ status })
    .populate('createdBy','firstName lastName')
    .sort({ scheduledAt:1 }).limit(100).lean();
  return ok(res, items);
});

const cancelScheduled = asyncHandler(async (req, res) => {
  const sn = await ScheduledNotification.findByIdAndUpdate(req.params.id, { status:'cancelled' }, { new:true });
  if (!sn) throw ApiError.notFound('Scheduled notification not found');
  return ok(res, sn, 'Cancelled');
});

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
const createTemplate = asyncHandler(async (req, res) => {
  const { name, title, body, screen, channel, imageUrl, category, variables } = req.body;
  if (!name||!title||!body) throw ApiError.badRequest('name, title, body required');
  const tpl = await NotificationTemplate.create({
    name, title, body, screen:screen||'Home', channel:channel||'default',
    imageUrl, category:category||'general', variables:variables||[],
    createdBy: req.user.id,
  });
  return created(res, tpl, 'Template created');
});

const getTemplates = asyncHandler(async (req, res) => {
  const { category } = req.query;
  const filter = { isActive:true };
  if (category) filter.category = category;
  const templates = await NotificationTemplate.find(filter).sort({ useCount:-1, createdAt:-1 }).lean();
  return ok(res, templates);
});

const updateTemplate = asyncHandler(async (req, res) => {
  const tpl = await NotificationTemplate.findByIdAndUpdate(req.params.id, req.body, { new:true, runValidators:true });
  if (!tpl) throw ApiError.notFound('Template not found');
  return ok(res, tpl, 'Template updated');
});

const deleteTemplate = asyncHandler(async (req, res) => {
  const tpl = await NotificationTemplate.findByIdAndUpdate(req.params.id, { isActive:false }, { new:true });
  if (!tpl) throw ApiError.notFound('Template not found');
  return ok(res, null, 'Template deleted');
});

// ── SEND FROM TEMPLATE ────────────────────────────────────────────────────────
const sendFromTemplate = asyncHandler(async (req, res) => {
  const { audience, userId, userIds, city, daysSince, variables={} } = req.body;
  const templateId = req.params.id || req.body.templateId;
  const tpl = await NotificationTemplate.findById(templateId);
  if (!tpl||!tpl.isActive) throw ApiError.notFound('Template not found');

  // Replace variables in title/body
  let title = tpl.title, body = tpl.body;
  Object.entries(variables).forEach(([k,v]) => {
    title = title.replace(new RegExp(`{{${k}}}`,'g'), v);
    body  = body.replace(new RegExp(`{{${k}}}`,'g'), v);
  });

  const payload = { title, body, data:{ screen: tpl.screen }, channel: tpl.channel, ...(tpl.imageUrl&&{imageUrl:tpl.imageUrl}) };
  const result  = await doSend(audience||'all', payload, { userId, userIds, city, daysSince: daysSince&&Number(daysSince) });

  await NotificationTemplate.findByIdAndUpdate(templateId, { $inc: { useCount:1 } });
  await logSend({ title, body, audience:audience||'all', channel:tpl.channel, screen:tpl.screen, sentBy:req.user.id, sentCount:result.sent||0, removed:result.removed||0 });

  return ok(res, result, `Template sent (${result.sent} tokens)`);
});

// ── USER SEARCH (enhanced) ────────────────────────────────────────────────────
const searchUsersForNotif = asyncHandler(async (req, res) => {
  const { q='', role, city, hasToken, page=1, limit=30 } = req.query;
  const filter = {};
  if (q.trim()) {
    filter.$or = [
      { firstName:  { $regex: q, $options:'i' } },
      { lastName:   { $regex: q, $options:'i' } },
      { email:      { $regex: q, $options:'i' } },
      { phone:      { $regex: q, $options:'i' } },
    ];
  }
  if (role) filter.role = role;
  if (city) filter['location.city'] = { $regex: new RegExp(`^${city}$`,'i') };
  if (hasToken==='true') filter.fcmTokens = { $exists:true, $not:{ $size:0 } };
  filter.status = { $ne:'banned' };

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('firstName lastName email phone avatar role location fcmTokens status createdAt')
      .sort({ createdAt:-1 })
      .skip((+page-1)*+limit).limit(+limit).lean(),
    User.countDocuments(filter),
  ]);

  const shaped = users.map(u => ({
    _id:         u._id,
    firstName:   u.firstName,
    lastName:    u.lastName,
    email:       u.email,
    phone:       u.phone,
    avatar:      u.avatar,
    role:        u.role,
    city:        u.location?.city || null,
    hasFCMToken: !!(u.fcmTokens?.length),
    tokenCount:  u.fcmTokens?.length || 0,
    status:      u.status,
    joinedAt:    u.createdAt,
  }));

  return ok(res, { users: shaped, total, page:+page, limit:+limit });
});

module.exports = {
  sendToSingleUser, sendToMultipleUsers, broadcast,
  notifyProviders, notifyByCity, notifyInactive,
  getHistory, getStats, trackOpen,
  scheduleNotification, getScheduled, cancelScheduled,
  createTemplate, getTemplates, updateTemplate, deleteTemplate, sendFromTemplate,
  searchUsersForNotif,
};
