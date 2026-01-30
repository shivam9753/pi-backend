const express = require('express');
const multer = require('multer');
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');
// const Analytics = require('../models/Analytics'); // Analytics model removed — analytics DB dropped
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

// Import the new analysis service
const AnalysisService = require('../services/analysisService');
const analysisService = new AnalysisService();

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

// POST /api/submissions/:id/upload-image - Upload image for a submission (used by frontend)
router.post('/:id/upload-image',
  (req, res, next) => {
    // Use multer to handle file upload and surface friendly errors
    upload.single('image')(req, res, (err) => {
      if (err) {
        console.error('Submission image upload error (multer):', err);
        return res.status(400).json({ success: false, message: 'File upload error: ' + err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const { id } = req.params;
      const submission = await Submission.findById(id);
      if (!submission) {
        return res.status(404).json({ success: false, message: 'Submission not found' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file provided' });
      }

      const { temporary = 'false', folder: customFolder } = req.body;
      const isTemporary = temporary === 'true' || temporary === true;

      const folderMap = {
        'article': 'articles',
        'cinema_essay': 'essays',
        'story': 'stories',
        'poem': 'poems'
      };
      const baseFolder = customFolder === 'profiles' ? 'profiles' : (folderMap[submission.submissionType] || folderMap['article'] || 'general');
      const folder = isTemporary ? `temp/${baseFolder}` : baseFolder;

      const uploadOptions = {
        quality: 85,
        maxWidth: 1200,
        maxHeight: 800,
        format: 'jpeg',
        folder: folder
      };

      // Upload using environment-aware service
      const uploadResult = await ImageService.uploadImage(
        req.file.buffer,
        req.file.originalname,
        uploadOptions
      );

      if (!uploadResult || !uploadResult.success) {
        console.error('Submission image upload failed:', uploadResult);
        return res.status(500).json({ success: false, message: 'Failed to upload image', error: uploadResult ? uploadResult.error : 'Unknown upload failure' });
      }

      const publicUrl = uploadResult.cdnUrl || uploadResult.url || uploadResult.fileUrl || '';

      // In production if storage expected to be s3, avoid returning local fallback
      try {
        const storageType = ImageService.getStorageType ? ImageService.getStorageType() : (process.env.NODE_ENV === 'production' ? 's3' : 'local');
        if (storageType === 's3' && uploadResult.fallbackUsed) {
          console.error('S3 expected but fallback used for submission image upload');
          return res.status(500).json({ success: false, message: 'S3 upload expected but fallback to local storage occurred. Check server S3 configuration.' });
        }
      } catch (e) {
        console.warn('Could not determine storage type for submission image upload:', e && e.message ? e.message : e);
      }

      // Update submission with image url and save
      submission.imageUrl = publicUrl;
      await submission.save();

      res.json({
        success: true,
        image: {
          url: publicUrl,
          cdnUrl: uploadResult.cdnUrl || null,
          s3Key: uploadResult.fileName || uploadResult.key || null,
          originalName: req.file.originalname,
          size: uploadResult.size,
          originalSize: uploadResult.originalSize,
          dimensions: uploadResult.dimensions,
          temporary: isTemporary,
          fallbackUsed: !!uploadResult.fallbackUsed
        }
      });

    } catch (error) {
      console.error('Error in submission image upload endpoint:', error);
      res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
    }
  }
);

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
          }
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
        quickRead: quickRead === 'true'
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
          // expose createdAt so clients can sort by creation time
          createdAt: 1,
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
      case 'createdAt':
        // Support explicit creation-time sorting
        sortField = 'createdAt';
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
      tag
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
    }
    
    // Tag filtering - need to find submissions through content collection
    let submissionIdsFromTags = null;
    if (tag) {
      const Content = require('../models/Content');
      const Tag = require('../models/Tag');

      // Resolve provided tag to canonical Tag._id — only accept ID or slug. Do NOT accept free-form names.
      let tagDoc = null;
      try {
        const isPossibleUuid = typeof tag === 'string' && (/^[0-9a-fA-F\-]{36}$/.test(tag) || /^[0-9a-fA-F]{24}$/.test(tag));

        // If looks like an id (UUID or ObjectId), try findById first
        if (isPossibleUuid) {
          tagDoc = await Tag.findById(tag).lean();
        }

        // Then try slug exact match (case-insensitive by lowercasing input)
        if (!tagDoc) {
          tagDoc = await Tag.findOne({ slug: (typeof tag === 'string' ? tag.toLowerCase() : tag) }).lean();
        }
      } catch (err) {
        console.warn('Error resolving tag to Tag doc (id/slug only):', err && (err.message || err));
      }

      // If tag not found, return empty result (do not fallback to name matching)
      if (!tagDoc) {
        return res.json({ submissions: [], total: 0, pagination: { limit: parseInt(limit), skip: parseInt(skip), currentPage: 1, totalPages: 0, hasMore: false } });
      }

      // Find contents that reference this Tag._id
      const contentsWithTag = await Content.find({ tags: { $in: [tagDoc._id] } }).select('submissionId tags').lean();

      const contentSubmissionIds = contentsWithTag.map(content => content.submissionId).filter(id => id);
      submissionIdsFromTags = [...new Set(contentSubmissionIds)];

      if (!submissionIdsFromTags || submissionIdsFromTags.length === 0) {
        // No content found with this tag, return empty result early
        return res.json({ submissions: [], total: 0, pagination: { limit: parseInt(limit), skip: parseInt(skip), currentPage: 1, totalPages: 0, hasMore: false } });
      }

      query._id = { $in: submissionIdsFromTags };
    }

    // Different field selection based on status
    let selectFields;
    if (status === 'published' || status === 'published_and_draft') {
      // Do NOT select submission-level tags - tags are derived from content at read-time
      selectFields = 'title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime userId seo status';
    } else {
      selectFields = 'title excerpt imageUrl readingTime submissionType userId reviewedBy createdAt reviewedAt status';
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
      .populate('userId', 'name username email profileImage ats')
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
        tags: [], // Submission-level tags are not stored; use detail endpoint to get aggregated tags
        slug: sub.seo?.slug,
        authorName: sub.userId?.name || sub.userId?.username || 'Unknown',
        authorAts: (sub.userId && typeof sub.userId.ats === 'number') ? sub.userId.ats : 50,
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
        tags: [],
        status: sub.status,
        authorName: sub.userId?.name || sub.userId?.username || 'Unknown',
        authorAts: (sub.userId && typeof sub.userId.ats === 'number') ? sub.userId.ats : 50,
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
        tags: [],
        status: sub.status,
        authorName: sub.userId?.name || sub.userId?.username || 'Unknown',
        authorAts: (sub.userId && typeof sub.userId.ats === 'number') ? sub.userId.ats : 50,
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
      // Analytics logging removed (analytics DB dropped)
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

    // Accept pagination and filtering query params and forward to the service
    const limit = Number.parseInt(req.query.limit || '20', 10);
    const skip = Number.parseInt(req.query.skip || '0', 10);
    const status = req.query.status || null;
    const type = req.query.type || null;

    const submissions = await SubmissionService.getUserSubmissions(req.user.userId, { limit, skip, status, type });
    res.json({ submissions });
  } catch (error) {
    console.error('Error in /user/me:', error);
    res.status(500).json({ message: 'Error fetching user submissions', error: error.message });
  }
});

// New: GET /api/submissions/drafts/my - return the authenticated user's draft submissions
router.get('/drafts/my', authenticateUser, validatePagination, async (req, res) => {
  try {
    if (!req.user?.userId) return res.status(400).json({ message: 'User not authenticated' });

    const limit = Number.parseInt(req.query.limit || '20', 10);
    const skip = Number.parseInt(req.query.skip || '0', 10);

    const query = { userId: req.user.userId, status: SUBMISSION_STATUS.DRAFT };

    const submissions = await Submission.find(query)
      .select('title excerpt submissionType imageUrl createdAt updatedAt readingTime status seo')
      .populate('userId', 'name username profileImage')
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .lean();

    const total = await Submission.countDocuments(query);

    res.json({
      submissions,
      total,
      pagination: {
        limit,
        skip,
        hasMore: (skip + submissions.length) < total,
        currentPage: Math.floor(skip / limit) + 1,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error in /drafts/my:', error);
    res.status(500).json({ message: 'Error fetching drafts', error: error.message });
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

    // Let Submission.findTrending aggregate DailyView buckets (windowDays param honored)
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

// POST /api/submissions/:id/view - Increment submission view count (rolling window)
router.post('/:id/view', validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    // windowDays is deprecated for per-doc rolling logic; keep param for backward compatibility
    const windowDays = req.body && req.body.windowDays ? Number.parseInt(req.body.windowDays, 10) : 7;

    const Submission = require('../models/Submission');
    const DailyView = require('../models/DailyView');

    const submission = await Submission.findById(id);
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Increment lifetime viewCount on submission (atomic)
    await Submission.updateOne({ _id: id }, { $inc: { viewCount: 1 } });

    // Upsert daily bucket
    const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await DailyView.updateOne(
      { targetType: 'submission', targetId: id, date: dateKey },
      { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );

    // Return updated lifetime viewCount (read fresh)
    const updated = await Submission.findById(id).select('viewCount');

    res.json({
      success: true,
      viewCount: updated ? updated.viewCount : submission.viewCount
    });
  } catch (error) {
    console.error('Error incrementing submission view count:', error);
    res.status(500).json({ message: 'Error updating view count', error: error.message });
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
    // Remove any tag data sent by client at submission creation
    if (req.body.tags) delete req.body.tags;
    if (Array.isArray(req.body.contents)) {
      req.body.contents = req.body.contents.map(c => ({
        title: c.title,
        body: c.body,
        type: c.type,
        footnotes: c.footnotes || '',
        seo: c.seo || {}
      }));
    }

    // Use authenticated user's ID instead of authorId from request body
    const submissionData = {
      ...req.body,
      userId: req.user._id, // Use authenticated user's database ID
      authorId: req.user._id, // For backward compatibility
      status: SUBMISSION_STATUS.PENDING_REVIEW // Always set status to pending_review for new submissions
    };

    // SERVER-SIDE DEDUPE: Prevent accidental duplicate submissions (e.g., double-click)
    // If a submission with same userId and title was created within the last 15 seconds,
    // treat the request as duplicate and return the existing submission.
    try {
      const recentWindowMs = 15 * 1000; // 15 seconds
      const since = new Date(Date.now() - recentWindowMs);
      const duplicate = await Submission.findOne({
        userId: req.user._id,
        title: submissionData.title,
        createdAt: { $gte: since }
      }).lean();

      if (duplicate) {
        console.warn('Duplicate submission prevented for user', req.user._id, 'title:', submissionData.title);
        // Return populated submission so client can proceed as if it was created
        const populated = await SubmissionService.getSubmissionWithContent(duplicate._id);
        return res.status(200).json({ message: 'Duplicate submission detected; returning existing submission', submission: populated });
      }
    } catch (dedupeErr) {
      console.warn('Dedupe check failed, continuing with create:', dedupeErr);
      // fallthrough to create submission
    }

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

// GET /api/submissions/by-slug/:slug - Public reading interface by SEO slug
router.get('/by-slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ success: false, message: 'Slug is required' });
    }

    // Use SubmissionService which normalizes slug and populates contents/tags
    const submission = await SubmissionService.getBySlug(slug);
    if (!submission) return res.status(404).json({ success: false, message: 'Published submission not found' });
    return res.json({ success: true, submission });
  } catch (error) {
    console.error('Error fetching submission by slug:', error && (error.message || error));
    if (error && (error.message === 'Published submission not found' || error.message === 'Submission not found')) {
      return res.status(404).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: 'Error fetching submission', error: error.message });
  }
});

// GET /api/submissions/random - Return random published submissions (public)
router.get('/random', async (req, res) => {
  try {
    const { limit = 5, type } = req.query;
    const limitNum = Math.min(Number.parseInt(limit, 10) || 5, 50); // cap at 50

    const match = { status: 'published' };
    if (type && typeof type === 'string') match.submissionType = type;

    const pipeline = [
      { $match: match },
      { $sample: { size: limitNum } },
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
          imageUrl: 1,
          readingTime: 1,
          slug: '$seo.slug',
          publishedAt: '$reviewedAt',
          author: {
            _id: '$author._id',
            name: '$author.name',
            username: '$author.username',
            profileImage: '$author.profileImage'
          }
        }
      }
    ];

    const submissions = await Submission.aggregate(pipeline);
    return res.json({ success: true, submissions });
  } catch (error) {
    console.error('Error fetching random submissions:', error);
    return res.status(500).json({ success: false, message: 'Error fetching random submissions', error: error.message });
  }
});

// POST /api/submissions/:id/publish-with-seo - Configure SEO and publish a submission
router.post('/:id/publish-with-seo', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const seoData = req.body || {};
    const publisherId = req.user._id;

    const published = await SubmissionService.publishWithSEO(id, seoData, publisherId);
    return res.json({ success: true, message: 'Submission published with SEO', submission: published });
  } catch (error) {
    console.error('Error in publish-with-seo route:', error);
    if (error && error.message === 'Submission not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: 'Error publishing submission', error: error.message });
  }
});

// PATCH /api/submissions/:id/unpublish - Unpublish a submission (admin only)
router.patch('/:id/unpublish', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const notes = req.body && req.body.notes ? String(req.body.notes).trim() : null;

    const submission = await Submission.findById(id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    // Move submission back to 'accepted' (preserve other fields) and clear reviewed metadata
    submission.status = SUBMISSION_STATUS.ACCEPTED || 'accepted';
    submission.reviewedAt = null;
    submission.reviewedBy = null;
    if (notes) submission.revisionNotes = notes;

    await submission.save();

    return res.json({ success: true, message: 'Submission unpublished and moved to accepted status', submission });
  } catch (error) {
    console.error('Error in unpublish route:', error);
    return res.status(500).json({ success: false, message: 'Error unpublishing submission', error: error.message });
  }
});

// POST /api/submissions/bulk-delete - Bulk delete multiple submissions and their contents (Admin only)
router.post('/bulk-delete', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'ids array required' });
    }

    // Normalize to string IDs and dedupe
    const normalized = [...new Set(ids.map(id => String(id)))];

    const result = await SubmissionService.deleteSubmissions(normalized);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in bulk-delete route:', error);
    res.status(500).json({ success: false, message: 'Error deleting submissions', error: error.message });
  }
});

// DELETE /api/submissions/:id - Permanently delete a submission and its contents (Admin only)
router.delete('/:id', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await SubmissionService.deleteSubmission(id);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error deleting submission:', error);
    if (error.message === 'Submission not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Error deleting submission', error: error.message });
  }
});

module.exports = router;