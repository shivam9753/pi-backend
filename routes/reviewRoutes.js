const express = require('express');
const Submission = require('../models/Submission');
const Review = require('../models/Review');
const SubmissionService = require('../services/submissionService');
const emailService = require('../services/emailService');
const { authenticateUser, requireReviewer, requireWriter, requireAdmin } = require('../middleware/auth');
const {
  validateObjectId,
  validatePagination
} = require('../middleware/validation');
const {
  SUBMISSION_STATUS,
  STATUS_ARRAYS,
} = require('../constants/status.constants');

const router = express.Router();

// Apply authentication middleware to all review routes
router.use(authenticateUser);

// DEPRECATED: Use /api/submissions?status=pending_review instead
// GET /api/reviews/pending - Get submissions pending review and in progress with advanced filtering
/**
 * Helper to build MongoDB match query from request params
 */
function buildPendingQuery({ status, type, dateFrom, dateTo, search }) {
  const query = status ? { status } : { status: { $in: STATUS_ARRAYS.REVIEWABLE_STATUSES } };

  if (type) query.submissionType = type;

  if (dateFrom || dateTo) {
    query.createdAt = {};
    if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
    if (dateTo) query.createdAt.$lte = new Date(dateTo);
  }

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  return query;
}

/**
 * Helper to map wordLength to a readingTime filter
 */
function getReadingTimeFilter(wordLength) {
  switch (wordLength) {
    case 'quick':
      return { readingTime: { $lte: 1 } }; // ~200 words
    case 'medium':
      return { readingTime: { $gt: 1, $lte: 3 } }; // 200-500 words
    case 'long':
      return { readingTime: { $gt: 3 } }; // >500 words
    default:
      return null;
  }
}

/**
 * Build aggregation pipeline for pending submissions
 */
function buildPendingPipeline(query, authorType, wordLength, sortBy, order, skip, limit) {
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

  const readingTimeFilter = getReadingTimeFilter(wordLength);
  if (readingTimeFilter) {
    pipeline.push({ $match: readingTimeFilter });
  }

  pipeline.push(
    { $sort: { [sortBy]: order === 'asc' ? 1 : -1 } },
    { $skip: Number.parseInt(skip) },
    { $limit: Number.parseInt(limit) }
  );

  return pipeline;
}

/**
 * Simple mapper to return optimized submission shape
 */
function mapOptimizedSubmission(sub) {
  return {
    _id: sub._id,
    title: sub.title,
    excerpt: sub.excerpt,
    imageUrl: sub.imageUrl,
    readingTime: sub.readingTime,
    submissionType: sub.submissionType,
    status: sub.status,
    tags: [], // Submission-level tags removed; aggregate from content in detail endpoints
    submitterName: sub.user?.name || sub.user?.username || 'Unknown',
    authorAts: (sub.user && typeof sub.user.ats === 'number') ? sub.user.ats : 50,
    isNewAuthor: !sub.publishedCount || sub.publishedCount.length === 0 || sub.publishedCount[0]?.count === 0,
    createdAt: sub.createdAt
  };
}

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

    const query = buildPendingQuery({ status, type, dateFrom, dateTo, search });
    const pipeline = buildPendingPipeline(query, authorType, wordLength, sortBy, order, skip, limit);

    const submissions = await Submission.aggregate(pipeline);

    // Get total count for pagination (remove sort, skip, limit)
    const countPipeline = pipeline.slice(0, -3);
    countPipeline.push({ $count: 'total' });
    const totalResult = await Submission.aggregate(countPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    const optimizedSubmissions = submissions.map(mapOptimizedSubmission);

    res.json({
      pendingSubmissions: optimizedSubmissions,
      total,
      pagination: {
        limit: Number.parseInt(limit),
        skip: Number.parseInt(skip),
        hasMore: (Number.parseInt(skip) + Number.parseInt(limit)) < total
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
    
    console.log(`🔍 Looking for submission with ID: ${req.params.id}`);
    
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      console.log(`❌ Submission not found: ${req.params.id}`);
      return res.status(404).json({ 
        message: 'Submission not found',
        details: `No submission exists with ID: ${req.params.id}`,
        submissionId: req.params.id
      });
    }
    
    console.log(`✅ Found submission: ${submission.title} with status: ${submission.status}`);
    
    if (submission.status !== SUBMISSION_STATUS.PENDING_REVIEW) {
      console.log(`❌ Wrong status: Expected ${SUBMISSION_STATUS.PENDING_REVIEW}, got ${submission.status}`);
      return res.status(400).json({ 
        message: 'Only pending submissions can be moved to in progress',
        details: `Current status: ${submission.status}, required: ${SUBMISSION_STATUS.PENDING_REVIEW}`,
        currentStatus: submission.status,
        requiredStatus: SUBMISSION_STATUS.PENDING_REVIEW
      });
    }
    
    await submission.changeStatus(SUBMISSION_STATUS.IN_PROGRESS, req.user, notes || 'Moved to in progress for review');
    
    console.log(`✅ Successfully moved submission to in progress`);
    
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
    console.error(`💥 Error in move-to-progress for ID ${req.params.id}:`, error);
    res.status(500).json({ 
      message: 'Error moving submission to in progress', 
      details: error.message,
      submissionId: req.params.id
    });
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
    const { reviewNotes } = req.body;
    
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