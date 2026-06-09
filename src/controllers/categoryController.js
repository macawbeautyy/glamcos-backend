const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, parseSort } = require('../utils/helpers');

/**
 * @desc    Get all categories (with filters)
 * @route   GET /api/v1/categories
 * @access  Public
 */
const getCategories = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, 'sortOrder');

  // Build filter
  const filter = {};

  // Public users only see active categories
  if (!req.user || !['admin', 'superadmin'].includes(req.user.role)) {
    filter.isActive = true;
  }

  if (req.query.type) filter.type = { $in: [req.query.type, 'both'] };
  if (req.query.parent) filter.parent = req.query.parent;
  if (req.query.parent === 'null') filter.parent = null; // Top-level only
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.search) {
    // Escape special regex chars to prevent ReDoS
    const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 100);
    filter.name = { $regex: escaped, $options: 'i' };
  }

  const [categories, total] = await Promise.all([
    Category.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('parent', 'name slug')
      .populate('createdBy', 'firstName lastName'),
    Category.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: categories,
    page,
    limit,
    total,
    message: 'Categories fetched successfully',
  });
});

/**
 * @desc    Get category tree (hierarchical)
 * @route   GET /api/v1/categories/tree
 * @access  Public
 */
const getCategoryTree = asyncHandler(async (req, res) => {
  const type = req.query.type || null;
  const tree = await Category.getTree(type);

  return ApiResponse.success(res, {
    data: tree,
    message: 'Category tree fetched successfully',
  });
});

/**
 * @desc    Get single category by ID or slug
 * @route   GET /api/v1/categories/:id
 * @access  Public
 */
const getCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Support lookup by slug or ObjectId
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const filter = isObjectId ? { _id: id } : { slug: id };

  const category = await Category.findOne(filter)
    .populate('parent', 'name slug')
    .populate('createdBy', 'firstName lastName')
    .populate({
      path: 'subcategories',
      match: { isActive: true },
      options: { sort: { sortOrder: 1 } },
    });

  if (!category) {
    throw ApiError.notFound('Category not found');
  }

  return ApiResponse.success(res, {
    data: category,
    message: 'Category fetched successfully',
  });
});

/**
 * @desc    Create category
 * @route   POST /api/v1/categories
 * @access  Private (Admin, Superadmin)
 */
const createCategory = asyncHandler(async (req, res) => {
  const {
    name, description, image, type, parent,
    icon, sortOrder, isActive, isFeatured,
  } = req.body;

  // Validate parent exists if provided
  if (parent) {
    const parentCategory = await Category.findById(parent);
    if (!parentCategory) {
      throw ApiError.badRequest('Parent category does not exist');
    }
  }

  const category = await Category.create({
    name,
    description,
    image,
    type,
    parent: parent || null,
    icon,
    sortOrder,
    isActive,
    isFeatured,
    createdBy: req.user.id,
  });

  return ApiResponse.created(res, {
    data: category,
    message: 'Category created successfully',
  });
});

/**
 * @desc    Update category
 * @route   PUT /api/v1/categories/:id
 * @access  Private (Admin, Superadmin)
 */
const updateCategory = asyncHandler(async (req, res) => {
  const allowedFields = [
    'name', 'description', 'image', 'type', 'parent',
    'icon', 'sortOrder', 'isActive', 'isFeatured',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  // Prevent category from being its own parent
  if (updates.parent && updates.parent === req.params.id) {
    throw ApiError.badRequest('A category cannot be its own parent');
  }

  // Validate parent exists if changing
  if (updates.parent) {
    const parentCategory = await Category.findById(updates.parent);
    if (!parentCategory) {
      throw ApiError.badRequest('Parent category does not exist');
    }
  }

  const category = await Category.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  });

  if (!category) {
    throw ApiError.notFound('Category not found');
  }

  return ApiResponse.success(res, {
    data: category,
    message: 'Category updated successfully',
  });
});

/**
 * @desc    Delete category (soft delete — deactivate)
 * @route   DELETE /api/v1/categories/:id
 * @access  Private (Admin, Superadmin)
 */
const deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);

  if (!category) {
    throw ApiError.notFound('Category not found');
  }

  // Check for child categories
  const childCount = await Category.countDocuments({ parent: category._id });
  if (childCount > 0) {
    throw ApiError.badRequest(
      `Cannot delete category with ${childCount} subcategories. Remove or reassign them first.`
    );
  }

  // Check for services/products using this category
  if (category.serviceCount > 0 || category.productCount > 0) {
    // Soft delete — deactivate instead of removing
    category.isActive = false;
    await category.save();

    return ApiResponse.success(res, {
      data: category,
      message: 'Category deactivated (has linked services/products)',
    });
  }

  // Hard delete if no dependencies
  await Category.findByIdAndDelete(req.params.id);

  return ApiResponse.success(res, {
    data: null,
    message: 'Category deleted successfully',
  });
});


// ── Category Suggestions ───────────────────────────────────────────────────
const CategorySuggestion = require('../models/CategorySuggestion');

// POST /api/v1/categories/suggest  — any logged-in user
exports.suggestCategory = asyncHandler(async (req, res) => {
  const { name, type, parentName, reason } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'Category name is required');

  const suggestion = await CategorySuggestion.create({
    name: name.trim(),
    type: type || 'product',
    parentName: parentName || '',
    reason: reason || '',
    suggestedBy: req.user._id,
  });

  return ApiResponse.created(res, { data: suggestion, message: 'Suggestion submitted for admin review' });
});

// GET /api/v1/categories/suggestions/admin  — admin
exports.adminGetSuggestions = asyncHandler(async (req, res) => {
  const { status = 'pending' } = req.query;
  const filter = status === 'all' ? {} : { status };
  const suggestions = await CategorySuggestion.find(filter)
    .populate('suggestedBy', 'firstName lastName email')
    .sort({ createdAt: -1 });
  return ApiResponse.success(res, { data: suggestions });
});

// PATCH /api/v1/categories/suggestions/:id  — admin approve/reject
exports.adminReviewSuggestion = asyncHandler(async (req, res) => {
  const { status, adminNote } = req.body;
  if (!['approved', 'rejected'].includes(status)) throw new ApiError(400, 'status must be approved or rejected');

  const suggestion = await CategorySuggestion.findById(req.params.id);
  if (!suggestion) throw new ApiError(404, 'Suggestion not found');

  suggestion.status    = status;
  suggestion.adminNote = adminNote || '';

  if (status === 'approved') {
    const existing = await Category.findOne({ name: suggestion.name });
    if (!existing) {
      const newCat = await Category.create({
        name:      suggestion.name,
        type:      suggestion.type,
        createdBy: req.user._id,
      });
      suggestion.createdCategory = newCat._id;
    }
  }

  await suggestion.save();
  return ApiResponse.success(res, { data: suggestion, message: `Suggestion ${status}` });
});
module.exports = {
  getCategories,
  getCategoryTree,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  suggestCategory:       exports.suggestCategory,
  adminGetSuggestions:   exports.adminGetSuggestions,
  adminReviewSuggestion: exports.adminReviewSuggestion,
};
