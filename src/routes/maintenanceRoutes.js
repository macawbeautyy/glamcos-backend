const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');

/**
 * DANGER ZONE — superadmin-only data purge.
 *
 * POST /api/v1/admin-maintenance/purge
 * Body: { collections: ['services','categories','orders','bookings','salonAppointments'],
 *         confirm: 'PURGE-GLAMCOS' }
 *
 * Each collection is wiped with deleteMany({}). Returns per-collection counts.
 * Guarded by: superadmin role + explicit confirm string.
 */
const MODEL_MAP = {
  services:          () => require('../models/Service'),
  categories:        () => require('../models/Category'),
  orders:            () => require('../models/Order'),
  bookings:          () => require('../models/Booking'),
  salonAppointments: () => require('../models/SalonAppointment'),
  carts:             () => require('../models/Cart'),
  reviews:           () => require('../models/Review'),
};

router.post('/purge', protect, authorize('superadmin'), async (req, res) => {
  try {
    const { collections, confirm } = req.body || {};
    if (confirm !== 'PURGE-GLAMCOS') {
      return res.status(400).json({ message: "Confirmation string missing. Pass confirm: 'PURGE-GLAMCOS'." });
    }
    if (!Array.isArray(collections) || collections.length === 0) {
      return res.status(400).json({ message: 'collections must be a non-empty array.', allowed: Object.keys(MODEL_MAP) });
    }
    const invalid = collections.filter((c) => !MODEL_MAP[c]);
    if (invalid.length) {
      return res.status(400).json({ message: `Unknown collections: ${invalid.join(', ')}`, allowed: Object.keys(MODEL_MAP) });
    }

    const results = {};
    for (const name of collections) {
      const Model = MODEL_MAP[name]();
      const { deletedCount } = await Model.deleteMany({});
      results[name] = deletedCount;
    }

    console.warn(`[MAINTENANCE] Purge by ${req.user.email}:`, results);
    res.json({ message: 'Purge complete.', deleted: results });
  } catch (err) {
    console.error('Purge error:', err);
    res.status(500).json({ message: 'Server error during purge.' });
  }
});

module.exports = router;
