const express = require('express');
const router  = express.Router();
const { protect, authorize } = require('../middleware/auth');
const {
  registerEmployer, getMyEmployerProfile, updateEmployerProfile,
  upsertSeekerProfile, getMySeekerProfile,
  getPlans, subscribeToPlan,
  adminGetEmployers, adminReviewEmployer,
  adminGetPendingJobs, adminReviewJob,
  adminUpdatePlan, adminGetSeekers,
  getCandidates,
  getCandidateById,
  contactCandidate,
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

// ── Plans (public) ────────────────────────────────────────────────────────────
// ── Candidate browsing (employer side, earning model) ───────────────────────
router.get('/candidates',            protect, getCandidates);
router.get('/candidates/contacts',   protect, getMyCandidateContacts);
router.get('/candidates/:id',        protect, getCandidateById);
router.post('/candidates/:id/contact', protect, contactCandidate);

router.get('/plans',                 getPlans);
router.post('/subscribe',            protect, subscribeToPlan);
router.post('/subscribe/order',      protect, createSubscriptionOrder);
router.post('/subscribe/verify',     protect, verifySubscriptionPayment);

// ── Admin ─────────────────────────────────────────────────────────────────────
router.get('/admin/employers',       protect, authorize('admin', 'superadmin'), adminGetEmployers);
router.patch('/admin/employers/:id', protect, authorize('admin', 'superadmin'), adminReviewEmployer);
router.get('/admin/jobs',            protect, authorize('admin', 'superadmin'), adminGetPendingJobs);
router.patch('/admin/jobs/:id',      protect, authorize('admin', 'superadmin'), adminReviewJob);
router.patch('/admin/plans/:planKey',protect, authorize('admin', 'superadmin'), adminUpdatePlan);
router.get('/admin/seekers',         protect, authorize('admin', 'superadmin'), adminGetSeekers);
router.post('/admin/seekers',        protect, authorize('admin', 'superadmin'), adminCreateSeeker);
router.delete('/admin/seekers/:id',  protect, authorize('admin', 'superadmin'), adminDeleteSeeker);
router.patch('/admin/seekers/:id',   protect, authorize('admin', 'superadmin'), adminReviewSeeker);

module.exports = router;
