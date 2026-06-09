const express = require('express');
const multer  = require('multer');
const router = express.Router();
const { firebaseLogin } = require('../controllers/authController');

const {
  register,
  login,
  refreshToken,
  getMe,
  updateProfile,
  uploadAvatar,
  changePassword,
  logout,
  updateFCMToken,
  updateNotifPrefs,
  updateLocation,
  getAllUsers,
  updateUserStatus,
  forgotPassword,
  resetPassword,
  deleteAccount,
  adminDeleteUser,
} = require('../controllers/authController');

const { protect, authorize } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');

// Multer: avatar image upload (max 5 MB, images only)
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

// ── Validation Rules ──────────────────────────────────────────────────────────

const registerValidation = validate([
  { field: 'firstName', type: 'string',   required: true,  min: 2, max: 50, label: 'First name' },
  { field: 'lastName',  type: 'string',   required: true,  min: 2, max: 50, label: 'Last name' },
  { field: 'email',     type: 'email',    required: true },
  { field: 'password',  type: 'password', required: true },
  { field: 'role',      type: 'enum',     required: false, values: ['user', 'provider', 'vendor'] },
]);

const loginValidation = validate([
  { field: 'email',    type: 'email',  required: true },
  { field: 'password', type: 'string', required: true, min: 1 },
]);

const changePasswordValidation = validate([
  { field: 'currentPassword', type: 'string',   required: true, min: 1,  label: 'Current password' },
  { field: 'newPassword',     type: 'password',  required: true,          label: 'New password' },
]);

// ── Public Routes ─────────────────────────────────────────────────────────────
router.post('/register',       authLimiter, registerValidation, register);
router.post('/login',          authLimiter, loginValidation,    login);
router.post('/refresh-token',  authLimiter, refreshToken);
router.post('/forgot-password',authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/firebase',       authLimiter, firebaseLogin);

// ── Protected Routes ──────────────────────────────────────────────────────────
router.get('/me',              protect, getMe);
router.put('/me',              protect, updateProfile);
router.post('/upload-avatar',  protect, avatarUpload.single('avatar'), uploadAvatar);
router.put('/change-password', protect, changePasswordValidation, changePassword);
router.post('/logout',         protect, logout);
router.put('/fcm-token',       protect, updateFCMToken);
router.put('/notif-prefs',     protect, updateNotifPrefs);
router.put('/location',        protect, updateLocation);

router.delete('/me',           protect, deleteAccount);

// ── Admin Routes ──────────────────────────────────────────────────────────────
router.get(   '/admin/users',            protect, authorize('admin', 'superadmin'), getAllUsers);
router.put(   '/admin/users/:id/status', protect, authorize('admin', 'superadmin'), updateUserStatus);
router.delete('/admin/users/:id',        protect, authorize('superadmin'),           adminDeleteUser);

module.exports = router;
