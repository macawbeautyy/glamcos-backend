const express    = require('express');
const router     = express.Router();
const FranchiseInquiry = require('../models/FranchiseInquiry');
const FranchiseListing = require('../models/FranchiseListing');
const { protect, authorize } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════
//  LISTINGS — user-submitted franchise opportunities (approval required)
// ══════════════════════════════════════════════════════════

// GET  /franchise/listings          — public, approved only
router.get('/listings', async (req, res) => {
  try {
    const { tier } = req.query;
    const filter = { status: 'approved' };
    if (tier && tier !== 'all') filter.tier = tier;

    const listings = await FranchiseListing.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET  /franchise/listings/mine     — user's own submissions
router.get('/listings/mine', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const listings = await FranchiseListing.find({ owner: userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET  /franchise/listings/admin    — admin: all listings
router.get('/listings/admin', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const listings = await FranchiseListing.find(filter)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /franchise/listings          — authenticated user submits a franchise listing
router.post('/listings', protect, async (req, res) => {
  try {
    const {
      franchiseName, tagline, description, category, tier,
      investmentMin, investmentMax, roi, breakEven,
      city, locationsAvail, support, images,
      brochureUrl, brochureName,
      contactName, contactPhone, contactEmail,
    } = req.body;
    if (!franchiseName || !contactPhone) {
      return res.status(400).json({ success: false, message: 'franchiseName and contactPhone are required' });
    }
    const listing = await FranchiseListing.create({
      franchiseName, tagline, description, category, tier,
      investmentMin, investmentMax, roi, breakEven,
      city, locationsAvail, support, images,
      brochureUrl, brochureName,
      contactName, contactPhone, contactEmail,
      owner: req.user?._id || req.user?.id,
    });
    res.status(201).json({ success: true, data: listing });
    require('../services/whatsappNotify').sendWhatsAppAlert(
      `🤝 New Franchise listing submitted\n${franchiseName}${city ? ` · 📍 ${city}` : ''}\n📞 ${contactPhone}`
    ).catch(() => {});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/listings/mine/:id — owner edits their own listing.
// If it was already approved, editing drops it back to "pending" so admin
// re-reviews the new content before it goes live again. Note: this is an
// in-place update, so the listing disappears from the public "approved"
// list immediately until admin re-approves — it does NOT stay live with
// the old content while the edit is under review (that would need a
// separate draft/versioning system, which doesn't exist here).
router.patch('/listings/mine/:id', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const existing = await FranchiseListing.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (String(existing.owner) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'You can only edit your own listing' });
    }

    const {
      franchiseName, tagline, description, category, tier,
      investmentMin, investmentMax, roi, breakEven,
      city, locationsAvail, support, images,
      brochureUrl, brochureName,
      contactName, contactPhone, contactEmail,
    } = req.body;
    if (!franchiseName || !contactPhone) {
      return res.status(400).json({ success: false, message: 'franchiseName and contactPhone are required' });
    }

    const wasApproved = existing.status === 'approved';
    const update = {
      franchiseName, tagline, description, category, tier,
      investmentMin, investmentMax, roi, breakEven,
      city, locationsAvail, support, images,
      brochureUrl, brochureName,
      contactName, contactPhone, contactEmail,
      adminNote: '',
    };
    if (wasApproved) {
      update.status = 'pending';
      update.wasApprovedBeforeEdit = true;
    }

    const listing = await FranchiseListing.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    res.json({ success: true, data: listing });
    if (wasApproved) {
      require('../services/whatsappNotify').sendWhatsAppAlert(
        `✏️ Franchise listing edited & needs re-review\n${franchiseName}${city ? ` · 📍 ${city}` : ''}`
      ).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/listings/:id/status — admin approve/reject
router.patch('/listings/:id/status', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const listing = await FranchiseListing.findByIdAndUpdate(
      req.params.id,
      { $set: { status, adminNote: adminNote || '' } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, data: listing });

    if (listing.owner) {
      const { Notif } = require('../services/notifications');
      if (status === 'approved') {
        Notif.franchiseListingApproved(listing.owner, { businessName: listing.franchiseName }).catch(() => {});
      } else if (status === 'rejected') {
        Notif.franchiseListingRejected(listing.owner, { businessName: listing.franchiseName, reason: adminNote }).catch(() => {});
      }
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/listings/:id — admin full edit
router.patch('/listings/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const listing = await FranchiseListing.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, data: listing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /franchise/listings/mine/:id — owner deletes their own listing
router.delete('/listings/mine/:id', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const existing = await FranchiseListing.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (String(existing.owner) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'You can only delete your own listing' });
    }
    await FranchiseListing.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /franchise/listings/:id — admin delete
router.delete('/listings/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    await FranchiseListing.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  INQUIRIES — contact requests
// ══════════════════════════════════════════════════════════

// POST /franchise/inquiries — authenticated users
router.post('/inquiries', protect, async (req, res) => {
  try {
    const { franchiseId, franchiseName, name, phone, email, city, message, budget, timeline } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'name and phone are required' });
    }
    const inquiry = await FranchiseInquiry.create({
      franchiseId, franchiseName, name, phone, email, city, message, budget, timeline,
      user: req.user?._id || req.user?.id || null,
    });
    res.status(201).json({ success: true, data: inquiry });
    require('../services/whatsappNotify').sendWhatsAppAlert(
      `📩 New Franchise inquiry\n${name}${franchiseName ? ` · ${franchiseName}` : ''}${budget ? ` · Budget: ${budget}` : ''}${timeline ? ` · Timeline: ${timeline}` : ''}\n📞 ${phone}`
    ).catch(() => {});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /franchise/my-inquiries — user's own inquiries
router.get('/my-inquiries', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const inquiries = await FranchiseInquiry.find({ user: userId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /franchise/inquiries — admin only
router.get('/inquiries', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const inquiries = await FranchiseInquiry.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/inquiries/:id — admin only
router.patch('/inquiries/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const inquiry = await FranchiseInquiry.findByIdAndUpdate(
      req.params.id,
      { $set: { status, adminNote } },
      { new: true }
    );
    res.json({ success: true, data: inquiry });

    if (inquiry?.user && status) {
      const { Notif } = require('../services/notifications');
      Notif.inquiryStatusUpdated(inquiry.user, { subject: inquiry.franchiseName, status }).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
