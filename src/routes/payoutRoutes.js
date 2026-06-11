/**
 * payoutRoutes — /api/v1/payouts
 * Seller wallet + payout requests, admin payout management, settings, reports.
 */
const express = require('express');
const router  = express.Router();

const {
  getMyWallet,
  getMyLedger,
  createPayoutRequest,
  getMyPayoutRequests,
  getMyReports,
  adminGetPayoutRequests,
  adminApprovePayout,
  adminRejectPayout,
  adminMarkPayoutPaid,
  adminGetSellerLedger,
  adminGetSellerWallet,
  adminGetBankDetails,
  adminUpdateSellerBank,
  adminCreateAdjustment,
  adminGetSettings,
  adminUpdateSettings,
  adminGetReports,
  adminGetAuditLogs,
} = require('../controllers/payoutController');

const { protect, authorize } = require('../middleware/auth');

router.use(protect);
const admin = authorize('admin', 'superadmin');

// ── Seller ────────────────────────────────────────────────────────────────────
router.get('/wallet',    getMyWallet);
router.get('/ledger',    getMyLedger);
router.post('/request',  createPayoutRequest);
router.get('/requests',  getMyPayoutRequests);
router.get('/reports',   getMyReports);

// ── Admin: payout requests ───────────────────────────────────────────────────
router.get('/admin/requests',              admin, adminGetPayoutRequests);
router.patch('/admin/requests/:id/approve', admin, adminApprovePayout);
router.patch('/admin/requests/:id/reject',  admin, adminRejectPayout);
router.patch('/admin/requests/:id/paid',    admin, adminMarkPayoutPaid);

// ── Admin: seller wallets / ledgers / bank ───────────────────────────────────
router.get('/admin/bank-details',                admin, adminGetBankDetails);
router.get('/admin/sellers/:sellerId/ledger',    admin, adminGetSellerLedger);
router.get('/admin/sellers/:sellerId/wallet',    admin, adminGetSellerWallet);
router.patch('/admin/sellers/:sellerId/bank',    admin, adminUpdateSellerBank);
router.post('/admin/sellers/:sellerId/adjustment', admin, adminCreateAdjustment);

// ── Admin: settings + reports + audit ────────────────────────────────────────
router.get('/admin/settings',   admin, adminGetSettings);
router.put('/admin/settings',   admin, adminUpdateSettings);
router.get('/admin/reports',    admin, adminGetReports);
router.get('/admin/audit-logs', admin, adminGetAuditLogs);

module.exports = router;
