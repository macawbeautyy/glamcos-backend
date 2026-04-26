const express = require('express');
const router  = express.Router();
const { getLoyaltySummary, validateRedemption } = require('../controllers/loyaltyController');
const { protect } = require('../middleware/auth');

router.get('/',                    protect, getLoyaltySummary);
router.post('/validate-redemption', protect, validateRedemption);

module.exports = router;
