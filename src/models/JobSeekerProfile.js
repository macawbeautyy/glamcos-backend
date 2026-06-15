const mongoose = require('mongoose');

const JobSeekerProfileSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName:    { type: String, required: true, trim: true },
  phone:       { type: String, default: '' },
  email:       { type: String, default: '', trim: true, lowercase: true }, // used for manual (admin-added) candidates
  isManual:    { type: Boolean, default: false },  // true when added by admin, no app account
  dateOfBirth: { type: Date },
  gender:      { type: String, enum: ['male', 'female', 'other', ''], default: '' },
  profilePhoto:{ type: String, default: '' }, // URL

  // Professional info
  title:       { type: String, default: '' },  // e.g. "Senior Hair Stylist"
  bio:         { type: String, default: '' },
  skills:      [{ type: String, trim: true }],
  experience:  { type: String, default: '' },  // e.g. "3 years"
  currentCity: { type: String, default: '' },
  preferredJobTypes: [{ type: String }],        // ['full_time', 'part_time']
  expectedSalary: {
    min: { type: Number, default: 0 },
    max: { type: Number, default: 0 },
  },

  // CV / Portfolio
  cvUrl:        { type: String, default: '' },   // uploaded PDF URL
  cvFilename:   { type: String, default: '' },
  portfolioUrls:[{ type: String }],

  // Education
  education: [{
    institute: String,
    course:    String,
    year:      String,
  }],

  // Previous work experience
  previousWork: [{
    company:     { type: String, default: '' },
    role:        { type: String, default: '' },
    duration:    { type: String, default: '' },  // e.g. "Jan 2022 - Dec 2023"
    description: { type: String, default: '' },
  }],

  // Accommodation needs (live-in stylists, out-of-town candidates etc.)
  needsAccommodation: { type: Boolean, default: false },
  accommodationNotes: { type: String, default: '' }, // e.g. "Need single room near salon"

  // Gallery photos showcasing past work
  galleryPhotos: [{ type: String }],

  // Admin approval — candidates are visible to employers only once approved
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true,
  },
  rejectionReason: { type: String, default: '' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: { type: Date },

  // Profile completeness tracking
  isProfileComplete: { type: Boolean, default: false },
  profileCompleteness: { type: Number, default: 0 }, // 0-100
}, { timestamps: true });

JobSeekerProfileSchema.index({ user: 1 });

// Calculate completeness before save
JobSeekerProfileSchema.pre('save', function (next) {
  let score = 0;
  if (this.fullName)    score += 15;
  if (this.phone)       score += 10;
  if (this.title)       score += 10;
  if (this.bio)         score += 10;
  if (this.skills?.length > 0)  score += 15;
  if (this.experience)  score += 10;
  if (this.cvUrl)       score += 15;
  if (this.currentCity) score += 10;
  if (this.profilePhoto) score += 5;
  this.profileCompleteness = score;
  this.isProfileComplete   = score >= 70;
  next();
});

module.exports = mongoose.model('JobSeekerProfile', JobSeekerProfileSchema);
