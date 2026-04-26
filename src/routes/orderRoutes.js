const express = require('express');
const router = express.Router();

const {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  getSellerOrders,
  updateOrderStatus,
  getAllOrders,
} = require('../controllers/orderController');

const { protect, authorize } = require('../middleware/auth');

// Everything requires auth
router.use(protect);

// ---- Specific paths BEFORE :id ----
router.get('/my-orders', getMyOrders);
router.get('/seller',    authorize('vendor', 'admin', 'superadmin'), getSellerOrders);

// ---- Admin listing ----
router.get('/', authorize('admin', 'superadmin'), getAllOrders);

// ---- Place a new order ----
router.post('/', createOrder);

// ---- Single order ----
router.get('/:id',           getOrder);
router.post('/:id/cancel',   cancelOrder);
router.patch('/:id/status',  updateOrderStatus);

module.exports = router;
