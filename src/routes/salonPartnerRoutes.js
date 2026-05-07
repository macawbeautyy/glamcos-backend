const express    = require('express');
const router     = express.Router();
const ctrl       = require('../controllers/salonPartnerController');
const { protect, adminOnly } = require('../middleware/authMiddleware');

router.post('/',            protect,            ctrl.apply);
router.get('/my',           protect,            ctrl.myStatus);
router.get('/',             protect, adminOnly, ctrl.list);
router.patch('/:id/status', protect, adminOnly, ctrl.updateStatus);

module.exports = router;
