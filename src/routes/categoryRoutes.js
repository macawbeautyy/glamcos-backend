const express = require('express');
const router = express.Router();

const {
  getCategories,
  getCategoryTree,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
} = require('../controllers/categoryController');

const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { readLimiter } = require('../middleware/rateLimiter');

// ---- Validation Rules ----

const createCategoryValidation = validate([
  { field: 'name', type: 'string', required: true, min: 2, max: 80, label: 'Category name' },
  { field: 'description', type: 'string', required: false, max: 500 },
  { field: 'type', type: 'enum', required: false, values: ['service', 'product', 'both'] },
  { field: 'parent', type: 'mongoId', required: false, label: 'Parent category' },
]);

const updateCategoryValidation = validate([
  { field: 'name', type: 'string', required: false, min: 2, max: 80, label: 'Category name' },
  { field: 'description', type: 'string', required: false, max: 500 },
  { field: 'type', type: 'enum', required: false, values: ['service', 'product', 'both'] },
  { field: 'parent', type: 'mongoId', required: false, label: 'Parent category' },
]);

// ---- Public Routes ----
router.get('/', readLimiter, optionalAuth, getCategories);
router.get('/tree', readLimiter, getCategoryTree);
router.get('/:id', readLimiter, optionalAuth, getCategory);

// ---- Admin Routes ----
router.post(
  '/',
  protect,
  authorize('admin', 'superadmin'),
  createCategoryValidation,
  createCategory
);

router.put(
  '/:id',
  protect,
  authorize('admin', 'superadmin'),
  updateCategoryValidation,
  updateCategory
);

router.delete(
  '/:id',
  protect,
  authorize('admin', 'superadmin'),
  deleteCategory
);

module.exports = router;
