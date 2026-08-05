const asyncHandler = require('../utils/asyncHandler');
const ApiError     = require('../utils/ApiError');
const { uploadToCloudinary } = require('../utils/cloudinaryUpload');

/**
 * POST /api/v1/uploads/image
 * Generic authenticated image upload — used by listing forms (salon
 * spaces, franchise, etc.). Field name must be "file".
 */
exports.uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No image file provided (field name must be "file")');

  let url;
  try {
    const folder = req.body?.folder ? String(req.body.folder).replace(/[^a-zA-Z0-9/_-]/g, '') : null;
    url = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.user._id.toString(), 'image', folder);
  } catch (err) {
    if (err.isOperational) throw err;
    const detail = err?.response?.data?.error?.message || err.message || 'Upload failed';
    throw new ApiError(`Image upload failed: ${detail}`, 500);
  }

  res.status(201).json({ success: true, url });
});

/**
 * POST /api/v1/uploads/video
 * Generic authenticated video upload. Field name must be "file".
 */
exports.uploadVideo = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No video file provided (field name must be "file")');

  let url;
  try {
    const folder = req.body?.folder ? String(req.body.folder).replace(/[^a-zA-Z0-9/_-]/g, '') : null;
    url = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.user._id.toString(), 'video', folder);
  } catch (err) {
    if (err.isOperational) throw err;
    const detail = err?.response?.data?.error?.message || err.message || 'Upload failed';
    throw new ApiError(`Video upload failed: ${detail}`, 500);
  }

  res.status(201).json({ success: true, url });
});

/**
 * POST /api/v1/uploads/document
 * Generic authenticated document upload (PDFs — brochures, pitch decks,
 * price lists, etc). Field name must be "file". Uploaded as a Cloudinary
 * "raw" resource since it isn't an image/video.
 */
exports.uploadDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No document file provided (field name must be "file")');

  let url;
  try {
    const folder = req.body?.folder ? String(req.body.folder).replace(/[^a-zA-Z0-9/_-]/g, '') : null;
    url = await uploadToCloudinary(req.file.buffer, req.file.originalname, req.user._id.toString(), 'raw', folder);
  } catch (err) {
    if (err.isOperational) throw err;
    const detail = err?.response?.data?.error?.message || err.message || 'Upload failed';
    throw new ApiError(`Document upload failed: ${detail}`, 500);
  }

  res.status(201).json({ success: true, url, name: req.file.originalname });
});
