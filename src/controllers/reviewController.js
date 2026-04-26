const mongoose = require('mongoose');
const Review = require('../models/Review');
const Order = require('../models/Order');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/helpers');

/**
 * @desc    List reviews for a product
 * @route   GET /api/v1/reviews/product/:productId
 * @access  Public
 */
const getProductReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = { product: req.params.productId, status: 'published' };
  if (req.query.rating) filter.rating = Number(req.query.rating);

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'firstName lastName avatar'),
    Review.countDocuments(filter),
  ]);

  // Overall rating distribution
  const stats = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(req.params.productId), status: 'published' } },
    { $group: { _id: '$rating', count: { $sum: 1 } } },
  ]).catch(() => []);

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of stats) distribution[s._id] = s.count;

  return ApiResponse.paginated(res, {
    data: reviews,
    page,
    limit,
    total,
    message: 'Reviews fetched',
  });
});

/**
 * @desc    Create a review (must have a delivered order for this product).
 * @route   POST /api/v1/reviews
 * @access  Private
 * @body    { productId, rating, title?, comment?, images? }
 */
const createReview = asyncHandler(async (req, res) => {
  const { productId, rating, title = '', comment = '', images = [] } = req.body;
  if (!productId) throw ApiError.badRequest('productId is required');
  const r = Number(rating);
  if (!Number.isFinite(r) || r < 1 || r > 5) {
    throw ApiError.badRequest('rating must be between 1 and 5');
  }

  const product = await Product.findById(productId).select('_id');
  if (!product) throw ApiError.notFound('Product not found');

  // Verify the user has actually purchased & received this product
  const deliveredOrder = await Order.findOne({
    user: req.user.id,
    status: 'delivered',
    'items.product': productId,
  }).select('_id');

  const existing = await Review.findOne({ product: productId, user: req.user.id });
  if (existing) {
    throw ApiError.conflict('You have already reviewed this product');
  }

  const review = await Review.create({
    product: productId,
    user:    req.user.id,
    order:   deliveredOrder?._id || null,
    isVerifiedPurchase: Boolean(deliveredOrder),
    rating:  r,
    title,
    comment,
    images,
  });

  await review.populate('user', 'firstName lastName avatar');

  return ApiResponse.created(res, {
    data: review,
    message: 'Review posted',
  });
});

/**
 * @desc    Update your own review
 * @route   PUT /api/v1/reviews/:id
 * @access  Private (Owner)
 */
const updateReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');
  if (review.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only edit your own review');
  }

  const { rating, title, comment, images } = req.body;
  if (rating !== undefined) {
    const r = Number(rating);
    if (!Number.isFinite(r) || r < 1 || r > 5) {
      throw ApiError.badRequest('rating must be between 1 and 5');
    }
    review.rating = r;
  }
  if (title !== undefined)   review.title   = title;
  if (comment !== undefined) review.comment = comment;
  if (images !== undefined)  review.images  = images;

  await review.save();
  return ApiResponse.success(res, { data: review, message: 'Review updated' });
});

/**
 * @desc    Delete a review (owner or admin)
 * @route   DELETE /api/v1/reviews/:id
 * @access  Private
 */
const deleteReview = asyncHandler(async (req, res) => {
  const review = await Review.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  const isOwner = review.user.toString() === req.user.id;
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  if (!isOwner && !isAdmin) {
    throw ApiError.forbidden('Not allowed to delete this review');
  }

  await Review.findByIdAndDelete(review._id);

  return ApiResponse.success(res, { data: null, message: 'Review deleted' });
});

/**
 * @desc    Mark a review helpful / not helpful (increments counter)
 * @route   POST /api/v1/reviews/:id/helpful
 * @access  Private
 * @body    { helpful: true|false }
 */
const markHelpful = asyncHandler(async (req, res) => {
  const field = req.body?.helpful ? 'helpfulCount' : 'notHelpfulCount';
  const review = await Review.findByIdAndUpdate(
    req.params.id,
    { $inc: { [field]: 1 } },
    { new: true }
  );
  if (!review) throw ApiError.notFound('Review not found');

  return ApiResponse.success(res, {
    data: { id: review._id, [field]: review[field] },
    message: 'Thanks for the feedback',
  });
});

module.exports = {
  getProductReviews,
  createReview,
  updateReview,
  deleteReview,
  markHelpful,
};
