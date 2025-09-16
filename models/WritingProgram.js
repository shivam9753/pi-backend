const mongoose = require('mongoose');

const writingProgramSchema = new mongoose.Schema({
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
    trim: true,
    minlength: 3,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    minlength: 10
  },
  imageUrl: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'closed', 'archived'],
    default: 'draft'
  },
  // Dynamic application criteria stored as JSON
  criteria: {
    questions: [{
      id: {
        type: String,
        required: true
      },
      type: {
        type: String,
        enum: ['text', 'textarea', 'select', 'multiselect', 'number'],
        required: true
      },
      question: {
        type: String,
        required: true
      },
      required: {
        type: Boolean,
        default: false
      },
      options: [{
        type: String
      }], // For select/multiselect types
      validation: {
        maxLength: Number,
        minLength: Number,
        pattern: String
      }
    }],
    requiresWritingSamples: {
      type: Boolean,
      default: false
    },
    minWritingSamples: {
      type: Number,
      default: 1,
      min: 1,
      max: 5
    },
    maxWritingSamples: {
      type: Number,
      default: 3,
      min: 1,
      max: 5
    },
    maxWordCount: {
      type: Number,
      default: 2000,
      min: 500,
      max: 5000
    }
  },
  applicationDeadline: {
    type: Date,
    required: true
  },
  maxApplications: {
    type: Number,
    default: 50,
    min: 1
  },
  applicationsReceived: {
    type: Number,
    default: 0,
    min: 0
  },
  createdBy: {
    type: String,
    ref: 'User',
    required: true
  },
  // SEO and public display
  slug: {
    type: String,
    unique: true,
    sparse: true
  },
  isPublic: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  versionKey: false,
  _id: false
});

// Indexes for efficient querying
writingProgramSchema.index({ status: 1, applicationDeadline: 1 });
writingProgramSchema.index({ createdBy: 1 });
writingProgramSchema.index({ slug: 1 }, { unique: true, sparse: true });
writingProgramSchema.index({ createdAt: -1 });

// Virtual properties
writingProgramSchema.virtual('isActive').get(function() {
  return this.status === 'active' && this.applicationDeadline > new Date();
});

writingProgramSchema.virtual('isExpired').get(function() {
  return this.applicationDeadline < new Date();
});

writingProgramSchema.virtual('spotsRemaining').get(function() {
  return Math.max(0, this.maxApplications - this.applicationsReceived);
});

// Static methods
writingProgramSchema.statics.getActivePrograms = function(options = {}) {
  const { limit = 20, skip = 0 } = options;
  
  return this.find({
    status: 'active',
    isPublic: true,
    applicationDeadline: { $gt: new Date() }
  })
    .populate('createdBy', 'username name')
    .sort({ applicationDeadline: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

writingProgramSchema.statics.findBySlug = function(slug) {
  return this.findOne({ 
    slug: slug,
    status: 'active',
    isPublic: true,
    applicationDeadline: { $gt: new Date() }
  }).populate('createdBy', 'username name');
};

writingProgramSchema.statics.getByCreator = function(creatorId, options = {}) {
  const { status, limit = 20, skip = 0 } = options;
  
  let query = { createdBy: creatorId };
  if (status) query.status = status;
  
  return this.find(query)
    .populate('createdBy', 'username name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Instance methods
writingProgramSchema.methods.generateSlug = function() {
  const baseSlug = this.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
  
  // Add year to make it unique
  const year = new Date().getFullYear();
  this.slug = `${baseSlug}-${year}`;
  
  return this.slug;
};

writingProgramSchema.methods.incrementApplications = async function() {
  this.applicationsReceived += 1;
  return await this.save();
};

writingProgramSchema.methods.canAcceptApplications = function() {
  return this.status === 'active' && 
         this.applicationDeadline > new Date() &&
         this.applicationsReceived < this.maxApplications;
};

// Pre-save middleware to generate slug if not present
writingProgramSchema.pre('save', async function(next) {
  if (this.isNew && !this.slug) {
    this.generateSlug();
  }
  next();
});

module.exports = mongoose.model('WritingProgram', writingProgramSchema);