const mongoose = require('mongoose');

// ── Comment sub-schema ────────────────────────────────────────────────────────
const CommentSchema = new mongoose.Schema(
  {
    user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text:    { type: String, required: true, trim: true, maxlength: 500 },
    likes:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
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
    likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    saves:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    shares:   { type: Number, default: 0, min: 0 },
    comments: [CommentSchema],

    // Moderation
    isActive:   { type: Boolean, default: true },
    isReported: { type: Boolean, default: false },
    reportCount:{ type: Number,  default: 0 },
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
