const path     = require('path');
const axios    = require('axios');
const FormData = require('form-data');
const ApiError = require('./ApiError');

/**
 * Shared Cloudinary uploader — extracted from reelController's working
 * upload-video/upload-thumbnail flow so any feature (salon listings,
 * franchise listings, product photos, etc.) can reuse it instead of each
 * screen calling Cloudinary's public "demo" account directly from the
 * client (which doesn't accept uploads and was the root cause of "image
 * won't add" — the demo cloud's ml_default preset returns "Upload preset
 * not found").
 *
 * Uses real server-side credentials from env vars:
 *   CLOUDINARY_CLOUD_NAME + CLOUDINARY_UPLOAD_PRESET  (unsigned), or
 *   CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET (signed)
 *
 * resourceType: 'image' | 'video'
 * Returns the secure CDN URL.
 */
async function uploadToCloudinary(buffer, originalName, userId, resourceType = 'image', folder = null) {
  const cloudName    = process.env.CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;
  const apiKey       = process.env.CLOUDINARY_API_KEY;
  const apiSecret    = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName) {
    throw new ApiError('File storage is not configured on the server. Please set CLOUDINARY_CLOUD_NAME in environment variables.', 503);
  }

  const ext         = path.extname(originalName) || (resourceType === 'image' ? '.jpg' : '.mp4');
  const contentType = resourceType === 'image' ? 'image/jpeg' : 'video/mp4';
  const uploadFolder = folder || `uploads/${userId}`;

  const form = new FormData();
  form.append('file', buffer, { filename: `${resourceType}_${userId}_${Date.now()}${ext}`, contentType });
  form.append('resource_type', resourceType);
  form.append('folder', uploadFolder);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`;

  if (uploadPreset) {
    form.append('upload_preset', uploadPreset);
    const res = await axios.post(endpoint, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120_000 });
    return res.data.secure_url;
  }
  if (apiKey && apiSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const crypto    = require('crypto');
    const toSign    = `folder=${uploadFolder}&resource_type=${resourceType}&timestamp=${timestamp}${apiSecret}`;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');
    form.append('api_key',   apiKey);
    form.append('timestamp', String(timestamp));
    form.append('signature', signature);
    const res = await axios.post(endpoint, form, { headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 120_000 });
    return res.data.secure_url;
  }
  throw new ApiError('File storage not fully configured. Set CLOUDINARY_UPLOAD_PRESET or CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET.', 503);
}

module.exports = { uploadToCloudinary };
