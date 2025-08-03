const express = require('express');
const Submission = require('../models/Submission');
const Review = require('../models/Review');
const SubmissionService = require('../services/submissionService');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
const { 
  validateReviewCreation,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');

const router = express.Router();

// Apply authentication middleware to all review routes
router.use(authenticateUser);

// GET /api/reviews/pending - Get submissions pending review
router.get('/pending', requireReviewer, validatePagination, async (req, res) => {
  try {
    const { limit = 20, skip = 0, sortBy = 'createdAt', order = 'asc', type } = req.query;
    
    const query = { status: 'pending_review' };
    if (type) query.submissionType = type;
    
    const submissions = await Submission.find(query)
      .populate('userId', 'username')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Submission.countDocuments(query);
    
    // Return only required fields for display
    const optimizedSubmissions = submissions.map(sub => ({
      _id: sub._id,
      title: sub.title,
      excerpt: sub.excerpt,
      imageUrl: sub.imageUrl,
      readingTime: sub.readingTime,
      submissionType: sub.submissionType,
      tags: sub.tags,
      submitterName: sub.userId?.username || 'Unknown',
      createdAt: sub.createdAt
    }));
    
    res.json({
      pendingSubmissions: optimizedSubmissions,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching pending reviews', error: error.message });
  }
});

// GET /api/reviews/accepted - Get accepted submissions ready for publication
router.get('/accepted', requireReviewer, validatePagination, async (req, res) => {
  try {
    const result = await SubmissionService.getAcceptedSubmissions(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching accepted submissions', error: error.message });
  }
});

// POST /api/reviews/:id/approve - Approve submission
router.post('/:id/approve', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    
    const reviewData = {
      reviewerId: req.user._id,
      reviewerName: req.user.username,
      status: 'accepted',
      reviewNotes: reviewNotes || '',
      rating: rating
    };

    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    
    res.json({
      message: 'Submission approved successfully',
      submission: result.submission,
      review: result.review
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message === 'Only pending submissions can be reviewed') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error approving submission', error: error.message });
  }
});

// POST /api/reviews/:id/reject - Reject submission
router.post('/:id/reject', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    
    if (!reviewNotes || reviewNotes.trim().length === 0) {
      return res.status(400).json({ message: 'Review notes are required when rejecting a submission' });
    }
    
    const reviewData = {
      reviewerId: req.user._id,
      reviewerName: req.user.username,
      status: 'rejected',
      reviewNotes: reviewNotes.trim(),
      rating: rating
    };

    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    
    res.json({
      message: 'Submission rejected',
      submission: result.submission,
      review: result.review
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message === 'Only pending submissions can be reviewed') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error rejecting submission', error: error.message });
  }
});

// POST /api/reviews/:id/revision - Request revision
router.post('/:id/revision', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    
    if (!reviewNotes || reviewNotes.trim().length === 0) {
      return res.status(400).json({ message: 'Review notes are required when requesting revision' });
    }
    
    const reviewData = {
      reviewerId: req.user._id,
      reviewerName: req.user.username,
      status: 'needs_revision',
      reviewNotes: reviewNotes.trim(),
      rating: rating
    };

    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    
    res.json({
      message: 'Revision requested',
      submission: result.submission,
      review: result.review
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message === 'Only pending submissions can be reviewed') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error requesting revision', error: error.message });
  }
});

// GET /api/reviews/my-reviews - Get reviews by current user
router.get('/my-reviews', requireReviewer, validatePagination, async (req, res) => {
  try {
    const { limit = 50, skip = 0 } = req.query;
    
    const reviews = await Review.findByReviewerId(req.user._id, { limit, skip });
    const total = await Review.countDocuments({ reviewerId: req.user._id });
    
    res.json({
      reviews,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching your reviews', error: error.message });
  }
});

// GET /api/reviews/submission/:id - Get reviews for a specific submission
router.get('/submission/:id', validateObjectId('id'), async (req, res) => {
  try {
    const review = await Review.findBySubmissionId(req.params.id);
    
    if (!review) {
      return res.status(404).json({ message: 'No review found for this submission' });
    }
    
    res.json({ review });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submission review', error: error.message });
  }
});

// GET /api/reviews/stats - Get review statistics
router.get('/stats', requireReviewer, async (req, res) => {
  try {
    const { reviewerId } = req.query;
    
    // If reviewerId is provided and user is admin, get stats for that reviewer
    // Otherwise, get stats for current user
    const targetReviewerId = (reviewerId && req.user.role === 'admin') ? reviewerId : req.user._id;
    
    const stats = await Review.aggregate([
      { $match: { reviewerId: targetReviewerId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const formattedStats = {
      accepted: 0,
      rejected: 0,
      needs_revision: 0,
      total: 0
    };

    stats.forEach(stat => {
      formattedStats[stat._id] = stat.count;
      formattedStats.total += stat.count;
    });

    res.json({ stats: formattedStats });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching review stats', error: error.message });
  }
});

// GET /api/reviews - Get all reviews (admin only)
router.get('/', requireAdmin, validatePagination, async (req, res) => {
  try {
    const { limit = 50, skip = 0, reviewerId, status } = req.query;
    
    const query = {};
    if (reviewerId) query.reviewerId = reviewerId;
    if (status) query.status = status;
    
    const reviews = await Review.find(query)
      .populate('reviewerId', 'username email')
      .populate('submissionId', 'title submissionType')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Review.countDocuments(query);
    
    res.json({
      reviews,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching reviews', error: error.message });
  }
});

// DELETE /api/reviews/:id - Delete review (admin only)
router.delete('/:id', requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const review = await Review.findByIdAndDelete(req.params.id);
    
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }
    
    res.json({ message: 'Review deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting review', error: error.message });
  }
});

module.exports = router;