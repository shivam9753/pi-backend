const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: function() {
      const { v4: uuidv4 } = require('uuid');
      return uuidv4();
    }
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
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
    enum: ['user', 'writer', 'reviewer', 'admin'],
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
  socialLinks: {
    twitter: { type: String, default: '' },
    instagram: { type: String, default: '' },
    facebook: { type: String, default: '' }
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  featuredAt: {
    type: Date,
    default: null
  },
  ats: {
    type: Number,
    required: true,
    default: 50,
    min: 0,
    max: 100
  }
}, {
  timestamps: true,
  versionKey: false,
  _id: false // Disable automatic _id since we're defining our own string UUID _id
});

// Methods
userSchema.methods.toPublicJSON = function() {
  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    role: this.role,
    bio: this.bio,
    profileImage: this.profileImage,
    socialLinks: this.socialLinks,
    isFeatured: this.isFeatured,
    featuredAt: this.featuredAt,
    ats: this.ats,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

userSchema.methods.toAuthJSON = function() {
  // Auth JSON should avoid exposing password
  return {
    _id: this._id,
    email: this.email,
    name: this.name,
    role: this.role,
    profileImage: this.profileImage
  };
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email });
};

module.exports = mongoose.model('User', userSchema);