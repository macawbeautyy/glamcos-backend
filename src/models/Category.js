const mongoose = require('mongoose');
const slugify = require('slugify');

const CategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true,
      maxlength: [80, 'Category name cannot exceed 80 characters'],
    },
    slug: {
      type: String,
      unique: true,
      lowercase: true,
      // index is created automatically by unique:true — no need for index:true
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: '',
    },
    image: {
      type: String,
      default: null,
    },

    // Which domain this category applies to
    type: {
      type: String,
      enum: {
        values: ['service', 'product', 'both'],
        message: '{VALUE} is not a valid category type',
      },
      default: 'both',
    },

    // Hierarchical categories (optional parent)
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },

    // Display
    icon: {
      type: String,
      default: null,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },

    // Tracking
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Aggregated counts (updated via hooks or jobs)
    serviceCount: {
      type: Number,
      default: 0,
    },
    productCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ---- Indexes ----
CategorySchema.index({ type: 1, isActive: 1 });
CategorySchema.index({ parent: 1 });
CategorySchema.index({ sortOrder: 1 });
CategorySchema.index({ isFeatured: 1, isActive: 1 });

// ---- Virtuals ----
CategorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parent',
  justOne: false,
});

CategorySchema.virtual('services', {
  ref: 'Service',
  localField: '_id',
  foreignField: 'category',
  justOne: false,
});

// ---- Pre-save: Auto-generate slug ----
CategorySchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = slugify(this.name, { lower: true, strict: true });
  }
  next();
});

// ---- Pre-update: Regenerate slug if name changed ----
CategorySchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  if (update.name) {
    update.slug = slugify(update.name, { lower: true, strict: true });
  }
  next();
});

// ---- Statics ----

/**
 * Get active categories with optional type filter
 */
CategorySchema.statics.getActive = function (type = null) {
  const filter = { isActive: true };
  if (type) filter.type = { $in: [type, 'both'] };
  return this.find(filter).sort({ sortOrder: 1, name: 1 });
};

/**
 * Get category tree (parent + children)
 */
CategorySchema.statics.getTree = function (type = null) {
  const filter = { isActive: true, parent: null };
  if (type) filter.type = { $in: [type, 'both'] };
  return this.find(filter)
    .sort({ sortOrder: 1 })
    .populate({
      path: 'subcategories',
      match: { isActive: true },
      options: { sort: { sortOrder: 1 } },
    });
};

module.exports = mongoose.model('Category', CategorySchema);
