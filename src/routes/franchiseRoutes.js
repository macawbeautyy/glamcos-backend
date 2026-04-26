const express    = require('express');
const router     = express.Router();
const FranchiseInquiry = require('../models/FranchiseInquiry');
const { protect, authorize } = require('../middleware/auth');

// POST /franchise/inquiries  — any user (public)
router.post('/inquiries', async (req, res) => {
  try {
    const { franchiseId, franchiseName, name, phone, email, city, message } = req.body;
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'name and phone are required' });
    }
    const inquiry = await FranchiseInquiry.create({ franchiseId, franchiseName, name, phone, email, city, message });
    res.status(201).json({ success: true, data: inquiry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /franchise/inquiries   — admin only
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
