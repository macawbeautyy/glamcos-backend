const express    = require('express');
const router     = express.Router();
const SalonSpaceInquiry = require('../models/SalonSpaceInquiry');
const SalonSpaceListing = require('../models/SalonSpaceListing');
const { protect, authorize } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════
//  LISTINGS — user-submitted spaces that go through approval
// ══════════════════════════════════════════════════════════

// GET  /salon-spaces/listings          — public, approved only
router.get('/listings', async (req, res) => {
  try {
    const { city, spaceType, listingType, priceMax } = req.query;
    const filter = { status: 'approved' };
    if (city)        filter.city        = new RegExp(city, 'i');
    if (spaceType)   filter.spaceType   = spaceType;
    if (listingType) filter.listingType = listingType;
    if (priceMax)    filter.price       = { $lte: Number(priceMax) };

    const listings = await SalonSpaceListing.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET  /salon-spaces/listings/mine     — user's own submissions (any status)
router.get('/listings/mine', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const listings = await SalonSpaceListing.find({ owner: userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET  /salon-spaces/listings/admin    — admin: all listings
router.get('/listings/admin', protect, authorize('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const listings = await SalonSpaceListing.find(filter)
      .populate('owner', 'name email phone')
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: listings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /salon-spaces/listings          — authenticated user submits a listing
router.post('/listings', protect, async (req, res) => {
  try {
    const {
      title, description, spaceType, listingType, price,
      area, city, address, amenities,
      contactName, contactPhone, contactEmail,
    } = req.body;
    if (!title || !contactPhone) {
      return res.status(400).json({ success: false, message: 'title and contactPhone are required' });
    }
    const listing = await SalonSpaceListing.create({
      title, description, spaceType, listingType, price,
      area, city, address, amenities,
      contactName, contactPhone, contactEmail,
      owner: req.user?._id || req.user?.id,
    });
    res.status(201).json({ success: true, data: listing });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /salon-spaces/listings/:id/status — admin approve/reject
router.patch('/listings/:id/status', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const listing = await SalonSpaceListing.findByIdAndUpdate(
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

// PATCH /salon-spaces/listings/:id — admin full edit
router.patch('/listings/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const listing = await SalonSpaceListing.findByIdAndUpdate(
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

// DELETE /salon-spaces/listings/:id — admin delete
router.delete('/listings/:id', protect, authorize('admin'), async (req, res) => {
  try {
    await SalonSpaceListing.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════════
//  INQUIRIES — contact requests about a specific space
// ══════════════════════════════════════════════════════════

// POST /salon-spaces/inquiries — authenticated users
router.post('/inquiries', protect, async (req, res) => {
  try {
    const { spaceId, spaceTitle, name, phone, email, city, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'name and phone are required' });
    }
    const inquiry = await SalonSpaceInquiry.create({
      spaceId, spaceTitle, name, phone, email, city, message,
      user: req.user?._id || req.user?.id || null,
    });
    res.status(201).json({ success: true, data: inquiry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /salon-spaces/my-inquiries — user's own inquiries
router.get('/my-inquiries', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const inquiries = await SalonSpaceInquiry.find({ user: userId }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /salon-spaces/inquiries — admin only
router.get('/inquiries', protect, authorize('admin'), async (req, res) => {
  try {
    const inquiries = await SalonSpaceInquiry.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /salon-spaces/inquiries/:id — admin only
router.patch('/inquiries/:id', protect, authorize('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const inquiry = await SalonSpaceInquiry.findByIdAndUpdate(
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
