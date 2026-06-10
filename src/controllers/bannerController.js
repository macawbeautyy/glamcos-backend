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

// POST /api/v1/banners/upload-image — admin: upload a banner image file (Cloudinary)
exports.uploadBannerImage = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'No image file provided');

  const axios    = require('axios');
  const FormData = require('form-data');
  const path     = require('path');

  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  const apiKey       = process.env.CLOUDINARY_API_KEY;
  const apiSecret    = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName) throw new ApiError(503, 'Image storage not configured');

  const ext    = path.extname(req.file.originalname) || '.jpg';
  const folder = 'banners';
  const form   = new FormData();
  form.append('file', req.file.buffer, { filename: `banner_${Date.now()}${ext}`, contentType: req.file.mimetype || 'image/jpeg' });
  form.append('resource_type', 'image');
  form.append('folder', folder);

  let imageUrl;
  if (uploadPreset) {
    form.append('upload_preset', uploadPreset);
    const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, form, {
      headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 60_000,
    });
    imageUrl = r.data.secure_url;
  } else if (apiKey && apiSecret) {
    const crypto    = require('crypto');
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign    = `folder=${folder}&resource_type=image&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    form.append('api_key', apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, form, {
      headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 60_000,
    });
    imageUrl = r.data.secure_url;
  } else {
    throw new ApiError(503, 'Cloudinary credentials not configured');
  }

  return ApiResponse.success(res, { data: { url: imageUrl }, message: 'Image uploaded successfully' });
});
