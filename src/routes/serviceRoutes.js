const express = require('express');
const router = express.Router();

const {
  getServices,
  getMyServices,
  getService,
  createService,
  updateService,
  deleteService,
} = require('../controllers/serviceController');

const {
  getAllServicesAdmin,
  getPendingServices,
  createServiceAsAdmin,
  updateServiceAsAdmin,
  approveService,
  rejectService,
} = require('../controllers/serviceAdminController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { readLimiter } = require('../middleware/rateLimiter');

// ---- Validation Rules ----

const createServiceValidation = validate([
  { field: 'name', type: 'string', required: true, min: 3, max: 120, label: 'Service name' },
  { field: 'description', type: 'string', required: true, min: 10, max: 2000 },
  { field: 'category', type: 'mongoId', required: true },
  { field: 'price', type: 'number', required: true, min: 0 },
  { field: 'duration', type: 'number', required: true, min: 5, label: 'Duration (minutes)' },
  { field: 'priceType', type: 'enum', required: false, values: ['fixed', 'hourly', 'starting_at', 'custom'] },
  { field: 'serviceArea', type: 'enum', required: false, values: ['on_site', 'at_provider', 'remote', 'flexible'] },
]);

const updateServiceValidation = validate([
  { field: 'name', type: 'string', required: false, min: 3, max: 120, label: 'Service name' },
  { field: 'description', type: 'string', required: false, min: 10, max: 2000 },
  { field: 'category', type: 'mongoId', required: false },
  { field: 'price', type: 'number', required: false, min: 0 },
  { field: 'duration', type: 'number', required: false, min: 5, label: 'Duration (minutes)' },
]);

// =========================================================
//  ROUTE ORDER MATTERS — specific paths BEFORE /:id params
// =========================================================

// ---- Public (list) ----
router.get('/', readLimiter, optionalAuth, getServices);

// ---- Provider (own services) — must be before /:id ----
router.get(
  '/dashboard/my-services',
  protect,
  authorize('provider'),
  getMyServices
);

// ---- Admin: all services (no status filter) — must be before /:id ----
router.get(
  '/admin/all',
  protect,
  authorize('admin', 'superadmin'),
  getAllServicesAdmin
);

// ---- Admin (pending queue) — must be before /:id ----
router.get(
  '/admin/pending',
  protect,
  authorize('admin', 'superadmin'),
  getPendingServices
);

// ---- Admin direct service creation (auto-approved) — must be before /:id ----
router.post(
  '/admin/create',
  protect,
  authorize('admin', 'superadmin'),
  createServiceValidation,
  createServiceAsAdmin
);

// ---- Admin direct service update — must be before /:id ----
router.put(
  '/admin/:id',
  protect,
  authorize('admin', 'superadmin'),
  updateServiceAsAdmin
);

// ---- Public (single) — :id param comes AFTER specific paths ----
router.get('/:id', readLimiter, optionalAuth, getService);

// ---- Provider CRUD ----
router.post(
  '/',
  protect,
  authorize('provider'),
  createServiceValidation,
  createService
);

router.put(
  '/:id',
  protect,
  authorize('provider'),
  updateServiceValidation,
  updateService
);

router.delete(
  '/:id',
  protect,
  authorize('provider', 'admin', 'superadmin'),
  deleteService
);

// ---- Admin Actions ----
router.put(
  '/:id/approve',
  protect,
  authorize('admin', 'superadmin'),
  approveService
);

router.put(
  '/:id/reject',
  protect,
  authorize('admin', 'superadmin'),
  rejectService
);

module.exports = router;
