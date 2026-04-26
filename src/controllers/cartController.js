const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Find-or-create the current user's cart.
 */
async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

/**
 * Load a cart with its product references populated, so the
 * frontend can display fresh stock / status info.
 */
async function populatedCart(userId) {
  return Cart.findOne({ user: userId })
    .populate('items.product', 'name thumbnail images price stock status slug')
    .populate('items.seller', 'firstName lastName vendorProfile.shopName');
}

/**
 * @desc    Get the logged-in user's cart
 * @route   GET /api/v1/cart
 * @access  Private
 */
const getCart = asyncHandler(async (req, res) => {
  await getOrCreateCart(req.user.id); // ensures exists
  const cart = await populatedCart(req.user.id);

  return ApiResponse.success(res, {
    data: cart,
    message: 'Cart fetched successfully',
  });
});

/**
 * @desc    Add an item to the cart (or increment qty if already present).
 * @route   POST /api/v1/cart/items
 * @access  Private
 * @body    { productId, quantity?, variant? }
 */
const addItem = asyncHandler(async (req, res) => {
  const { productId, quantity = 1, variant = null } = req.body;

  if (!productId) throw ApiError.badRequest('productId is required');
  const qty = Math.max(1, Number(quantity) || 1);

  const product = await Product.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');
  if (!['active', 'out_of_stock'].includes(product.status) || !product.isActive) {
    throw ApiError.badRequest('This product is not available');
  }
  if (product.trackInventory && product.stock < qty) {
    throw ApiError.badRequest(`Only ${product.stock} in stock`);
  }

  const cart = await getOrCreateCart(req.user.id);

  // Try to merge with existing line
  const existing = cart.findLine(productId, variant);
  if (existing) {
    const newQty = existing.quantity + qty;
    if (product.trackInventory && product.stock < newQty) {
      throw ApiError.badRequest(`Only ${product.stock} in stock`);
    }
    existing.quantity = newQty;
    // Refresh snapshot price in case it changed
    existing.price = product.price;
  } else {
    cart.items.push({
      product:  product._id,
      seller:   product.seller,
      name:     product.name,
      image:    product.thumbnail || product.images?.[0] || null,
      price:    product.price,
      quantity: qty,
      variant,
    });
  }

  await cart.save();
  const full = await populatedCart(req.user.id);

  return ApiResponse.success(res, {
    data: full,
    message: 'Item added to cart',
  });
});

/**
 * @desc    Update a line item's quantity (or set variant).
 * @route   PATCH /api/v1/cart/items/:itemId
 * @access  Private
 * @body    { quantity }
 */
const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) {
    throw ApiError.badRequest('quantity must be a non-negative number');
  }

  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) throw ApiError.notFound('Cart not found');

  const line = cart.items.id(req.params.itemId);
  if (!line) throw ApiError.notFound('Cart item not found');

  if (qty === 0) {
    line.deleteOne();
  } else {
    // Re-validate stock
    const product = await Product.findById(line.product);
    if (product?.trackInventory && product.stock < qty) {
      throw ApiError.badRequest(`Only ${product.stock} in stock`);
    }
    line.quantity = qty;
    if (product) line.price = product.price; // refresh snapshot
  }

  await cart.save();
  const full = await populatedCart(req.user.id);

  return ApiResponse.success(res, {
    data: full,
    message: 'Cart updated',
  });
});

/**
 * @desc    Remove a line item from the cart.
 * @route   DELETE /api/v1/cart/items/:itemId
 * @access  Private
 */
const removeItem = asyncHandler(async (req, res) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) throw ApiError.notFound('Cart not found');

  const line = cart.items.id(req.params.itemId);
  if (!line) throw ApiError.notFound('Cart item not found');

  line.deleteOne();
  await cart.save();

  const full = await populatedCart(req.user.id);
  return ApiResponse.success(res, {
    data: full,
    message: 'Item removed from cart',
  });
});

/**
 * @desc    Empty the cart
 * @route   DELETE /api/v1/cart
 * @access  Private
 */
const clearCart = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.items = [];
  cart.couponCode = null;
  await cart.save();

  return ApiResponse.success(res, {
    data: cart,
    message: 'Cart cleared',
  });
});

/**
 * @desc    Apply a coupon code (basic — validation hook for future use).
 * @route   POST /api/v1/cart/coupon
 * @access  Private
 * @body    { code }
 */
const applyCoupon = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw ApiError.badRequest('Coupon code is required');

  const cart = await getOrCreateCart(req.user.id);
  cart.couponCode = code.trim().toUpperCase();
  await cart.save();

  const full = await populatedCart(req.user.id);
  return ApiResponse.success(res, {
    data: full,
    message: 'Coupon applied',
  });
});

/**
 * @desc    Remove any applied coupon
 * @route   DELETE /api/v1/cart/coupon
 * @access  Private
 */
const removeCoupon = asyncHandler(async (req, res) => {
  const cart = await getOrCreateCart(req.user.id);
  cart.couponCode = null;
  await cart.save();

  const full = await populatedCart(req.user.id);
  return ApiResponse.success(res, {
    data: full,
    message: 'Coupon removed',
  });
});

module.exports = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  clearCart,
  applyCoupon,
  removeCoupon,
};
