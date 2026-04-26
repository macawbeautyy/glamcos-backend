const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { sanitizeUser } = require('../utils/helpers');
const config = require('../config/env');

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, role } = req.body;

  const existingUser = await User.findOne({
    $or: [{ email }, ...(phone ? [{ phone }] : [])],
  });

  if (existingUser) {
    throw ApiError.conflict(
      existingUser.email === email
        ? 'An account with this email already exists'
        : 'An account with this phone number already exists'
    );
  }

  const allowedRoles = ['user', 'provider', 'vendor'];
  const userRole = allowedRoles.includes(role) ? role : 'user';

  const user = await User.create({
    firstName,
    lastName,
    email,
    phone,
    password,
    role: userRole,
    status: 'active',
  });

  sendTokenResponse(user, 201, 'Account created successfully', res);
});

/**
 * @desc    Login user
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw ApiError.badRequest('Please provide email and password');
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (user.status === 'suspended') {
    throw ApiError.forbidden('Your account has been suspended. Contact support.');
  }
  if (user.status === 'banned') {
    throw ApiError.forbidden('Your account has been permanently banned.');
  }

  user.lastLogin = new Date();
  user.loginCount += 1;
  await user.save({ validateBeforeSave: false });

  sendTokenResponse(user, 200, 'Login successful', res);
});

/**
 * @desc    Refresh access token
 * @route   POST /api/v1/auth/refresh-token
 * @access  Public
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    throw ApiError.badRequest('Refresh token is required');
  }

  const jwt = require('jsonwebtoken');
  let decoded;

  try {
    decoded = jwt.verify(token, config.jwt.refreshSecret);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const user = await User.findById(decoded.id).select('+refreshToken');

  if (!user || user.refreshToken !== token) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  sendTokenResponse(user, 200, 'Token refreshed', res);
});

/**
 * @desc    Get current logged-in user
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  return ApiResponse.success(res, {
    data: { user: sanitizeUser(user) },
    message: 'Profile fetched successfully',
  });
});

/**
 * @desc    Update user profile
 * @route   PUT /api/v1/auth/me
 * @access  Private
 */
const updateProfile = asyncHandler(async (req, res) => {
  const allowedFields = [
    'firstName', 'lastName', 'phone', 'avatar', 'address',
  ];

  const updates = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  }

  const user = await User.findByIdAndUpdate(req.user.id, updates, {
    new: true,
    runValidators: true,
  });

  return ApiResponse.success(res, {
    data: { user: sanitizeUser(user) },
    message: 'Profile updated successfully',
  });
});

/**
 * @desc    Change password
 * @route   PUT /api/v1/auth/change-password
 * @access  Private
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('Current password and new password are required');
  }

  const user = await User.findById(req.user.id).select('+password');

  const isMatch = await user.matchPassword(currentPassword);
  if (!isMatch) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  user.password = newPassword;
  await user.save();

  sendTokenResponse(user, 200, 'Password changed successfully', res);
});

/**
 * @desc    Logout
 * @route   POST /api/v1/auth/logout
 * @access  Private
 */
const logout = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { refreshToken: null });

  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 5 * 1000),
    httpOnly: true,
  });

  return ApiResponse.success(res, {
    data: null,
    message: 'Logged out successfully',
  });
});

/**
 * @desc    Register / update Expo push notification token
 * @route   PUT /api/v1/auth/fcm-token
 * @access  Private
 */
const updateFCMToken = asyncHandler(async (req, res) => {
  const { token: fcmToken, deviceId } = req.body;
  if (!fcmToken) throw ApiError.badRequest('FCM token is required');

  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound('User not found');

  if (!user.fcmTokens.includes(fcmToken)) {
    user.fcmTokens.push(fcmToken);
  }

  if (deviceId) {
    const existing = user.deviceInfo.find((d) => d.deviceId === deviceId);
    if (existing) {
      existing.lastUsed = new Date();
    } else {
      user.deviceInfo.push({ deviceId, platform: req.body.platform || 'unknown', lastUsed: new Date() });
    }
  }

  await user.save({ validateBeforeSave: false });

  return ApiResponse.success(res, {
    data: null,
    message: 'FCM token registered',
  });
});

/**
 * @desc    Admin: Get all users (filterable by role / status)
 * @route   GET /api/v1/auth/admin/users
 * @access  Admin
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const {
    role,
    status,
    search,
    page    = 1,
    limit   = 50,
    sort    = '-createdAt',
  } = req.query;

  const filter = {};

  if (role   && role   !== 'all') filter.role   = role;
  if (status && status !== 'all') filter.status = status;

  if (search) {
    const regex = new RegExp(search, 'i');
    filter.$or  = [
      { firstName: regex },
      { lastName:  regex },
      { email:     regex },
      { phone:     regex },
    ];
  }

  const skip  = (Number(page) - 1) * Number(limit);
  const total = await User.countDocuments(filter);

  const users = await User.find(filter)
    .select('-password -refreshToken -__v')
    .sort(sort)
    .skip(skip)
    .limit(Number(limit))
    .lean();

  return ApiResponse.success(res, {
    data: {
      users,
      pagination: {
        total,
        page:       Number(page),
        limit:      Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    },
    message: `${total} users found`,
  });
});

/**
 * @desc    Admin: Update user status (suspend / activate / ban)
 * @route   PUT /api/v1/auth/admin/users/:id/status
 * @access  Admin
 */
const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowed = ['active', 'inactive', 'suspended', 'banned'];

  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`Status must be one of: ${allowed.join(', ')}`);
  }

  // Prevent admin from suspending themselves
  if (req.params.id === req.user.id.toString()) {
    throw ApiError.badRequest('You cannot change your own account status.');
  }

  const user = await User.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true }
  ).select('-password -refreshToken');

  if (!user) throw ApiError.notFound('User not found');

  return ApiResponse.success(res, {
    data: { user: sanitizeUser(user) },
    message: `User status updated to ${status}`,
  });
});

// ── Helper: Generate tokens and send response ─────────────────────────────────
const sendTokenResponse = async (user, statusCode, message, res) => {
  const accessToken     = user.getSignedToken();
  const newRefreshToken = user.getRefreshToken();

  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  const cookieOptions = {
    expires:  new Date(Date.now() + config.jwt.cookieExpire * 24 * 60 * 60 * 1000),
    httpOnly: true,
    secure:   config.env === 'production',
    sameSite: 'strict',
  };

  return res
    .status(statusCode)
    .cookie('token', accessToken, cookieOptions)
    .json({
      success: true,
      status:  statusCode,
      message,
      data: {
        user: sanitizeUser(user),
        tokens: {
          accessToken,
          refreshToken: newRefreshToken,
          expiresIn:    config.jwt.expire,
        },
      },
    });
};

/**
 * @desc    Update user's current GPS location
 * @route   PUT /api/v1/auth/location
 * @access  Private
 */
const updateLocation = asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;

  if (latitude == null || longitude == null) {
    throw ApiError.badRequest('latitude and longitude are required');
  }

  await User.findByIdAndUpdate(req.user.id, {
    location: {
      type:        'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)],
    },
  });

  return ApiResponse.success(res, {
    data: null,
    message: 'Location updated',
  });
});

/**
 * @desc    Request password reset OTP
 * @route   POST /api/v1/auth/forgot-password
 * @access  Public
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Email address is required');

  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Always return success — don't reveal if email exists (security)
  if (!user) {
    return ApiResponse.success(res, {
      data: null,
      message: 'If this email is registered, an OTP has been sent.',
    });
  }

  // Generate 6-digit OTP
  const crypto = require('crypto');
  const otp    = Math.floor(100000 + Math.random() * 900000).toString();

  // Store hashed OTP + 10-minute expiry
  user.resetPasswordToken  = crypto.createHash('sha256').update(otp).digest('hex');
  user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes
  await user.save({ validateBeforeSave: false });

  // Try to send email
  const { sendEmail } = require('../utils/mailer');
  const emailResult = await sendEmail({
    to:      user.email,
    subject: 'MACAW — Password Reset OTP',
    text: [
      `Hello ${user.firstName},`,
      ``,
      `Your password reset OTP is: ${otp}`,
      ``,
      `This OTP expires in 10 minutes.`,
      `If you didn't request a password reset, please ignore this email.`,
      ``,
      `— MACAW Beauty Team`,
    ].join('\n'),
    html: `
      <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:24px">
        <h2 style="color:#7C3AED">Password Reset</h2>
        <p>Hello <strong>${user.firstName}</strong>,</p>
        <p>Use the OTP below to reset your password:</p>
        <div style="background:#F5F3FF;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
          <span style="font-size:36px;font-weight:900;letter-spacing:10px;color:#7C3AED">${otp}</span>
        </div>
        <p style="color:#888;font-size:13px">This OTP expires in 10 minutes.</p>
        <p style="color:#888;font-size:13px">If you didn't request a password reset, ignore this email.</p>
      </div>
    `,
  });

  // In dev (no SMTP), include OTP hint in response so dev can test
  const devNote = (!emailResult.success && process.env.NODE_ENV !== 'production')
    ? { devOtp: otp, devNote: 'SMTP not configured — OTP shown here for dev/testing only' }
    : {};

  return ApiResponse.success(res, {
    data: devNote,
    message: 'If this email is registered, an OTP has been sent.',
  });
});

/**
 * @desc    Reset password using OTP
 * @route   POST /api/v1/auth/reset-password
 * @access  Public
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    throw ApiError.badRequest('Email, OTP, and new password are all required');
  }
  if (newPassword.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters');
  }

  const crypto    = require('crypto');
  const hashedOtp = crypto.createHash('sha256').update(otp.toString().trim()).digest('hex');

  const user = await User.findOne({
    email:               email.toLowerCase().trim(),
    resetPasswordToken:  hashedOtp,
    resetPasswordExpire: { $gt: Date.now() },
  });

  if (!user) {
    throw ApiError.badRequest('Invalid or expired OTP. Please request a new one.');
  }

  // Set new password and clear reset fields
  user.password            = newPassword;
  user.resetPasswordToken  = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  return ApiResponse.success(res, {
    data: null,
    message: 'Password reset successfully. Please log in with your new password.',
  });
});

module.exports = {
  register,
  login,
  refreshToken,
  getMe,
  updateProfile,
  changePassword,
  logout,
  updateFCMToken,
  updateLocation,
  getAllUsers,
  updateUserStatus,
  forgotPassword,
  resetPassword,
};
