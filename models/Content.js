const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: function() {
      const { v4: uuidv4 } = require('uuid');
      return uuidv4();
    }
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  body: {
    type: String,
    required: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  footnotes: {
    type: String,
    trim: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    s3Key: {
      type: String,
      required: true
    },
    cdnUrl: String,
    originalName: String,
    size: Number,
    compressionRatio: Number,
    dimensions: {
      width: Number,
      height: Number
    },
    alt: String,
    caption: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  hasInlineImages: {
    type: Boolean,
    default: false
  },
  // Featured content flag for highlighting (content-level featuring)
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  featuredAt: {
    type: Date
  },
  viewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  recentViews: {
    type: Number,
    default: 0,
    min: 0
  },
  windowStartTime: {
    type: Date,
    default: function() {
      const date = new Date();
      date.setDate(date.getDate() - 7);
      return date;
    }
  },
  submissionId: {
    type: String,
    ref: 'Submission',
    required: true,
    index: true
  },
  // SEO for individual content pieces
  seo: {
    slug: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      unique: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    },
    metaTitle: {
      type: String,
      maxlength: 70,
      trim: true
    },
    metaDescription: {
      type: String,
      maxlength: 160,
      trim: true
    }
  }
  
  // REMOVED REDUNDANT FIELDS:
  // - userId: Derive from submissionId.userId
  // - isPublished: Derive from submissionId.status === 'published'
  // - publishedAt: Use submissionId.publishedAt
  // - type: Use submissionId.submissionType
  
}, {
  timestamps: true,
  versionKey: false,
  _id: false // Disable automatic _id since we're defining our own string UUID _id
});

// Indexes
contentSchema.index({ tags: 1 });
contentSchema.index({ createdAt: -1 });
contentSchema.index({ submissionId: 1 });
// Featured content indexes
contentSchema.index({ isFeatured: 1 });
contentSchema.index({ isFeatured: 1, featuredAt: -1 });
// SEO indexes
contentSchema.index({ 'seo.slug': 1 }, { unique: true, sparse: true });

// Virtual fields to derive publication status from submission
contentSchema.virtual('isPublished').get(function() {
  // This will be populated when we do lookups
  return this.submission?.status === 'published';
});

contentSchema.virtual('publishedAt').get(function() {
  // This will be populated when we do lookups
  return this.submission?.publishedAt;
});

contentSchema.virtual('type').get(function() {
  // This will be populated when we do lookups
  return this.submission?.submissionType;
});

contentSchema.virtual('userId').get(function() {
  // This will be populated when we do lookups
  return this.submission?.userId;
});

// Static methods
contentSchema.statics.createMany = async function(contents) {
  return await this.insertMany(contents);
};

contentSchema.statics.deleteByIds = async function(ids) {
  return await this.deleteMany({ _id: { $in: ids } });
};

contentSchema.statics.findWithUser = function(id) {
  return this.aggregate([
    { $match: { _id: id } },
    {
      $lookup: {
        from: 'submissions',
        localField: 'submissionId',
        foreignField: '_id',
        as: 'submission'
      }
    },
    { $unwind: '$submission' },
    {
      $lookup: {
        from: 'users',
        localField: 'submission.userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $addFields: {
        userId: '$user._id'
      }
    }
  ]);
};

// Get published content with submission status check
contentSchema.statics.findPublished = function(filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $lookup: {
        from: 'submissions',
        localField: 'submissionId',
        foreignField: '_id',
        as: 'submission'
      }
    },
    { $unwind: '$submission' },
    { $match: { 'submission.status': 'published' } },
    {
      $lookup: {
        from: 'users',
        localField: 'submission.userId',
        foreignField: '_id',
        as: 'author'
      }
    },
    { $unwind: '$author' },
    {
      $addFields: {
        isPublished: true,
        publishedAt: '$submission.publishedAt',
        type: '$submission.submissionType',
        userId: '$submission.userId'
      }
    }
  ]);
};

// Get content by user (via submission)
contentSchema.statics.findByUser = function(userId, filters = {}) {
  return this.aggregate([
    { $match: filters },
    {
      $lookup: {
        from: 'submissions',
        localField: 'submissionId',
        foreignField: '_id',
        as: 'submission'
      }
    },
    { $unwind: '$submission' },
    { $match: { 'submission.userId': userId } },
    {
      $addFields: {
        userId: '$submission.userId',
        type: '$submission.submissionType',
        isPublished: { $eq: ['$submission.status', 'published'] },
        publishedAt: '$submission.publishedAt'
      }
    }
  ]);
};

contentSchema.statics.calculateWordCount = function(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
};

contentSchema.statics.prepareForStorage = function(contentData) {
  const prepared = { ...contentData };
  
  // Remove any legacy fields that shouldn't be stored
  delete prepared.userId;
  delete prepared.isPublished;
  delete prepared.publishedAt;
  delete prepared.type;
  
  return prepared;
};

contentSchema.statics.addS3Image = async function(contentId, imageData) {
  const content = await this.findById(contentId);
  if (!content) throw new Error('Content not found');
  
  const imageRecord = {
    url: imageData.url,
    s3Key: imageData.fileName,
    cdnUrl: imageData.cdnUrl,
    originalName: imageData.originalName,
    size: imageData.size,
    compressionRatio: imageData.compressionRatio,
    dimensions: imageData.dimensions,
    alt: imageData.alt || '',
    caption: imageData.caption || ''
  };
  
  content.images.push(imageRecord);
  content.hasInlineImages = true;
  
  return await content.save();
};

contentSchema.statics.removeS3Image = async function(contentId, imageId) {
  const content = await this.findById(contentId);
  if (!content) throw new Error('Content not found');
  
  const imageIndex = content.images.findIndex(img => img._id.toString() === imageId);
  if (imageIndex === -1) throw new Error('Image not found');
  
  const removedImage = content.images[imageIndex];
  content.images.splice(imageIndex, 1);
  
  if (content.images.length === 0) {
    content.hasInlineImages = false;
  }
  
  await content.save();
  return removedImage.s3Key; // Return S3 key for deletion
};

// Utility method to check if content is published (requires submission lookup)
contentSchema.methods.checkPublishStatus = async function() {
  const submission = await mongoose.model('Submission').findById(this.submissionId).select('status publishedAt');
  if (!submission) {
    throw new Error('Associated submission not found');
  }
  
  return {
    isPublished: submission.status === 'published',
    publishedAt: submission.publishedAt
  };
};

// Rolling window view tracking method (same as Submission)
contentSchema.methods.logView = async function(windowDays = 7) {
  const now = new Date();
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - windowDays);

  // If this is the first view or window has shifted significantly, reset
  if (!this.windowStartTime || this.windowStartTime < windowStart) {
    this.windowStartTime = windowStart;
    this.recentViews = 1;
  } else {
    this.recentViews += 1;
  }

  this.viewCount += 1;

  // Update the window start time to maintain the rolling window
  this.windowStartTime = windowStart;

  await this.save();
};

// Get trending score (recent vs total views ratio)
contentSchema.methods.getTrendingScore = function() {
  if (this.viewCount === 0) return 0;
  return Math.round((this.recentViews / this.viewCount) * 100);
};

// Method to get full content with publication info
contentSchema.methods.toPublicJSON = async function() {
  const submission = await mongoose.model('Submission')
    .findById(this.submissionId)
    .populate('userId', 'username name profileImage')
    .select('status publishedAt submissionType userId seo');
    
  if (!submission) {
    throw new Error('Associated submission not found');
  }
  
  return {
    _id: this._id,
    title: this.title,
    body: this.body,
    tags: this.tags,
    footnotes: this.footnotes,
    isFeatured: this.isFeatured,
    featuredAt: this.featuredAt,
    viewCount: this.viewCount,
    createdAt: this.createdAt,
    seo: this.seo,
    // Derived fields
    isPublished: submission.status === 'published',
    publishedAt: submission.publishedAt,
    type: submission.submissionType,
    author: submission.userId,
    submission: {
      _id: submission._id,
      slug: submission.seo?.slug
    }
  };
};

module.exports = mongoose.model('Content', contentSchema);