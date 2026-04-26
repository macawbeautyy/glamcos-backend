const express = require('express');
const router  = express.Router();
const {
  getActiveBanners, getAllBanners, createBanner, updateBanner, deleteBanner,
} = require('../controllers/bannerController');

router.get('/',          getActiveBanners);
router.get('/admin/all', getAllBanners);
router.post('/',         createBanner);
router.put('/:id',       updateBanner);
router.delete('/:id',    deleteBanner);

module.exports = router;