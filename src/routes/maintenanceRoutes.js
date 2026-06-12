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


/**
 * POST /api/v1/admin-maintenance/backfill-product-details
 * Body: { dryRun?: boolean }
 *
 * Fills missing PDP content (benefits, ingredients, how-to-use, safety,
 * specifications, short description, country of origin) for ALL products
 * that don't have it yet. Seller-provided content is never overwritten.
 */
router.post('/backfill-product-details', protect, authorize('admin', 'superadmin'), async (req, res) => {
  try {
    const Product = require('../models/Product');
    const { generateMissingDetails } = require('../services/productDetailGenerator');
    const dryRun = Boolean(req.body?.dryRun);

    const products = await Product.find({})
      .select('name brand description tags category shortDescription benefits howToUse ingredients activeIngredients safetyInstructions specifications countryOfOrigin weight volume sku')
      .populate('category', 'name');

    let updated = 0;
    const samples = [];
    for (const product of products) {
      const { bucket, updates } = generateMissingDetails(product);
      const keys = Object.keys(updates);
      if (keys.length === 0) continue;
      if (!dryRun) {
        await Product.updateOne({ _id: product._id }, { $set: updates });
      }
      updated += 1;
      if (samples.length < 10) samples.push({ id: product._id, name: product.name, bucket, fieldsFilled: keys });
    }

    return res.json({
      success: true,
      message: dryRun
        ? `Dry run: ${updated} of ${products.length} products would be updated`
        : `Filled missing details on ${updated} of ${products.length} products`,
      data: { totalProducts: products.length, updated, dryRun, samples },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
