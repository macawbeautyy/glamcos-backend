const express = require('express');
const router = express.Router();

const {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
  markHelpful,
} = require('../controllers/reviewController');

const { protect, optionalAuth } = require('../middleware/auth');

// Public: list reviews for a product
router.get('/product/:productId', optionalAuth, getProductReviews);

// Private: create / edit / delete
router.post('/',            protect, createReview);
router.put('/:id',          protect, updateReview);
router.delete('/:id',       protect, deleteReview);
router.post('/:id/helpful', protect, markHelpful);

module.exports = router;
