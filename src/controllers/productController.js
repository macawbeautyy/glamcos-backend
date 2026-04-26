const Product = require('../models/Product');
const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, parseSort } = require('../utils/helpers');

/**
 * @desc    Get all products (public listing with filters)
 * @route   GET /api/v1/products
 * @access  Public
 */
const getProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, '-createdAt');

  // Build filter
  const filter = { status: { $in: ['active', 'out_of_stock'] }, isActive: true };

  if (req.query.category) filter.category = req.query.category;
  if (req.query.seller) filter.seller = req.query.seller;
  if (req.query.brand) filter.brand = new RegExp(req.query.brand, 'i');
  if (req.query.featured === 'true') filter.isFeatured = true;
  if (req.query.inStock === 'true') {
    filter.status = 'active';
    filter.stock = { $gt: 0 };
  }

  // Price range
  if (req.query.priceMin || req.query.priceMax) {
    filter.price = {};
    if (req.query.priceMin) filter.price.$gte = Number(req.query.priceMin);
    if (req.query.priceMax) filter.price.$lte = Number(req.query.priceMax);
  }

  // Rating filter
  if (req.query.rating) {
    filter.rating = { $gte: Number(req.query.rating) };
  }

  // Text search
  if (req.query.search) {
    filter.$text = { $search: req.query.search };
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug icon')
      .populate('seller', 'firstName lastName vendorProfile.shopName vendorProfile.rating'),
    Product.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: products,
    page,
    limit,
    total,
    message: 'Products fetched successfully',
  });
});

/**
 * @desc    Get products for logged-in vendor (their own)
 * @route   GET /api/v1/products/my-products
 * @access  Private (Vendor)
 */
const getMyProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, '-createdAt');

  const filter = { seller: req.user.id };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.lowStock === 'true') {
    filter.stock = { $gt: 0, $lte: 5 }; // Default threshold
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug'),
    Product.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: products,
    page,
    limit,
    total,
    message: 'Your products fetched successfully',
  });
});

/**
 * @desc    Get single product by ID or slug
 * @route   GET /api/v1/products/:id
 * @access  Public
 */
const getProduct = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const filter = isObjectId ? { _id: id } : { slug: id };

  const product = await Product.findOne(filter)
    .populate('category', 'name slug icon')
    .populate('seller', 'firstName lastName avatar vendorProfile');

  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  // Non-public products visible only to owner or admin
  if (!['active', 'out_of_stock'].includes(product.status)) {
    const sellerId = product.seller?._id?.toString() ?? product.seller?.toString();
    const isOwner = req.user && sellerId && req.user.id === sellerId;
    const isAdmin = req.user && ['admin', 'superadmin'].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      throw ApiError.notFound('Product not found');
    }
  }

  return ApiResponse.success(res, {
    data: product,
    message: 'Product fetched successfully',
  });
});

/**
 * @desc    Create a new product
 * @route   POST /api/v1/products
 * @access  Private (Vendor)
 */
const createProduct = asyncHandler(async (req, res) => {
  const {
    name, description, shortDescription, category, price,
    comparePrice, stock, sku, brand, images, thumbnail,
    tags, variants, specifications, shippingInfo,
    weight, dimensions, trackInventory, lowStockThreshold,
  } = req.body;

  // Validate category
  const cat = await Category.findById(category);
  if (!cat) {
    throw ApiError.badRequest('Category does not exist');
  }
  if (cat.type === 'service') {
    throw ApiError.badRequest('This category is for services only');
  }

  // Check for duplicate SKU
  if (sku) {
    const existing = await Product.findOne({ sku: sku.toUpperCase() });
    if (existing) {
      throw ApiError.conflict(`SKU '${sku}' already exists`);
    }
  }

  const product = await Product.create({
    name,
    description,
    shortDescription,
    category,
    seller: req.user.id,
    price,
    comparePrice,
    stock,
    sku,
    brand,
    images,
    thumbnail,
    tags,
    variants,
    specifications,
    shippingInfo,
    weight,
    dimensions,
    trackInventory,
    lowStockThreshold,
    status: 'pending_approval',
  });

  await product.populate('category', 'name slug');

  return ApiResponse.created(res, {
    data: product,
    message: 'Product created and submitted for approval',
  });
});

/**
 * @desc    Update a product
 * @route   PUT /api/v1/products/:id
 * @access  Private (Owner Vendor)
 */
const updateProduct = asyncHandler(async (req, res) => {
  let product = await Product.findById(req.params.id);

  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  if (product.seller.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only update your own products');
  }

  const allowedFields = [
    'name', 'description', 'shortDescription', 'category', 'price',
    'comparePrice', 'stock', 'sku', 'brand', 'images', 'thumbnail',
    'tags', 'variants', 'specifications', 'shippingInfo', 'weight',
    'dimensions', 'trackInventory', 'lowStockThreshold', 'isActive',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  // Validate category if changing
  if (updates.category) {
    const cat = await Category.findById(updates.category);
    if (!cat) throw ApiError.badRequest('Category does not exist');
    if (cat.type === 'service') throw ApiError.badRequest('This category is for services only');
  }

  // Check SKU uniqueness if changing
  if (updates.sku) {
    const existing = await Product.findOne({
      sku: updates.sku.toUpperCase(),
      _id: { $ne: req.params.id },
    });
    if (existing) throw ApiError.conflict(`SKU '${updates.sku}' already exists`);
  }

  // Resubmit for approval on major edits
  if (product.status === 'active' && Object.keys(updates).some(
    (k) => ['name', 'description', 'price', 'category'].includes(k)
  )) {
    updates.status = 'pending_approval';
  }

  product = await Product.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  }).populate('category', 'name slug');

  return ApiResponse.success(res, {
    data: product,
    message: 'Product updated successfully',
  });
});

/**
 * @desc    Update product stock only (quick inventory update)
 * @route   PATCH /api/v1/products/:id/stock
 * @access  Private (Owner Vendor)
 */
const updateStock = asyncHandler(async (req, res) => {
  const { stock } = req.body;

  if (stock === undefined || stock === null) {
    throw ApiError.badRequest('Stock value is required');
  }
  if (Number(stock) < 0) {
    throw ApiError.badRequest('Stock cannot be negative');
  }

  const product = await Product.findById(req.params.id);

  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  if (product.seller.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only update stock for your own products');
  }

  product.stock = Number(stock);
  await product.save(); // Triggers pre-save stock status logic

  return ApiResponse.success(res, {
    data: { _id: product._id, stock: product.stock, status: product.status },
    message: 'Stock updated successfully',
  });
});

/**
 * @desc    Delete a product
 * @route   DELETE /api/v1/products/:id
 * @access  Private (Owner Vendor, Admin)
 */
const deleteProduct = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);

  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  const isOwner = product.seller.toString() === req.user.id;
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

  if (!isOwner && !isAdmin) {
    throw ApiError.forbidden('You can only delete your own products');
  }

  // Soft delete if has sales history
  if (product.totalSold > 0) {
    product.status = 'archived';
    product.isActive = false;
    await product.save();

    return ApiResponse.success(res, {
      data: null,
      message: 'Product archived (has sales history)',
    });
  }

  await Product.findByIdAndDelete(req.params.id);

  return ApiResponse.success(res, {
    data: null,
    message: 'Product deleted successfully',
  });
});

/**
 * @desc    Approve a product (Admin)
 * @route   PUT /api/v1/products/:id/approve
 * @access  Private (Admin, Superadmin)
 */
const approveProduct = asyncHandler(async (req, res) => {
  // Atomic conditional update — prevents two admins from double-processing
  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, status: 'pending_approval' },
    {
      $set: {
        status: 'active',
        approvedBy: req.user.id,
        approvedAt: new Date(),
        rejectionReason: null,
      },
    },
    { new: true, runValidators: true }
  );

  if (!product) {
    // Either doesn't exist or was already processed by someone else
    const existing = await Product.findById(req.params.id).select('status');
    if (!existing) throw ApiError.notFound('Product not found');
    throw ApiError.badRequest(`Cannot approve a product with status '${existing.status}'`);
  }

  return ApiResponse.success(res, {
    data: product,
    message: 'Product approved successfully',
  });
});

/**
 * @desc    Reject a product (Admin)
 * @route   PUT /api/v1/products/:id/reject
 * @access  Private (Admin, Superadmin)
 */
const rejectProduct = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) {
    throw ApiError.badRequest('Rejection reason is required');
  }

  const product = await Product.findOneAndUpdate(
    { _id: req.params.id, status: 'pending_approval' },
    { $set: { status: 'rejected', rejectionReason: reason } },
    { new: true, runValidators: true }
  );

  if (!product) {
    const existing = await Product.findById(req.params.id).select('status');
    if (!existing) throw ApiError.notFound('Product not found');
    throw ApiError.badRequest(`Cannot reject a product with status '${existing.status}'`);
  }

  return ApiResponse.success(res, {
    data: product,
    message: 'Product rejected',
  });
});

/**
 * @desc    Get all products pending approval (Admin)
 * @route   GET /api/v1/products/pending
 * @access  Private (Admin, Superadmin)
 */
const getPendingProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = { status: 'pending_approval' };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug')
      .populate('seller', 'firstName lastName email vendorProfile.shopName'),
    Product.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: products,
    page,
    limit,
    total,
    message: 'Pending products fetched successfully',
  });
});

/**
 * @desc    Admin listing — every product regardless of status.
 * @route   GET /api/v1/products/admin/all
 * @access  Private (Admin, Superadmin)
 */
const getAllProductsAdmin = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, '-createdAt');

  const filter = {};
  if (req.query.status)   filter.status   = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.seller)   filter.seller   = req.query.seller;
  if (req.query.search)   filter.$text    = { $search: req.query.search };

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug icon')
      .populate('seller',   'firstName lastName email vendorProfile.shopName'),
    Product.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: products, page, limit, total,
    message: 'All products fetched (admin)',
  });
});

module.exports = {
  getProducts,
  getMyProducts,
  getProduct,
  createProduct,
  updateProduct,
  updateStock,
  deleteProduct,
  approveProduct,
  rejectProduct,
  getPendingProducts,
  getAllProductsAdmin,
};
