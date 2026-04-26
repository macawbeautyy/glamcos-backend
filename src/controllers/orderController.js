const mongoose = require('mongoose');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/helpers');

const DEFAULT_DELIVERY_FEE  = 49;        // ₹ flat
const FREE_DELIVERY_AT      = 499;       // orders above this total get free delivery

/**
 * @desc    Place a new order from the user's cart (or from explicit items).
 * @route   POST /api/v1/orders
 * @access  Private
 * @body    {
 *            shippingAddress,
 *            paymentMethod: 'cod'|'razorpay'|'upi'|...,
 *            items?: [{ productId, quantity, variant? }]   // if omitted, uses cart
 *            couponCode?: string
 *            notes?: string
 *          }
 */
const createOrder = asyncHandler(async (req, res) => {
  const { shippingAddress, paymentMethod, items: rawItems, notes = '', couponCode } = req.body;

  if (!shippingAddress) throw ApiError.badRequest('shippingAddress is required');
  if (!paymentMethod)   throw ApiError.badRequest('paymentMethod is required');

  // 1. Resolve source items (explicit body, else live cart)
  let sourceItems = Array.isArray(rawItems) ? rawItems : null;
  let cart = null;
  if (!sourceItems) {
    cart = await Cart.findOne({ user: req.user.id });
    if (!cart || cart.items.length === 0) {
      throw ApiError.badRequest('Your cart is empty');
    }
    sourceItems = cart.items.map((i) => ({
      productId: i.product,
      quantity:  i.quantity,
      variant:   i.variant,
    }));
  }

  if (!sourceItems.length) throw ApiError.badRequest('No items to order');

  // 2. Load all products in one go, then build order lines with live prices
  const productIds = sourceItems.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds } });
  const pById = new Map(products.map((p) => [String(p._id), p]));

  const orderItems = [];
  let itemsTotal = 0;
  for (const i of sourceItems) {
    const p = pById.get(String(i.productId));
    if (!p) throw ApiError.badRequest(`Product ${i.productId} no longer exists`);
    if (!['active', 'out_of_stock'].includes(p.status) || !p.isActive) {
      throw ApiError.badRequest(`'${p.name}' is not available`);
    }
    const qty = Math.max(1, Number(i.quantity) || 1);
    if (p.trackInventory && p.stock < qty) {
      throw ApiError.badRequest(`Only ${p.stock} of '${p.name}' in stock`);
    }
    const price = p.price;
    const subtotal = price * qty;
    itemsTotal += subtotal;
    orderItems.push({
      product:  p._id,
      seller:   p.seller,
      name:     p.name,
      image:    p.thumbnail || p.images?.[0] || null,
      sku:      p.sku || null,
      price,
      quantity: qty,
      subtotal,
      variant:  i.variant || null,
    });
  }

  // 3. Pricing
  const deliveryFee = itemsTotal >= FREE_DELIVERY_AT ? 0 : DEFAULT_DELIVERY_FEE;
  const discount    = 0;                                  // coupons TBD
  const tax         = 0;                                  // GST TBD
  const total       = itemsTotal + deliveryFee + tax - discount;

  // 4. Transactional: create order + decrement stock + clear cart
  const session = await mongoose.startSession();
  let order;
  try {
    await session.withTransaction(async () => {
      const [created] = await Order.create(
        [{
          user:  req.user.id,
          items: orderItems,
          itemsTotal,
          deliveryFee,
          discount,
          tax,
          total,
          currency: 'INR',
          couponCode: couponCode || null,
          shippingAddress,
          notes,
          payment: {
            method: paymentMethod,
            status: paymentMethod === 'cod' ? 'pending' : 'pending',
          },
          status: 'pending',
          statusHistory: [{ status: 'pending', changedBy: req.user.id }],
        }],
        { session }
      );
      order = created;

      // Decrement stock atomically per product (tracked items only)
      for (const line of orderItems) {
        const p = pById.get(String(line.product));
        if (!p.trackInventory) continue;
        const updated = await Product.findOneAndUpdate(
          { _id: p._id, stock: { $gte: line.quantity } },
          { $inc: { stock: -line.quantity, totalSold: line.quantity } },
          { new: true, session }
        );
        if (!updated) {
          throw ApiError.badRequest(`'${p.name}' ran out of stock`);
        }
        // If stock now 0, mark out_of_stock (pre-save hook won't fire on $inc)
        if (updated.stock === 0 && updated.status === 'active') {
          await Product.updateOne({ _id: updated._id }, { status: 'out_of_stock' }, { session });
        }
      }

      // Empty the cart if we used it
      if (cart) {
        cart.items = [];
        cart.couponCode = null;
        await cart.save({ session });
      }
    });
  } finally {
    session.endSession();
  }

  const populated = await Order.findById(order._id)
    .populate('items.product', 'name slug thumbnail')
    .populate('items.seller', 'firstName lastName vendorProfile.shopName');

  return ApiResponse.created(res, {
    data: populated,
    message: 'Order placed successfully',
  });
});

/**
 * @desc    List the current user's orders
 * @route   GET /api/v1/orders/my-orders
 * @access  Private
 */
const getMyOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { user: req.user.id };
  if (req.query.status) filter.status = req.query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('items.product', 'name slug thumbnail'),
    Order.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: orders, page, limit, total,
    message: 'Your orders',
  });
});

/**
 * @desc    Get a single order (owner, seller of any line, or admin)
 * @route   GET /api/v1/orders/:id
 * @access  Private
 */
const getOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id)
    .populate('user', 'firstName lastName email phone')
    .populate('items.product', 'name slug thumbnail')
    .populate('items.seller', 'firstName lastName vendorProfile.shopName');

  if (!order) throw ApiError.notFound('Order not found');

  const isOwner    = order.user._id?.toString() === req.user.id;
  const isAdmin    = ['admin', 'superadmin'].includes(req.user.role);
  const isSeller   = order.items.some(
    (i) => (i.seller?._id ?? i.seller)?.toString() === req.user.id
  );
  if (!isOwner && !isAdmin && !isSeller) {
    throw ApiError.forbidden('You are not allowed to view this order');
  }

  return ApiResponse.success(res, {
    data: order,
    message: 'Order fetched',
  });
});

/**
 * @desc    Cancel an order (owner only, while still cancellable)
 * @route   POST /api/v1/orders/:id/cancel
 * @access  Private
 * @body    { reason? }
 */
const cancelOrder = asyncHandler(async (req, res) => {
  const { reason = '' } = req.body;
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only cancel your own orders');
  }
  if (!['pending', 'confirmed', 'processing'].includes(order.status)) {
    throw ApiError.badRequest(`Cannot cancel an order in status '${order.status}'`);
  }

  // Restore stock for tracked items
  for (const line of order.items) {
    await Product.updateOne(
      { _id: line.product, trackInventory: true },
      { $inc: { stock: line.quantity, totalSold: -line.quantity } }
    );
  }

  order.status        = 'cancelled';
  order.cancelReason  = reason;
  order.cancelledAt   = new Date();
  // If already paid, mark pending refund
  if (order.payment.status === 'paid') {
    order.payment.status = 'refunded';
    order.payment.refundAmount = order.total;
    order.payment.refundedAt = new Date();
  }
  await order.save();

  return ApiResponse.success(res, {
    data: order,
    message: 'Order cancelled',
  });
});

/**
 * @desc    List orders that contain items sold by the logged-in vendor.
 * @route   GET /api/v1/orders/seller
 * @access  Private (Vendor)
 */
const getSellerOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { 'items.seller': req.user.id };
  if (req.query.status) filter.status = req.query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'firstName lastName phone')
      .populate('items.product', 'name slug thumbnail'),
    Order.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: orders, page, limit, total,
    message: 'Seller orders',
  });
});

/**
 * @desc    Update the fulfilment status of a seller's line, or the whole
 *          order when the caller is admin.
 * @route   PATCH /api/v1/orders/:id/status
 * @access  Private (Seller of any line, Admin)
 * @body    { status, itemId?, trackingNumber?, carrier? }
 */
const updateOrderStatus = asyncHandler(async (req, res) => {
  const { status, itemId, trackingNumber, carrier } = req.body;
  const ALLOWED = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'];
  if (!ALLOWED.includes(status)) {
    throw ApiError.badRequest(`Invalid status '${status}'`);
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
  const isSeller = order.items.some(
    (i) => i.seller?.toString() === req.user.id
  );

  if (!isAdmin && !isSeller) {
    throw ApiError.forbidden('You are not allowed to update this order');
  }

  if (itemId) {
    // Per-line update — only the seller of that line (or admin) can do it
    const line = order.items.id(itemId);
    if (!line) throw ApiError.notFound('Line item not found');
    if (!isAdmin && line.seller.toString() !== req.user.id) {
      throw ApiError.forbidden('You can only update your own lines');
    }
    line.status = status;
    if (trackingNumber) line.trackingNumber = trackingNumber;
    if (carrier)        line.carrier = carrier;

    // If every line is delivered, roll order up to delivered.
    if (order.items.every((l) => l.status === 'delivered')) {
      order.status = 'delivered';
    } else if (order.items.some((l) => l.status === 'shipped') && order.status === 'confirmed') {
      order.status = 'shipped';
    }
  } else {
    // Whole-order update (admin-only)
    if (!isAdmin) {
      throw ApiError.forbidden('Only admins can update the whole-order status');
    }
    order.status = status;
  }

  await order.save();

  return ApiResponse.success(res, {
    data: order,
    message: 'Order status updated',
  });
});

/**
 * @desc    Admin listing of all orders
 * @route   GET /api/v1/orders
 * @access  Private (Admin)
 */
const getAllOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.status)        filter.status            = req.query.status;
  if (req.query.paymentStatus) filter['payment.status'] = req.query.paymentStatus;
  if (req.query.user)          filter.user              = req.query.user;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('user', 'firstName lastName email phone')
      .populate('items.product', 'name slug thumbnail'),
    Order.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: orders, page, limit, total,
    message: 'All orders',
  });
});

module.exports = {
  createOrder,
  getMyOrders,
  getOrder,
  cancelOrder,
  getSellerOrders,
  updateOrderStatus,
  getAllOrders,
};
