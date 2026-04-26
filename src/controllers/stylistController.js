const asyncHandler = require('../utils/asyncHandler');
const ApiError     = require('../utils/ApiError');
const ApiResponse  = require('../utils/ApiResponse');
const Stylist      = require('../models/Stylist');

// GET /api/v1/stylists  — public: approved stylists
exports.getApprovedStylists = asyncHandler(async (req, res) => {
  const { skill, limit = 20, page = 1 } = req.query;
  const filter = { status: 'approved' };
  if (skill) filter.skills = { $in: [new RegExp(skill, 'i')] };

  const total    = await Stylist.countDocuments(filter);
  const stylists = await Stylist.find(filter)
    .select('-bankDetails -aadhaar -pan')
    .sort({ rating: -1, reviewsCount: -1 })
    .limit(+limit).skip((+page - 1) * +limit);

  return res.json(new ApiResponse(200, { total, data: stylists }, 'Stylists fetched'));
});

// GET /api/v1/stylists/admin/all  — admin: all stylists
exports.getAllStylists = asyncHandler(async (req, res) => {
  const { status, limit = 50, page = 1 } = req.query;
  const filter = status ? { status } : {};

  const total    = await Stylist.countDocuments(filter);
  const stylists = await Stylist.find(filter)
    .sort({ createdAt: -1 })
    .limit(+limit).skip((+page - 1) * +limit);

  return res.json(new ApiResponse(200, { total, data: stylists }, 'Stylists fetched'));
});

// GET /api/v1/stylists/:id
exports.getStylistById = asyncHandler(async (req, res) => {
  const stylist = await Stylist.findById(req.params.id).select('-bankDetails -aadhaar -pan');
  if (!stylist) throw new ApiError(404, 'Stylist not found');
  return res.json(new ApiResponse(200, stylist, 'Stylist fetched'));
});

// POST /api/v1/stylists/register
exports.registerStylist = asyncHandler(async (req, res) => {
  const exists = await Stylist.findOne({ email: req.body.email });
  if (exists) throw new ApiError(400, 'Already registered with this email');

  const stylist = await Stylist.create({
    ...req.body,
    bankDetails: {
      accountNumber: req.body.accountNumber,
      ifsc:          req.body.ifsc,
      accountName:   req.body.accountName,
      bankName:      req.body.bankName,
    },
  });
  return res.status(201).json(new ApiResponse(201, stylist, 'Application submitted for review'));
});

// PUT /api/v1/stylists/:id/approve
exports.approveStylist = asyncHandler(async (req, res) => {
  const stylist = await Stylist.findByIdAndUpdate(
    req.params.id,
    { status: 'approved', rejectionReason: null },
    { new: true }
  );
  if (!stylist) throw new ApiError(404, 'Stylist not found');
  return res.json(new ApiResponse(200, stylist, 'Stylist approved'));
});

// PUT /api/v1/stylists/:id/reject
exports.rejectStylist = asyncHandler(async (req, res) => {
  const stylist = await Stylist.findByIdAndUpdate(
    req.params.id,
    { status: 'rejected', rejectionReason: req.body.reason || 'Does not meet requirements' },
    { new: true }
  );
  if (!stylist) throw new ApiError(404, 'Stylist not found');
  return res.json(new ApiResponse(200, stylist, 'Stylist rejected'));
});

// DELETE /api/v1/stylists/:id
exports.deleteStylist = asyncHandler(async (req, res) => {
  await Stylist.findByIdAndDelete(req.params.id);
  return res.json(new ApiResponse(200, null, 'Stylist removed'));
});