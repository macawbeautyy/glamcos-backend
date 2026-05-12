const mongoose = require('mongoose');

const FollowSchema = new mongoose.Schema(
  {
    follower:  {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    following: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Each pair must be unique
FollowSchema.index({ follower: 1, following: 1 }, { unique: true });
FollowSchema.index({ following: 1 });   // fast "who follows me" lookup
FollowSchema.index({ follower: 1 });    // fast "who am I following" lookup

module.exports = mongoose.model('Follow', FollowSchema);
