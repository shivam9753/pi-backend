const mongoose = require('mongoose');

const submissionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    minlength: 3
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
    enum: ['poem', 'story', 'article', 'quote', 'cinema_essay'],
    required: true
  },
  status: {
    type: String,
    enum: ['pending_review', 'accepted', 'rejected', 'published'],
    default: 'pending_review'
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
  hasImages: {
    type: Boolean,
    default: false
  },
  imageStorage: {
    type: String,
    enum: ['none', 'inline', 'attachment'],
    default: 'none'
  },
  viewCount: {
    type: Number,
    default: 0
  },
  likeCount: {
    type: Number,
    default: 0
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  reviewedAt: {
    type: Date
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // SEO Metadata
  seo: {
    slug: {
      type: String,
      unique: true,
      sparse: true,
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
    publishSettings: {
      allowComments: {
        type: Boolean,
        default: true
      },
      enableSocialSharing: {
        type: Boolean,
        default: true
      },
      featuredOnHomepage: {
        type: Boolean,
        default: false
      }
    }
  }
}, {
  timestamps: true
});

// Indexes
submissionSchema.index({ userId: 1 });
submissionSchema.index({ status: 1 });
submissionSchema.index({ submissionType: 1 });
submissionSchema.index({ createdAt: -1 });
submissionSchema.index({ reviewedAt: -1 });
submissionSchema.index({ tags: 1 });
submissionSchema.index({ isFeatured: 1 });
// Compound indexes for common queries
submissionSchema.index({ status: 1, submissionType: 1 });
submissionSchema.index({ status: 1, isFeatured: 1 });
submissionSchema.index({ status: 1, reviewedAt: -1 });
// SEO slug index for fast URL lookups
submissionSchema.index({ 'seo.slug': 1 }, { unique: true, sparse: true });

// Methods
submissionSchema.methods.incrementViews = async function() {
  this.viewCount += 1;
  return await this.save();
};

submissionSchema.methods.toggleFeatured = async function() {
  this.isFeatured = !this.isFeatured;
  return await this.save();
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
    return total + (content.wordCount || 0);
  }, 0);
  return Math.ceil(totalWords / 200);
};

submissionSchema.statics.generateExcerpt = function(contents, maxLength = 150) {
  if (!contents || contents.length === 0) return '';
  
  const firstContent = contents[0];
  if (!firstContent.body) return '';
  
  const text = firstContent.body.replace(/\n/g, ' ').trim();
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
    .populate('userId', 'username email profileImage')
    .populate('contentIds');
};

module.exports = mongoose.model('Submission', submissionSchema);