const express = require('express');
const Submission = require('../models/Submission');
const SubmissionService = require('../services/submissionService');
const AuditService = require('../services/auditService');
const emailService = require('../services/emailService');
const { authenticateUser, requireReviewer, requireWriter, requireAdmin } = require('../middleware/auth');
const {
  validateObjectId,
  validatePagination
} = require('../middleware/validation');
const {
  SUBMISSION_STATUS,
  STATUS_ARRAYS,
  STATUS_UTILS
} = require('../constants/status.constants');

const router = express.Router();

// Apply authentication middleware to all review routes
router.use(authenticateUser);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getReadingTimeFilter(wordLength) {
  switch (wordLength) {
    case 'quick':  return { readingTime: { $lte: 1 } };
    case 'medium': return { readingTime: { $gt: 1, $lte: 3 } };
    case 'long':   return { readingTime: { $gt: 3 } };
    default:       return null;
  }
}

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
    pipeline.push({ $match: { $or: [{ publishedCount: { $size: 0 } }, { 'publishedCount.0.count': { $eq: 0 } }] } });
  } else if (authorType === 'returning') {
    pipeline.push({ $match: { 'publishedCount.0.count': { $gt: 0 } } });
  }

  const readingTimeFilter = getReadingTimeFilter(wordLength);
  if (readingTimeFilter) pipeline.push({ $match: readingTimeFilter });

  pipeline.push(
    { $sort: { [sortBy]: order === 'asc' ? 1 : -1 } },
    { $skip: Number.parseInt(skip) },
    { $limit: Number.parseInt(limit) }
  );
  return pipeline;
}

function mapOptimizedSubmission(sub) {
  return {
    _id: sub._id,
    title: sub.title,
    excerpt: sub.excerpt,
    imageUrl: sub.imageUrl,
    readingTime: sub.readingTime,
    submissionType: sub.submissionType,
    status: sub.status,
    tags: [],
    submitterName: sub.user?.name || sub.user?.username || 'Unknown',
    authorAts: (sub.user && typeof sub.user.ats === 'number') ? sub.user.ats : 50,
    isNewAuthor: !sub.publishedCount || sub.publishedCount.length === 0 || sub.publishedCount[0]?.count === 0,
    createdAt: sub.createdAt
  };
}

/**
 * Apply a status transition directly on the Submission document and write an
 * Audit entry.  This replaces the old submission.changeStatus() method.
 */
async function applyTransition(submission, newStatus, action, user, notes = '', rating = null) {
  const fromStatus = submission.status;
  if (fromStatus !== newStatus && !STATUS_UTILS.isValidStatusTransition(fromStatus, newStatus)) {
    throw new Error(`Invalid status transition from ${fromStatus} to ${newStatus}`);
  }

  submission.status = newStatus;

  // Clear / set assignment fields
  if (action === 'in_progress') {
    submission.assignedTo = String(user._id || user.id || user);
    submission.assignedAt = new Date();
  } else if (['accepted', 'rejected', 'needs_revision', 'published', 'republished', 'unpublished'].includes(action)) {
    submission.assignedTo = null;
    submission.assignedAt = null;
  }

  await submission.save();

  const userId = String(user._id || user.id || user);
  const userRole = user.role || null;

  await AuditService.log({
    submissionId: submission._id,
    action,
    resultingStatus: newStatus,
    userId,
    userRole,
    notes: notes || '',
    rating
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/reviews/pending
router.get('/pending', requireWriter, validatePagination, async (req, res) => {
  try {
    const {
      limit = 20, skip = 0, sortBy = 'createdAt', order = 'asc',
      type, status, dateFrom, dateTo, search, authorType, wordLength
    } = req.query;

    const query = buildPendingQuery({ status, type, dateFrom, dateTo, search });
    const pipeline = buildPendingPipeline(query, authorType, wordLength, sortBy, order, skip, limit);
    const submissions = await Submission.aggregate(pipeline);

    const countPipeline = pipeline.slice(0, -3);
    countPipeline.push({ $count: 'total' });
    const totalResult = await Submission.aggregate(countPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    res.json({
      pendingSubmissions: submissions.map(mapOptimizedSubmission),
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

// GET /api/reviews/accepted
router.get('/accepted', requireWriter, validatePagination, async (req, res) => {
  try {
    const result = await SubmissionService.getAcceptedSubmissions(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching accepted submissions', error: error.message });
  }
});

// POST /api/reviews/:id/move-to-progress
router.post('/:id/move-to-progress', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { notes } = req.body;
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    if (submission.status !== SUBMISSION_STATUS.PENDING_REVIEW) {
      return res.status(400).json({
        message: 'Only pending submissions can be moved to in progress',
        currentStatus: submission.status,
        requiredStatus: SUBMISSION_STATUS.PENDING_REVIEW
      });
    }

    await applyTransition(submission, SUBMISSION_STATUS.IN_PROGRESS, 'in_progress', req.user, notes || 'Moved to in progress for review');

    res.json({
      success: true,
      message: 'Submission moved to in progress',
      submission: { _id: submission._id, status: SUBMISSION_STATUS.IN_PROGRESS, assignedTo: req.user._id, assignedAt: new Date() }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error moving submission to in progress', details: error.message });
  }
});

// POST /api/reviews/:id/approve
router.post('/:id/approve', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;

    // ATS update via service (just needs the submission found)
    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(400).json({ message: 'Submission not found' });

    await SubmissionService.updateAuthorAts(req.params.id, SUBMISSION_STATUS.ACCEPTED);
    await applyTransition(submission, SUBMISSION_STATUS.ACCEPTED, 'accepted', req.user, reviewNotes || 'Submission accepted', rating || null);

    res.json({ success: true, message: 'Submission accepted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error approving submission', error: error.message });
  }
});

// POST /api/reviews/:id/reject
router.post('/:id/reject', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    if (!reviewNotes || reviewNotes.trim().length === 0) {
      return res.status(400).json({ message: 'Review notes are required when rejecting a submission' });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(400).json({ message: 'Submission not found' });

    await SubmissionService.updateAuthorAts(req.params.id, SUBMISSION_STATUS.REJECTED);
    await applyTransition(submission, SUBMISSION_STATUS.REJECTED, 'rejected', req.user, reviewNotes.trim(), rating || null);

    res.json({ success: true, message: 'Submission rejected' });
  } catch (error) {
    res.status(500).json({ message: 'Error rejecting submission', error: error.message });
  }
});

// POST /api/reviews/:id/revision
router.post('/:id/revision', requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { reviewNotes, rating } = req.body;
    if (!reviewNotes || reviewNotes.trim().length === 0) {
      return res.status(400).json({ message: 'Review notes are required when requesting revision' });
    }

    const submission = await Submission.findById(req.params.id);
    if (!submission) return res.status(400).json({ message: 'Submission not found' });

    await SubmissionService.updateAuthorAts(req.params.id, SUBMISSION_STATUS.NEEDS_REVISION);
    await applyTransition(submission, SUBMISSION_STATUS.NEEDS_REVISION, 'needs_revision', req.user, reviewNotes.trim(), rating || null);

    res.json({ success: true, message: 'Revision requested' });
  } catch (error) {
    res.status(500).json({ message: 'Error requesting revision', error: error.message });
  }
});

module.exports = router;