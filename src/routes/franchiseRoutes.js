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
router.get('/listings/admin', protect, authorize('admin'), async (req, res) => {
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
      city, locationsAvail, support,
      contactName, contactPhone, contactEmail,
    } = req.body;
    if (!franchiseName || !contactPhone) {
      return res.status(400).json({ success: false, message: 'franchiseName and contactPhone are required' });
    }
    const listing = await FranchiseListing.create({
      franchiseName, tagline, description, category, tier,
      investmentMin, investmentMax, roi, breakEven,
      city, locationsAvail, support,
      contactName, contactPhone, contactEmail,
      owner: req.user?._id || req.user?.id,
    });
    res.status(201).json({ success: true, data: listing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/listings/:id/status — admin approve/reject
router.patch('/listings/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const listing = await FranchiseListing.findByIdAndUpdate(
      req.params.id,
      { $set: { status, adminNote: adminNote || '' } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, data: listing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/listings/:id — admin full edit
router.patch('/listings/:id', protect, authorize('admin'), async (req, res) => {
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

// DELETE /franchise/listings/:id — admin delete
router.delete('/listings/:id', protect, authorize('admin'), async (req, res) => {
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
    const { franchiseId, franchiseName, name, phone, email, city, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'name and phone are required' });
    }
    const inquiry = await FranchiseInquiry.create({
      franchiseId, franchiseName, name, phone, email, city, message,
      user: req.user?._id || req.user?.id || null,
    });
    res.status(201).json({ success: true, data: inquiry });
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
router.get('/inquiries', protect, authorize('admin'), async (req, res) => {
  try {
    const inquiries = await FranchiseInquiry.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /franchise/inquiries/:id — admin only
router.patch('/inquiries/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const inquiry = await FranchiseInquiry.findByIdAndUpdate(
      req.params.id,
      { $set: { status, adminNote } },
      { new: true }
    );
    res.json({ success: true, data: inquiry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
