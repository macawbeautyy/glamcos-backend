const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  getJobs,
  getJobById,
  postJob,
  updateJob,
  deleteJob,
  boostJob,
  applyForJob,
  getMyApplications,
  getMyListings,
  getJobApplications,
  getAllApplications,
  updateApplicationStatus,
  createJobApplicantUnlockOrder,
  verifyJobApplicantUnlockPayment,
} = require('../controllers/jobController');

// ── IMPORTANT: Specific static routes must come BEFORE /:id wildcard routes ──

// ── Public routes ─────────────────────────────────────────────────────────────
router.get('/', getJobs);

// ── Admin routes (before /:id to avoid conflicts) ─────────────────────────────
router.get('/admin/applications', protect, authorize('admin'), getAllApplications);

// ── Seeker routes ─────────────────────────────────────────────────────────────
router.get('/applications/my', protect, getMyApplications);

// ── Employer static routes ────────────────────────────────────────────────────
router.post('/', protect, postJob);
router.get('/my/listings', protect, getMyListings);
router.patch('/applications/:applicationId/status', protect, updateApplicationStatus);

// ── Dynamic /:id routes (must be AFTER all static routes) ─────────────────────
router.get('/:id', getJobById);
router.post('/:id/apply', protect, applyForJob);
router.patch('/:id', protect, updateJob);
router.delete('/:id', protect, deleteJob);
router.post('/:id/boost', protect, boostJob);
router.get('/:id/applications', protect, getJobApplications);
router.post('/:id/applications/:applicationId/unlock/order',  protect, createJobApplicantUnlockOrder);
router.post('/:id/applications/:applicationId/unlock/verify', protect, verifyJobApplicantUnlockPayment);

module.exports = router;
