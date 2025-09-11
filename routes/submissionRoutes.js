const express = require('express');
const multer = require('multer');
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');
const Analytics = require('../models/Analytics');
const SubmissionService = require('../services/submissionService');
const { authenticateUser, requireReviewer, requireWriter, requireAdmin } = require('../middleware/auth');
const { 
  validateSubmissionCreation, 
  validateSubmissionUpdate, 
  validateStatusUpdate,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');
const { SUBMISSION_STATUS } = require('../constants/status.constants');

// Import ImageService for S3/local storage handling
const { ImageService } = require('../config/imageService');

const router = express.Router();


// Use memory storage for multer since we'll handle storage through ImageService
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed!'), false);
    }
  }
});

// ========================================
// DEBUG ENDPOINT - TEMPORARY
// ========================================

// GET /api/submissions/debug-count - Check actual database counts
router.get('/debug-count', authenticateUser, async (req, res) => {
  try {
    console.log('🔍 Database Debug Count Check:');
    
    // Count all submissions
    const totalSubmissions = await Submission.countDocuments({});
    console.log('- Total submissions in database:', totalSubmissions);
    
    // Count by each status
    const statusCounts = await Submission.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    console.log('- Status breakdown:', statusCounts);
    
    // Count review queue submissions
    const reviewQueueQuery = {
      status: { $in: ['pending_review', 'in_progress', 'shortlisted', 'resubmitted'] }
    };
    const reviewQueueCount = await Submission.countDocuments(reviewQueueQuery);
    console.log('- Review queue count:', reviewQueueCount);
    
    // Get sample review queue submissions to check their actual data
    const sampleSubmissions = await Submission.find(reviewQueueQuery)
      .select('title status createdAt')
      .limit(5)
      .sort({ createdAt: -1 });
    console.log('- Sample review queue submissions:', sampleSubmissions);
    
    res.json({
      success: true,
      debug: {
        totalSubmissions,
        statusCounts,
        reviewQueueCount,
        sampleSubmissions
      }
    });
  } catch (error) {
    console.error('Debug count error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========================================
// NEW OPTIMIZED LIGHTWEIGHT ENDPOINTS
// ========================================

// GET /api/submissions/review-queue - Lightweight review workflow cards
router.get('/review-queue', authenticateUser, requireReviewer, validatePagination, async (req, res) => {
  try {
    const {
      limit = 20,
      skip = 0,
      status,
      type,
      urgent,
      newAuthor,
      quickRead,
      topicSubmission,
      sortBy = 'createdAt',
      order = 'desc'
    } = req.query;

    // Build query for review queue statuses
    const query = {
      status: {
        $in: ['pending_review', 'in_progress', 'shortlisted', 'resubmitted']
      }
    };

    // Apply filters
    if (status && status !== 'all') {
      query.status = status;
    }
    if (type && type !== 'all') {
      query.submissionType = type;
    }

    // Build aggregation pipeline for lightweight data
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'submissions',
          let: { authorId: { $ifNull: ['$author._id', null] } },
          pipeline: [
            { 
              $match: { 
                $expr: { 
                  $and: [
                    { $ne: ['$$authorId', null] },
                    { $eq: ['$userId', '$$authorId'] }
                  ]
                }, 
                status: 'published' 
              } 
            },
            { $count: 'publishedCount' }
          ],
          as: 'authorStats'
        }
      },
      {
        $addFields: {
          isNewAuthor: {
            $cond: {
              if: { $eq: ['$author._id', null] },
              then: false, // Submissions without authors are not considered "new author"
              else: { $eq: [{ $ifNull: [{ $arrayElemAt: ['$authorStats.publishedCount', 0] }, 0] }, 0] }
            }
          },
          isUrgent: {
            $or: [
              { $eq: ['$status', 'resubmitted'] },
              {
                $and: [
                  { $gte: [{ $subtract: [new Date(), '$createdAt'] }, 7 * 24 * 60 * 60 * 1000] } // 7 days old
                ]
              }
            ]
          },
          hasTopicPitch: { $ne: ['$topicPitchId', null] }
        }
      },
      {
        $project: {
          _id: 1,
          title: 1,
          excerpt: 1,
          submissionType: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          readingTime: 1,
          wordCount: 1,
          imageUrl: 1,
          isUrgent: 1,
          hasTopicPitch: 1,
          isNewAuthor: 1,
          author: {
            _id: '$author._id',
            name: '$author.name',
            username: '$author.username',
            email: '$author.email'
          }
        }
      }
    ];

    // Apply additional filters
    if (urgent === 'true') {
      pipeline.push({ $match: { isUrgent: true } });
    }
    if (newAuthor === 'true') {
      pipeline.push({ $match: { isNewAuthor: true } });
    }
    if (quickRead === 'true') {
      pipeline.push({ $match: { readingTime: { $lte: 5 } } });
    }
    if (topicSubmission === 'true') {
      pipeline.push({ $match: { hasTopicPitch: true } });
    }

    // Create count pipeline BEFORE adding pagination
    const countPipeline = [...pipeline];
    countPipeline.push({ $count: "total" });
    
    // Add sorting to main pipeline
    const sortOrder = order === 'asc' ? 1 : -1;
    pipeline.push({ $sort: { [sortBy]: sortOrder } });

    // Add pagination to main pipeline
    pipeline.push({ $skip: parseInt(skip) });
    pipeline.push({ $limit: parseInt(limit) });

    // Execute both pipelines
    const [submissions, countResult] = await Promise.all([
      Submission.aggregate(pipeline),
      Submission.aggregate(countPipeline)
    ]);
    
    const total = countResult.length > 0 ? countResult[0].total : 0;
    
    // Debug logging
    console.log('🔍 Debug Pagination:');
    console.log('- Submissions returned:', submissions.length);
    console.log('- Count result:', countResult);
    console.log('- Total calculated:', total);
    console.log('- Original query:', JSON.stringify(query));
    console.log('- Applied filters: urgent=', urgent, 'newAuthor=', newAuthor, 'quickRead=', quickRead);
    
    // Debug: Test simple count without aggregation
    const simpleCount = await Submission.countDocuments(query);
    console.log('- Simple countDocuments:', simpleCount);
    
    // Debug: Show count pipeline structure
    console.log('- Count pipeline length:', countPipeline.length);
    console.log('- Count pipeline:', JSON.stringify(countPipeline, null, 2));

    res.json({
      success: true,
      submissions,
      pagination: {
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      },
      total,
      filters: {
        statuses: ['pending_review', 'in_progress', 'shortlisted', 'resubmitted'],
        types: ['poem', 'prose', 'article', 'book_review', 'cinema_essay', 'opinion'],
        urgent: urgent === 'true',
        newAuthor: newAuthor === 'true',
        quickRead: quickRead === 'true',
        topicSubmission: topicSubmission === 'true'
      }
    });
  } catch (error) {
    console.error('Error fetching review queue:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching review queue', 
      error: error.message 
    });
  }
});

// GET /api/submissions/publish-queue - Lightweight publish workflow cards
router.get('/publish-queue', authenticateUser, requireReviewer, validatePagination, async (req, res) => {
  try {
    const {
      limit = 20,
      skip = 0,
      type,
      sortBy = 'acceptedAt',
      order = 'desc'
    } = req.query;

    // Build query for accepted submissions ready to publish
    const query = {
      status: 'accepted'
    };

    // Apply type filter
    if (type && type !== 'all') {
      query.submissionType = type;
    }

    // Build aggregation pipeline for lightweight publish data
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          title: 1,
          excerpt: 1,
          submissionType: 1,
          status: 1,
          acceptedAt: '$reviewedAt',
          createdAt: 1,
          readingTime: 1,
          imageUrl: 1,
          hasImage: { $ne: ['$imageUrl', null] },
          author: {
            _id: '$author._id',
            name: '$author.name',
            username: '$author.username'
          }
        }
      }
    ];

    // Add sorting
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortField = sortBy === 'acceptedAt' ? 'acceptedAt' : sortBy;
    pipeline.push({ $sort: { [sortField]: sortOrder } });

    // Add pagination
    pipeline.push({ $skip: parseInt(skip) });
    pipeline.push({ $limit: parseInt(limit) });

    const submissions = await Submission.aggregate(pipeline);
    const total = await Submission.countDocuments(query);

    res.json({
      success: true,
      submissions,
      pagination: {
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      },
      total,
      filters: {
        types: ['poem', 'prose', 'article', 'book_review', 'cinema_essay', 'opinion']
      }
    });
  } catch (error) {
    console.error('Error fetching publish queue:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching publish queue', 
      error: error.message 
    });
  }
});

// GET /api/submissions/explore - Lightweight public content cards  
router.get('/explore', validatePagination, async (req, res) => {
  try {
    const {
      limit = 20,
      skip = 0,
      type,
      featured,
      sortBy = 'publishedAt', 
      order = 'desc'
    } = req.query;

    // Build query for published submissions
    const query = {
      status: 'published'
    };

    // Apply type filter
    if (type && type !== 'all') {
      query.submissionType = type;
    }

    // Apply featured filter
    if (featured === 'true') {
      query.featured = true;
    }

    // Build aggregation pipeline for lightweight public data
    const pipeline = [
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          slug: '$seo.slug',
          title: 1,
          excerpt: 1,
          submissionType: 1,
          publishedAt: '$reviewedAt',
          readingTime: 1,
          viewCount: { $ifNull: ['$viewCount', 0] },
          imageUrl: 1,
          featured: { $ifNull: ['$featured', false] },
          author: {
            name: '$author.name',
            username: '$author.username'
          }
        }
      }
    ];

    // Add sorting - handle different sort fields
    const sortOrder = order === 'asc' ? 1 : -1;
    let sortField;
    switch (sortBy) {
      case 'publishedAt':
      case 'latest':
        sortField = 'publishedAt';
        break;
      case 'viewCount':
      case 'popular':
        sortField = 'viewCount';
        break;
      case 'title':
        sortField = 'title';
        break;
      default:
        sortField = 'publishedAt';
    }
    pipeline.push({ $sort: { [sortField]: sortOrder } });

    // Add pagination
    pipeline.push({ $skip: parseInt(skip) });
    pipeline.push({ $limit: parseInt(limit) });

    const submissions = await Submission.aggregate(pipeline);
    const total = await Submission.countDocuments(query);

    res.json({
      success: true,
      submissions,
      pagination: {
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      },
      total,
      filters: {
        types: ['poem', 'prose', 'article', 'book_review', 'cinema_essay', 'opinion'],
        featured: featured === 'true'
      }
    });
  } catch (error) {
    console.error('Error fetching explore content:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching explore content', 
      error: error.message 
    });
  }
});





// ========================================
// END OF NEW OPTIMIZED ENDPOINTS
// ========================================

// GET /api/submissions/:id/history - Get submission with full history
router.get('/:id/history', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('userId', 'name username email')
      .populate('history.user', 'name username email');
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Check permissions - only writer/reviewer/admin or submission owner can view
    const isOwner = submission.userId._id.toString() === req.user._id.toString();
    const isReviewer = ['writer', 'reviewer', 'admin'].includes(req.user.role);
    
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Build complete history including initial submission
    const history = [
      {
        action: 'submitted',
        status: 'pending_review',
        timestamp: submission.createdAt,
        user: {
          _id: submission.userId._id,
          name: submission.userId.name,
          username: submission.userId.username,
          email: submission.userId.email
        },
        notes: 'Submission created'
      },
      ...submission.history
    ];
    
    res.json({ 
      _id: submission._id,
      history 
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submission history', error: error.message });
  }
});

// GET /api/submissions - Consolidated endpoint for submissions with enhanced filtering
router.get('/', validatePagination, async (req, res) => {
  try {
    // Add cache control headers to prevent stale data
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    const { 
      status, 
      type, 
      limit = 20, 
      skip = 0, 
      sortBy = 'createdAt', 
      order = 'desc',
      featured,
      includeTypes,
      search,
      tag,
      isTopicSubmission
    } = req.query;
    
    // Build query based on parameters
    const query = {};
    
    // Status filtering
    if (status) {
      if (status === 'published_and_draft') {
        query.status = { $in: ['published', 'draft'] };
      } else if (status === 'published_and_accepted') {
        query.status = { $in: ['published', 'accepted'] };
      } else if (status.includes(',')) {
        // Handle comma-separated multiple statuses
        const statusArray = status.split(',').map(s => s.trim()).filter(s => s.length > 0);
        query.status = { $in: statusArray };
      } else {
        query.status = status;
      }
    }
    
    // Type filtering
    if (type) query.submissionType = type;
    
    // Featured filtering
    if (featured === 'true') query.isFeatured = true;
    if (featured === 'false') query.isFeatured = false;
    
    // Topic submission filtering
    if (isTopicSubmission === 'true') {
      query.topicPitchId = { $ne: null };
    } else if (isTopicSubmission === 'false') {
      query.topicPitchId = null;
    }
    
    // Search filtering
    if (search) {
      // First, find users whose name or username matches the search term
      const User = require('../models/User');
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } }
        ]
      }).select('_id').lean();
      
      const matchingUserIds = matchingUsers.map(user => user._id);
      console.log(`🔍 Search term: "${search}", found ${matchingUsers.length} matching users:`, matchingUserIds);
      
      // Build search query that includes title, description, excerpt, and user matches
      const searchConditions = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { excerpt: { $regex: search, $options: 'i' } }
      ];
      
      // If we found matching users, add them to search conditions
      if (matchingUserIds.length > 0) {
        searchConditions.push({ userId: { $in: matchingUserIds } });
      }
      
      query.$or = searchConditions;
      console.log('🔍 Final search query:', JSON.stringify(query, null, 2));
    }
    
    // Tag filtering - need to find submissions through content collection
    let submissionIdsFromTags = null;
    if (tag) {
      const Content = require('../models/Content');
      
      // Try searching in both Content collection and Submission collection
      const contentsWithTag = await Content.find({ 
        tags: { $in: [tag.toLowerCase()] },
        isPublished: true 
      }).select('submissionId tags').lean();
      
      // Also search in submissions that have tags in their content
      const submissionsWithTag = await Submission.find({
        status: 'published'
      }).populate({
        path: 'contentIds',
        match: { tags: { $in: [tag.toLowerCase()] } }
      }).lean();
      
      // Filter out submissions where no content matched the tag
      const validSubmissionsWithTag = submissionsWithTag.filter(sub => 
        sub.contentIds && sub.contentIds.length > 0
      );
      
      // Combine IDs from both approaches
      let contentSubmissionIds = contentsWithTag.map(content => content.submissionId).filter(id => id);
      let populatedSubmissionIds = validSubmissionsWithTag.map(sub => sub._id);
      
      submissionIdsFromTags = [...new Set([...contentSubmissionIds, ...populatedSubmissionIds])];
      
      if (submissionIdsFromTags.length === 0) {
        // No content found with this tag, return empty result early
        return res.json({
          submissions: [],
          total: 0,
          pagination: {
            limit: parseInt(limit),
            skip: parseInt(skip),
            currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
            totalPages: 0,
            hasMore: false
          }
        });
      }
      
      query._id = { $in: submissionIdsFromTags };
    }
    
    // Different field selection based on status
    let selectFields;
    if (status === 'published' || status === 'published_and_draft') {
      selectFields = 'title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime tags userId seo status';
    } else {
      selectFields = 'title excerpt imageUrl readingTime submissionType tags userId reviewedBy createdAt reviewedAt status';
    }
    
    // Create a deterministic sort - handle null values properly and ensure consistent results
    let sortOptions;
    if (sortBy === 'reviewedAt') {
      // For reviewedAt, fallback to createdAt for null values, then _id for full determinism
      sortOptions = { 
        reviewedAt: order === 'asc' ? 1 : -1, 
        createdAt: order === 'asc' ? 1 : -1, 
        _id: -1 
      };
    } else {
      // For other fields, just add _id as secondary sort
      sortOptions = { [sortBy]: order === 'asc' ? 1 : -1, _id: -1 };
    }
    
    const submissions = await Submission.find(query)
      .select(selectFields)
      .populate('userId', 'name username email profileImage')
      .populate('reviewedBy', 'username')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Submission.countDocuments(query);
    
    // Include types if requested
    let submissionTypes = null;
    if (includeTypes === 'true') {
      submissionTypes = await SubmissionService.getSubmissionTypes();
    }
    
    // Get post type statistics for the filtered query
    const typeStats = await Submission.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$submissionType',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    
    // Transform data based on status
    let transformedSubmissions;
    if (status === 'published') {
      transformedSubmissions = submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        submissionType: sub.submissionType,
        excerpt: sub.excerpt,
        imageUrl: sub.imageUrl,
        publishedAt: sub.reviewedAt || sub.createdAt,
        viewCount: sub.viewCount,
        likeCount: sub.likeCount,
        readingTime: sub.readingTime,
        tags: sub.tags,
        slug: sub.seo?.slug,
        authorName: sub.userId?.name || sub.userId?.username || 'Unknown',
        author: {
          _id: sub.userId?._id || null,
          name: sub.userId?.name || sub.userId?.username || 'Unknown',
          username: sub.userId?.username || null,
          email: sub.userId?.email || null,
          profileImage: sub.userId?.profileImage || null
        }
      }));
    } else if (status === 'published_and_draft') {
      // Special case for published_and_draft - include status field
      transformedSubmissions = submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        submissionType: sub.submissionType,
        excerpt: sub.excerpt,
        imageUrl: sub.imageUrl,
        readingTime: sub.readingTime,
        tags: sub.tags,
        status: sub.status,
        authorName: sub.userId?.name || sub.userId?.username || 'Unknown',
        author: {
          _id: sub.userId?._id || null,
          name: sub.userId?.name || sub.userId?.username || 'Unknown',
          username: sub.userId?.username || null,
          email: sub.userId?.email || null,
          profileImage: sub.userId?.profileImage || null
        },
        createdAt: sub.createdAt,
        reviewedAt: sub.reviewedAt,
        viewCount: sub.viewCount || 0,
        likeCount: sub.likeCount || 0
      }));
    } else {
      transformedSubmissions = submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        excerpt: sub.excerpt,
        imageUrl: sub.imageUrl,
        readingTime: sub.readingTime,
        submissionType: sub.submissionType,
        tags: sub.tags,
        status: sub.status,
        authorName: sub.userId?.name || sub.userId?.username || 'Unknown',
        author: {
          _id: sub.userId?._id || null,
          name: sub.userId?.name || sub.userId?.username || 'Unknown',
          username: sub.userId?.username || null,
          email: sub.userId?.email || null,
          profileImage: sub.userId?.profileImage || null
        },
        createdAt: sub.createdAt,
        reviewedAt: sub.reviewedAt
      }));
    }
    
    const response = {
      submissions: transformedSubmissions,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      },
      stats: {
        typeBreakdown: typeStats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      }
    };
    
    // Add types if requested
    if (submissionTypes) {
      response.types = submissionTypes;
    }
    
    // Log search query analytics (non-blocking)
    if (search && search.trim()) {
      setImmediate(() => {
        Analytics.create({
          eventType: 'search_query',
          eventData: {
            query: search.trim(),
            resultsCount: total,
            filters: { 
              type: 'submissions',
              status,
              submissionType: type,
              featured,
              tag,
              sortBy,
              order,
              isTopicSubmission
            }
          },
          userId: req.user?._id || null,
          sessionId: req.sessionID || req.headers['x-session-id'] || 'anonymous',
          userAgent: req.headers['user-agent'] || 'Unknown',
          ip: req.ip || req.connection?.remoteAddress || 'Unknown'
        }).catch(err => console.error('Analytics logging error:', err));
      });
    }
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submissions', error: error.message });
  }
});

// DEPRECATED: Use /api/submissions?status=published instead

// GET /api/submissions/published/:id - Get single published submission
router.get('/published/:id', validateObjectId('id'), async (req, res) => {
  try {
    const submission = await SubmissionService.getPublishedSubmissionDetails(req.params.id);
    res.json(submission);
  } catch (error) {
    if (error.message === 'Published submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching submission', error: error.message });
  }
});

// GET /api/submissions/types - Get submission types with counts
router.get('/types', async (req, res) => {
  try {
    const types = await SubmissionService.getSubmissionTypes();
    res.json({ types });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submission types', error: error.message });
  }
});

// GET /api/submissions/featured - Get featured submissions
router.get('/featured', async (req, res) => {
  try {
    const featured = await SubmissionService.getFeaturedSubmissions(req.query);
    res.json({ featured, total: featured.length });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching featured submissions', error: error.message });
  }
});

// DEPRECATED: Use /api/submissions/explore?user=me instead
// This endpoint is redundant with /users/profile which provides user data + submission stats
// Use /users/profile for complete user profile, or /submissions/explore?user=me for submission list

// GET /api/submissions/user/me - Get current user's submissions (must come before /:userId)
router.get('/user/me', authenticateUser, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(400).json({ message: 'User not authenticated' });
    }
    
    // Add deprecation headers to inform frontend
    res.set('X-API-Deprecated', 'true');
    res.set('X-API-Replacement', '/api/submissions/explore?user=me');
    res.set('X-API-Alternative', '/api/users/profile (for user data + stats)');
    
    const submissions = await SubmissionService.getUserSubmissions(req.user.userId);
    res.json({ submissions });
  } catch (error) {
    console.error('Error in /user/me:', error);
    res.status(500).json({ message: 'Error fetching user submissions', error: error.message });
  }
});


// GET /api/submissions/user/:userId - Get user's submissions
router.get('/user/:userId', validateObjectId('userId'), validatePagination, async (req, res) => {
  try {
    const submissions = await Submission.find({ userId: req.params.userId })
      .populate('userId', 'username email profileImage')
      .sort({ createdAt: -1 })
      .limit(parseInt(req.query.limit) || 20)
      .skip(parseInt(req.query.skip) || 0);

    const total = await Submission.countDocuments({ userId: req.params.userId });
    
    res.json({
      submissions,
      total,
      pagination: {
        limit: parseInt(req.query.limit) || 20,
        skip: parseInt(req.query.skip) || 0,
        hasMore: (parseInt(req.query.skip) || 0) + submissions.length < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user submissions', error: error.message });
  }
});

// GET /api/submissions/trending - Get trending submissions
router.get('/trending', validatePagination, async (req, res) => {
  try {
    const { 
      limit = 10,
      skip = 0,
      windowDays = 7, 
      submissionType,
      featured 
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 10, 50); // Cap at 50
    const skipNum = parseInt(skip) || 0;
    const windowDaysNum = parseInt(windowDays) || 7;

    // Get more submissions than needed to handle filtering + pagination
    const fetchLimit = limitNum + skipNum + 20; // Extra buffer for filtering
    let trendingSubmissions = await Submission.findTrending(fetchLimit, windowDaysNum);

    // Filter by type if specified
    if (submissionType) {
      trendingSubmissions = trendingSubmissions.filter(s => s.submissionType === submissionType);
    }

    // Filter by featured if specified
    if (featured === 'true') {
      trendingSubmissions = trendingSubmissions.filter(s => s.isFeatured);
    }

    // Apply pagination after filtering
    const totalCount = trendingSubmissions.length;
    const paginatedSubmissions = trendingSubmissions.slice(skipNum, skipNum + limitNum);

    // Transform to match published submissions format
    const formattedSubmissions = paginatedSubmissions.map(submission => ({
      _id: submission._id,
      title: submission.title,
      submissionType: submission.submissionType,
      excerpt: submission.excerpt,
      imageUrl: submission.imageUrl,
      publishedAt: submission.reviewedAt || submission.createdAt,
      viewCount: submission.viewCount,
      readingTime: submission.readingTime,
      slug: submission.seo?.slug,
      authorName: submission.userId?.name || submission.userId?.username || 'Unknown'
    }));

    res.json({
      success: true,
      submissions: formattedSubmissions,
      total: totalCount,
      meta: {
        limit: limitNum,
        skip: skipNum,
        windowDays: windowDaysNum,
        returned: formattedSubmissions.length
      }
    });

  } catch (error) {
    console.error('Error fetching trending submissions:', error);
    res.status(500).json({ message: 'Error fetching trending submissions', error: error.message });
  }
});

// MOVED: Generic /:id route moved to end to avoid conflicts with specific routes like /explore

// GET /api/submissions/:id/contents - Get submission with contents
router.get('/:id/contents', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await SubmissionService.getSubmissionWithContent(req.params.id);
    
    // Check if user owns this submission or has writer/reviewer/admin rights
    const isOwner = submission.userId._id.toString() === req.user._id.toString();
    const isReviewer = req.user.role === 'writer' || req.user.role === 'reviewer' || req.user.role === 'admin';
    
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: 'Access denied. You can only view your own submissions.' });
    }
    
    res.json(submission);
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching submission with contents', error: error.message });
  }
});

// GET /api/submissions/:id/review - Get submission data optimized for reviewers
router.get('/:id/review', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await SubmissionService.getSubmissionWithContent(req.params.id);
    
    // Return only the essential data reviewers need
    const reviewData = {
      _id: submission._id,
      title: submission.title,
      description: submission.description,
      submissionType: submission.submissionType,
      status: submission.status,
      imageUrl: submission.imageUrl,
      excerpt: submission.excerpt,
      readingTime: submission.readingTime,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
      userId: {
        _id: submission.userId._id,
        name: submission.userId.name,
        username: submission.userId.username
      },
      contents: submission.contents.map(content => ({
        _id: content._id,
        title: content.title,
        body: content.body,
        type: content.type,
        tags: content.tags,
        footnotes: content.footnotes
      }))
    };
    
    res.json(reviewData);
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching submission for review', error: error.message });
  }
});

// POST /api/submissions - Create new submission
router.post('/', authenticateUser, validateSubmissionCreation, async (req, res) => {
  try {
    // Use authenticated user's ID instead of authorId from request body
    const submissionData = {
      ...req.body,
      userId: req.user._id, // Use authenticated user's database ID
      authorId: req.user._id, // For backward compatibility
      status: SUBMISSION_STATUS.PENDING_REVIEW // Always set status to pending_review for new submissions
    };
    
    const submission = await SubmissionService.createSubmission(submissionData);
    res.status(201).json({
      message: 'Submission created successfully',
      submission
    });
  } catch (error) {
    console.error('Submission creation error:', error);
    if (error.message === 'User not found') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error creating submission', error: error.message });
  }
});


// PUT /api/submissions/:id/resubmit - User resubmit needs_revision submission
router.put('/:id/resubmit', authenticateUser, validateObjectId('id'), validateSubmissionUpdate, async (req, res) => {
  try {
    
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Check if user owns this submission  
    if (submission.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Can only resubmit your own submissions' });
    }
    
    // Check if submission is in needs_revision or draft status
    if (!['needs_revision', 'draft'].includes(submission.status)) {
      return res.status(400).json({ message: 'Can only resubmit submissions that need revision or are in draft' });
    }
    
    // Update submission
    Object.assign(submission, req.body);
    
    // Add history entry and change status to resubmitted
    await submission.changeStatus('resubmitted', req.user, 'Resubmitted after revision');
    
    // Update contents if provided
    if (req.body.contents && Array.isArray(req.body.contents)) {
      const newContentIds = [];
      
      for (const contentData of req.body.contents) {
        if (contentData._id) {
          // Update existing content
          await Content.findByIdAndUpdate(contentData._id, {
            title: contentData.title,
            body: contentData.body,
            tags: contentData.tags || [],
            footnotes: contentData.footnotes || ''
          });
          newContentIds.push(contentData._id);
        } else {
          // Create new content
          const newContent = await Content.create({
            title: contentData.title,
            body: contentData.body,
            tags: contentData.tags || [],
            footnotes: contentData.footnotes || '',
            userId: submission.userId,
            submissionId: submission._id,
            type: contentData.type || submission.submissionType,
            isPublished: submission.status === 'published'
          });
          newContentIds.push(newContent._id);
        }
      }
      
      // Update submission's contentIds array
      submission.contentIds = newContentIds;
      await submission.save();
    }

    res.json({
      success: true,
      message: 'Submission resubmitted successfully',
      submission
    });
  } catch (error) {
    res.status(500).json({ message: 'Error resubmitting submission', error: error.message });
  }
});


// PATCH /api/submissions/:id/status - Update submission status
router.patch('/:id/status', authenticateUser, requireWriter, validateObjectId('id'), validateStatusUpdate, async (req, res) => {
  try {
    
    // Get submission before updating to check for images
    const submissionBefore = await Submission.findById(req.params.id);
    if (!submissionBefore) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    const submission = await SubmissionService.updateSubmissionStatus(
      req.params.id, 
      req.body.status, 
      req.user._id
    );

    // If submission is being rejected and has an image, clean it up from S3
    if (req.body.status === 'rejected' && submissionBefore.imageUrl) {
      console.log('🗑️ Submission rejected, cleaning up S3 image:', submissionBefore.imageUrl);
      
      // Extract S3 key from URL for deletion
      let s3Key = null;
      if (submissionBefore.imageUrl.includes('amazonaws.com')) {
        s3Key = submissionBefore.imageUrl.split('.amazonaws.com/')[1];
      } else if (submissionBefore.imageUrl.includes('cloudfront.net')) {
        s3Key = submissionBefore.imageUrl.split('.cloudfront.net/')[1];
      }

      // Delete from S3 if we have the key
      if (s3Key) {
        console.log('🔧 DEBUG: Attempting to delete S3 object:', s3Key);
        try {
          const deleteResult = await ImageService.deleteImage(s3Key);
          
          if (deleteResult.success) {
            console.log('✅ Successfully deleted orphaned image from S3');
          } else {
            console.error('❌ Failed to delete from S3:', deleteResult.error);
          }
        } catch (deleteError) {
          console.error('❌ Error during S3 cleanup:', deleteError);
        }
      }

      // Remove image URL from rejected submission
      submission.imageUrl = '';
      await submission.save();
    }

    res.json({
      success: true,
      message: `Submission ${req.body.status}`,
      submission
    });
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error updating submission status', error: error.message });
  }
});

// PATCH /api/submissions/:id/featured - Toggle featured status
router.patch('/:id/featured', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    await submission.toggleFeatured();

    res.json({
      message: `Submission ${submission.isFeatured ? 'featured' : 'unfeatured'}`,
      submission
    });
  } catch (error) {
    res.status(500).json({ message: 'Error toggling featured status', error: error.message });
  }
});

// POST /api/submissions/:id/upload-image - Upload image
router.post('/:id/upload-image', authenticateUser, requireReviewer, validateObjectId('id'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    console.log('🔧 DEBUG: Upload route called with file:', req.file.originalname);
    console.log('🔧 DEBUG: File size:', req.file.size, 'bytes');
    console.log('🔧 DEBUG: Using ImageService for upload...');

    // Use ImageService to handle storage (S3 or local)
    const uploadResult = await ImageService.uploadImage(
      req.file.buffer, 
      req.file.originalname,
      { folder: 'submissions' }
    );

    if (!uploadResult.success) {
      console.log('🔧 DEBUG: Image upload failed:', uploadResult.error);
      return res.status(500).json({ 
        message: 'Image upload failed', 
        error: uploadResult.error 
      });
    }

    console.log('🔧 DEBUG: Image uploaded successfully to:', uploadResult.url);

    const submission = await Submission.findByIdAndUpdate(
      req.params.id,
      { imageUrl: uploadResult.url },
      { new: true }
    );
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      imageUrl: uploadResult.url,
      submission
    });
  } catch (error) {
    res.status(500).json({ message: 'Error uploading image', error: error.message });
  }
});

// DELETE /api/submissions/:id/image - Delete submission image
router.delete('/:id/image', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    if (!submission.imageUrl) {
      return res.status(404).json({ message: 'No image found for this submission' });
    }

    console.log('🔧 DEBUG: Deleting submission image:', submission.imageUrl);

    // Extract S3 key from URL for deletion
    let s3Key = null;
    if (submission.imageUrl.includes('amazonaws.com')) {
      // Extract key from S3 URL
      s3Key = submission.imageUrl.split('.amazonaws.com/')[1];
    } else if (submission.imageUrl.includes('cloudfront.net')) {
      // Extract key from CloudFront URL  
      s3Key = submission.imageUrl.split('.cloudfront.net/')[1];
    }

    // Delete from S3 if we have the key
    if (s3Key) {
      console.log('🔧 DEBUG: Attempting to delete S3 object:', s3Key);
      const deleteResult = await ImageService.deleteImage(s3Key);
      
      if (!deleteResult.success) {
        console.error('❌ Failed to delete from S3:', deleteResult.error);
        // Continue anyway - we'll still remove from database
      } else {
        console.log('✅ Successfully deleted from S3');
      }
    } else {
      console.log('⚠️ Could not extract S3 key from URL, skipping S3 deletion');
    }

    // Remove image URL from submission - use direct update to avoid validation issues
    const updatedSubmission = await Submission.findByIdAndUpdate(
      req.params.id,
      { imageUrl: '' },
      { runValidators: false, new: true }
    );

    res.json({
      success: true,
      message: 'Image deleted successfully',
      submission: updatedSubmission
    });
  } catch (error) {
    console.error('Error deleting submission image:', error);
    res.status(500).json({ message: 'Error deleting image', error: error.message });
  }
});

// DELETE /api/submissions/:id - Delete submission (admin only)
router.delete('/:id', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    
    // Get submission before deleting to check for images
    const submissionToDelete = await Submission.findById(req.params.id);
    
    // Delete the submission
    const result = await SubmissionService.deleteSubmission(req.params.id);
    
    // Clean up S3 images if submission had any
    if (submissionToDelete && submissionToDelete.imageUrl) {
      console.log('🗑️ Submission deleted, cleaning up S3 image:', submissionToDelete.imageUrl);
      
      // Extract S3 key from URL for deletion
      let s3Key = null;
      if (submissionToDelete.imageUrl.includes('amazonaws.com')) {
        s3Key = submissionToDelete.imageUrl.split('.amazonaws.com/')[1];
      } else if (submissionToDelete.imageUrl.includes('cloudfront.net')) {
        s3Key = submissionToDelete.imageUrl.split('.cloudfront.net/')[1];
      }

      // Delete from S3 if we have the key
      if (s3Key) {
        console.log('🔧 DEBUG: Attempting to delete S3 object:', s3Key);
        try {
          const deleteResult = await ImageService.deleteImage(s3Key);
          
          if (deleteResult.success) {
            console.log('✅ Successfully deleted orphaned image from S3');
          } else {
            console.error('❌ Failed to delete from S3:', deleteResult.error);
          }
        } catch (deleteError) {
          console.error('❌ Error during S3 cleanup:', deleteError);
        }
      }
    }
    
    res.json(result);
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error deleting submission', error: error.message });
  }
});

// PATCH /api/submissions/:id/unpublish - Unpublish submission (admin only)
router.patch('/:id/unpublish', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { notes } = req.body;
    
    const submission = await Submission.findById(req.params.id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    if (submission.status !== SUBMISSION_STATUS.PUBLISHED) {
      return res.status(400).json({ message: 'Only published submissions can be unpublished' });
    }
    
    await submission.changeStatus(SUBMISSION_STATUS.ACCEPTED, req.user, notes || 'Unpublished by admin');
    
    res.json({
      success: true,
      message: 'Submission unpublished successfully',
      submission: {
        _id: submission._id,
        status: 'accepted',
        unpublishedBy: req.user._id,
        unpublishedAt: new Date()
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error unpublishing submission', error: error.message });
  }
});

// SEO-related routes
// POST /api/submissions/:id/publish-with-seo - Publish submission with SEO configuration
router.post('/:id/publish-with-seo', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const seoData = req.body;
    const submission = await SubmissionService.publishWithSEO(req.params.id, seoData, req.user._id);
    
    res.json({
      success: true,
      message: 'Submission published with SEO configuration',
      submission,
      url: `/post/${submission.seo.slug}`
    });
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    if (error.message === 'Slug already exists') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error publishing submission with SEO', error: error.message });
  }
});

// GET /api/submissions/by-slug/:slug - Get published submission by SEO slug
router.get('/by-slug/:slug', async (req, res) => {
  try {
    const submission = await SubmissionService.getBySlug(req.params.slug);
    res.json(submission);
  } catch (error) {
    if (error.message === 'Published submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching submission by slug', error: error.message });
  }
});

// PATCH /api/submissions/:id/seo - Update SEO configuration
router.patch('/:id/seo', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await SubmissionService.updateSEO(req.params.id, req.body);
    res.json({
      success: true,
      message: 'SEO configuration updated',
      submission
    });
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    if (error.message === 'Slug already exists') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error updating SEO configuration', error: error.message });
  }
});

// Import the new analysis service
const AnalysisService = require('../services/analysisService');
const analysisService = new AnalysisService();

router.post('/:id/analyze', validateObjectId('id'), async (req, res) => {
  try {
    const submissionId = req.params.id;
    
    // Get submission with content from database
    const submission = await SubmissionService.getSubmissionWithContent(submissionId);
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    // Extract text from submission contents
    let submissionText = '';
    if (submission.contents && submission.contents.length > 0) {
      submissionText = submission.contents
        .map(content => {
          const cleanTitle = stripHtmlTags(content.title || '');
          const cleanBody = stripHtmlTags(content.body || '');
          return `${cleanTitle}\n\n${cleanBody}`;
        })
        .join('\n\n---\n\n');
    } else if (req.body.submissionText) {
      submissionText = stripHtmlTags(req.body.submissionText);
    } else {
      // Fallback: use submission title and description
      const cleanTitle = stripHtmlTags(submission.title || '');
      const cleanDescription = stripHtmlTags(submission.description || '');
      submissionText = `${cleanTitle}\n\n${cleanDescription}`;
    }
    
    if (!submissionText || submissionText.trim().length === 0) {
      return res.status(400).json({ error: 'No submission text found to analyze' });
    }
    
    // Log the analysis request  
    console.log(`📊 Analysis requested for submission ${submissionId}`);
    console.log(`📝 Text length: ${submissionText.length} characters`);
    console.log(`📝 Submission type: ${submission.submissionType}`);
    
    // Use trained models from pi-engine (no fallback - fail if models unavailable)
    const analysisResult = await analysisService.analyzeSubmission(
      submissionText, 
      submission.submissionType
    );
    
    res.json({
      submissionId,
      analysis: analysisResult.analysis,
      timestamp: new Date(),
      processing_time_ms: analysisResult.processing_time,
      python_version: analysisResult.python_version,
      source: analysisResult.source,
      status: 'completed'
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ 
      error: 'Analysis failed', 
      details: error.message,
      status: 'failed'
    });
  }
});

// Health check endpoint for Python service
router.get('/analysis/health', async (req, res) => {
  try {
    const isAvailable = await analysisService.isServiceAvailable();
    const envCheck = await analysisService.verifyPythonEnvironment();
    
    res.json({
      service_available: isAvailable,
      python_path: analysisService.pythonPath,
      scripts_directory: analysisService.scriptsDir,
      timeout_ms: analysisService.timeout,
      environment_check: envCheck,
      timestamp: new Date()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Health check failed',
      details: error.message
    });
  }
});

// Helper function to strip HTML tags and clean text for analysis
function stripHtmlTags(html) {
  if (!html || typeof html !== 'string') return '';
  
  return html
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Convert HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Remove extra whitespace and line breaks
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    // Trim whitespace
    .trim();
}

// Draft management routes

// GET /api/submissions/drafts/my - Get user's drafts
router.get('/drafts/my', authenticateUser, async (req, res) => {
  try {
    const drafts = await Submission.findUserDrafts(req.user._id);
    
    const formattedDrafts = drafts.map(draft => ({
      id: draft._id,
      title: draft.title || 'Untitled Draft',
      type: draft.submissionType,
      contents: draft.contentIds || [], // Include full contents array
      content: draft.contentIds?.[0]?.body || '',
      excerpt: draft.excerpt || '',
      tags: draft.contentIds?.[0]?.tags || [],
      wordCount: draft.contentIds?.reduce((total, content) => {
        if (!content.body) return total;
        return total + content.body.trim().split(/\s+/).filter(word => word.length > 0).length;
      }, 0) || 0,
      lastEditedAt: draft.lastEditedAt,
      draftExpiresAt: draft.draftExpiresAt,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt
    }));
    
    res.json({
      success: true,
      drafts: formattedDrafts
    });
  } catch (error) {
    console.error('Error fetching user drafts:', error);
    res.status(500).json({ message: 'Error fetching drafts', error: error.message });
  }
});

// POST /api/submissions/drafts - Create or update draft
router.post('/drafts', authenticateUser, async (req, res) => {
  try {
    const { title, description, submissionType, contents, draftId, topicPitchId } = req.body;
    
    if (!submissionType) {
      return res.status(400).json({ message: 'Submission type is required' });
    }
    
    if (!contents || contents.length === 0) {
      return res.status(400).json({ message: 'At least one content piece is required' });
    }

    let draft;
    
    if (draftId) {
      // Update existing draft
      draft = await Submission.findOne({ _id: draftId, userId: req.user._id, status: 'draft' });
      if (!draft) {
        return res.status(404).json({ message: 'Draft not found' });
      }
      
      // Update content
      if (draft.contentIds && draft.contentIds.length > 0) {
        await Content.deleteMany({ _id: { $in: draft.contentIds } });
      }
      
      const contentDocs = contents.map(content => ({
        ...content,
        userId: req.user._id,
        type: content.type || submissionType,
        submissionId: draft._id
      }));
      
      const createdContents = await Content.create(contentDocs);
      
      // Calculate reading time and excerpt
      const readingTime = Submission.calculateReadingTime(createdContents);
      const excerpt = Submission.generateExcerpt(createdContents);
      
      await draft.updateDraft({
        title,
        description,
        submissionType,
        contentIds: createdContents.map(c => c._id),
        readingTime,
        excerpt,
        ...(topicPitchId && { topicPitchId })
      });
    } else {
      // Create new draft
      const submissionData = {
        userId: req.user._id,
        title,
        description,
        submissionType,
        contentIds: [],
        ...(topicPitchId && { topicPitchId })
      };
      
      draft = await Submission.createDraft(submissionData);
      
      // Create content items
      const contentDocs = contents.map(content => ({
        ...content,
        userId: req.user._id,
        type: content.type || submissionType,
        submissionId: draft._id
      }));
      
      const createdContents = await Content.create(contentDocs);
      
      // Calculate reading time and excerpt
      const readingTime = Submission.calculateReadingTime(createdContents);
      const excerpt = Submission.generateExcerpt(createdContents);
      
      // Update draft with content IDs and calculated values
      draft.contentIds = createdContents.map(c => c._id);
      draft.readingTime = readingTime;
      draft.excerpt = excerpt;
      await draft.save();
    }
    
    res.json({
      success: true,
      message: 'Draft saved successfully',
      draft: {
        id: draft._id,
        title: draft.title,
        type: draft.submissionType,
        lastEditedAt: draft.lastEditedAt,
        draftExpiresAt: draft.draftExpiresAt
      }
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({ message: 'Error saving draft', error: error.message });
  }
});

// POST /api/submissions/drafts/:id/submit - Convert draft to submission
router.post('/drafts/:id/submit', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const draft = await Submission.findOne({ 
      _id: req.params.id, 
      userId: req.user._id, 
      status: 'draft' 
    });
    
    if (!draft) {
      return res.status(404).json({ message: 'Draft not found' });
    }
    
    await draft.convertDraftToSubmission();
    
    res.json({
      success: true,
      message: 'Draft converted to submission successfully',
      submissionId: draft._id
    });
  } catch (error) {
    console.error('Error converting draft to submission:', error);
    res.status(500).json({ message: 'Error converting draft', error: error.message });
  }
});

// DELETE /api/submissions/drafts/:id - Delete draft
router.delete('/drafts/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const draft = await Submission.findOne({ 
      _id: req.params.id, 
      userId: req.user._id, 
      status: 'draft' 
    });
    
    if (!draft) {
      return res.status(404).json({ message: 'Draft not found' });
    }
    
    // Delete associated content
    if (draft.contentIds && draft.contentIds.length > 0) {
      await Content.deleteMany({ _id: { $in: draft.contentIds } });
    }
    
    await Submission.findByIdAndDelete(req.params.id);
    
    res.json({
      success: true,
      message: 'Draft deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting draft:', error);
    res.status(500).json({ message: 'Error deleting draft', error: error.message });
  }
});

// Background job to cleanup expired drafts (call this from a cron job)
router.post('/drafts/cleanup', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const result = await Submission.cleanupExpiredDrafts();
    res.json({
      success: true,
      message: 'Draft cleanup completed',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error cleaning up expired drafts:', error);
    res.status(500).json({ message: 'Error cleaning up drafts', error: error.message });
  }
});

// PUT /api/submissions/:id - Update existing submission
router.put('/:id', authenticateUser, validateObjectId('id'), validateSubmissionUpdate, async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Check if user owns the submission OR has admin/reviewer privileges
    const isOwner = submission.userId.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    const isReviewer = req.user.role === 'reviewer';
    
    if (!isOwner && !isAdmin && !isReviewer) {
      return res.status(403).json({ message: 'Access denied - not your submission and insufficient privileges' });
    }
    
    // For regular users, only allow updates for certain statuses
    // For admins and reviewers, allow updates to published posts as well
    if (!isAdmin && !isReviewer) {
      const allowedStatuses = ['draft', 'needs_revision'];
      if (!allowedStatuses.includes(submission.status)) {
        return res.status(400).json({ 
          message: `Cannot update submission with status: ${submission.status}` 
        });
      }
    }
    
    const { title, description, submissionType, contents, status, imageUrl } = req.body;
    
    // Update submission fields
    if (title) submission.title = title;
    if (description !== undefined) submission.description = description;
    if (submissionType) submission.submissionType = submissionType;
    if (status) submission.status = status;
    if (imageUrl !== undefined) submission.imageUrl = imageUrl;
    
    // Handle content updates if provided
    if (contents && Array.isArray(contents)) {
      // Delete existing content items
      if (submission.contentIds && submission.contentIds.length > 0) {
        await Content.deleteMany({ _id: { $in: submission.contentIds } });
      }
      
      // Create new content items
      const contentDocs = contents.map(content => ({
        userId: req.user._id,
        submissionId: submission._id.toString(), // Add required submissionId
        title: content.title,
        body: content.body,
        type: content.type || submissionType,
        tags: content.tags || [],
        footnotes: content.footnotes || ''
      }));
      
      const createdContents = await Content.create(contentDocs);
      submission.contentIds = createdContents.map(c => c._id);
      
      // Recalculate reading time and excerpt
      submission.readingTime = Submission.calculateReadingTime(createdContents);
      submission.excerpt = Submission.generateExcerpt(createdContents);
      
      // If this is a published post being updated by admin/reviewer, update the published content
      if (submission.status === 'published' && (isAdmin || isReviewer)) {
        // Update the published content items
        for (const content of createdContents) {
          content.isPublished = true;
          await content.save();
        }
      }
    }
    
    submission.updatedAt = new Date();
    
    await submission.save();
    
    res.json({
      success: true,
      message: 'Submission updated successfully',
      submission
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating submission', error: error.message });
  }
});

// PUT /api/submissions/:id/resubmit - Semantic resubmission API
router.put('/:id/resubmit', authenticateUser, validateObjectId('id'), validateSubmissionUpdate, async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ 
        success: false, 
        message: 'Submission not found' 
      });
    }
    
    // Check ownership
    if (submission.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Can only resubmit your own submissions' 
      });
    }
    
    // Check if submission can be resubmitted
    const allowedStatuses = ['needs_revision', 'draft', 'rejected'];
    if (!allowedStatuses.includes(submission.status)) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot resubmit submission with status: ${submission.status}. Allowed statuses: ${allowedStatuses.join(', ')}` 
      });
    }
    
    const { title, description, submissionType, contents } = req.body;
    
    // Update submission fields
    if (title) submission.title = title;
    if (description !== undefined) submission.description = description;
    if (submissionType) submission.submissionType = submissionType;
    
    // Handle content updates
    if (contents && Array.isArray(contents)) {
      // Delete existing content items
      if (submission.contentIds && submission.contentIds.length > 0) {
        await Content.deleteMany({ _id: { $in: submission.contentIds } });
      }
      
      // Create new content items with proper _id handling
      const newContentIds = [];
      
      for (const contentData of contents) {
        const contentDoc = {
          userId: req.user._id,
          submissionId: submission._id.toString(),
          title: contentData.title,
          body: contentData.body,
          type: contentData.type || submissionType,
          tags: contentData.tags || [],
          footnotes: contentData.footnotes || ''
        };
        
        const newContent = await Content.create(contentDoc);
        newContentIds.push(newContent._id);
      }
      
      submission.contentIds = newContentIds;
      
      // Recalculate reading time and excerpt
      const createdContents = await Content.find({ _id: { $in: newContentIds } });
      submission.readingTime = Submission.calculateReadingTime(createdContents);
      submission.excerpt = Submission.generateExcerpt(createdContents);
    }
    
    // Automatically change status to 'resubmitted' - this is the semantic behavior
    const previousStatus = submission.status;
    submission.status = 'resubmitted';
    submission.revisionNotes = null; // Clear any previous revision notes
    submission.updatedAt = new Date();
    
    // Add to history using the changeStatus method for proper tracking
    await submission.changeStatus('resubmitted', req.user, `Resubmitted from ${previousStatus} status`);
    
    res.json({
      success: true,
      message: 'Submission resubmitted successfully and status updated to "resubmitted"',
      submission: {
        _id: submission._id,
        title: submission.title,
        status: submission.status,
        previousStatus: previousStatus,
        updatedAt: submission.updatedAt,
        submissionType: submission.submissionType
      }
    });
  } catch (error) {
    console.error('Error resubmitting submission:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error resubmitting submission', 
      error: error.message 
    });
  }
});

// POST /api/submissions/:id/view - Log view with rolling window trending
router.post('/:id/view', validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const { windowDays = 7 } = req.body;

    const submission = await Submission.findOne({ _id: id, status: 'published' });

    if (!submission) {
      return res.status(404).json({ message: 'Published submission not found' });
    }

    // Log the view using our rolling window method
    await submission.logView(windowDays);

    res.json({
      success: true,
      viewCount: submission.viewCount,
      recentViews: submission.recentViews,
      windowStartTime: submission.windowStartTime.toISOString(),
      trendingScore: submission.getTrendingScore()
    });

  } catch (error) {
    console.error('Error logging view:', error);
    res.status(500).json({ message: 'Error logging view', error: error.message });
  }
});

// GET /api/submissions/most-viewed - Get most viewed submissions
router.get('/most-viewed', validatePagination, async (req, res) => {
  try {
    const { 
      limit = 10, 
      timeframe = 'all',
      submissionType
    } = req.query;

    const limitNum = Math.min(parseInt(limit) || 10, 50);

    let mostViewedSubmissions = await Submission.findMostViewed(limitNum, timeframe);

    // Filter by type if specified
    if (submissionType) {
      mostViewedSubmissions = mostViewedSubmissions.filter(s => s.submissionType === submissionType);
    }

    const formattedSubmissions = mostViewedSubmissions.map(submission => ({
      _id: submission._id,
      title: submission.title,
      submissionType: submission.submissionType,
      excerpt: submission.excerpt,
      imageUrl: submission.imageUrl,
      publishedAt: submission.reviewedAt || submission.createdAt,
      viewCount: submission.viewCount,
      readingTime: submission.readingTime,
      slug: submission.seo?.slug,
      authorName: submission.userId?.name || submission.userId?.username || 'Unknown'
    }));

    res.json({
      success: true,
      submissions: formattedSubmissions,
      meta: {
        total: formattedSubmissions.length,
        limit: limitNum,
        timeframe
      }
    });

  } catch (error) {
    console.error('Error fetching most viewed submissions:', error);
    res.status(500).json({ message: 'Error fetching most viewed submissions', error: error.message });
  }
});

// GET /api/submissions/:id/stats - Get detailed stats for a submission
router.get('/:id/stats', validateObjectId('id'), async (req, res) => {
  try {
    const submission = await Submission.findOne({ 
      _id: req.params.id, 
      status: 'published' 
    }).select('viewCount recentViews windowStartTime');

    if (!submission) {
      return res.status(404).json({ message: 'Published submission not found' });
    }

    res.json({
      success: true,
      stats: {
        viewCount: submission.viewCount || 0,
        recentViews: submission.recentViews || 0,
        windowStartTime: submission.windowStartTime,
        trendingScore: submission.getTrendingScore()
      }
    });

  } catch (error) {
    console.error('Error fetching submission stats:', error);
    res.status(500).json({ message: 'Error fetching submission stats', error: error.message });
  }
});

// GET /api/submissions/analytics/overview - Get overall analytics data
router.get('/analytics/overview', requireReviewer, async (req, res) => {
  try {
    // Get total counts and aggregate statistics
    const totalSubmissions = await Submission.countDocuments({ status: 'published' });
    
    // Get total views across all published submissions
    const viewStats = await Submission.aggregate([
      { $match: { status: 'published' } },
      {
        $group: {
          _id: null,
          totalViews: { $sum: '$viewCount' },
          totalRecentViews: { $sum: '$recentViews' },
          avgViews: { $avg: '$viewCount' }
        }
      }
    ]);

    // Get post type statistics
    const typeStats = await Submission.aggregate([
      { $match: { status: 'published' } },
      {
        $group: {
          _id: '$submissionType',
          count: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          avgViews: { $avg: '$viewCount' }
        }
      },
      { $sort: { totalViews: -1 } }
    ]);

    // Get top viewed posts
    const topPosts = await Submission.find({ status: 'published' })
      .populate('userId', 'name username')
      .select('title viewCount recentViews submissionType publishedAt seo')
      .sort({ viewCount: -1 })
      .limit(10);

    // Get recent trending posts (last 7 days activity)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const trending = await Submission.find({ 
      status: 'published',
      windowStartTime: { $gte: sevenDaysAgo },
      recentViews: { $gt: 0 }
    })
      .populate('userId', 'name username')
      .select('title viewCount recentViews submissionType publishedAt seo')
      .sort({ recentViews: -1 })
      .limit(10);

    // Calculate trending scores for each post
    const trendingWithScores = trending.map(post => ({
      ...post.toObject(),
      trendingScore: post.getTrendingScore ? post.getTrendingScore() : 0
    }));

    // Get recent activity data (posts published in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentActivity = await Submission.aggregate([
      { 
        $match: { 
          status: 'published',
          publishedAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$publishedAt" } },
          posts: { $sum: 1 },
          views: { $sum: '$viewCount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const stats = viewStats[0] || { totalViews: 0, totalRecentViews: 0, avgViews: 0 };

    res.json({
      success: true,
      overview: {
        totalPosts: totalSubmissions,
        totalViews: stats.totalViews,
        totalRecentViews: stats.totalRecentViews,
        avgViewsPerPost: Math.round(stats.avgViews || 0),
        postTypeStats: typeStats,
        topPosts: topPosts,
        trendingPosts: trendingWithScores,
        recentActivity: recentActivity
      }
    });

  } catch (error) {
    console.error('Error fetching analytics overview:', error);
    res.status(500).json({ message: 'Error fetching analytics overview', error: error.message });
  }
});

// GET /api/submissions/analytics/performance - Get performance analytics
router.get('/analytics/performance', requireReviewer, async (req, res) => {
  try {
    const { timeframe = '30' } = req.query;
    const days = parseInt(timeframe);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get view performance data
    const performanceData = await Submission.aggregate([
      { $match: { status: 'published', publishedAt: { $gte: startDate } } },
      {
        $project: {
          title: 1,
          viewCount: 1,
          recentViews: 1,
          submissionType: 1,
          publishedAt: 1,
          viewsPerDay: {
            $divide: [
              '$viewCount',
              {
                $max: [
                  1,
                  {
                    $divide: [
                      { $subtract: [new Date(), '$publishedAt'] },
                      1000 * 60 * 60 * 24
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      { $sort: { viewsPerDay: -1 } },
      { $limit: 20 }
    ]);

    res.json({
      success: true,
      performance: {
        timeframe: `${days} days`,
        topPerformers: performanceData
      }
    });

  } catch (error) {
    console.error('Error fetching performance analytics:', error);
    res.status(500).json({ message: 'Error fetching performance analytics', error: error.message });
  }
});

// GET /api/submissions/:id - Get submission by ID (MOVED TO END to avoid conflicts with /explore)
router.get('/:id', validateObjectId('id'), async (req, res) => {
  try {
    const submission = await SubmissionService.getSubmissionWithContent(req.params.id);
    res.json({ submission });
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching submission', error: error.message });
  }
});

module.exports = router;