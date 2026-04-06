const express = require('express');
const multer = require('multer');
const Submission = require('../models/Submission');
const SubmissionService = require('../services/submissionService');
const AuditService = require('../services/auditService');
const { authenticateUser, requireReviewer, requireWriter, requireAdmin } = require('../middleware/auth');
const { 
  validateSubmissionCreation, 
  validateSubmissionUpdate,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');
const { SUBMISSION_STATUS, STATUS_UTILS } = require('../constants/status.constants');

// Import ImageService for S3/local storage handling
const { ImageService } = require('../config/imageService');

// Import the new analysis service
const AnalysisService = require('../services/analysisService');

const router = express.Router();


const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB limit (allow small multipart overhead over 2MB compressed images)
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
        // Log extra debugging information to help diagnose size-related failures
        console.error('Submission image upload error (multer):', err);
        try {
          console.error('Multer error code:', err.code);
          console.error('Request content-length header:', req.headers && req.headers['content-length']);
        } catch (e) {
          console.error('Failed to read request headers for upload error:', e && e.message);
        }
        return res.status(400).json({ success: false, message: 'File upload error: ' + err.message });
      }

      // Log received file size and content-length for debugging (helps diagnose proxy/nginx limits)
      try {
        if (req.file) {
          console.log('Submission upload received file:', {
            originalName: req.file.originalname,
            fieldName: req.file.fieldname,
            sizeBytes: req.file.size
          });
        }
        console.log('Submission upload request content-length header:', req.headers && req.headers['content-length']);
      } catch (e) {
        console.warn('Failed to log upload debug info:', e && e.message);
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
          publishedAt: '$publishedAt',
          createdAt: 1,
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
    // Add _id as tiebreaker to ensure deterministic pagination
    pipeline.push({ $sort: { [sortField]: sortOrder, _id: -1 } });

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

// GET /api/submissions/:id/history - Get full audit trail for a submission
router.get('/:id/history', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('userId', 'name username email');
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Check permissions - only writer/reviewer/admin or submission owner can view
    const isOwner = submission.userId._id.toString() === req.user._id.toString();
    const isReviewer = ['writer', 'reviewer', 'admin'].includes(req.user.role);
    
    if (!isOwner && !isReviewer) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Fetch audit trail from the Audit collection
    const auditTrail = await AuditService.getTrail(req.params.id);

    // Prepend a synthetic "created" entry using submission.createdAt if not already present
    const hasCreated = auditTrail.some(e => e.action === 'created' || e.action === 'pending_review');
    const trail = hasCreated ? auditTrail : [
      {
        action: 'created',
        resultingStatus: 'draft',
        timestamp: submission.createdAt,
        createdAt: submission.createdAt,
        userId: { _id: submission.userId._id, name: submission.userId.name, username: submission.userId.username, email: submission.userId.email },
        notes: 'Submission created'
      },
      ...auditTrail
    ];
    
    res.json({ _id: submission._id, trail });
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
      selectFields = 'title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount userId seo status';
    } else {
      selectFields = 'title excerpt imageUrl submissionType userId reviewedBy createdAt reviewedAt status';
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
    
    // Ensure canonical response shape (add success and filters)
    response.success = true;
    response.filters = {
      types: ['poem','prose','article','book_review','cinema_essay','opinion'],
      featured: (featured === 'true')
    };
    if (tag) response.filters.tag = tag;

    res.json(response);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submissions', error: error.message });
  }
});

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
      .select('title excerpt submissionType imageUrl createdAt updatedAt status seo')
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

// POST /api/submissions/drafts - Create or update a draft
router.post('/drafts', authenticateUser, async (req, res) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ message: 'User not authenticated' });

    const { title, description, submissionType, contents, draftId } = req.body;

    const sanitizedContents = Array.isArray(contents)
      ? contents.map(c => ({
          title: c.title || '',
          body: c.body || '',
          type: c.type || submissionType || '',
          footnotes: c.footnotes || '',
          seo: c.seo || {}
        }))
      : [];

    // If a draftId is provided, update the existing draft
    if (draftId) {
      const existing = await Submission.findOne({
        _id: draftId,
        userId: req.user.userId,
        status: SUBMISSION_STATUS.DRAFT
      });

      if (!existing) {
        return res.status(404).json({ message: 'Draft not found or does not belong to you' });
      }

      existing.title = title || existing.title;
      existing.description = description || existing.description;
      existing.submissionType = submissionType || existing.submissionType;
      existing.contents = sanitizedContents.length ? sanitizedContents : existing.contents;
      existing.updatedAt = new Date();

      await existing.save();

      return res.json({
        message: 'Draft updated successfully',
        draft: { id: existing._id, ...existing.toObject() }
      });
    }

    // Otherwise create a new draft
    const draft = await Submission.create({
      title: title || 'Untitled Draft',
      description: description || '',
      submissionType: submissionType || '',
      contents: sanitizedContents,
      userId: req.user.userId,
      authorId: req.user.userId,
      status: SUBMISSION_STATUS.DRAFT
    });

    return res.status(201).json({
      message: 'Draft saved successfully',
      draft: { id: draft._id, ...draft.toObject() }
    });
  } catch (error) {
    console.error('Error in POST /drafts:', error);
    res.status(500).json({ message: 'Error saving draft', error: error.message });
  }
});

// POST /api/submissions/drafts/:id/submit - Promote a draft to a real submission
router.post('/drafts/:id/submit', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ message: 'User not authenticated' });

    const draft = await Submission.findOne({
      _id: req.params.id,
      userId: req.user.userId,
      status: SUBMISSION_STATUS.DRAFT
    });

    if (!draft) {
      return res.status(404).json({ message: 'Draft not found or does not belong to you' });
    }

    draft.status = SUBMISSION_STATUS.PENDING_REVIEW;
    draft.submittedAt = new Date();
    await draft.save();

    // Audit the submit event
    await AuditService.log({
      submissionId: draft._id,
      action: 'pending_review',
      resultingStatus: SUBMISSION_STATUS.PENDING_REVIEW,
      userRole: req.user.role,
      notes: 'Submitted for review'
    });

    const populated = await SubmissionService.getSubmissionWithContent(draft._id);
    return res.json({ message: 'Draft submitted for review successfully', submission: populated });
  } catch (error) {
    console.error('Error in POST /drafts/:id/submit:', error);
    res.status(500).json({ message: 'Error submitting draft', error: error.message });
  }
});

// DELETE /api/submissions/drafts/:id - Delete a draft
router.delete('/drafts/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ message: 'User not authenticated' });

    const draft = await Submission.findOneAndDelete({
      _id: req.params.id,
      userId: req.user.userId,
      status: SUBMISSION_STATUS.DRAFT
    });

    if (!draft) {
      return res.status(404).json({ message: 'Draft not found or does not belong to you' });
    }

    return res.json({ message: 'Draft deleted successfully' });
  } catch (error) {
    console.error('Error in DELETE /drafts/:id:', error);
    res.status(500).json({ message: 'Error deleting draft', error: error.message });
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
        const populated = await SubmissionService.getSubmissionWithContent(duplicate._id);
        return res.status(200).json({ message: 'Duplicate submission detected; returning existing submission', submission: populated });
      }
    } catch (dedupeErr) {
      console.warn('Dedupe check failed, continuing with create:', dedupeErr);
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

// GET /api/submissions/related - Get published submissions of the same type as the given submission
// Query params:
//   id       (required) - the submission ID whose related content to find
//   limit    (optional, default 10, max 20)
//   skip     (optional, default 0)
router.get('/related', async (req, res) => {
  try {
    const { id, limit = 10, skip = 0 } = req.query;

    if (!id || typeof id !== 'string' || !id.trim()) {
      return res.status(400).json({ success: false, message: 'Query param "id" is required' });
    }

    const limitNum = Math.min(Number.parseInt(limit, 10) || 10, 20);
    const skipNum = Math.max(Number.parseInt(skip, 10) || 0, 0);

    // Fetch the source submission to read its type
    const source = await Submission.findById(id.trim()).select('submissionType').lean();
    if (!source) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    // TODO: extend matching logic (e.g. shared tags, same author, vector similarity)
    const query = {
      status: SUBMISSION_STATUS.PUBLISHED,
      submissionType: source.submissionType,
      _id: { $ne: id.trim() } // exclude the source submission itself
    };

    const [related, total] = await Promise.all([
      Submission.find(query)
        .select('title excerpt submissionType imageUrl reviewedAt createdAt userId seo')
        .populate('userId', 'name username profileImage')
        .sort({ reviewedAt: -1 })
        .skip(skipNum)
        .limit(limitNum)
        .lean(),
      Submission.countDocuments(query)
    ]);

    const submissions = related.map(sub => ({
      _id: sub._id,
      title: sub.title,
      excerpt: sub.excerpt,
      submissionType: sub.submissionType,
      imageUrl: sub.imageUrl,
      slug: sub.seo?.slug,
      publishedAt: sub.reviewedAt || sub.createdAt,
      author: {
        _id: sub.userId?._id || null,
        name: sub.userId?.name || sub.userId?.username || 'Unknown',
        username: sub.userId?.username || null,
        profileImage: sub.userId?.profileImage || null
      }
    }));

    return res.json({
      success: true,
      submissions,
      total,
      pagination: {
        limit: limitNum,
        skip: skipNum,
        hasMore: (skipNum + limitNum) < total,
        currentPage: Math.floor(skipNum / limitNum) + 1,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Error fetching related submissions:', error);
    return res.status(500).json({ success: false, message: 'Error fetching related submissions', error: error.message });
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
    // Return canonical response for random endpoint
    const total = Array.isArray(submissions) ? submissions.length : 0;
    const limitVal = limitNum;
    const skipVal = 0;
    const currentPage = 1;
    const totalPages = 1;
    const hasMore = false;

    return res.json({
      success: true,
      submissions,
      pagination: {
        currentPage,
        totalPages,
        limit: limitVal,
        skip: skipVal,
        hasMore
      },
      total,
      filters: {
        types: ['poem','prose','article','book_review','cinema_essay','opinion']
      }
    });
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

// PATCH /api/submissions/:id/seo - Update SEO configuration for a submission
router.patch('/:id/seo', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body || {};

    const submission = await Submission.findById(id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    submission.seo = submission.seo || {};

    // Whitelist allowed SEO fields
    const allowed = ['slug', 'metaTitle', 'metaDescription', 'primaryKeyword', 'ogImage', 'featuredOnHomepage', 'keywords', 'canonical'];
    allowed.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        // normalize booleans/strings appropriately
        if (field === 'featuredOnHomepage') submission.seo[field] = !!payload[field];
        else if (field === 'keywords' && Array.isArray(payload[field])) submission.seo[field] = payload[field];
        else submission.seo[field] = payload[field];
      }
    });

    await submission.save();

    return res.json({ success: true, message: 'SEO configuration updated', submission });
  } catch (error) {
    console.error('Error updating SEO configuration:', error);
    return res.status(500).json({ success: false, message: 'Error updating SEO configuration', error: error.message });
  }
});

// PATCH /api/submissions/:id/unpublish - Unpublish a submission (admin only)
router.patch('/:id/unpublish', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { id } = req.params;

    const submission = await Submission.findById(id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    // Move submission back to 'accepted' (preserve other fields) and clear reviewed metadata
    submission.status = SUBMISSION_STATUS.ACCEPTED || 'accepted';
    submission.reviewedAt = null;
    submission.reviewedBy = null;

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

// PUT /api/submissions/:id/resubmit - Resubmit a submission after making revisions (owner or admin)
router.put('/:id/resubmit', authenticateUser, validateObjectId('id'), validateSubmissionUpdate, async (req, res) => {
  try {
    const { id } = req.params;
    const submission = await Submission.findById(id);
    if (!submission) {
      return res.status(404).json({ success: false, message: 'Submission not found' });
    }

    // Only the owner or an admin may resubmit
    const isOwner = submission.userId && String(submission.userId) === String(req.user._id);
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Update existing Content documents if contents array is provided
    if (Array.isArray(req.body.contents) && req.body.contents.length > 0) {
      const Content = require('../models/Content');
      const incomingContents = req.body.contents;

      for (const incoming of incomingContents) {
        const contentId = incoming._id || incoming.id;
        if (contentId && submission.contentIds && submission.contentIds.includes(String(contentId))) {
          // Update existing content document
          await Content.findByIdAndUpdate(String(contentId), {
            $set: {
              title: incoming.title || '',
              body: incoming.body || '',
              footnotes: incoming.footnotes || '',
              type: incoming.type || submission.submissionType
            }
          });
        }
      }
    }

    // Whitelist updatable top-level fields for resubmission (not contents — handled above via Content docs)
    const updatable = ['title', 'description', 'submissionType', 'seo', 'imageUrl'];
    updatable.forEach(field => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        submission[field] = req.body[field];
      }
    });
    // Cap excerpt to schema maxlength to avoid validation errors
    if (Object.prototype.hasOwnProperty.call(req.body, 'excerpt')) {
      const raw = String(req.body.excerpt || '').trim();
      submission.excerpt = raw.length <= 300 ? raw : raw.slice(0, 300).trimEnd() + '…';
    }

    // Use model method to set status and record audit properly
    try {
      const fromStatus = submission.status;
      if (fromStatus !== 'resubmitted' && !STATUS_UTILS.isValidStatusTransition(fromStatus, 'resubmitted')) {
        return res.status(400).json({ success: false, message: `Invalid status transition from ${fromStatus} to resubmitted` });
      }
      submission.status = 'resubmitted';
      await submission.save();
      await AuditService.log({
        submissionId: id,
        action: 'resubmitted',
        resultingStatus: 'resubmitted',
        userId: String(req.user._id),
        userRole: req.user.role,
        notes: req.body.revisionNotes || 'Resubmitted by author'
      });
    } catch (statusErr) {
      console.error('Error changing status to resubmitted:', statusErr);
      return res.status(400).json({ success: false, message: statusErr.message || 'Invalid status transition' });
    }

    // Ensure any other changes are persisted (save again to be safe)
    await submission.save();

    // Return the updated submission (lean/populate as needed by clients)
    const populated = await Submission.findById(id)
      .populate('userId', 'name username email profileImage')
      .lean();

    return res.json({ success: true, message: 'Submission resubmitted', submission: populated });
  } catch (error) {
    console.error('Error in resubmit route:', error);
    return res.status(500).json({ success: false, message: 'Error resubmitting submission', error: error.message });
  }
});

module.exports = router;