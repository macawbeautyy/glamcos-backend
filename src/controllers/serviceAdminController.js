const Service = require('../models/Service');
const Category = require('../models/Category');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { parsePagination } = require('../utils/helpers');

/**
 * @desc    Get all services for admin (no status filter)
 * @route   GET /api/v1/services/admin/all
 * @access  Private (Admin, Superadmin)
 */
const getAllServicesAdmin = asyncHandler(async (req, res) => {
  const services = await Service.find()
    .sort('-createdAt')
    .populate('category', 'name slug icon')
    .populate('provider', 'firstName lastName email');

  return ApiResponse.success(res, {
    data: services,
    message: 'All services fetched',
  });
});

/**
 * @desc    Get all services pending approval
 * @route   GET /api/v1/services/admin/pending
 * @access  Private (Admin, Superadmin)
 */
const getPendingServices = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const filter = { status: 'pending_approval' };

  const [services, total] = await Promise.all([
    Service.find(filter)
      .sort({ createdAt: 1 }) // Oldest first (FIFO)
      .skip(skip)
      .limit(limit)
      .populate('category', 'name slug')
      .populate('provider', 'firstName lastName email providerProfile.businessName'),
    Service.countDocuments(filter),
  ]);

  return ApiResponse.paginated(res, {
    data: services,
    page,
    limit,
    total,
    message: 'Pending services fetched successfully',
  });
});

/**
 * @desc    Admin creates a service directly (auto-approved, active immediately)
 * @route   POST /api/v1/services/admin/create
 * @access  Private (Admin, Superadmin)
 */
const createServiceAsAdmin = asyncHandler(async (req, res) => {
  const {
    name, description, category, price, duration,
    thumbnail, image, tags, serviceArea,
  } = req.body;

  // Validate category
  const cat = await Category.findById(category);
  if (!cat) throw ApiError.badRequest('Category does not exist');

  const service = await Service.create({
    name,
    description:  description || `${name} service provided by GlamCos.`,
    category,
    provider:     req.user.id, // admin's user ID as provider
    price:        Number(price),
    duration:     Number(duration) || 60,
    thumbnail:    thumbnail || image || '',
    images:       image ? [image] : [],
    tags:         tags || [],
    serviceArea:  serviceArea || 'flexible',
    status:       'active',    // auto-approved
    isActive:     true,
    isFeatured:   false,
  });

  await service.populate('category', 'name slug');

  return ApiResponse.created(res, {
    data: service,
    message: 'Service created and published',
  });
});

/**
 * @desc    Admin updates a service directly
 * @route   PUT /api/v1/services/admin/:id
 * @access  Private (Admin, Superadmin)
 */
const updateServiceAsAdmin = asyncHandler(async (req, res) => {
  const {
    name, description, category, price, duration,
    thumbnail, image, tags, serviceArea, isActive, isFeatured,
  } = req.body;

  const updateData = {};
  if (name        !== undefined) updateData.name        = name;
  if (description !== undefined) updateData.description = description;
  if (category    !== undefined) {
    const cat = await Category.findById(category);
    if (!cat) throw ApiError.badRequest('Category does not exist');
    updateData.category = category;
  }
  if (price       !== undefined) updateData.price       = Number(price);
  if (duration    !== undefined) updateData.duration    = Number(duration);
  if (thumbnail   !== undefined) updateData.thumbnail   = thumbnail;
  if (image       !== undefined) { updateData.thumbnail = image; updateData.images = [image]; }
  if (tags        !== undefined) updateData.tags        = tags;
  if (serviceArea !== undefined) updateData.serviceArea = serviceArea;
  if (isActive    !== undefined) updateData.isActive    = isActive;
  if (isFeatured  !== undefined) updateData.isFeatured  = isFeatured;

  const service = await Service.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  ).populate('category', 'name slug');

  if (!service) throw ApiError.notFound('Service not found');

  return ApiResponse.success(res, {
    data: service,
    message: 'Service updated successfully',
  });
});

/**
 * @desc    Approve a service
 * @route   PUT /api/v1/services/:id/approve
 * @access  Private (Admin, Superadmin)
 */
const approveService = asyncHandler(async (req, res) => {
  const service = await Service.findById(req.params.id);

  if (!service) throw ApiError.notFound('Service not found');

  if (service.status !== 'pending_approval') {
    throw ApiError.badRequest(`Cannot approve a service with status '${service.status}'`);
  }

  service.status          = 'active';
  service.approvedBy      = req.user.id;
  service.approvedAt      = new Date();
  service.rejectionReason = null;
  await service.save();

  return ApiResponse.success(res, {
    data: service,
    message: 'Service approved successfully',
  });
});

/**
 * @desc    Reject a service
 * @route   PUT /api/v1/services/:id/reject
 * @access  Private (Admin, Superadmin)
 */
const rejectService = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  if (!reason) throw ApiError.badRequest('Rejection reason is required');

  const service = await Service.findById(req.params.id);

  if (!service) throw ApiError.notFound('Service not found');

  if (service.status !== 'pending_approval') {
    throw ApiError.badRequest(`Cannot reject a service with status '${service.status}'`);
  }

  service.status          = 'rejected';
  service.rejectionReason = reason;
  await service.save();

  return ApiResponse.success(res, {
    data: service,
    message: 'Service rejected',
  });
});

module.exports = {
  getAllServicesAdmin,
  getPendingServices,
  createServiceAsAdmin,
  updateServiceAsAdmin,
  approveService,
  rejectService,
};
