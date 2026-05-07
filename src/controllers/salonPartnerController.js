const SalonPartner = require('../models/SalonPartner');

// POST /api/v1/salon-partners  — submit application
exports.apply = async (req, res) => {
  try {
    const {
      ownerName, phone, email, salonName, yearsOld,
      address, city, pincode, avgMonthlySale,
      seatingCapacity, hasGst, gstNumber, services, enableBooking,
    } = req.body;

    // Prevent duplicate pending applications from same phone
    const existing = await SalonPartner.findOne({ phone, status: 'pending' });
    if (existing) {
      return res.status(409).json({ message: 'An application from this phone number is already under review.' });
    }

    const partner = await SalonPartner.create({
      ownerName, phone, email, salonName, yearsOld,
      address, city, pincode, avgMonthlySale,
      seatingCapacity, hasGst, gstNumber, services,
      enableBooking,
      userId: req.user?._id,
    });

    res.status(201).json({ message: 'Application submitted successfully!', partner });
  } catch (err) {
    console.error('SalonPartner apply error:', err);
    res.status(500).json({ message: 'Server error. Please try again.' });
  }
};

// GET /api/v1/salon-partners/my  — check own status
exports.myStatus = async (req, res) => {
  try {
    const partner = await SalonPartner.findOne({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json({ partner: partner || null });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// ── Admin routes ──────────────────────────────────────────────────────────────

// GET /api/v1/salon-partners  — list all (admin)
exports.list = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const partners = await SalonPartner.find(filter).sort({ createdAt: -1 });
    res.json({ partners });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};

// PATCH /api/v1/salon-partners/:id/status  — approve/reject (admin)
exports.updateStatus = async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }
    const partner = await SalonPartner.findByIdAndUpdate(
      req.params.id,
      { status, adminNote, reviewedAt: new Date(), reviewedBy: req.user._id },
      { new: true }
    );
    if (!partner) return res.status(404).json({ message: 'Application not found.' });
    res.json({ message: `Application ${status}.`, partner });
  } catch (err) {
    res.status(500).json({ message: 'Server error.' });
  }
};
