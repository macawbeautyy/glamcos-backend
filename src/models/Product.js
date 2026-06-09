const mongoose = require('mongoose');
const slugify = require('slugify');

const ProductSchema = new mongoose.Schema(
  {
    // ---- Core ----
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [150, 'Product name cannot exceed 150 characters'],
    },
    slug: {
      type: String,
      lowercase: true,
      // index is defined below via ProductSchema.index({ slug: 1 }, { unique: true, sparse: true })
    },
    description: {
      type: String,
      required: [true, 'Product description is required'],
      trim: true,
      maxlength: [3000, 'Description cannot exceed 3000 characters'],
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [250, 'Short description cannot exceed 250 characters'],
    },

    // ---- Relationships ----
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Seller is required'],
      index: true,
    },

    // ---- Pricing ----
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    comparePrice: {
      type: Number,
      default: null,
      min: [0, 'Compare price cannot be negative'],
    },
    costPrice: {
      type: Number,
      default: null,
      select: false, // Internal field, hidden from public queries
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },

    // ---- Inventory ----
    stock: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      min: [0, 'Stock cannot be negative'],
      default: 0,
    },
    lowStockThreshold: {
      type: Number,
      default: 5,
    },
    sku: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      index: true,
    },
    trackInventory: {
      type: Boolean,
      default: true,
    },
    bulkPricing: [{
      minQty: { type: Number, required: true, min: 1 },
      maxQty: { type: Number, default: null },
      price:  { type: Number, required: true, min: 0 },
    }],

    // ---- Media ----
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 10,
        message: 'Cannot upload more than 10 images',
      },
    },
    thumbnail: {
      type: String,
      default: null,
    },

    // ---- Attributes ----
    brand: {
      type: String,
      trim: true,
      default: null,
    },
    weight: {
      value: { type: Number, default: null },
      unit: { type: String, enum: ['g', 'kg', 'lb', 'oz'], default: 'g' },
    },
    dimensions: {
      length: { type: Number, default: null },
      width: { type: Number, default: null },
      height: { type: Number, default: null },
      unit: { type: String, enum: ['cm', 'in', 'm'], default: 'cm' },
    },
    variants: [
      {
        name: { type: String, trim: true },    // e.g. "Color", "Size"
        value: { type: String, trim: true },   // e.g. "Red", "XL"
        priceModifier: { type: Number, default: 0 },
        stock: { type: Number, default: 0 },
        sku: { type: String, trim: true },
      },
    ],
    specifications: [
      {
        key: { type: String, trim: true },
        value: { type: String, trim: true },
      },
    ],

    // ---- Tags & Search ----
    tags: {
      type: [String],
      default: [],
      index: true,
    },

    // ---- Shipping ----
    shippingInfo: {
      freeShipping: { type: Boolean, default: false },
      shippingCost: { type: Number, default: 0 },
      estimatedDays: { type: Number, default: 5 },
      returnPolicy: {
        type: String,
        enum: ['no_return', '7_days', '15_days', '30_days'],
        default: '7_days',
      },
    },

    // ---- Status ----
    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'active', 'inactive', 'rejected', 'archived', 'out_of_stock'],
      default: 'pending_approval',
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },

    // ---- Ratings (aggregated) ----
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    totalSold: {
      type: Number,
      default: 0,
    },

    // ---- Cosmetics / Beauty Extended Fields ----
    ingredients: {
      type: String,
      trim: true,
      default: null,
    },
    activeIngredients: {
      type: String,
      trim: true,
      default: null,
    },
    benefits: {
      type: String,
      trim: true,
      default: null,
    },
    howToUse: {
      type: String,
      trim: true,
      default: null,
    },
    hairType: {
      type: [String],  // e.g. ['dry', 'oily', 'normal', 'curly']
      default: [],
    },
    fragrance: {
      type: String,
      trim: true,
      default: null,
    },

    // ---- Compliance / Regulatory ----
    hsnCode: {
      type: String,
      trim: true,
      default: null,
    },
    manufacturingDate: {
      type: Date,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    safetyInstructions: {
      type: String,
      trim: true,
      default: null,
    },
    safetyClaims: {
      type: String,
      trim: true,
      default: null,
    },
    countryOfOrigin: {
      type: String,
      trim: true,
      default: 'India',
    },
    manufacturerName: {
      type: String,
      trim: true,
      default: null,
    },
    manufacturerAddress: {
      type: String,
      trim: true,
      default: null,
    },
    sellerInfo: {
      type: String,
      trim: true,
      default: null,
    },

    // ---- Inventory Extended ----
    stockQuantity: {
      type: Number,
      default: null,  // mirrors stock, for legacy compat
    },
    lowStockAlert: {
      type: Number,
      default: 5,   // mirrors lowStockThreshold
    },
    volume: {
      value: { type: Number, default: null },
      unit:  { type: String, enum: ['ml', 'l', 'fl oz'], default: 'ml' },
    },

    // ---- Product Status (extended) ----
    productStatus: {
      type: String,
      enum: ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'archived'],
      default: 'draft',
      index: true,
    },

    // ---- Admin ----
    rejectionReason: {
      type: String,
      default: null,
    },
    adminNotes: {
      type: String,
      default: null,
    },
    requestedChanges: {
      type: String,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---- Indexes ----
ProductSchema.index({ seller: 1, status: 1 });
ProductSchema.index({ category: 1, status: 1, isActive: 1 });
ProductSchema.index({ price: 1 });
ProductSchema.index({ rating: -1 });
ProductSchema.index({ totalSold: -1 });
ProductSchema.index({ name: 'text', description: 'text', tags: 'text', brand: 'text' });
ProductSchema.index({ slug: 1 }, { unique: true, sparse: true });

// ---- Virtuals ----
ProductSchema.virtual('discountPercent').get(function () {
  if (this.comparePrice && this.comparePrice > this.price) {
    return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
  }
  return 0;
});

ProductSchema.virtual('inStock').get(function () {
  if (!this.trackInventory) return true;
  return this.stock > 0;
});

ProductSchema.virtual('isLowStock').get(function () {
  if (!this.trackInventory) return false;
  return this.stock > 0 && this.stock <= this.lowStockThreshold;
});

// ---- Pre-save ----
ProductSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    const suffix = this._id.toString().slice(-4);
    this.slug = slugify(`${this.name}-${suffix}`, { lower: true, strict: true });
  }

  // Sync stock <-> stockQuantity
  if (this.isModified('stock') && this.stockQuantity === null) this.stockQuantity = this.stock;
  if (this.isModified('stockQuantity') && this.stockQuantity !== null) this.stock = this.stockQuantity;

  // Sync lowStockThreshold <-> lowStockAlert
  if (this.isModified('lowStockAlert')) this.lowStockThreshold = this.lowStockAlert;
  if (this.isModified('lowStockThreshold')) this.lowStockAlert = this.lowStockThreshold;

  // Sync productStatus <-> status
  const STATUS_MAP = { draft: 'draft', submitted: 'pending_approval', under_review: 'pending_approval', approved: 'active', rejected: 'rejected', archived: 'archived' };
  if (this.isModified('productStatus')) {
    this.status = STATUS_MAP[this.productStatus] || this.productStatus;
  } else if (this.isModified('status') && !this.isModified('productStatus')) {
    const REV = { draft: 'draft', pending_approval: 'submitted', active: 'approved', rejected: 'rejected', archived: 'archived', inactive: 'draft', out_of_stock: 'approved' };
    this.productStatus = REV[this.status] || this.productStatus;
  }

  // Auto-set out_of_stock status
  if (this.trackInventory && this.stock === 0 && this.status === 'active') {
    this.status = 'out_of_stock';
  }
  // Restore active if restocked
  if (this.trackInventory && this.stock > 0 && this.status === 'out_of_stock') {
    this.status = 'active';
  }

  next();
});

// ---- Post-save: Update category product count ----
ProductSchema.post('save', async function () {
  if (this.category) {
    const Category = mongoose.model('Category');
    const count = await mongoose.model('Product').countDocuments({
      category: this.category,
      status: { $in: ['active', 'out_of_stock'] },
      isActive: true,
    });
    await Category.findByIdAndUpdate(this.category, { productCount: count });
  }
});

// ---- Statics ----
ProductSchema.statics.search = function (filters = {}) {
  const query = { status: { $in: ['active', 'out_of_stock'] }, isActive: true };

  if (filters.category) query.category = filters.category;
  if (filters.seller) query.seller = filters.seller;
  if (filters.brand) query.brand = new RegExp(filters.brand, 'i');
  if (filters.priceMin || filters.priceMax) {
    query.price = {};
    if (filters.priceMin) query.price.$gte = Number(filters.priceMin);
    if (filters.priceMax) query.price.$lte = Number(filters.priceMax);
  }
  if (filters.rating) query.rating = { $gte: Number(filters.rating) };
  if (filters.inStock) query.stock = { $gt: 0 };
  if (filters.search) {
    query.$text = { $search: filters.search };
  }

  return this.find(query);
};

module.exports = mongoose.model('Product', ProductSchema);
