/**
 * ProfileView — records when an APPROVED employer sees a candidate profile.
 *
 * Deliberately strict about what counts, so the numbers a candidate sees on
 * their dashboard mean something:
 *   - Only written from endpoints behind `requireApprovedEmployer`, so a
 *     pending/rejected/unregistered employer viewing a profile records nothing.
 *   - A candidate viewing their own profile never records anything (employers
 *     and seekers are different accounts, and we also guard on self-view).
 *   - Deduped per (employer, profile, kind, day) via `dayKey` + a unique index,
 *     so a recruiter refreshing a profile ten times counts as one view.
 *
 * kind:
 *   'view'   — employer opened the full candidate profile (getCandidateById)
 *   'search' — profile came back in an employer's candidate search/browse list
 */
const mongoose = require('mongoose');

const ProfileViewSchema = new mongoose.Schema({
  seekerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'JobSeekerProfile', required: true, index: true },
  seeker:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  employer:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  employerProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployerProfile' },
  kind:          { type: String, enum: ['view', 'search'], default: 'view', index: true },
  // YYYY-MM-DD of the view — the dedupe bucket.
  dayKey:        { type: String, required: true },
}, { timestamps: true });

// One row per employer per profile per kind per day.
ProfileViewSchema.index(
  { seekerProfile: 1, employer: 1, kind: 1, dayKey: 1 },
  { unique: true }
);
// Insight queries are always "this profile, this kind, since date".
ProfileViewSchema.index({ seekerProfile: 1, kind: 1, createdAt: -1 });

module.exports = mongoose.model('ProfileView', ProfileViewSchema);
