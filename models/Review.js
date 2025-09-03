const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => require('uuid').v4()
  },
  submissionId: {
    type: String,
    ref: 'Submission',
    required: true
  },
  reviewerId: {
    type: String,
    ref: 'User',
    required: true
  },
  status: {
    type: String,
    enum: ['accepted', 'rejected', 'needs_revision', 'shortlisted'],
    required: true
  },
  reviewNotes: {
    type: String,
    maxlength: 1000
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  }
}, {
  timestamps: true,
  versionKey: false,
  _id: false // Disable automatic _id since we're defining our own
});

// Indexes
reviewSchema.index({ submissionId: 1 });
reviewSchema.index({ reviewerId: 1 });
reviewSchema.index({ createdAt: -1 });

// Static methods
reviewSchema.statics.findBySubmissionId = function(submissionId) {
  return this.findOne({ submissionId })
    .populate('reviewerId', 'username email')
    .sort({ createdAt: -1 });
};

reviewSchema.statics.findByReviewerId = function(reviewerId, options = {}) {
  const { limit = 50, skip = 0 } = options;
  return this.find({ reviewerId })
    .populate('submissionId', 'title submissionType')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip(skip);
};

reviewSchema.statics.validateReviewData = function(reviewData) {
  const errors = [];

  if (!reviewData.submissionId) {
    errors.push('Submission ID is required');
  }

  if (!reviewData.reviewerId) {
    errors.push('Reviewer ID is required');
  }

  if (!reviewData.status || !['accepted', 'rejected', 'needs_revision', 'shortlisted'].includes(reviewData.status)) {
    errors.push('Status must be "accepted", "rejected", "needs_revision", or "shortlisted"');
  }

  if (reviewData.status === 'rejected' && (!reviewData.reviewNotes || reviewData.reviewNotes.trim().length === 0)) {
    errors.push('Review notes are required when rejecting a submission');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = mongoose.model('Review', reviewSchema);