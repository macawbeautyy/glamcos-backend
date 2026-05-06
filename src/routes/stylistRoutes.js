const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getApprovedStylists, getAllStylists, getStylistById,
  registerStylist, approveStylist, rejectStylist, deleteStylist,
} = require('../controllers/stylistController');

router.get('/',            getApprovedStylists);
router.get('/admin/all',   protect, authorize('admin', 'superadmin'), getAllStylists);
router.get('/:id',         getStylistById);
router.post('/register',   registerStylist);
router.put('/:id/approve', protect, authorize('admin', 'superadmin'), approveStylist);
router.put('/:id/reject',  protect, authorize('admin', 'superadmin'), rejectStylist);
router.delete('/:id',      protect, authorize('admin', 'superadmin'), deleteStylist);

module.exports = router;
