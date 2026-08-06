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
router.get('/listings/admin', protect, authorize('admin', 'superadmin'), async (req, res) => {
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

// Fields accepted from the client for both create and owner-edit — kept as
// one list so the two routes can't silently drift apart.
const LISTING_FIELDS = [
  'title', 'description', 'category', 'spaceType', 'listingType', 'saleScope',
  'address', 'landmark', 'city', 'pincode', 'area', 'location',
  'areaUnit', 'carpetAreaSqft', 'builtupAreaSqft', 'floor', 'totalFloors', 'furnishing',
  'washrooms', 'parking', 'powerBackupKW', 'frontageWidthFt', 'amenities',
  'chairs', 'treatmentRooms', 'equipment', 'staffCount', 'staffStaying',
  'brandAffiliation', 'licenses', 'yearsInOperation', 'monthlyRevenue',
  'reasonForSelling',
  'askingPrice', 'negotiable', 'ownershipType', 'possessionStatus',
  'monthlyRent', 'securityDeposit', 'maintenanceCharges', 'lockInMonths',
  'leaseTenureYears', 'availableFrom', 'subLeasePermitted',
  'images', 'videos',
  'contactName', 'contactPhone', 'contactEmail',
];

function pickListingFields(body) {
  const out = {};
  for (const f of LISTING_FIELDS) {
    if (body[f] !== undefined) out[f] = body[f];
  }
  // Keep the legacy `price` field in sync so old sort/filter code keeps working.
  out.price = body.listingType === 'sale' ? (Number(body.askingPrice) || 0) : (Number(body.monthlyRent) || 0);
  return out;
}

// POST /salon-spaces/listings          — authenticated user submits a listing
router.post('/listings', protect, async (req, res) => {
  try {
    const data = pickListingFields(req.body);
    if (!data.title || !req.body.contactPhone) {
      return res.status(400).json({ success: false, message: 'title and contactPhone are required' });
    }
    const listing = await SalonSpaceListing.create({
      ...data,
      owner: req.user?._id || req.user?.id,
    });
    res.status(201).json({ success: true, data: listing });
    require('../services/whatsappNotify').sendWhatsAppAlert(
      `🏠 New Salon Space listing submitted\n${data.title}${data.city ? ` · 📍 ${data.city}` : ''}\n📞 ${data.contactPhone}`
    ).catch(() => {});
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /salon-spaces/listings/mine/:id — owner edits their own listing.
// If it was already approved, editing drops it back to "pending" so admin
// re-reviews the new content before it goes live again (same policy as
// FranchiseListing — an in-place update, no draft/versioning system, so the
// listing disappears from the public "approved" list immediately until
// admin re-approves it).
router.patch('/listings/mine/:id', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const existing = await SalonSpaceListing.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (String(existing.owner) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'You can only edit your own listing' });
    }

    const data = pickListingFields(req.body);
    if (!data.title || !req.body.contactPhone) {
      return res.status(400).json({ success: false, message: 'title and contactPhone are required' });
    }

    const wasApproved = existing.status === 'approved';
    const update = { ...data, adminNote: '' };
    if (wasApproved) {
      update.status = 'pending';
      update.wasApprovedBeforeEdit = true;
    }

    const listing = await SalonSpaceListing.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    res.json({ success: true, data: listing });
    if (wasApproved) {
      require('../services/whatsappNotify').sendWhatsAppAlert(
        `✏️ Salon Space listing edited & needs re-review\n${data.title}${data.city ? ` · 📍 ${data.city}` : ''}`
      ).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /salon-spaces/listings/mine/:id — owner deletes their own listing
router.delete('/listings/mine/:id', protect, async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const existing = await SalonSpaceListing.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Listing not found' });
    if (String(existing.owner) !== String(userId)) {
      return res.status(403).json({ success: false, message: 'You can only delete your own listing' });
    }
    await SalonSpaceListing.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /salon-spaces/listings/:id/status — admin approve/reject
router.patch('/listings/:id/status', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const listing = await SalonSpaceListing.findByIdAndUpdate(
      req.params.id,
      { $set: { status, adminNote: adminNote || '' } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ success: false, message: 'Listing not found' });
    res.json({ success: true, data: listing });

    if (listing.owner) {
      const { Notif } = require('../services/notifications');
      if (status === 'approved') {
        Notif.salonSpaceListingApproved(listing.owner, { title: listing.title }).catch(() => {});
      } else if (status === 'rejected') {
        Notif.salonSpaceListingRejected(listing.owner, { title: listing.title, reason: adminNote }).catch(() => {});
      }
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /salon-spaces/listings/:id — admin full edit
router.patch('/listings/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
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
router.delete('/listings/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
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
    require('../services/whatsappNotify').sendWhatsAppAlert(
      `📩 New Salon Space inquiry\n${name}${spaceTitle ? ` · ${spaceTitle}` : ''}\n📞 ${phone}`
    ).catch(() => {});
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
router.get('/inquiries', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const inquiries = await SalonSpaceInquiry.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: inquiries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /salon-spaces/inquiries/:id — admin only
router.patch('/inquiries/:id', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const inquiry = await SalonSpaceInquiry.findByIdAndUpdate(
      req.params.id,
      { $set: { status, adminNote } },
      { new: true }
    );
    res.json({ success: true, data: inquiry });

    if (inquiry?.user && status) {
      const { Notif } = require('../services/notifications');
      Notif.inquiryStatusUpdated(inquiry.user, { subject: inquiry.spaceTitle, status }).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
