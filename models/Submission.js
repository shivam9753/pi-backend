const mongoose = require('mongoose');
const { 
  SUBMISSION_STATUS, 
  REVIEW_ACTIONS, 
  SUBMISSION_TYPES, 
  STATUS_ARRAYS,
  STATUS_ACTION_MAP,
  STATUS_UTILS 
} = require('../constants/status.constants');

const submissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: false,
    default: ''
  },
  contentIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Content'
  }],
  submissionType: {
    type: String,
    enum: STATUS_ARRAYS.ALL_SUBMISSION_TYPES,
    required: true
  },
  status: {
    type: String,
    enum: STATUS_ARRAYS.ALL_SUBMISSION_STATUSES,
    default: SUBMISSION_STATUS.DRAFT
  },
  imageUrl: {
    type: String,
    default: ''
  },
  excerpt: {
    type: String,
    maxlength: 200
  },
  readingTime: {
    type: Number,
    default: 1
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Editorial workflow fields
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedAt: {
    type: Date,
    default: null
  },
  
  // Submission history tracking
  history: [{
    action: {
      type: String,
      enum: STATUS_ARRAYS.ALL_REVIEW_ACTIONS,
      required: true
    },
    status: {
      type: String,
      enum: STATUS_ARRAYS.ALL_SUBMISSION_STATUSES,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    userRole: {
      type: String,
      enum: STATUS_ARRAYS.ALL_USER_ROLES,
      required: true
    },
    notes: {
      type: String,
      default: ''
    }
  }],
  // For needs_revision status
  revisionNotes: {
    type: String,
    default: ''
  },
  // SEO Metadata
  seo: {
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    },
    metaTitle: {
      type: String,
      maxlength: 60,
      trim: true
    },
    metaDescription: {
      type: String,
      maxlength: 160,
      trim: true
    },
    keywords: [{
      type: String,
      trim: true,
      lowercase: true
    }],
    ogImage: {
      type: String,
      trim: true
    },
    canonical: {
      type: String,
      trim: true
    },
  },
  // Draft-specific fields
  lastEditedAt: {
    type: Date,
    default: Date.now
  },
  draftExpiresAt: {
    type: Date,
    index: true
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Trending tracking fields
  recentViews: {
    type: Number,
    default: 0,
    min: 0
  },
  windowStartTime: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  versionKey: false
});

// Indexes
submissionSchema.index({ userId: 1 });
submissionSchema.index({ status: 1 });
submissionSchema.index({ submissionType: 1 });
submissionSchema.index({ createdAt: -1 });
submissionSchema.index({ reviewedAt: -1 });
submissionSchema.index({ isFeatured: 1 });
// Compound indexes for common queries
submissionSchema.index({ status: 1, submissionType: 1 });
submissionSchema.index({ status: 1, isFeatured: 1 });
submissionSchema.index({ status: 1, reviewedAt: -1 });
// SEO slug index for fast URL lookups
submissionSchema.index({ 'seo.slug': 1 }, { unique: true, sparse: true });
// Trending indexes
submissionSchema.index({ recentViews: -1 });
submissionSchema.index({ viewCount: -1 });
submissionSchema.index({ status: 1, recentViews: -1 });
submissionSchema.index({ windowStartTime: 1 });

// Methods

submissionSchema.methods.toggleFeatured = async function() {
  this.isFeatured = !this.isFeatured;
  return await this.save();
};

// Method to add history entry
submissionSchema.methods.addHistoryEntry = function(action, newStatus, userId, userRole, notes = '') {
  // Validate required parameters
  if (!userRole) {
    throw new Error('userRole is required for history entry');
  }
  
  // Validate that the userRole is valid
  const { STATUS_ARRAYS } = require('../constants/status.constants');
  if (!STATUS_ARRAYS.ALL_USER_ROLES.includes(userRole)) {
    throw new Error(`Invalid userRole: ${userRole}. Must be one of: ${STATUS_ARRAYS.ALL_USER_ROLES.join(', ')}`);
  }
  
  this.history.push({
    action,
    status: newStatus,
    user: userId,
    userRole,
    notes,
    timestamp: new Date()
  });
  this.status = newStatus;
  if (['approved', 'rejected', 'needs_changes', 'shortlisted'].includes(action)) {
    this.reviewedAt = new Date();
    this.reviewedBy = userId;
  }
  
  // Handle assignment for in_progress status
  if (action === 'moved_to_in_progress') {
    this.assignedTo = userId;
    this.assignedAt = new Date();
  } else if (['approved', 'rejected', 'needs_changes', 'shortlisted', 'published', 'archived'].includes(action)) {
    // Clear assignment when moving to final states
    this.assignedTo = null;
    this.assignedAt = null;
  }
  
  return this;
};

// Method to change status with history tracking
submissionSchema.methods.changeStatus = async function(newStatus, user, notes = '') {
  // user can be either a user object with {_id, role} or just a userId for backward compatibility
  let userId, userRole;
  
  if (typeof user === 'object' && user._id && user.role) {
    userId = user._id;
    userRole = user.role;
  } else if (typeof user === 'string' || (typeof user === 'object' && user.toString)) {
    // Backward compatibility: if just userId is passed, we need to look up the role
    userId = user.toString();
    const User = require('./User');
    const userData = await User.findById(userId).select('role');
    if (!userData) {
      throw new Error('User not found');
    }
    userRole = userData.role;
  } else {
    throw new Error('Invalid user parameter. Expected user object with {_id, role} or userId string');
  }
  
  // Validate status
  if (!STATUS_UTILS.isValidSubmissionStatus(newStatus)) {
    throw new Error(`Invalid submission status: ${newStatus}`);
  }
  
  // Validate status transition
  if (!STATUS_UTILS.isValidStatusTransition(this.status, newStatus)) {
    throw new Error(`Invalid status transition from ${this.status} to ${newStatus}`);
  }
  
  const action = STATUS_UTILS.getActionForStatus(newStatus);
  
  if (!action) {
    throw new Error(`No action mapping defined for status: ${newStatus}`);
  }
  
  // Update the status
  this.status = newStatus;
  
  // Add history entry
  this.addHistoryEntry(action, newStatus, userId, userRole, notes);
  
  if (newStatus === SUBMISSION_STATUS.NEEDS_CHANGES || newStatus === SUBMISSION_STATUS.NEEDS_REVISION) {
    this.revisionNotes = notes;
  }
  
  return await this.save();
};

// Static method to check if submission can be moved to in_progress
submissionSchema.statics.canMoveToInProgress = async function(submissionId) {
  const submission = await this.findById(submissionId);
  if (!submission) {
    throw new Error('Submission not found');
  }
  
  // Check if submission is in a valid state to be moved to in_progress
  const validStates = ['submitted', 'shortlisted'];
  if (!validStates.includes(submission.status)) {
    return { canMove: false, reason: `Cannot move from ${submission.status} to in_progress` };
  }
  
  // Check if submission is already assigned to someone
  if (submission.assignedTo) {
    return { canMove: false, reason: 'Submission is already being handled by someone else' };
  }
  
  return { canMove: true };
};

// Instance method to release assignment
submissionSchema.methods.releaseAssignment = async function() {
  if (this.status === 'in_progress') {
    this.assignedTo = null;
    this.assignedAt = null;
    this.status = 'submitted';
    return await this.save();
  }
  return this;
};


// Static methods
submissionSchema.statics.findPublished = function(filters = {}) {
  const query = { status: 'published', ...filters };
  return this.find(query)
    .populate('userId', 'username email profileImage')
    .populate('reviewedBy', 'username')
    .sort({ reviewedAt: -1 });
};

submissionSchema.statics.findFeatured = function(filters = {}) {
  const query = { status: 'published', isFeatured: true, ...filters };
  return this.find(query)
    .populate('userId', 'username email profileImage')
    .sort({ reviewedAt: -1 });
};

submissionSchema.statics.findWithContent = function(id) {
  return this.findById(id)
    .populate('userId', 'username email profileImage')
    .populate('contentIds')
    .populate('reviewedBy', 'username');
};

submissionSchema.statics.calculateReadingTime = function(contents) {
  const totalWords = contents.reduce((total, content) => {
    if (!content.body) return total;
    const wordCount = content.body.trim().split(/\s+/).filter(word => word.length > 0).length;
    return total + wordCount;
  }, 0);
  return Math.ceil(totalWords / 200);
};

submissionSchema.statics.generateExcerpt = function(contents, maxLength = 150) {
  if (!contents || contents.length === 0) return '';
  
  const firstContent = contents[0];
  if (!firstContent.body) return '';
  
  // Remove all HTML tags and clean up the text
  const text = firstContent.body
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&nbsp;/g, ' ') // Replace non-breaking spaces
    .replace(/&amp;/g, '&')  // Decode HTML entities
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&[^;]+;/g, ' ') // Replace any other entities with space
    .replace(/\s+/g, ' ')     // Collapse multiple whitespace to single space
    .replace(/\n/g, ' ')      // Replace newlines with spaces
    .trim();
  
  return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
};

submissionSchema.statics.generateSlug = function(title, authorName) {
  // Create base slug from title
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .trim();
  
  // Add author name if slug is too short or generic
  if (slug.length < 10 || ['poem', 'story', 'article', 'essay'].includes(slug)) {
    const authorSlug = authorName
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    slug = `${slug}-by-${authorSlug}`;
  }
  
  return slug;
};

submissionSchema.statics.findBySlug = function(slug) {
  return this.findOne({ 
    'seo.slug': slug, 
    status: 'published' 
  })
    .populate('userId', 'name username email profileImage')
    .populate({
      path: 'contentIds',
      select: 'title body type tags'
    });
};


// Draft management static methods
submissionSchema.statics.findUserDrafts = function(userId) {
  return this.find({
    userId: userId,
    status: 'draft'
  })
    .populate('contentIds')
    .sort({ lastEditedAt: -1 });
};

submissionSchema.statics.cleanupExpiredDrafts = function() {
  const now = new Date();
  return this.deleteMany({
    status: 'draft',
    draftExpiresAt: { $lte: now }
  });
};

submissionSchema.statics.createDraft = function(draftData) {
  const oneWeekFromNow = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
  
  return this.create({
    ...draftData,
    status: 'draft',
    lastEditedAt: new Date(),
    draftExpiresAt: oneWeekFromNow
  });
};

// Trending static methods
submissionSchema.statics.findTrending = function(limit = 10, windowDays = 7) {
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const cutoffTime = new Date(Date.now() - windowMs);
  
  return this.find({
    status: 'published',
    recentViews: { $gt: 0 },
    windowStartTime: { $gte: cutoffTime }
  })
    .populate('userId', 'name username email profileImage')
    .populate('contentIds', 'title body type tags')
    .sort({ recentViews: -1, viewCount: -1 })
    .limit(limit);
};

submissionSchema.statics.findMostViewed = function(limit = 10, timeframe = 'all') {
  let query = { status: 'published', viewCount: { $gt: 0 } };
  
  if (timeframe !== 'all') {
    const days = timeframe === 'week' ? 7 : timeframe === 'month' ? 30 : 365;
    const cutoffTime = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    query.createdAt = { $gte: cutoffTime };
  }
  
  return this.find(query)
    .populate('userId', 'name username email profileImage')
    .populate('contentIds', 'title body type tags')
    .sort({ viewCount: -1 })
    .limit(limit);
};


// Instance methods for drafts
submissionSchema.methods.updateDraft = function(updateData) {
  const oneWeekFromNow = new Date(Date.now() + (7 * 24 * 60 * 60 * 1000));
  
  Object.assign(this, updateData);
  this.lastEditedAt = new Date();
  this.draftExpiresAt = oneWeekFromNow; // Reset expiration
  
  return this.save();
};

submissionSchema.methods.convertDraftToSubmission = function() {
  this.status = 'pending_review';
  this.draftExpiresAt = undefined;
  this.lastEditedAt = new Date();
  
  return this.save();
};

// View tracking methods
submissionSchema.methods.logView = function(windowDays = 7) {
  const now = new Date();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const windowStart = new Date(this.windowStartTime);
  
  // Check if current window has expired
  if (now - windowStart > windowMs) {
    // Reset window
    this.recentViews = 1;
    this.windowStartTime = now;
  } else {
    // Increment current window
    this.recentViews = (this.recentViews || 0) + 1;
  }
  
  // Always increment total views
  this.viewCount = (this.viewCount || 0) + 1;
  
  // Save with validation disabled to avoid issues with existing data
  return this.save({ validateBeforeSave: false });
};

submissionSchema.methods.getTrendingScore = function() {
  if (!this.viewCount || this.viewCount === 0) return 0;
  return Math.round((this.recentViews / this.viewCount) * 100);
};

module.exports = mongoose.model('Submission', submissionSchema);