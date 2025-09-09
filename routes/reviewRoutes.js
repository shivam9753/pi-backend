const express = require('express');
const Submission = require('../models/Submission');
const Review = require('../models/Review');
const SubmissionService = require('../services/submissionService');
const { authenticateUser, requireReviewer, requireWriter, requireAdmin } = require('../middleware/auth');
const { 
  validateReviewCreation,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');
const { 
  SUBMISSION_STATUS, 
  REVIEW_ACTIONS, 
  STATUS_ARRAYS,
  ACTION_STATUS_MAP,
  STATUS_UTILS 
} = require('../constants/status.constants');

const router = express.Router();

// Apply authentication middleware to all review routes
router.use(authenticateUser);

// DEPRECATED: Use /api/submissions?status=pending_review instead
// GET /api/reviews/pending - Get submissions pending review and in progress with advanced filtering
router.get('/pending', requireWriter, validatePagination, async (req, res) => {
  try {
    const { 
      limit = 20, 
      skip = 0, 
      sortBy = 'createdAt', 
      order = 'asc', 
      type, 
      status,
      dateFrom,
      dateTo,
      search,
      authorType, // 'new' or 'returning'
      wordLength // 'quick' (<200), 'medium' (200-500), 'long' (>500)
    } = req.query;
    
    // Default to reviewable statuses, or filter by specific status
    const query = status ? { status } : { status: { $in: STATUS_ARRAYS.REVIEWABLE_STATUSES } };
    
    // Content type filter
    if (type) query.submissionType = type;
    
    // Date range filter
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }
    
    // Search filter (title, description, content)
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Build the aggregation pipeline for complex filtering
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $lookup: {
          from: 'submissions',
          let: { userId: '$userId' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$userId', '$$userId'] }, { $eq: ['$status', 'published'] }] } } },
            { $count: 'count' }
          ],
          as: 'publishedCount'
        }
      }
    ];
    
    // Add author type filter
    if (authorType === 'new') {
      pipeline.push({
        $match: {
          $or: [
            { publishedCount: { $size: 0 } },
            { 'publishedCount.0.count': { $eq: 0 } }
          ]
        }
      });
    } else if (authorType === 'returning') {
      pipeline.push({
        $match: {
          'publishedCount.0.count': { $gt: 0 }
        }
      });
    }
    
    // Add word length filter
    if (wordLength) {
      let readingTimeFilter = {};
      switch (wordLength) {
        case 'quick':
          readingTimeFilter = { readingTime: { $lte: 1 } }; // ~200 words
          break;
        case 'medium':
          readingTimeFilter = { readingTime: { $gt: 1, $lte: 3 } }; // 200-500 words
          break;
        case 'long':
          readingTimeFilter = { readingTime: { $gt: 3 } }; // >500 words
          break;
      }
      if (Object.keys(readingTimeFilter).length > 0) {
        pipeline.push({ $match: readingTimeFilter });
      }
    }
    
    // Add sorting and pagination
    pipeline.push(
      { $sort: { [sortBy]: order === 'asc' ? 1 : -1 } },
      { $skip: parseInt(skip) },
      { $limit: parseInt(limit) }
    );
    
    const submissions = await Submission.aggregate(pipeline);
    
    // Get total count for pagination
    const countPipeline = pipeline.slice(0, -3); // Remove sort, skip, limit
    countPipeline.push({ $count: 'total' });
    const totalResult = await Submission.aggregate(countPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;
    
    // Return optimized submission data
    const optimizedSubmissions = submissions.map(sub => ({
      _id: sub._id,
      title: sub.title,
      excerpt: sub.excerpt,
      imageUrl: sub.imageUrl,
      readingTime: sub.readingTime,
      submissionType: sub.submissionType,
      status: sub.status,
      tags: sub.tags,
      submitterName: sub.user?.name || sub.user?.username || 'Unknown',
      isNewAuthor: !sub.publishedCount || sub.publishedCount.length === 0 || sub.publishedCount[0]?.count === 0,
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
router.get('/accepted', requireWriter, validatePagination, async (req, res) => {
  try {
    const result = await SubmissionService.getAcceptedSubmissions(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching accepted submissions', error: error.message });
  }
});

// POST /api/reviews/:id/move-to-progress - Move submission to in_progress
router.post('/:id/move-to-progress', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { notes } = req.body;
    
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.status !== SUBMISSION_STATUS.PENDING_REVIEW) {
      return res.status(400).json({ message: 'Only pending submissions can be moved to in progress' });
    }
    
    await submission.changeStatus(SUBMISSION_STATUS.IN_PROGRESS, req.user, notes || 'Moved to in progress for review');
    
    res.json({
      success: true,
      message: 'Submission moved to in progress',
      submission: {
        _id: submission._id,
        status: SUBMISSION_STATUS.IN_PROGRESS,
        assignedTo: req.user._id,
        assignedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error moving submission to in progress', error: error.message });
  }
});

// POST /api/reviews/:id/action - Unified review action endpoint
router.post('/:id/action', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { action, reviewNotes, rating } = req.body;
    
    // Validate action
    const validActions = ['approve', 'reject', 'revision', 'shortlist'];
    if (!action || !validActions.includes(action)) {
      return res.status(400).json({ 
        message: `Invalid action. Must be one of: ${validActions.join(', ')}` 
      });
    }
    
    // Validate required fields based on action
    if ((action === 'reject' || action === 'revision') && (!reviewNotes || reviewNotes.trim().length === 0)) {
      return res.status(400).json({ 
        message: `Review notes are required when ${action === 'reject' ? 'rejecting' : 'requesting revision for'} a submission` 
      });
    }
    
    // Map action to status using constants
    const statusMap = ACTION_STATUS_MAP;
    
    const reviewData = {
      reviewerId: req.user._id,
      status: statusMap[action],
      reviewNotes: reviewNotes ? reviewNotes.trim() : '',
      rating: rating
    };

    let result;
    let message;
    
    if (action === 'approve') {
      // Create the review record first
      result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
      // Then update submission status with history tracking
      await result.submission.changeStatus(SUBMISSION_STATUS.ACCEPTED, req.user, reviewNotes || 'Submission approved');
      message = 'Submission approved successfully';
    } else if (action === 'shortlist') {
      // For shortlist: Create review first, then update status
      result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
      // Then update submission status with history tracking
      await result.submission.changeStatus(SUBMISSION_STATUS.SHORTLISTED, req.user, reviewNotes || 'Submission shortlisted for further review');
      message = 'Submission shortlisted successfully';
    } else {
      // For reject/revision: Create review first, then update status
      result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
      // Then update submission status with history tracking
      await result.submission.changeStatus(statusMap[action], req.user, reviewNotes.trim());
      message = action === 'reject' ? 'Submission rejected' : 'Revision requested';
    }
    
    res.json({
      message,
      submission: result.submission,
      review: result.review
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message.includes('pending submissions')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: `Error ${req.body.action}ing submission`, error: error.message });
  }
});

// NEW SEMANTIC REVIEW ENDPOINTS - No action parameter required
// These replace the generic POST /:id/action for better API semantics

// POST /api/reviews/:id/approve - Approve submission
router.post('/:id/approve', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    
    const reviewData = {
      reviewerId: req.user._id,
      status: SUBMISSION_STATUS.ACCEPTED,
      reviewNotes: reviewNotes ? reviewNotes.trim() : '',
      rating: rating
    };

    // Create review record and update status
    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    await result.submission.changeStatus(SUBMISSION_STATUS.ACCEPTED, req.user, reviewNotes || 'Submission approved');
    
    res.json({
      success: true,
      message: 'Submission approved successfully'
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message.includes('pending submissions')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error approving submission', error: error.message });
  }
});

// POST /api/reviews/:id/reject - Reject submission
router.post('/:id/reject', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    
    // Validate required review notes for rejection
    if (!reviewNotes || reviewNotes.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Review notes are required when rejecting a submission' 
      });
    }
    
    const reviewData = {
      reviewerId: req.user._id,
      status: SUBMISSION_STATUS.REJECTED,
      reviewNotes: reviewNotes.trim(),
      rating: rating
    };

    // Create review record and update status
    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    await result.submission.changeStatus(SUBMISSION_STATUS.REJECTED, req.user, reviewNotes.trim());
    
    res.json({
      success: true,
      message: 'Submission rejected'
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message.includes('pending submissions')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error rejecting submission', error: error.message });
  }
});

// POST /api/reviews/:id/revision - Request revision
router.post('/:id/revision', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    
    // Validate required review notes for revision
    if (!reviewNotes || reviewNotes.trim().length === 0) {
      return res.status(400).json({ 
        message: 'Review notes are required when requesting revision for a submission' 
      });
    }
    
    const reviewData = {
      reviewerId: req.user._id,
      status: SUBMISSION_STATUS.NEEDS_REVISION,
      reviewNotes: reviewNotes.trim(),
      rating: rating
    };

    // Create review record and update status
    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    await result.submission.changeStatus(SUBMISSION_STATUS.NEEDS_REVISION, req.user, reviewNotes.trim());
    
    res.json({
      success: true,
      message: 'Revision requested'
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message.includes('pending submissions')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error requesting revision', error: error.message });
  }
});

// POST /api/reviews/:id/shortlist - Shortlist submission
router.post('/:id/shortlist', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, reviewerId } = req.body;
    
    const reviewData = {
      reviewerId: req.user._id,
      status: SUBMISSION_STATUS.SHORTLISTED,
      reviewNotes: reviewNotes ? reviewNotes.trim() : 'Shortlisted for further consideration',
      rating: null // Shortlisting doesn't require rating
    };

    // Create review record and update status
    const result = await SubmissionService.reviewSubmission(req.params.id, reviewData);
    await result.submission.changeStatus(SUBMISSION_STATUS.SHORTLISTED, req.user, reviewNotes || 'Submission shortlisted for further review');
    
    res.json({
      success: true,
      message: 'Submission shortlisted successfully'
    });
  } catch (error) {
    if (error.message === 'Submission not found' || error.message.includes('pending submissions')) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error shortlisting submission', error: error.message });
  }
});

// LEGACY ENDPOINTS REMOVED - Use semantic endpoints above instead
// These endpoints have been consolidated into the unified action endpoint for better maintainability

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
router.get('/submission/:id', requireWriter, validateObjectId('id'), async (req, res) => {
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
router.get('/stats', requireWriter, async (req, res) => {
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