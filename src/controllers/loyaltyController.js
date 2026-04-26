const ApiResponse  = require('../utils/ApiResponse');
const ApiError     = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const loyalty      = require('../services/loyalty');

/**
 * GET /api/v1/loyalty
 * Get loyalty summary: balance, tier, transaction history
 */
const getLoyaltySummary = asyncHandler(async (req, res) => {
  const summary = await loyalty.getLoyaltySummary(req.user.id);
  return ApiResponse.success(res, { data: summary, message: 'Loyalty summary' });
});

/**
 * POST /api/v1/loyalty/validate-redemption
 * Validate points before applying at checkout
 * Body: { points: 200 }
 */
const validateRedemption = asyncHandler(async (req, res) => {
  const { points } = req.body;
  if (!points || points <= 0) throw ApiError.badRequest('Invalid points value');

  const result = await loyalty.validateRedemption(req.user.id, Number(points));
  return ApiResponse.success(res, {
    data: result,
    message: `${result.pointsToUse} points = ₹${result.discount} discount`,
  });
});

module.exports = { getLoyaltySummary, validateRedemption };
