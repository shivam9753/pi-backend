const mongoose = require('mongoose');

const contentSchema = new mongoose.Schema({
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
  body: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['poem', 'prose', 'article', 'book_review', 'cinema_essay', 'opinion', 'books', 'napoWrimo', 'interview'],
    default: 'poem'
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
  // Content-level publishing
  isPublished: {
    type: Boolean,
    default: false,
    index: true
  },
  publishedAt: {
    type: Date
  },
  // Featured content flag for highlighting
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
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
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
}, {
  timestamps: true,
  versionKey: false
});

// Indexes
contentSchema.index({ userId: 1 });
contentSchema.index({ type: 1 });
contentSchema.index({ tags: 1 });
contentSchema.index({ createdAt: -1 });
// Publishing indexes
contentSchema.index({ isPublished: 1 });
contentSchema.index({ isPublished: 1, publishedAt: -1 });
contentSchema.index({ isPublished: 1, tags: 1 });
// Featured content indexes
contentSchema.index({ isFeatured: 1 });
contentSchema.index({ isFeatured: 1, featuredAt: -1 });
contentSchema.index({ isPublished: 1, isFeatured: 1 });
contentSchema.index({ submissionId: 1 });
// SEO indexes
contentSchema.index({ 'seo.slug': 1 }, { unique: true, sparse: true });


// Static methods
contentSchema.statics.createMany = async function(contents) {
  return await this.insertMany(contents);
};

contentSchema.statics.deleteByIds = async function(ids) {
  return await this.deleteMany({ _id: { $in: ids } });
};

contentSchema.statics.findWithUser = function(id) {
  return this.findById(id).populate('userId', 'username email profileImage');
};

contentSchema.statics.calculateWordCount = function(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
};

contentSchema.statics.prepareForStorage = function(contentData) {
  const prepared = { ...contentData };
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

module.exports = mongoose.model('Content', contentSchema);