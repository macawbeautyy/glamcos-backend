const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  uploadVideo,
  uploadThumbnail,
  createReel,
  deleteReel,
  getAdminReels,
  getFeed,
  getFollowingFeed,
  incrementView,
  toggleLike,
  toggleSave,
  incrementShare,
  getComments,
  addComment,
  deleteComment,
  likeComment,
  replyToComment,
  toggleFollow,
  getFollowers,
  getFollowing,
  getUserProfile,
  getSavedReels,
  getReelStats,
  // New
  reportReel,
  hideReel,
  blockReelUser,
  adminGetReportedReels,
  adminModerateReel,
} = require('../controllers/reelController');

// Multer: store file in memory (max 100 MB for videos)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'), false);
  },
});

// Multer for thumbnail images (max 10 MB)
const thumbUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

// All reel routes require authentication
router.use(protect);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/all',              getAdminReels);
router.get('/admin/reported',         adminGetReportedReels);
router.patch('/admin/:id/moderate',   adminModerateReel);

// ── Video upload (bypasses Firebase Storage CORS) ─────────────────────────────
router.post('/upload-video',     upload.single('video'),         uploadVideo);
router.post('/upload-thumbnail', thumbUpload.single('thumbnail'), uploadThumbnail);

// ── Feed ──────────────────────────────────────────────────────────────────────
router.get('/feed',      getFeed);
router.get('/following', getFollowingFeed);
router.get('/saved',     getSavedReels);

// ── Profile / Follow ──────────────────────────────────────────────────────────
router.get('/profile/:userId',    getUserProfile);
router.get('/followers/:userId',  getFollowers);
router.get('/following/:userId',  getFollowing);
router.post('/follow/:userId',    toggleFollow);

// ── CRUD ──────────────────────────────────────────────────────────────────────
router.post('/',          createReel);
router.delete('/:id',     deleteReel);
router.get('/:id/stats',  getReelStats);

// ── Engagement ────────────────────────────────────────────────────────────────
router.post('/:id/view',       incrementView);
router.post('/:id/like',       toggleLike);
router.post('/:id/save',       toggleSave);
router.post('/:id/share',      incrementShare);

// ── Moderation (user) ─────────────────────────────────────────────────────────
router.post('/:id/report',     reportReel);
router.post('/:id/hide',       hideReel);
router.post('/:id/block-user', blockReelUser);

// ── Comments ──────────────────────────────────────────────────────────────────
router.get('/:id/comments',                          getComments);
router.post('/:id/comments',                         addComment);
router.delete('/:reelId/comments/:commentId',        deleteComment);
router.post('/:id/comments/:commentId/like',         likeComment);
router.post('/:id/comments/:commentId/reply',        replyToComment);

module.exports = router;
