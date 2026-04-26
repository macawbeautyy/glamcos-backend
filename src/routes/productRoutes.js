const express = require('express');
const router = express.Router();

const {
  getProducts,
  getMyProducts,
  getProduct,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
  approveProduct,
  rejectProduct,
  getPendingProducts,
  getAllProductsAdmin,
} = require('../controllers/productController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { readLimiter } = require('../middleware/rateLimiter');

// ---- Validation Rules ----

const createProductValidation = validate([
  { field: 'name', type: 'string', required: true, min: 3, max: 150, label: 'Product name' },
  { field: 'description', type: 'string', required: true, min: 10, max: 3000 },
  { field: 'category', type: 'mongoId', required: true },
  { field: 'price', type: 'number', required: true, min: 0 },
  { field: 'stock', type: 'number', required: true, min: 0 },
]);

const updateProductValidation = validate([
  { field: 'name', type: 'string', required: false, min: 3, max: 150, label: 'Product name' },
  { field: 'description', type: 'string', required: false, min: 10, max: 3000 },
  { field: 'category', type: 'mongoId', required: false },
  { field: 'price', type: 'number', required: false, min: 0 },
  { field: 'stock', type: 'number', required: false, min: 0 },
]);

const updateStockValidation = validate([
  { field: 'stock', type: 'number', required: true, min: 0 },
]);

// =========================================================
//  ROUTE ORDER MATTERS — specific paths BEFORE /:id params
// =========================================================

// ---- Public (list) ----
router.get('/', readLimiter, optionalAuth, getProducts);

// ---- Vendor (own products) — must be before /:id ----
router.get(
  '/dashboard/my-products',
  protect,
  authorize('vendor'),
  getMyProducts
);

// ---- Admin (pending queue) — must be before /:id ----
router.get(
  '/admin/pending',
  protect,
  authorize('admin', 'superadmin'),
  getPendingProducts
);

// ---- Admin (all products, any status) — must be before /:id ----
router.get(
  '/admin/all',
  protect,
  authorize('admin', 'superadmin'),
  getAllProductsAdmin
);

// ---- Public (single) — :id param comes AFTER specific paths ----
router.get('/:id', readLimiter, optionalAuth, getProduct);

// ---- Vendor CRUD ----
router.post(
  '/',
  protect,
  authorize('vendor'),
  createProductValidation,
  createProduct
);

router.put(
  '/:id',
  protect,
  authorize('vendor'),
  updateProductValidation,
  updateProduct
);

router.patch(
  '/:id/stock',
  protect,
  authorize('vendor'),
  updateStockValidation,
  updateStock
);

router.delete(
  '/:id',
  protect,
  authorize('vendor', 'admin', 'superadmin'),
  deleteProduct
);

// ---- Admin Actions ----
router.put(
  '/:id/approve',
  protect,
  authorize('admin', 'superadmin'),
  approveProduct
);

router.put(
  '/:id/reject',
  protect,
  authorize('admin', 'superadmin'),
  rejectProduct
);

module.exports = router;
