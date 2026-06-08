const mongoose = require('mongoose');

// ── Reply sub-schema ──────────────────────────────────────────────────────────
const ReplySchema = new mongoose.Schema(
  {
    user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text:  { type: String, required: true, trim: true, maxlength: 500 },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  { timestamps: true }
);

// ── Comment sub-schema ────────────────────────────────────────────────────────
const CommentSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text:    { type: String, required: true, trim: true, maxlength: 500 },
    likes:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    replies: [ReplySchema],
  },
  { timestamps: true }
);

// ── Reel schema ───────────────────────────────────────────────────────────────
const ReelSchema = new mongoose.Schema(
  {
    // Uploader
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
      required: true,
      index: true,
    },

    // Video content
    videoUrl:     { type: String, required: true },   // Firebase Storage URL
    thumbnailUrl: { type: String, default: null },    // auto-generated or manual
    caption:      { type: String, trim: true, maxlength: 2200, default: '' },
    hashtags:     [{ type: String, lowercase: true, trim: true }],

    // Duration bucket
    duration: {
      type:    Number,
      enum:    [15, 30, 60],
      required: true,
    },

    // Engagement
    views:    { type: Number, default: 0, min: 0 },
    viewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // per-user view dedup
    likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    saves:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    shares:   { type: Number, default: 0, min: 0 },
    sharesBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], // per-user share dedup
    comments: [CommentSchema],

    // Linked in-app item (product / job / service / franchise)
    linkedItem: {
      type:     { type: String, enum: ['product', 'job', 'service', 'franchise'], default: null },
      itemId:   { type: mongoose.Schema.Types.ObjectId, default: null },
      title:    { type: String, trim: true, default: '' },
      imageUrl: { type: String, default: null },
      price:    { type: String, default: null },   // formatted string e.g. "₹499"
      ctaLabel: { type: String, default: null },   // "Shop Now" / "Apply" / "Book"
    },

    // Moderation
    isActive:   { type: Boolean, default: true },
    isReported: { type: Boolean, default: false },
    reportCount:{ type: Number,  default: 0 },

    // Extended report tracking
    reports: [
      {
        user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        reason:    {
          type: String,
          enum: ['copyright_violation', 'spam', 'offensive_content', 'harassment', 'nudity', 'violence', 'misinformation', 'other'],
          required: true,
        },
        details:   { type: String, trim: true, maxlength: 500, default: '' },
        reportedAt:{ type: Date, default: Date.now },
        status:    { type: String, enum: ['pending', 'reviewed', 'actioned', 'dismissed'], default: 'pending' },
      },
    ],
    reportedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],  // unique reporters set

    // Hidden status
    hiddenStatus: {
      type: String,
      enum: ['visible', 'hidden_by_user', 'hidden_by_admin', 'removed'],
      default: 'visible',
    },
    hiddenAt:    { type: Date, default: null },
    hiddenBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    removalReason: { type: String, default: null },

    // Blocked users (users who blocked this reel's creator)
    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Admin moderation
    moderationStatus: {
      type: String,
      enum: ['clean', 'flagged', 'under_review', 'actioned'],
      default: 'clean',
    },
    moderationNotes: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true },
    toObject:   { virtuals: true },
  }
);

// ── Virtuals ──────────────────────────────────────────────────────────────────
ReelSchema.virtual('likesCount').get(function () {
  return this.likes.length;
});
ReelSchema.virtual('savesCount').get(function () {
  return this.saves.length;
});
ReelSchema.virtual('commentsCount').get(function () {
  return this.comments.length;
});

// ── Indexes ───────────────────────────────────────────────────────────────────
ReelSchema.index({ createdAt: -1 });
ReelSchema.index({ hashtags: 1 });
ReelSchema.index({ views: -1 });

module.exports = mongoose.model('Reel', ReelSchema);
