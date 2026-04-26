const mongoose = require('mongoose');

/**
 * Order
 * ------
 * A purchase made from the marketplace. Contains a snapshot of each line item
 * at purchase-time (price, name, image) so cancelling/editing a product later
 * doesn't mutate history.
 *
 * Status flow:
 *   pending  → confirmed → processing → shipped → delivered
 *                                               ↘ cancelled | refunded | returned
 *
 * Payment status:
 *   pending → paid | failed | refunded
 */

const OrderItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Snapshot so history is preserved if product changes
    name:      { type: String, required: true },
    image:     { type: String, default: null },
    sku:       { type: String, default: null },
    price:     { type: Number, required: true, min: 0 },      // per-unit at purchase
    quantity:  { type: Number, required: true, min: 1 },
    subtotal:  { type: Number, required: true, min: 0 },      // price * quantity
    variant:   { type: Object, default: null },
    // Per-line fulfilment status (lets multi-seller orders be tracked individually)
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'],
      default: 'pending',
    },
    trackingNumber: { type: String, default: null },
    carrier:        { type: String, default: null },
  },
  { _id: true }
);

const ShippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    phone:    { type: String, required: true, trim: true },
    line1:    { type: String, required: true, trim: true },
    line2:    { type: String, default: '',  trim: true },
    city:     { type: String, required: true, trim: true },
    state:    { type: String, required: true, trim: true },
    pincode:  { type: String, required: true, trim: true, match: /^[1-9][0-9]{5}$/ },
    country:  { type: String, default: 'IN' },
    landmark: { type: String, default: '' },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: {
      type: [OrderItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'An order must contain at least one item',
      },
    },

    // ---- Pricing ----
    itemsTotal:   { type: Number, required: true, min: 0 },
    deliveryFee:  { type: Number, default: 0,     min: 0 },
    discount:     { type: Number, default: 0,     min: 0 },
    tax:          { type: Number, default: 0,     min: 0 },
    total:        { type: Number, required: true, min: 0 },
    currency:     { type: String, default: 'INR', uppercase: true },

    couponCode:   { type: String, default: null, trim: true, uppercase: true },

    // ---- Address ----
    shippingAddress: { type: ShippingAddressSchema, required: true },

    // ---- Status ----
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned', 'refunded'],
      default: 'pending',
      index: true,
    },
    statusHistory: [
      {
        status:     { type: String },
        changedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedAt:  { type: Date, default: Date.now },
        note:       { type: String, default: '' },
      },
    ],
    cancelReason:  { type: String, default: null },
    cancelledAt:   { type: Date,   default: null },
    deliveredAt:   { type: Date,   default: null },
    expectedDeliveryDate: { type: Date, default: null },

    // ---- Payment ----
    payment: {
      method: {
        type: String,
        enum: ['cod', 'razorpay', 'upi', 'card', 'wallet', 'netbanking'],
        required: true,
      },
      status: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded', 'partial_refund'],
        default: 'pending',
      },
      razorpayOrderId:   { type: String, default: null, index: true },
      razorpayPaymentId: { type: String, default: null, index: true },
      razorpaySignature: { type: String, default: null },
      paidAt:            { type: Date,   default: null },
      refundedAt:        { type: Date,   default: null },
      refundAmount:      { type: Number, default: 0 },
      failureReason:     { type: String, default: null },
    },

    notes: { type: String, default: '' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ---- Indexes ----
OrderSchema.index({ user: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ 'payment.status': 1 });
OrderSchema.index({ createdAt: -1 });

// ---- Virtuals ----
OrderSchema.virtual('totalItems').get(function () {
  return (this.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
});

// ---- Pre-save: generate a short, human-friendly order number ----
OrderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    // Format: GLM-YYMMDD-XXXX (e.g. GLM-260422-8F3A)
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const rand = Math.random().toString(16).slice(2, 6).toUpperCase();
    this.orderNumber = `GLM-${yy}${mm}${dd}-${rand}`;
  }

  // Record status transitions
  if (this.isModified('status')) {
    this.statusHistory = this.statusHistory || [];
    this.statusHistory.push({ status: this.status, changedAt: new Date() });
    if (this.status === 'delivered' && !this.deliveredAt) {
      this.deliveredAt = new Date();
    }
    if (this.status === 'cancelled' && !this.cancelledAt) {
      this.cancelledAt = new Date();
    }
  }

  next();
});

// ---- Statics ----
OrderSchema.statics.findByUser = function (userId, filters = {}) {
  const q = { user: userId };
  if (filters.status) q.status = filters.status;
  return this.find(q).sort({ createdAt: -1 });
};

OrderSchema.statics.findBySeller = function (sellerId, filters = {}) {
  const q = { 'items.seller': sellerId };
  if (filters.status) q.status = filters.status;
  return this.find(q).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Order', OrderSchema);
