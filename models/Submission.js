const mongoose = require('mongoose');
const { 
  SUBMISSION_STATUS, 
  STATUS_ARRAYS,
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
    maxlength: 300
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
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
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  publishedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  versionKey: false,
  _id: false
});
submissionSchema.set('strictPopulate', false);
// Indexes
submissionSchema.index({ userId: 1 });
submissionSchema.index({ status: 1 });
submissionSchema.index({ submissionType: 1 });
submissionSchema.index({ createdAt: -1 });
submissionSchema.index({ publishedAt: -1 });
submissionSchema.index({ isFeatured: 1 });
submissionSchema.index({ status: 1, submissionType: 1 });
submissionSchema.index({ status: 1, isFeatured: 1 });
submissionSchema.index({ status: 1, publishedAt: -1 });
submissionSchema.index({ 'seo.slug': 1 }, { unique: true, sparse: true });
submissionSchema.index({ viewCount: -1 });
submissionSchema.index({ status: 1, viewCount: -1 });

// Methods

submissionSchema.methods.toggleFeatured = async function() {
  this.isFeatured = !this.isFeatured;
  return await this.save();
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

// Static helper: generate a short excerpt from contents
submissionSchema.statics.generateExcerpt = function(contents, maxLength = 200) {
  return "";
};

module.exports = mongoose.model('Submission', submissionSchema);