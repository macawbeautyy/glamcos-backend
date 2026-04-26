/**
 * sellerRoutes — /api/v1/sellers
 */
const express = require('express');
const router  = express.Router();
const {
  registerSeller,
  getMySeller,
  updateMySeller,
  getSellerDashboard,
  adminGetSellers,
  adminApproveSeller,
  adminRejectSeller,
  adminUpdateSellerStatus,
  adminGetMarketplaceOrders,
  adminGetSellerProducts,
} = require('../controllers/sellerController');
const { protect, authorize } = require('../middleware/auth');

// ── Seller (own) routes ────────────────────────────────────────────────────────
router.post('/register',   protect, registerSeller);
router.get('/me',          protect, getMySeller);
router.put('/me',          protect, updateMySeller);
router.get('/dashboard',   protect, getSellerDashboard);

// ── Admin routes ───────────────────────────────────────────────────────────────
router.get('/admin/all',            protect, authorize('admin', 'superadmin'), adminGetSellers);
router.put('/admin/:id/approve',    protect, authorize('admin', 'superadmin'), adminApproveSeller);
router.put('/admin/:id/reject',     protect, authorize('admin', 'superadmin'), adminRejectSeller);
router.patch('/admin/:id/status',   protect, authorize('admin', 'superadmin'), adminUpdateSellerStatus);
router.get('/admin/orders',         protect, authorize('admin', 'superadmin'), adminGetMarketplaceOrders);
router.get('/admin/:sellerId/products', protect, authorize('admin', 'superadmin'), adminGetSellerProducts);

module.exports = router;
