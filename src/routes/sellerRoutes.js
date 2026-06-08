/**
 * sellerRoutes — /api/v1/sellers
 */
const express = require('express');
const router  = express.Router();
const {
  // Legacy / existing
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
  // New onboarding
  verifyGST,
  lookupIFSC,
  saveOnboardingStep,
  uploadDocument,
  submitOnboarding,
  // New admin
  adminRequestChanges,
  adminReviewDocument,
  adminApproveProduct,
  adminRejectProduct,
  adminRequestProductChanges,
  adminGetPendingProducts,
} = require('../controllers/sellerController');
const { protect, authorize } = require('../middleware/auth');

// ── Public utilities ───────────────────────────────────────────────────────────
router.get('/ifsc/:ifsc', lookupIFSC);  // no auth needed

// ── Onboarding ────────────────────────────────────────────────────────────────
router.post('/verify-gst',          protect, verifyGST);
router.post('/onboarding/step',     protect, saveOnboardingStep);
router.post('/onboarding/document/:docType', protect, uploadDocument);
router.post('/onboarding/submit',   protect, submitOnboarding);

// ── Seller (own) routes ────────────────────────────────────────────────────────
router.post('/register',   protect, registerSeller);
router.get('/me',          protect, getMySeller);
router.put('/me',          protect, updateMySeller);
router.get('/dashboard',   protect, getSellerDashboard);

// ── Admin — Sellers ───────────────────────────────────────────────────────────
router.get('/admin/all',                    protect, authorize('admin', 'superadmin'), adminGetSellers);
router.put('/admin/:id/approve',            protect, authorize('admin', 'superadmin'), adminApproveSeller);
router.put('/admin/:id/reject',             protect, authorize('admin', 'superadmin'), adminRejectSeller);
router.patch('/admin/:id/status',           protect, authorize('admin', 'superadmin'), adminUpdateSellerStatus);
router.patch('/admin/:id/request-changes',  protect, authorize('admin', 'superadmin'), adminRequestChanges);
router.patch('/admin/:sellerId/document/:docType', protect, authorize('admin', 'superadmin'), adminReviewDocument);
router.get('/admin/orders',                 protect, authorize('admin', 'superadmin'), adminGetMarketplaceOrders);
router.get('/admin/:sellerId/products',     protect, authorize('admin', 'superadmin'), adminGetSellerProducts);

// ── Admin — Products ──────────────────────────────────────────────────────────
router.get('/admin/products/pending',                    protect, authorize('admin', 'superadmin'), adminGetPendingProducts);
router.patch('/admin/products/:productId/approve',       protect, authorize('admin', 'superadmin'), adminApproveProduct);
router.patch('/admin/products/:productId/reject',        protect, authorize('admin', 'superadmin'), adminRejectProduct);
router.patch('/admin/products/:productId/request-changes', protect, authorize('admin', 'superadmin'), adminRequestProductChanges);

module.exports = router;
