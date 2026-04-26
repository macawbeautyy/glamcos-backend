const mongoose = require('mongoose');
const slugify = require('slugify');

const ServiceSchema = new mongoose.Schema(
  {
    // ---- Core ----
    name: {
      type: String,
      required: [true, 'Service name is required'],
      trim: true,
      maxlength: [120, 'Service name cannot exceed 120 characters'],
    },
    slug: {
      type: String,
      lowercase: true,
      // index is defined below via ServiceSchema.index({ slug: 1 }, { unique: true, sparse: true })
    },
    description: {
      type: String,
      required: [true, 'Service description is required'],
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    shortDescription: {
      type: String,
      trim: true,
      maxlength: [200, 'Short description cannot exceed 200 characters'],
    },

    // ---- Relationships ----
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
      index: true,
    },
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Provider is required'],
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
    priceType: {
      type: String,
      enum: ['fixed', 'hourly', 'starting_at', 'custom'],
      default: 'fixed',
    },
    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
    },

    // ---- Service Details ----
    duration: {
      type: Number, // in minutes
      required: [true, 'Duration is required'],
      min: [5, 'Duration must be at least 5 minutes'],
    },
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

    // ---- Tags & Search ----
    tags: {
      type: [String],
      default: [],
      index: true,
    },

    // ---- Inclusions / What you get ----
    inclusions: {
      type: [String],
      default: [],
    },
    exclusions: {
      type: [String],
      default: [],
    },

    // ---- Location ----
    serviceArea: {
      type: String,
      enum: ['on_site', 'at_provider', 'remote', 'flexible'],
      default: 'on_site',
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    serviceRadius: {
      type: Number, // km
      default: 10,
    },

    // ---- Status ----
    status: {
      type: String,
      enum: ['draft', 'pending_approval', 'active', 'inactive', 'rejected', 'archived'],
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
    totalBookings: {
      type: Number,
      default: 0,
    },

    // ---- Admin ----
    rejectionReason: {
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
ServiceSchema.index({ provider: 1, status: 1 });
ServiceSchema.index({ category: 1, status: 1, isActive: 1 });
ServiceSchema.index({ price: 1 });
ServiceSchema.index({ rating: -1 });
ServiceSchema.index({ location: '2dsphere' });
ServiceSchema.index({ name: 'text', description: 'text', tags: 'text' });
ServiceSchema.index({ slug: 1 }, { unique: true, sparse: true });

// ---- Virtuals ----
ServiceSchema.virtual('discountPercent').get(function () {
  if (this.comparePrice && this.comparePrice > this.price) {
    return Math.round(((this.comparePrice - this.price) / this.comparePrice) * 100);
  }
  return 0;
});

ServiceSchema.virtual('formattedDuration').get(function () {
  if (!this.duration) return '';
  const hours = Math.floor(this.duration / 60);
  const mins = this.duration % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
});

// ---- Pre-save ----
ServiceSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    // Append a short random suffix to avoid slug collisions across providers
    const suffix = this._id.toString().slice(-4);
    this.slug = slugify(`${this.name}-${suffix}`, { lower: true, strict: true });
  }
  next();
});

// ---- Post-save: Update category service count ----
ServiceSchema.post('save', async function () {
  if (this.category) {
    const Category = mongoose.model('Category');
    const count = await mongoose.model('Service').countDocuments({
      category: this.category,
      status: 'active',
      isActive: true,
    });
    await Category.findByIdAndUpdate(this.category, { serviceCount: count });
  }
});

// ---- Statics ----

/**
 * Search services with filters
 */
ServiceSchema.statics.search = function (filters = {}) {
  const query = { status: 'active', isActive: true };

  if (filters.category) query.category = filters.category;
  if (filters.provider) query.provider = filters.provider;
  if (filters.priceMin || filters.priceMax) {
    query.price = {};
    if (filters.priceMin) query.price.$gte = Number(filters.priceMin);
    if (filters.priceMax) query.price.$lte = Number(filters.priceMax);
  }
  if (filters.rating) query.rating = { $gte: Number(filters.rating) };
  if (filters.serviceArea) query.serviceArea = filters.serviceArea;
  if (filters.search) {
    query.$text = { $search: filters.search };
  }

  return this.find(query);
};

module.exports = mongoose.model('Service', ServiceSchema);
