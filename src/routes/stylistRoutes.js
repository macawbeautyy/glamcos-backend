const express = require('express');
const router  = express.Router();
const {
  getApprovedStylists, getAllStylists, getStylistById,
  registerStylist, approveStylist, rejectStylist, deleteStylist,
} = require('../controllers/stylistController');

router.get('/',            getApprovedStylists);
router.get('/admin/all',   getAllStylists);
router.get('/:id',         getStylistById);
router.post('/register',   registerStylist);
router.put('/:id/approve', approveStylist);
router.put('/:id/reject',  rejectStylist);
router.delete('/:id',      deleteStylist);

module.exports = router;