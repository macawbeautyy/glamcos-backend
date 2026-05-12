const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const {
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
} = require('../controllers/reelController');

// All reel routes require authentication
router.use(protect);

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
router.post('/',    createReel);
router.delete('/:id', deleteReel);

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
