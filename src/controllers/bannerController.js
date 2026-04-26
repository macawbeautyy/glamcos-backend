const asyncHandler  = require('../utils/asyncHandler');
const ApiError      = require('../utils/ApiError');
const ApiResponse   = require('../utils/ApiResponse');
const Banner        = require('../models/Banner');

// GET /api/v1/banners  — public: active banners only
exports.getActiveBanners = asyncHandler(async (req, res) => {
  const banners = await Banner.find({ isActive: true }).sort({ order: 1, createdAt: -1 });
  return ApiResponse.success(res, { data: banners, message: 'Banners fetched' });
});

// GET /api/v1/banners/admin/all  — admin: all banners regardless of status
exports.getAllBanners = asyncHandler(async (req, res) => {
  const banners = await Banner.find().sort({ order: 1, createdAt: -1 });
  return ApiResponse.success(res, { data: banners, message: 'All banners fetched' });
});

// POST /api/v1/banners
exports.createBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.create(req.body);
  return ApiResponse.created(res, { data: banner, message: 'Banner created' });
});

// PUT /api/v1/banners/:id
exports.updateBanner = asyncHandler(async (req, res) => {
  const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!banner) throw new ApiError(404, 'Banner not found');
  return ApiResponse.success(res, { data: banner, message: 'Banner updated' });
});

// DELETE /api/v1/banners/:id
exports.deleteBanner = asyncHandler(async (req, res) => {
  await Banner.findByIdAndDelete(req.params.id);
  return ApiResponse.success(res, { data: null, message: 'Banner deleted' });
});
