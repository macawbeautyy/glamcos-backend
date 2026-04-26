const Service = require('../models/Service');
const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination, parseSort } = require('../utils/helpers');

/**
 * @desc    Get all services (public listing with filters)
 * @route   GET /api/v1/services
 * @access  Public
 */
const getServices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, '-createdAt');

  // Build filter
  const filter = { status: 'active', isActive: true };

  if (req.query.category)    filter.category    = req.query.category;
  if (req.query.provider)    filter.provider    = req.query.provider;
  if (req.query.priceType)   filter.priceType   = req.query.priceType;
  if (req.query.serviceArea) filter.serviceArea = req.query.serviceArea;
  if (req.query.featured === 'true') filter.isFeatured = true;

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

  const [services, total] = await Promise.all([
    Service.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug icon')
      .populate('provider', 'firstName lastName avatar providerProfile.businessName providerProfile.rating'),
    Service.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: services,
    page,
    limit,
    total,
    message: 'Services fetched successfully',
  });
});

/**
 * @desc    Get services for logged-in provider (their own)
 * @route   GET /api/v1/services/dashboard/my-services
 * @access  Private (Provider)
 */
const getMyServices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const sort = parseSort(req.query.sort, '-createdAt');

  const filter = { provider: req.user.id };

  if (req.query.status)   filter.status   = req.query.status;
  if (req.query.category) filter.category = req.query.category;

  const [services, total] = await Promise.all([
    Service.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug'),
    Service.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: services,
    page,
    limit,
    total,
    message: 'Your services fetched successfully',
  });
});

/**
 * @desc    Get single service by ID or slug
 * @route   GET /api/v1/services/:id
 * @access  Public
 */
const getService = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const isObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const filter = isObjectId ? { _id: id } : { slug: id };

  const service = await Service.findOne(filter)
    .populate('category', 'name slug icon')
    .populate('provider', 'firstName lastName avatar phone providerProfile');

  if (!service) {
    throw ApiError.notFound('Service not found');
  }

  // Non-active services visible only to owner or admin
  if (service.status !== 'active') {
    const isOwner = req.user && req.user.id === service.provider._id.toString();
    const isAdmin = req.user && ['admin', 'superadmin'].includes(req.user.role);
    if (!isOwner && !isAdmin) {
      throw ApiError.notFound('Service not found');
    }
  }

  return ApiResponse.success(res, {
    data: service,
    message: 'Service fetched successfully',
  });
});

/**
 * @desc    Create a new service (submitted for approval)
 * @route   POST /api/v1/services
 * @access  Private (Provider)
 */
const createService = asyncHandler(async (req, res) => {
  const {
    name, description, shortDescription, category, price,
    comparePrice, priceType, duration, images, thumbnail,
    tags, inclusions, exclusions, serviceArea, serviceRadius,
  } = req.body;

  // Validate category exists and accepts services
  const cat = await Category.findById(category);
  if (!cat) throw ApiError.badRequest('Category does not exist');
  if (cat.type === 'product') throw ApiError.badRequest('This category is for products only');

  const service = await Service.create({
    name,
    description,
    shortDescription,
    category,
    provider: req.user.id,
    price,
    comparePrice,
    priceType,
    duration,
    images,
    thumbnail,
    tags,
    inclusions,
    exclusions,
    serviceArea,
    serviceRadius,
    status: 'pending_approval',
  });

  await service.populate('category', 'name slug');

  return ApiResponse.created(res, {
    data: service,
    message: 'Service created and submitted for approval',
  });
});

/**
 * @desc    Update a service
 * @route   PUT /api/v1/services/:id
 * @access  Private (Owner Provider)
 */
const updateService = asyncHandler(async (req, res) => {
  let service = await Service.findById(req.params.id);

  if (!service) throw ApiError.notFound('Service not found');

  // Only owner can update (admins use approve/reject)
  if (service.provider.toString() !== req.user.id) {
    throw ApiError.forbidden('You can only update your own services');
  }

  const allowedFields = [
    'name', 'description', 'shortDescription', 'category', 'price',
    'comparePrice', 'priceType', 'duration', 'images', 'thumbnail',
    'tags', 'inclusions', 'exclusions', 'serviceArea', 'serviceRadius',
    'isActive',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  }

  // Validate category if changing
  if (updates.category) {
    const cat = await Category.findById(updates.category);
    if (!cat) throw ApiError.badRequest('Category does not exist');
    if (cat.type === 'product') throw ApiError.badRequest('This category is for products only');
  }

  // If editing key fields on an active service, resubmit for approval
  if (service.status === 'active' && Object.keys(updates).some(
    (k) => ['name', 'description', 'price', 'category'].includes(k)
  )) {
    updates.status = 'pending_approval';
  }

  service = await Service.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  }).populate('category', 'name slug');

  return ApiResponse.success(res, {
    data: service,
    message: 'Service updated successfully',
  });
});

/**
 * @desc    Delete a service
 * @route   DELETE /api/v1/services/:id
 * @access  Private (Owner Provider, Admin)
 */
const deleteService = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) throw ApiError.notFound('Service not found');

  const isOwner = service.provider.toString() === req.user.id;
  const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

  if (!isOwner && !isAdmin) {
    throw ApiError.forbidden('You can only delete your own services');
  }

  // Soft delete if has bookings, hard delete otherwise
  if (service.totalBookings > 0) {
    service.status   = 'archived';
    service.isActive = false;
    await service.save();

    return ApiResponse.success(res, {
      data: null,
      message: 'Service archived (has booking history)',
    });
  }

  await Service.findByIdAndDelete(req.params.id);

  return ApiResponse.success(res, {
    data: null,
    message: 'Service deleted successfully',
  });
});

module.exports = {
  getServices,
  getMyServices,
  getService,
  createService,
  updateService,
  deleteService,
};
