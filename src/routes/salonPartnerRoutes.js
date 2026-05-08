const express  = require('express');
const router   = express.Router();
const ctrl     = require('../controllers/salonPartnerController');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

// Applicant / owner routes
router.post('/',             optionalAuth, ctrl.apply);           // submit application
router.get('/my',            protect,      ctrl.myStatus);        // check own status
router.patch('/my',          protect,      ctrl.updateMyProfile); // owner updates own profile
router.post('/my/staff',     protect,      ctrl.addStaff);        // add staff member
router.delete('/my/staff/:staffId', protect, ctrl.removeStaff);  // remove staff member
router.post('/my/images',            protect,      ctrl.uploadImage);     // upload a photo (base64)
router.delete('/my/images/:index',   protect,      ctrl.deleteImage);     // delete a photo by index

// Admin routes
router.get('/',             protect, authorize('admin','superadmin'), ctrl.list);
router.patch('/:id/status', protect, authorize('admin','superadmin'), ctrl.updateStatus);

module.exports = router;
