const Reel         = require('../models/Reel');
const Follow       = require('../models/Follow');
const User         = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError     = require('../utils/ApiError');
const path         = require('path');
const axios        = require('axios');
const FormData     = require('form-data');

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO UPLOAD via Cloudinary (no CORS issues, works without Firebase Admin)
// Falls back to Firebase Storage if CLOUDINARY_URL is not set.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload buffer to Cloudinary using unsigned upload preset or API key+secret.
 * Returns the secure CDN URL.
 */
/**
 * Generic Cloudinary uploader.
 * resourceType: 'video' | 'image'
 * endpoint:     e.g. 'video/upload' | 'image/upload'
 */
async function uploadToCloudinary(buffer, originalName, userId, resourceType = 'video', folder = null) {
  const cloudName   = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset= process.env.CLOUDINARY_UPLOAD_PRESET;
  const apiKey      = process.env.CLOUDINARY_API_KEY;
  const apiSecret   = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName) {
    throw new ApiError('Video storage is not configured on the server. Please set CLOUDINARY_CLOUD_NAME in environment variables.', 503);
  }

  const ext        = path.extname(originalName) || (resourceType === 'image' ? '.jpg' : '.mp4');
  const contentType= resourceType === 'image' ? 'image/jpeg' : 'video/mp4';
  const uploadFolder = folder || `reels/${userId}`;

  const form = new FormData();
  form.append('file', buffer, { filename: `${resourceType}_${userId}_${Date.now()}${ext}`, contentType });
  form.append('resource_type', resourceType);
  form.append('folder', uploadFolder);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  if (uploadPreset) {
    form.append('upload_preset', uploadPreset);
    const res = await axios.post(endpoint, form, {
      headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120_000,
    });
    return res.data.secure_url;
  } else if (apiKey && apiSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const crypto    = require('crypto');
    const toSign    = `folder=${uploadFolder}&resource_type=${resourceType}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    form.append('api_key',   apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    const res = await axios.post(endpoint, form, {
      headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120_000,
    });
    return res.data.secure_url;
  } else {
    throw new ApiError('Video storage not fully configured. Set CLOUDINARY_UPLOAD_PRESET or CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.', 503);
  }
}

/**
 * POST /api/v1/reels/upload-video
 * Receives a video file as multipart/form-data, uploads to Cloudinary,
 * and returns the public CDN URL.
 */
exports.uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No video file provided (field name must be "video")');

  let videoUrl;
  try {
    videoUrl = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.user._id.toString(), 'video');
  } catch (err) {
    if (err.isOperational) throw err;
    const detail = err?.response?.data?.error?.message || err.message || 'Upload failed';
    throw new ApiError(`Video upload failed: ${detail}`, 500);
  }

  res.status(201).json({ success: true, url: videoUrl });
});

/**
 * POST /api/v1/reels/upload-thumbnail
 * Receives an image file as multipart/form-data, uploads to Cloudinary,
 * and returns the public CDN URL.
 */
exports.uploadThumbnail = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No thumbnail file provided (field name must be "thumbnail")');

  let thumbnailUrl;
  try {
    thumbnailUrl = await uploadToCloudinary(
      req.file.buffer, req.file.originalname,
      req.user._id.toString(), 'image', `thumbnails/${req.user._id}`
    );
  } catch (err) {
    if (err.isOperational) throw err;
    const detail = err?.response?.data?.error?.message || err.message || 'Upload failed';
    throw new ApiError(`Thumbnail upload failed: ${detail}`, 500);
  }

  res.status(201).json({ success: true, url: thumbnailUrl });
});

// ─────────────────────────────────────────────────────────────────────────────
// REEL CRUD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reels
 * Create (upload metadata for) a new reel.
 * Video itself is uploaded directly to Firebase Storage by the client;
 * this endpoint stores the metadata + public URL.
 */
exports.createReel = asyncHandler(async (req, res) => {
  const { videoUrl, thumbnailUrl, caption, hashtags, duration, linkedItem } = req.body;

  if (!videoUrl)  throw ApiError.badRequest('videoUrl is required');
  if (![15, 30, 60].includes(Number(duration))) {
    throw ApiError.badRequest('duration must be 15, 30, or 60');
  }

  const reel = await Reel.create({
    user: req.user._id,
    videoUrl,
    thumbnailUrl:  thumbnailUrl || null,
    caption:       caption || '',
    hashtags:      Array.isArray(hashtags) ? hashtags : [],
    duration:      Number(duration),
    linkedItem:    linkedItem   || undefined,
  });

  await reel.populate('user', 'firstName lastName avatar');

  res.status(201).json({ success: true, data: reel });
});

/**
 * DELETE /api/v1/reels/:id
 * Owner or admin can delete.
 */
exports.deleteReel = asyncHandler(async (req, res) => {
  const reel = await Reel.findById(req.params.id);
  if (!reel) throw ApiError.notFound('Reel not found');

  const isOwner = reel.user.toString() === req.user._id.toString();
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not authorised');

  await reel.deleteOne();
  res.json({ success: true, message: 'Reel deleted' });
});

// ─────────────────────────────────────────────────────────────────────────────
// FEEDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reels/feed?page=1&limit=10
 * "For You" feed — recent reels from everyone (simple chronological + trending).
 */
exports.getFeed = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(20, parseInt(req.query.limit) || 10);
  const skip  = (page - 1) * limit;

  const reels = await Reel.find({ isActive: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('user', 'firstName lastName avatar')
    .lean();

  const userId = req.user._id.toString();
  const enriched = reels.map((r) => ({
    ...r,
    likesCount:    r.likes.length,
    savesCount:    r.saves.length,
    commentsCount: r.comments.length,
    isLiked:  r.likes.map(String).includes(userId),
    isSaved:  r.saves.map(String).includes(userId),
    isShared: (r.sharesBy || []).map(String).includes(userId),
    isViewed: (r.viewedBy || []).map(String).includes(userId),
  }));

  res.json({ success: true, data: enriched, page, limit });
});

/**
 * GET /api/v1/reels/following?page=1&limit=10
 * Feed of reels from users the logged-in user follows.
 */
exports.getFollowingFeed = asyncHandler(async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(20, parseInt(req.query.limit) || 10);
  const skip  = (page - 1) * limit;

  const follows   = await Follow.find({ follower: req.user._id }).select('following');
  const followIds = follows.map((f) => f.following);

  const reels = await Reel.find({ user: { $in: followIds }, isActive: true })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('user', 'firstName lastName avatar')
    .lean();

  const userId = req.user._id.toString();
  const enriched = reels.map((r) => ({
    ...r,
    likesCount:    r.likes.length,
    savesCount:    r.saves.length,
    commentsCount: r.comments.length,
    isLiked:  r.likes.map(String).includes(userId),
    isSaved:  r.saves.map(String).includes(userId),
    isShared: (r.sharesBy || []).map(String).includes(userId),
    isViewed: (r.viewedBy || []).map(String).includes(userId),
  }));

  res.json({ success: true, data: enriched, page, limit });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reels/:id/view
 * Increment view count — deduplicated per user (each user counts only once).
 */
exports.incrementView = asyncHandler(async (req, res) => {
  const uid  = req.user._id;
  const reel = await Reel.findOneAndUpdate(
    { _id: req.params.id, viewedBy: { $ne: uid } }, // only if NOT already viewed
    { $inc: { views: 1 }, $addToSet: { viewedBy: uid } },
    { new: true }
  );
  // If reel is null the user already viewed it — just return current count
  if (!reel) {
    const r = await Reel.findById(req.params.id).select('views');
    return res.json({ success: true, views: r?.views || 0, alreadyViewed: true });
  }
  res.json({ success: true, views: reel.views });
});

/**
 * POST /api/v1/reels/:id/like
 * Toggle like on a reel.
 */
exports.toggleLike = asyncHandler(async (req, res) => {
  const reel   = await Reel.findById(req.params.id);
  if (!reel)   throw ApiError.notFound('Reel not found');

  const uid    = req.user._id;
  const idx    = reel.likes.findIndex((id) => id.equals(uid));
  const liked  = idx === -1;

  if (liked) reel.likes.push(uid);
  else        reel.likes.splice(idx, 1);

  await reel.save();
  res.json({ success: true, liked, likesCount: reel.likes.length });
});

/**
 * POST /api/v1/reels/:id/save
 * Toggle save on a reel.
 */
exports.toggleSave = asyncHandler(async (req, res) => {
  const reel  = await Reel.findById(req.params.id);
  if (!reel)  throw ApiError.notFound('Reel not found');

  const uid   = req.user._id;
  const idx   = reel.saves.findIndex((id) => id.equals(uid));
  const saved = idx === -1;

  if (saved) reel.saves.push(uid);
  else        reel.saves.splice(idx, 1);

  await reel.save();
  res.json({ success: true, saved, savesCount: reel.saves.length });
});

/**
 * POST /api/v1/reels/:id/share
 * Increment share count — deduplicated per user (each user counts only once).
 */
exports.incrementShare = asyncHandler(async (req, res) => {
  const uid  = req.user._id;
  const reel = await Reel.findOneAndUpdate(
    { _id: req.params.id, sharesBy: { $ne: uid } }, // only if NOT already shared
    { $inc: { shares: 1 }, $addToSet: { sharesBy: uid } },
    { new: true }
  );
  if (!reel) {
    const r = await Reel.findById(req.params.id).select('shares');
    return res.json({ success: true, shares: r?.shares || 0, alreadyShared: true });
  }
  res.json({ success: true, shares: reel.shares });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reels/:id/comments
 * Returns comments enriched with isLiked, likesCount, and replies.
 */
exports.getComments = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();

  const reel = await Reel.findById(req.params.id)
    .select('comments')
    .populate('comments.user', 'firstName lastName avatar')
    .populate('comments.replies.user', 'firstName lastName avatar');

  if (!reel) throw ApiError.notFound('Reel not found');

  const data = reel.comments.map(c => ({
    ...c.toObject(),
    isLiked:    c.likes.map(String).includes(userId),
    likesCount: c.likes.length,
    replies: (c.replies || []).map(r => ({
      ...r.toObject(),
      isLiked:    r.likes.map(String).includes(userId),
      likesCount: r.likes.length,
    })),
  }));

  res.json({ success: true, data });
});

/**
 * POST /api/v1/reels/:id/comments/:commentId/like
 * Toggle like on a comment.
 */
exports.likeComment = asyncHandler(async (req, res) => {
  const { id: reelId, commentId } = req.params;
  const userId = req.user._id;

  const reel = await Reel.findById(reelId);
  if (!reel) throw ApiError.notFound('Reel not found');

  const comment = reel.comments.id(commentId);
  if (!comment) throw ApiError.notFound('Comment not found');

  const alreadyLiked = comment.likes.map(String).includes(userId.toString());
  if (alreadyLiked) comment.likes.pull(userId);
  else              comment.likes.push(userId);

  await reel.save();
  res.json({ success: true, liked: !alreadyLiked, likesCount: comment.likes.length });
});

/**
 * POST /api/v1/reels/:id/comments/:commentId/reply
 * Add a reply to a comment.
 */
exports.replyToComment = asyncHandler(async (req, res) => {
  const { id: reelId, commentId } = req.params;
  const { text } = req.body;

  if (!text?.trim()) throw ApiError.badRequest('Reply text is required');

  const reel = await Reel.findById(reelId);
  if (!reel) throw ApiError.notFound('Reel not found');

  const comment = reel.comments.id(commentId);
  if (!comment) throw ApiError.notFound('Comment not found');

  comment.replies.push({ user: req.user._id, text: text.trim() });
  await reel.save();

  await reel.populate('comments.replies.user', 'firstName lastName avatar');
  const newReply = comment.replies[comment.replies.length - 1];

  res.status(201).json({
    success: true,
    data: { ...newReply.toObject(), isLiked: false, likesCount: 0 },
  });
});

/**
 * POST /api/v1/reels/:id/comments
 */
exports.addComment = asyncHandler(async (req, res) => {
  const { text } = req.body;
  if (!text?.trim()) throw ApiError.badRequest('Comment text is required');

  const reel = await Reel.findById(req.params.id);
  if (!reel)  throw ApiError.notFound('Reel not found');

  reel.comments.push({ user: req.user._id, text: text.trim() });
  await reel.save();

  const newComment = reel.comments[reel.comments.length - 1];
  await reel.populate('comments.user', 'firstName lastName avatar');

  const populated = reel.comments.id(newComment._id);
  res.status(201).json({ success: true, data: populated, commentsCount: reel.comments.length });
});

/**
 * DELETE /api/v1/reels/:reelId/comments/:commentId
 */
exports.deleteComment = asyncHandler(async (req, res) => {
  const reel = await Reel.findById(req.params.reelId);
  if (!reel)  throw ApiError.notFound('Reel not found');

  const comment = reel.comments.id(req.params.commentId);
  if (!comment) throw ApiError.notFound('Comment not found');

  const isOwner  = comment.user.toString() === req.user._id.toString();
  const isAdmin  = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not authorised');

  comment.deleteOne();
  await reel.save();
  res.json({ success: true, commentsCount: reel.comments.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reels/follow/:userId
 * Toggle follow on a user.
 */
exports.toggleFollow = asyncHandler(async (req, res) => {
  const targetId = req.params.userId;
  const meId     = req.user._id;

  if (targetId === meId.toString()) throw ApiError.badRequest("You can't follow yourself");

  const target = await User.findById(targetId);
  if (!target)  throw ApiError.notFound('User not found');

  const existing = await Follow.findOne({ follower: meId, following: targetId });

  if (existing) {
    await existing.deleteOne();
    res.json({ success: true, following: false });
  } else {
    await Follow.create({ follower: meId, following: targetId });
    res.json({ success: true, following: true });
  }
});

/**
 * GET /api/v1/reels/followers/:userId
 * List followers of a user.
 */
exports.getFollowers = asyncHandler(async (req, res) => {
  const follows = await Follow.find({ following: req.params.userId })
    .populate('follower', 'firstName lastName avatar')
    .lean();
  res.json({ success: true, data: follows.map((f) => f.follower), count: follows.length });
});

/**
 * GET /api/v1/reels/following/:userId
 * List users that this user follows.
 */
exports.getFollowing = asyncHandler(async (req, res) => {
  const follows = await Follow.find({ follower: req.params.userId })
    .populate('following', 'firstName lastName avatar')
    .lean();
  res.json({ success: true, data: follows.map((f) => f.following), count: follows.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE STATS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reels/profile/:userId
 * Full Instagram-style profile stats + reel grid for a user.
 */
exports.getUserProfile = asyncHandler(async (req, res) => {
  const targetId = req.params.userId;
  const meId     = req.user._id.toString();

  const user = await User.findById(targetId).select('firstName lastName avatar bio username socialLink profileColor createdAt');
  if (!user) throw ApiError.notFound('User not found');

  // Parallel fetches
  const [reels, followersCount, followingCount, isFollowing] = await Promise.all([
    Reel.find({ user: targetId, isActive: true })
      .sort({ createdAt: -1 })
      .select('videoUrl thumbnailUrl caption duration views likes saves shares comments createdAt')
      .lean(),
    Follow.countDocuments({ following: targetId }),
    Follow.countDocuments({ follower:  targetId }),
    Follow.exists({ follower: meId, following: targetId }),
  ]);

  // Aggregate totals
  let totalViews = 0, totalLikes = 0, totalSaves = 0, totalShares = 0;
  const reelsEnriched = reels.map((r) => {
    totalViews  += r.views;
    totalLikes  += r.likes.length;
    totalSaves  += r.saves.length;
    totalShares += r.shares;
    return {
      ...r,
      likesCount:    r.likes.length,
      savesCount:    r.saves.length,
      commentsCount: r.comments.length,
      isLiked: r.likes.map(String).includes(meId),
      isSaved: r.saves.map(String).includes(meId),
    };
  });

  res.json({
    success: true,
    data: {
      user: {
        ...user.toObject(),
        isMe: meId === targetId,
        isFollowing: !!isFollowing,
      },
      stats: {
        reelsCount:  reels.length,
        followersCount,
        followingCount,
        totalViews,
        totalLikes,
        totalSaves,
        totalShares,
      },
      reels: reelsEnriched,
    },
  });
});

/**
 * GET /api/v1/reels/saved
 * Reels the logged-in user has saved.
 */
exports.getSavedReels = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const reels  = await Reel.find({ saves: userId, isActive: true })
    .sort({ createdAt: -1 })
    .populate('user', 'firstName lastName avatar')
    .lean();

  const enriched = reels.map((r) => ({
    ...r,
    likesCount:    r.likes.length,
    savesCount:    r.saves.length,
    commentsCount: r.comments.length,
    isLiked: r.likes.map(String).includes(userId.toString()),
    isSaved: true,
  }));

  res.json({ success: true, data: enriched });
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATOR ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reels/:id/stats
 * Detailed stats for a single reel — only the owner or admin can access.
 */
exports.getReelStats = asyncHandler(async (req, res) => {
  const reel = await Reel.findById(req.params.id)
    .populate('user', 'firstName lastName avatar')
    .lean();

  if (!reel) throw ApiError.notFound('Reel not found');

  const isOwner = reel.user._id.toString() === req.user._id.toString();
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Not authorised');

  const likesCount    = reel.likes.length;
  const savesCount    = reel.saves.length;
  const commentsCount = reel.comments.length;
  const views         = reel.views || 0;
  const shares        = reel.shares || 0;
  const engagements   = likesCount + commentsCount + savesCount + shares;
  const engagementRate = views > 0 ? ((engagements / views) * 100).toFixed(1) : '0.0';

  res.json({
    success: true,
    data: {
      reel: {
        _id:         reel._id,
        videoUrl:    reel.videoUrl,
        thumbnailUrl:reel.thumbnailUrl,
        caption:     reel.caption,
        hashtags:    reel.hashtags,
        duration:    reel.duration,
        linkedItem:  reel.linkedItem,
        createdAt:   reel.createdAt,
        isActive:    reel.isActive,
      },
      stats: {
        views,
        likesCount,
        savesCount,
        commentsCount,
        shares,
        engagements,
        engagementRate: Number(engagementRate),
      },
    },
  });
});
