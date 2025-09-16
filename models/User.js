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
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 2,
    maxlength: 50
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
  isFeatured: {
    type: Boolean,
    default: false
  },
  featuredAt: {
    type: Date,
    default: null
  },
}, {
  timestamps: true,
  versionKey: false,
  _id: false // Disable automatic _id since we're defining our own string UUID _id
});

// Indexes are automatically created by unique: true in schema
// userSchema.index({ email: 1 }); // Removed - handled by unique: true
// userSchema.index({ username: 1 }); // Removed - handled by unique: true

// Methods
userSchema.methods.toPublicJSON = function() {
  return {
    _id: this._id,
    email: this.email,
    username: this.username,
    name: this.name,
    role: this.role,
    bio: this.bio,
    profileImage: this.profileImage,
    isFeatured: this.isFeatured,
    featuredAt: this.featuredAt
  };
};

userSchema.methods.toAuthJSON = function() {
  return {
    _id: this._id,
    email: this.email,
    username: this.username,
    name: this.name,
    role: this.role,
    bio: this.bio,
    profileImage: this.profileImage,
    isFeatured: this.isFeatured,
    featuredAt: this.featuredAt
  };
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email });
};

userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username });
};

module.exports = mongoose.model('User', userSchema);