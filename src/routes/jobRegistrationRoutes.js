const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  registerEmployer, getMyEmployerProfile, updateEmployerProfile,
  upsertSeekerProfile, getMySeekerProfile, uploadSeekerCV,
  getPlans, subscribeToPlan,
  adminGetEmployers, adminReviewEmployer,
  adminGetPendingJobs, adminReviewJob,
  adminEditJob, adminDeleteJob, adminEditSeeker,
  adminUpdatePlan, adminGetSeekers,
  getCandidates,
  getCandidateById,
  contactCandidate,
  createUnlockOrder,
  verifyUnlockPayment,
  createBundleOrder,
  verifyBundlePayment,
  swipeCandidate,
  getMyCandidateContacts,
  adminReviewSeeker,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  adminCreateSeeker,
  adminDeleteSeeker,
} = require('../controllers/jobRegistrationController');

// ── Employer ──────────────────────────────────────────────────────────────────
router.post('/employer/register',    protect, registerEmployer);
router.get('/employer/me',           protect, getMyEmployerProfile);
router.put('/employer/me',           protect, updateEmployerProfile);

// ── Seeker ────────────────────────────────────────────────────────────────────
router.post('/seeker/profile',       protect, upsertSeekerProfile);
router.get('/seeker/me',             protect, getMySeekerProfile);

// CV file upload: images (photo/scan of CV) or PDF/DOC/DOCX, max 10 MB
const cvUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (file.mimetype.startsWith('image/') || allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only images, PDF, or Word documents are allowed'), false);
  },
});
router.post('/seeker/upload-cv',     protect, cvUpload.single('cv'), uploadSeekerCV);

// ── Plans (public) ────────────────────────────────────────────────────────────
// ── Candidate browsing (employer side, earning model) ───────────────────────
router.get('/candidates',            protect, getCandidates);
router.get('/candidates/contacts',   protect, getMyCandidateContacts);
router.get('/candidates/:id',        protect, getCandidateById);
router.post('/candidates/:id/contact',       protect, contactCandidate);
router.post('/candidates/:id/unlock/order',  protect, createUnlockOrder);
router.post('/candidates/:id/unlock/verify', protect, verifyUnlockPayment);
router.post('/candidates/:id/swipe',         protect, swipeCandidate);

// ── Unlock credit bundles ─────────────────────────────────────────────────────
router.post('/credits/order',        protect, createBundleOrder);
router.post('/credits/verify',       protect, verifyBundlePayment);

router.get('/plans',                 getPlans);
router.post('/subscribe',            protect, subscribeToPlan);
router.post('/subscribe/order',      protect, createSubscriptionOrder);
router.post('/subscribe/verify',     protect, verifySubscriptionPayment);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/employers',       protect, authorize('admin', 'superadmin'), adminGetEmployers);
router.patch('/admin/employers/:id', protect, authorize('admin', 'superadmin'), adminReviewEmployer);
router.get('/admin/jobs',            protect, authorize('admin', 'superadmin'), adminGetPendingJobs);
router.patch('/admin/jobs/:id',      protect, authorize('admin', 'superadmin'), adminReviewJob);
router.put('/admin/jobs/:id',        protect, authorize('admin', 'superadmin'), adminEditJob);
router.delete('/admin/jobs/:id',     protect, authorize('admin', 'superadmin'), adminDeleteJob);
router.patch('/admin/plans/:planKey',protect, authorize('admin', 'superadmin'), adminUpdatePlan);
router.get('/admin/seekers',         protect, authorize('admin', 'superadmin'), adminGetSeekers);
router.post('/admin/seekers',        protect, authorize('admin', 'superadmin'), adminCreateSeeker);
router.delete('/admin/seekers/:id',  protect, authorize('admin', 'superadmin'), adminDeleteSeeker);
router.patch('/admin/seekers/:id',   protect, authorize('admin', 'superadmin'), adminReviewSeeker);
router.put('/admin/seekers/:id',     protect, authorize('admin', 'superadmin'), adminEditSeeker);

module.exports = router;
