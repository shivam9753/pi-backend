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
    trim: true,
    minlength: 3
  },
  body: {
    type: String,
    required: true,
    minlength: 10
  },
  type: {
    type: String,
    enum: ['poem', 'story', 'article', 'quote', 'cinema_essay'],
    default: 'poem'
  },
  language: {
    type: String,
    enum: ['english', 'hindi', 'bengali', 'tamil', 'other'],
    default: 'english'
  },
  wordCount: {
    type: Number,
    default: 0
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
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
  }
}, {
  timestamps: true
});

// Indexes
contentSchema.index({ userId: 1 });
contentSchema.index({ type: 1 });
contentSchema.index({ tags: 1 });
contentSchema.index({ createdAt: -1 });

// Pre-save hook to calculate word count and extract tags
contentSchema.pre('save', function(next) {
  if (this.body && (this.isNew || this.isModified('body'))) {
    this.wordCount = this.body.split(/\s+/).filter(word => word.length > 0).length;
  }
  next();
});

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
  
  if (prepared.body && !prepared.wordCount) {
    prepared.wordCount = this.calculateWordCount(prepared.body);
  }
  
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