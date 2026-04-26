const express = require('express');
const router = express.Router();

const {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  applyCoupon,
  removeCoupon,
} = require('../controllers/cartController');

const { protect } = require('../middleware/auth');

// All cart routes require a logged-in user
router.use(protect);

router.get('/',               getCart);
router.delete('/',            clearCart);

router.post('/items',         addItem);
router.patch('/items/:itemId', updateItem);
router.delete('/items/:itemId', removeItem);

router.post('/coupon',        applyCoupon);
router.delete('/coupon',      removeCoupon);

module.exports = router;
