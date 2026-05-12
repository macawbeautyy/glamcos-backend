const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
  uploadVideo,
  createReel,
  deleteReel,
  getFeed,
  getFollowingFeed,
  incrementView,
  toggleLike,
  toggleSave,
  incrementShare,
  getComments,
  addComment,
  deleteComment,
  toggleFollow,
  getFollowers,
  getFollowing,
  getUserProfile,
  getSavedReels,
  getReelStats,
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

// All reel routes require authentication
router.use(protect);

// ── Video upload (bypasses Firebase Storage CORS) ─────────────────────────────
router.post('/upload-video', upload.single('video'), uploadVideo);

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
router.post('/:id/view',  incrementView);
router.post('/:id/like',  toggleLike);
router.post('/:id/save',  toggleSave);
router.post('/:id/share', incrementShare);

// ── Comments ──────────────────────────────────────────────────────────────────
router.get('/:id/comments',              getComments);
router.post('/:id/comments',             addComment);
router.delete('/:reelId/comments/:commentId', deleteComment);

module.exports = router;
