const express = require('express');
const router  = express.Router();
const aiRoutes = require('./aiRoutes');

router.use('/auth',       require('./authRoutes'));
router.use('/categories', require('./categoryRoutes'));
router.use('/services',   require('./serviceRoutes'));
router.use('/products',   require('./productRoutes'));
router.use('/health',     require('./healthRoutes'));
router.use('/bookings',   require('./bookingRoutes'));
router.use('/stylists',   require('./stylistRoutes'));
router.use('/banners',    require('./bannerRoutes'));

// ── Phase 2 routes ──────────────────────────────────────────────────────────
router.use('/providers',  require('./providerRoutes'));
router.use('/loyalty',    require('./loyaltyRoutes'));

// ── Phase 3 routes ──────────────────────────────────────────────────────────
router.use('/jobs',       require('./jobRoutes'));
router.use('/job-registration', require('./jobRegistrationRoutes'));

// ── Phase 4: Marketplace ─────────────────────────────────────────────────────
router.use('/cart',         require('./cartRoutes'));
router.use('/orders',       require('./orderRoutes'));
router.use('/payments',     require('./paymentRoutes'));
router.use('/reviews',      require('./reviewRoutes'));
router.use('/sellers',      require('./sellerRoutes'));
router.use('/ai', aiRoutes);

// ── Phase 5: Franchise & Salon Spaces ────────────────────────────────────────
router.use('/franchise',     require('./franchiseRoutes'));
router.use('/salon-spaces',  require('./salonSpaceRoutes'));

// ── Phase 6: Salon Partner Program ───────────────────────────────────────────
router.use('/salon-partners',      require('./salonPartnerRoutes'));
router.use('/salon-appointments',  require('./salonAppointmentRoutes'));

// ── Support Chat ──────────────────────────────────────────────────────────────
router.use('/support',             require('./supportRoutes'));

// ── Admin Notifications ───────────────────────────────────────────────────────
router.use('/notifications',       require('./notificationRoutes'));

// ── Phase 7: Explore / Reels ──────────────────────────────────────────────────
router.use('/reels',               require('./reelRoutes'));


module.exports = router;
