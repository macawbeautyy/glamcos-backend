/**
 * AdminBadgeView — tracks when an admin last viewed each sidebar badge
 * category (franchise-inquiries, salon-space-inquiries, etc).
 *
 * Sidebar badges count "needs attention" items (e.g. FranchiseInquiry docs
 * with status:'new'). Without this, the badge only clears once an admin
 * changes an item's status one-by-one, so it can stay stuck at a stale
 * number even after the admin has seen everything. Opening the relevant
 * admin page marks that key as "viewed now" (see markBadgeViewed), and
 * getAdminBadgeCounts only counts items created AFTER that timestamp —
 * so the badge clears on view, then climbs again only for genuinely new
 * items that arrive afterward.
 */
const mongoose = require('mongoose');

const AdminBadgeViewSchema = new mongoose.Schema(
  {
    key:      { type: String, required: true, unique: true, index: true },
    viewedAt: { type: Date, default: () => new Date(0) },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminBadgeView', AdminBadgeViewSchema);
