const mongoose = require('mongoose');

/**
 * Review
 * ------
 * A product review, one per (user, product) pair. Only users who have a
 * delivered order containing the product can post a review (enforced in
 * the controller, not at the schema level).
 */

const ReviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    order: {
      // Proof-of-purchase link
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    rating:  { type: Number, required: true, min: 1, max: 5 },
    title:   { type: String, default: '', trim: true, maxlength: 120 },
    comment: { type: String, default: '', trim: true, maxlength: 2000 },
    images:  [{ type: String }],
    // Helpful counts
    helpfulCount:    { type: Number, default: 0 },
    notHelpfulCount: { type: Number, default: 0 },
    // Moderation
    status: {
      type: String,
      enum: ['published', 'pending', 'hidden', 'flagged'],
      default: 'published',
      index: true,
    },
    // Verified purchase flag — set true when we can link to a delivered order
    isVerifiedPurchase: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One review per (user, product)
ReviewSchema.index({ product: 1, user: 1 }, { unique: true });
ReviewSchema.index({ product: 1, createdAt: -1 });
ReviewSchema.index({ rating: -1 });

/**
 * After save / remove, recompute the product's rating + reviewCount.
 * This keeps the denormalised fields on Product accurate without a cron.
 */
async function recomputeProductStats(productId) {
  const Review = mongoose.model('Review');
  const Product = mongoose.model('Product');
  const [stats] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(productId), status: 'published' } },
    {
      $group: {
        _id: '$product',
        avg: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);
  await Product.findByIdAndUpdate(productId, {
    rating:       stats ? Number(stats.avg.toFixed(2)) : 0,
    totalReviews: stats ? stats.count : 0,
  });
}

ReviewSchema.post('save', function () {
  recomputeProductStats(this.product).catch((err) =>
    console.error('[Review] recomputeProductStats failed:', err.message)
  );
});

ReviewSchema.post('findOneAndDelete', function (doc) {
  if (doc?.product) {
    recomputeProductStats(doc.product).catch((err) =>
      console.error('[Review] recomputeProductStats failed:', err.message)
    );
  }
});

ReviewSchema.post('findOneAndUpdate', function (doc) {
  if (doc?.product) {
    recomputeProductStats(doc.product).catch((err) =>
      console.error('[Review] recomputeProductStats failed:', err.message)
    );
  }
});

module.exports = mongoose.model('Review', ReviewSchema);
