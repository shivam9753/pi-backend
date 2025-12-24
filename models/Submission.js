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
  _id: {
    type: String,
    default: function() {
      const { v4: uuidv4 } = require('uuid');
      return uuidv4();
    }
  },
  userId: {
    type: String,
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
    type: String,
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
    type: String,
    ref: 'User'
  },
  // Editorial workflow fields
  assignedTo: {
    type: String,
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
      type: String,
      ref: 'User',
      required: true
    },
    userRole: {
      type: String,
      enum: STATUS_ARRAYS.ALL_USER_ROLES,
      required: false
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
      maxlength: 70,
      trim: true
    },
    metaDescription: {
      type: String,
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
  // Topic pitch reference for submissions created from topic pitches
  topicPitchId: {
    type: String,
    ref: 'TopicPitch',
    default: null,
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
  versionKey: false,
  _id: false // Disable automatic _id since we're defining our own string UUID _id
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
submissionSchema.methods.addHistoryEntry = async function(action, newStatus, userId, userRole, notes = '') {
  // Ensure we have a user ID for the history entry
  if (!userId || (typeof userId === 'string' && userId.trim().length === 0)) {
    throw new Error('User ID is required for history entry');
  }
  
  // Convert userId to string for consistency
  userId = userId.toString();
  
  // If userRole is not provided, get it from the user
  if (!userRole) {
    try {
      const User = require('./User');
      const userData = await User.findById(userId).select('role');
      if (userData) {
        userRole = userData.role;
        console.log('🔧 Found user role for history entry:', userRole);
      } else {
        // User not found - this could happen due to data inconsistency after ID migration
        console.warn(`⚠️ User not found for ID ${userId} during history entry creation. Using fallback role.`);
        
        // Check if this is an admin/reviewer action by checking the action type
        if (['approved', 'rejected', 'needs_changes', 'shortlisted', 'published'].includes(action)) {
          userRole = 'reviewer'; // Safe fallback for review actions
          console.log('🔧 Using fallback role "reviewer" for review action:', action);
        } else {
          userRole = 'user'; // Safe fallback for user actions
          console.log('🔧 Using fallback role "user" for user action:', action);
        }
      }
    } catch (error) {
      // Handle database lookup errors more gracefully
      console.error(`❌ Database error during user lookup for history entry:`, error);
      
      if (error.name === 'CastError') {
        throw new Error(`Invalid user ID format: ${userId}`);
      }
      
      // For production resilience, use fallback role instead of throwing
      console.warn(`⚠️ Failed to lookup user for history entry, using fallback role`);
      userRole = ['approved', 'rejected', 'needs_changes', 'shortlisted', 'published'].includes(action) ? 'reviewer' : 'user';
      console.log('🔧 Using fallback role:', userRole);
    }
  }
  
  // Validate that the userRole is valid if provided
  if (userRole) {
    const { STATUS_ARRAYS } = require('../constants/status.constants');
    if (!STATUS_ARRAYS.ALL_USER_ROLES.includes(userRole)) {
      throw new Error(`Invalid userRole: ${userRole}. Must be one of: ${STATUS_ARRAYS.ALL_USER_ROLES.join(', ')}`);
    }
  }
  
  // Final validation before adding to history
  if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('Valid user ID is required for history entry');
  }
  
  this.history.push({
    action,
    status: newStatus,
    user: userId.trim(),
    userRole, // Will be set from lookup above
    notes: notes || '',
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
  
  // Debug logging
  console.log('🔧 changeStatus called with:', { newStatus, userType: typeof user, user: JSON.stringify(user, null, 2) });
  
  if (typeof user === 'object' && user._id) {
    userId = user._id;
    userRole = user.role; // May be undefined in production data
    console.log('🔧 Using user object - userId:', userId, 'userRole:', userRole);
    
    // If userRole is missing from user object, look it up
    if (!userRole) {
      console.log('🔧 UserRole missing from user object, looking up in database...');
      try {
        const User = require('./User');
        const userData = await User.findById(userId).select('role');
        if (userData) {
          userRole = userData.role;
          console.log('🔧 Found userRole from database:', userRole);
        } else {
          // User not found - this is critical for history integrity
          throw new Error(`User not found for ID ${userId} - cannot create history entry without valid user`);
        }
      } catch (error) {
        if (error.name === 'CastError') {
          throw new Error(`Invalid user ID format: ${userId}`);
        }
        throw new Error(`Failed to lookup user for history entry: ${error.message}`);
      }
    }
  } else if (typeof user === 'string' || (typeof user === 'object' && user.toString)) {
    // Backward compatibility: if just userId is passed, we need to look up the role
    userId = user.toString();
    
    // Validate the userId format before attempting database lookup
    if (!userId || userId.trim().length === 0) {
      throw new Error('Invalid user ID: User ID cannot be empty');
    }
    
    try {
      const User = require('./User');
      const userData = await User.findById(userId).select('role');
      if (!userData) {
        throw new Error(`User not found for ID: ${userId}`);
      }
      userRole = userData.role;
    } catch (error) {
      // More specific error handling
      if (error.name === 'CastError') {
        throw new Error(`Invalid user ID format: ${userId}`);
      }
      throw new Error(`Failed to lookup user: ${error.message}`);
    }
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
  await this.addHistoryEntry(action, newStatus, userId, userRole, notes);
  
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

// Helper method to manually populate contentIds (reusable across methods)
submissionSchema.statics.populateContentIds = async function(submission) {
  if (!submission || !submission.contentIds || submission.contentIds.length === 0) {
    return submission;
  }
  
  // Use direct MongoDB query with string IDs
  const contents = await this.db.collection('contents').find({
    _id: { $in: submission.contentIds }
  }).toArray();
  
  // Create a map for fast lookup
  const contentMap = new Map(contents.map(content => [content._id, content]));
  
  // Sort contents to match the order in submission.contentIds
  const sortedContents = submission.contentIds
    .map(id => contentMap.get(id))
    .filter(Boolean); // Remove any null/undefined entries
  
  // Convert to plain JavaScript objects to avoid Mongoose serialization issues
  const plainContents = sortedContents.map(content => ({
    _id: content._id,
    title: content.title,
    body: content.body,
    type: content.type, // Include type for backward compatibility
    tags: content.tags || [],
    footnotes: content.footnotes || '',
    seo: content.seo || {},
    viewCount: content.viewCount || 0,
    isFeatured: content.isFeatured || false,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt
  }));
  
  // Create a completely new object to avoid Mongoose interference
  let submissionObj;
  try {
    submissionObj = submission.toObject ? submission.toObject() : { ...submission };
    
    // Ensure user data is properly handled
    if (submissionObj.userId && submissionObj.userId._id) {
      // User is populated, keep as is
    } else if (submissionObj.userId) {
      // User ID exists but not populated, that's fine
    } else {
      // No user ID at all
      submissionObj.userId = null;
    }
    
  } catch (error) {
    console.error('Error converting submission to object:', error);
    // Fallback: create manual object
    submissionObj = {
      _id: submission._id,
      title: submission.title,
      userId: submission.userId,
      status: submission.status,
      seo: submission.seo,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    };
  }
  
  submissionObj.contentIds = plainContents;
  return submissionObj;
};

submissionSchema.statics.findBySlug = async function(slug) {
  try {
    // First find the submission
    const submission = await this.findOne({ 
      'seo.slug': slug, 
      status: 'published' 
    }).populate('userId', 'name username email profileImage');
    
    if (!submission) {
      return null;
    }
    
    // Use helper method to populate content
    return await this.populateContentIds(submission);
    
  } catch (error) {
    console.error('Error in findBySlug:', error);
    throw error;
  }
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
    .populate('contentIds', 'title body type tags footnotes')
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
    .populate('contentIds', 'title body type tags footnotes')
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