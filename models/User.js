const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 30
  },
  name: {
    type: String,
    required: false,
    trim: true,
    maxlength: 100,
    default: ''
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['user', 'reviewer', 'admin'],
    default: 'user'
  },
  bio: {
    type: String,
    maxlength: 500,
    default: ''
  },
  profileImage: {
    type: String,
    default: ''
  },
  // Temporary fields for first-time submissions
  tempBio: {
    type: String,
    maxlength: 500,
    default: ''
  },
  tempProfileImage: {
    type: String,
    default: ''
  },
  // Approval status for profile data
  profileApproval: {
    bioApproved: { type: Boolean, default: false },
    imageApproved: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date }
  },
  socialLinks: {
    website: { type: String, default: '' },
    twitter: { type: String, default: '' },
    instagram: { type: String, default: '' },
    linkedin: { type: String, default: '' }
  },
  stats: {
    totalPublished: { type: Number, default: 0 },
    totalViews: { type: Number, default: 0 },
    totalLikes: { type: Number, default: 0 },
    followers: { type: Number, default: 0 },
    following: { type: Number, default: 0 }
  },
  preferences: {
    showEmail: { type: Boolean, default: false },
    showStats: { type: Boolean, default: true },
    allowMessages: { type: Boolean, default: true }
  },
  // Track if user has completed initial profile setup
  profileCompleted: {
    type: Boolean,
    default: false
  },
  // Track when user first registered
  firstLogin: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes are automatically created by unique: true in schema
// userSchema.index({ email: 1 }); // Removed - handled by unique: true
// userSchema.index({ username: 1 }); // Removed - handled by unique: true

// Methods
userSchema.methods.toPublicJSON = function() {
  const user = this.toObject();
  delete user.password;
  return user;
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email });
};

userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username });
};

module.exports = mongoose.model('User', userSchema);