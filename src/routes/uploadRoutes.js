const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect } = require('../middleware/auth');
const { uploadImage, uploadVideo } = require('../controllers/uploadController');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'));
  },
});

router.post('/image', protect, imageUpload.single('file'), uploadImage);
router.post('/video', protect, videoUpload.single('file'), uploadVideo);

module.exports = router;
