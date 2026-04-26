const express = require('express');
const router  = express.Router();

const {
  applyAsProvider,
  submitKYC,
  submitBankDetails,
  getMyProviderProfile,
  updateAvailability,
  getProviderDashboard,
  getProviderEarnings,
  getPendingProviders,
  getAllProviders,
  approveProvider,
  rejectProvider,
  getProviderStatus,
  switchMode,
  acknowledgeProviderWelcome,
} = require('../controllers/providerController');

const { protect, authorize } = require('../middleware/auth');

// ── User / Provider routes ────────────────────────────────────────────────────
router.post('/apply',              protect, applyAsProvider);
router.post('/kyc',                protect, submitKYC);
router.post('/bank',               protect, submitBankDetails);
router.get('/me',                  protect, getMyProviderProfile);
router.put('/availability',        protect, updateAvailability);
router.get('/dashboard',           protect, getProviderDashboard);
router.get('/earnings',            protect, getProviderEarnings);

// ── Dual-Role System routes ───────────────────────────────────────────────────
router.get('/status',              protect, getProviderStatus);
router.put('/switch-mode',         protect, switchMode);
router.put('/acknowledge-welcome', protect, acknowledgeProviderWelcome);

// ── Admin routes ──────────────────────────────────────────────────────────────
// GET /admin/pending  – only pending/kyc_pending (backward compat)
router.get('/admin/pending',       protect, authorize('admin', 'superadmin'), getPendingProviders);
// GET /admin/all      – all providers, filterable by ?status=pending|active|rejected|all
router.get('/admin/all',           protect, authorize('admin', 'superadmin'), getAllProviders);
// Approve / Reject
router.put('/admin/:id/approve',   protect, authorize('admin', 'superadmin'), approveProvider);
router.put('/admin/:id/reject',    protect, authorize('admin', 'superadmin'), rejectProvider);

module.exports = router;
