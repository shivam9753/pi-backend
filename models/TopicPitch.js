const mongoose = require('mongoose');
const { SUBMISSION_TYPES } = require('../constants/status.constants');

const topicPitchSchema = new mongoose.Schema({
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
  contentType: {
    type: String,
    enum: ['article', 'opinion', 'cinema_essay', 'story'],
    required: true
  },
  pitchedBy: {
    type: String,
    required: true
  },
  pitcherName: {
    type: String,
    required: true
  },
  pitcherRole: {
    type: String,
    enum: ['creator', 'curator', 'admin'],
    required: true
  },
  status: {
    type: String,
    enum: ['available', 'claimed', 'completed', 'cancelled'],
    default: 'available'
  },
  claimedBy: {
    type: String,
    default: null
  },
  claimedByName: {
    type: String,
    default: null
  },
  claimedAt: {
    type: Date,
    default: null
  },
  deadline: {
    type: Date,
    default: null
  },
  userDeadline: {
    type: Date,
    default: null
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'medium'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Submission',
    default: null
  },
  notes: {
    type: String,
    maxlength: 500,
    default: ''
  }
}, {
  timestamps: true, // This adds createdAt and updatedAt automatically
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying
topicPitchSchema.index({ status: 1, createdAt: -1 });
topicPitchSchema.index({ pitchedBy: 1 });
topicPitchSchema.index({ claimedBy: 1 });
topicPitchSchema.index({ contentType: 1 });
topicPitchSchema.index({ priority: 1 });
topicPitchSchema.index({ tags: 1 });

// Virtual for checking if pitch is available
topicPitchSchema.virtual('isAvailable').get(function() {
  return this.status === 'available';
});

// Virtual for checking if pitch is overdue
topicPitchSchema.virtual('isOverdue').get(function() {
  return this.deadline && this.deadline < new Date() && this.status === 'claimed';
});

// Static methods for common queries
topicPitchSchema.statics.getAvailable = function(options = {}) {
  const { contentType, priority, tags, limit = 20, skip = 0 } = options;
  
  let query = { status: 'available' };
  
  if (contentType) query.contentType = contentType;
  if (priority) query.priority = priority;
  if (tags && tags.length > 0) query.tags = { $in: tags };
  
  return this.find(query)
    .populate('pitchedBy', 'username name')
    .sort({ priority: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

topicPitchSchema.statics.getByUser = function(userId, options = {}) {
  const { status, limit = 20, skip = 0 } = options;
  
  let query = { 
    $or: [
      { pitchedBy: userId },
      { claimedBy: userId }
    ]
  };
  
  if (status) query.status = status;
  
  return this.find(query)
    .populate('pitchedBy', 'username name')
    .populate('claimedBy', 'username name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

// Instance method to claim a pitch
topicPitchSchema.methods.claimBy = function(userId, userName) {
  if (this.status !== 'available') {
    throw new Error('Pitch is not available for claiming');
  }
  
  this.status = 'claimed';
  this.claimedBy = userId;
  this.claimedByName = userName;
  this.claimedAt = new Date();
  
  return this.save();
};

// Instance method to complete a pitch
topicPitchSchema.methods.complete = function(submissionId = null) {
  if (this.status !== 'claimed') {
    throw new Error('Pitch must be claimed before it can be completed');
  }
  
  this.status = 'completed';
  if (submissionId) {
    this.submissionId = submissionId;
  }
  
  return this.save();
};

// Instance method to cancel a pitch
topicPitchSchema.methods.cancel = function() {
  this.status = 'cancelled';
  return this.save();
};

// Instance method to release a pitch (unclaim)
topicPitchSchema.methods.release = function() {
  if (this.status !== 'claimed') {
    throw new Error('Only claimed pitches can be released');
  }
  
  this.status = 'available';
  this.claimedBy = null;
  this.claimedByName = null;
  this.claimedAt = null;
  
  return this.save();
};

module.exports = mongoose.model('TopicPitch', topicPitchSchema);