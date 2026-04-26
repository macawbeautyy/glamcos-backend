const mongoose = require('mongoose');

const JobSeekerProfileSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  fullName:    { type: String, required: true, trim: true },
  phone:       { type: String, default: '' },
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

  // Status (seekers are auto-approved but profile completeness is tracked)
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
  if (this.cvUrl)       score += 20;
  if (this.currentCity) score += 10;
  this.profileCompleteness = score;
  this.isProfileComplete   = score >= 70;
  next();
});

module.exports = mongoose.model('JobSeekerProfile', JobSeekerProfileSchema);
