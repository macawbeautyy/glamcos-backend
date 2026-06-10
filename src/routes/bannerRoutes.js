const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getActiveBanners, getAllBanners, createBanner, updateBanner, deleteBanner, uploadBannerImage,
} = require('../controllers/bannerController');

// Multer: banner image upload (max 5 MB, images only)
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

router.get('/',          getActiveBanners);
router.get('/admin/all', protect, authorize('admin', 'superadmin'), getAllBanners);
router.post('/upload-image', protect, authorize('admin', 'superadmin'), bannerUpload.single('image'), uploadBannerImage);
router.post('/',         protect, authorize('admin', 'superadmin'), createBanner);
router.put('/:id',       protect, authorize('admin', 'superadmin'), updateBanner);
router.delete('/:id',    protect, authorize('admin', 'superadmin'), deleteBanner);

module.exports = router;
