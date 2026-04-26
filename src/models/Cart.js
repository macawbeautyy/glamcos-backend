const mongoose = require('mongoose');

/**
 * Cart
 * ----
 * A persistent shopping cart, one per user. Line items snapshot the price
 * and name at add-time so UI stays stable if a seller edits the product,
 * but we re-validate against the live Product row at checkout.
 */

const CartItemSchema = new mongoose.Schema(
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
    },
    // Snapshot at add-time
    name:     { type: String, required: true },
    image:    { type: String, default: null },
    price:    { type: Number, required: true, min: 0 }, // per-unit
    quantity: { type: Number, required: true, min: 1, default: 1 },
    variant:  { type: Object, default: null },
    addedAt:  { type: Date, default: Date.now },
  },
  { _id: true }
);

const CartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true, // unique implies index; no need for index: true
    },
    items:      { type: [CartItemSchema], default: [] },
    couponCode: { type: String, default: null, trim: true, uppercase: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ---- Virtuals ----
CartSchema.virtual('itemsCount').get(function () {
  return (this.items || []).reduce((s, i) => s + (i.quantity || 0), 0);
});

CartSchema.virtual('subtotal').get(function () {
  return (this.items || []).reduce((s, i) => s + (i.price * i.quantity), 0);
});

// ---- Methods ----
/**
 * Find a line item matching a product (+ optional variant).
 * Variants are compared by JSON for simplicity.
 */
CartSchema.methods.findLine = function (productId, variant = null) {
  const pid = String(productId);
  const vKey = variant ? JSON.stringify(variant) : null;
  return this.items.find((i) => {
    if (String(i.product) !== pid) return false;
    const iv = i.variant ? JSON.stringify(i.variant) : null;
    return iv === vKey;
  });
};

module.exports = mongoose.model('Cart', CartSchema);
