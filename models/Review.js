const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  submissionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Submission',
    required: true
  },
  reviewerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reviewerName: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['accepted', 'rejected', 'needs_revision'],
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
  versionKey: false
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

  if (!reviewData.status || !['accepted', 'rejected', 'needs_revision'].includes(reviewData.status)) {
    errors.push('Status must be "accepted", "rejected", or "needs_revision"');
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