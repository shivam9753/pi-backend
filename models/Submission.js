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
    // Primary focus keyword for submission (editor-provided)
    primaryKeyword: {
      type: String,
      trim: true,
      default: ''
    },
    ogImage: {
      type: String,
      trim: true
    },
    canonical: {
      type: String,
      trim: true
    }
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
  // Topic pitch support removed
  // Trending tracking fields
  // Keep lifetime viewCount; per-doc rolling-window fields (recentViews/windowStartTime) are deprecated
  viewCount: {
    type: Number,
    default: 0,
    min: 0
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
// Keep indexes relevant to querying by counts
submissionSchema.index({ viewCount: -1 });
submissionSchema.index({ status: 1, viewCount: -1 });

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
          userRole = 'user'; // Safe fallback for general user actions
          console.log('🔧 Using fallback role "user" for action:', action);
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

// Static helper: populate contentIds into content documents (keeps order)
submissionSchema.statics.populateContentIds = async function(submission) {
  const Content = require('./Content');
  if (!submission) return submission;

  // Allow passing either a mongoose document or a plain object
  const raw = (typeof submission.toObject === 'function') ? submission.toObject() : submission;
  const ids = Array.isArray(raw.contentIds) ? raw.contentIds.filter(Boolean) : [];
  if (!ids.length) return raw;

  // Fetch contents and order them according to ids
  const contents = await Content.find({ _id: { $in: ids } }).lean();
  const map = new Map(contents.map(c => [String(c._id), c]));
  const ordered = ids.map(id => map.get(String(id))).filter(Boolean);

  // Return a plain object with populated contentIds
  const result = { ...raw, contentIds: ordered };
  return result;
};

// Static method: findTrending
// Returns top published submissions ordered by trending views in the recent window (fallback to viewCount)
submissionSchema.statics.findTrending = async function(limit = 10, windowDays = 7) {
  try {
    limit = Math.min(parseInt(limit, 10) || 10, 200);
    windowDays = Math.max(parseInt(windowDays, 10) || 7, 1);

    const DailyView = require('./DailyView');

    // Compute date key in YYYY-MM-DD for start of window (inclusive)
    const now = new Date();
    const windowStart = new Date(now.getTime() - (windowDays * 24 * 60 * 60 * 1000));
    const startKey = windowStart.toISOString().slice(0, 10);

    // Aggregate recent daily view buckets to find top targetIds
    const agg = await DailyView.aggregate([
      { $match: { targetType: 'submission', date: { $gte: startKey } } },
      { $group: { _id: '$targetId', views: { $sum: '$count' } } },
      { $sort: { views: -1 } },
      { $limit: Math.min(limit * 5, 500) }
    ]).allowDiskUse(true);

    const ids = agg.map(a => (a._id ? String(a._id) : null)).filter(Boolean);

    if (ids.length === 0) {
      // Fallback: return top submissions by lifetime viewCount
      const fallback = await this.find({ status: 'published' })
        .sort({ viewCount: -1, reviewedAt: -1 })
        .limit(limit)
        .lean();
      return fallback;
    }

    // Fetch published submissions matching these ids
    const submissions = await this.find({ _id: { $in: ids }, status: 'published' })
      .populate('userId', 'name username profileImage')
      .lean();

    // Order according to aggregated ids order
    const submissionsMap = new Map(submissions.map(s => [String(s._id), s]));
    const ordered = ids.map(id => submissionsMap.get(id)).filter(Boolean);

    // If we still don't have enough results, pad with top viewCount submissions
    if (ordered.length < limit) {
      const extra = await this.find({ status: 'published', _id: { $nin: ordered.map(s => s._id) } })
        .sort({ viewCount: -1, reviewedAt: -1 })
        .limit(limit - ordered.length)
        .lean();
      ordered.push(...extra);
    }

    return ordered.slice(0, limit);
  } catch (err) {
    console.error('Error in Submission.findTrending:', err);
    // On error, degrade to simple popular query
    try {
      const fallback = await this.find({ status: 'published' })
        .sort({ viewCount: -1, reviewedAt: -1 })
        .limit(limit)
        .lean();
      return fallback;
    } catch (e) {
      console.error('Fallback error in Submission.findTrending:', e);
      return [];
    }
  }
};

// Static helper: findBySlug
submissionSchema.statics.findBySlug = async function(slug) {
  if (!slug || typeof slug !== 'string') return null;

  // Normalize incoming slug (strip leading paths)
  slug = slug.trim();
  if (slug.includes('/')) {
    // If full path provided, take last segment
    const parts = slug.split('/').filter(Boolean);
    slug = parts[parts.length - 1];
  }

  // Ensure lowercase
  slug = slug.toLowerCase();

  // Find published submission with matching seo.slug
  const submission = await this.findOne({ 'seo.slug': slug, status: 'published' })
    .populate('userId', 'name username profileImage')
    .lean();

  return submission;
};

module.exports = mongoose.model('Submission', submissionSchema);