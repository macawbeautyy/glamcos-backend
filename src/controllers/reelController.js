const Reel         = require('../models/Reel');
const Follow       = require('../models/Follow');
const User         = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError     = require('../utils/ApiError');
const path         = require('path');
const admin        = require('../config/firebase');

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO UPLOAD  (multer in-memory → Firebase Storage via Admin SDK)
// Avoids Firebase Storage CORS issues on web deployments.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reels/upload-video
 * Receives a video file as multipart/form-data, uploads it to Firebase Storage,
 * and returns the public download URL.
 *
 * Body fields:
 *   file   — the video file (field name: "video")
 *   folder — optional storage path prefix (default: "reels")
 */
exports.uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No video file provided (field name must be "video")');

  const bucket   = admin.storage().bucket();
  const ext      = path.extname(req.file.originalname) || '.mp4';
  const fileName = `reels/${req.user._id}/${Date.now()}${ext}`;
  const fileRef  = bucket.file(fileName);

  // Upload the in-memory buffer
  await fileRef.save(req.file.buffer, {
    metadata: {
      contentType: req.file.mimetype || 'video/mp4',
    },
  });

  // Make it publicly readable
  await fileRef.makePublic();

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

  res.status(201).json({ success: true, url: publicUrl });
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
  const { videoUrl, thumbnailUrl, caption, hashtags, duration } = req.body;

  if (!videoUrl)  throw ApiError.badRequest('videoUrl is required');
  if (![15, 30, 60].includes(Number(duration))) {
    throw ApiError.badRequest('duration must be 15, 30, or 60');
  }

  const reel = await Reel.create({
    user: req.user._id,
    videoUrl,
    thumbnailUrl: thumbnailUrl || null,
    caption:      caption || '',
    hashtags:     Array.isArray(hashtags) ? hashtags : [],
    duration:     Number(duration),
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
    isLiked: r.likes.map(String).includes(userId),
    isSaved: r.saves.map(String).includes(userId),
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
    isLiked: r.likes.map(String).includes(userId),
    isSaved: r.saves.map(String).includes(userId),
  }));

  res.json({ success: true, data: enriched, page, limit });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENGAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/reels/:id/view
 * Increment view count (call when reel is played).
 */
exports.incrementView = asyncHandler(async (req, res) => {
  const reel = await Reel.findByIdAndUpdate(
    req.params.id,
    { $inc: { views: 1 } },
    { new: true }
  );
  if (!reel) throw ApiError.notFound('Reel not found');
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
 * Increment share count.
 */
exports.incrementShare = asyncHandler(async (req, res) => {
  const reel = await Reel.findByIdAndUpdate(
    req.params.id,
    { $inc: { shares: 1 } },
    { new: true }
  );
  if (!reel) throw ApiError.notFound('Reel not found');
  res.json({ success: true, shares: reel.shares });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/reels/:id/comments
 */
exports.getComments = asyncHandler(async (req, res) => {
  const reel = await Reel.findById(req.params.id)
    .select('comments')
    .populate('comments.user', 'firstName lastName avatar');

  if (!reel) throw ApiError.notFound('Reel not found');

  res.json({ success: true, data: reel.comments });
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

  const user = await User.findById(targetId).select('firstName lastName avatar bio createdAt');
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
