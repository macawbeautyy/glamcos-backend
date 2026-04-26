const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getActiveBanners, getAllBanners, createBanner, updateBanner, deleteBanner,
} = require('../controllers/bannerController');

router.get('/',          getActiveBanners);
router.get('/admin/all', protect, authorize('admin', 'superadmin'), getAllBanners);
router.post('/',         protect, authorize('admin', 'superadmin'), createBanner);
router.put('/:id',       protect, authorize('admin', 'superadmin'), updateBanner);
router.delete('/:id',    protect, authorize('admin', 'superadmin'), deleteBanner);

module.exports = router;
