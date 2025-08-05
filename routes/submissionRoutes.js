const express = require('express');
const multer = require('multer');
const path = require('path');
const Submission = require('../models/Submission');
const SubmissionService = require('../services/submissionService');
const { authenticateUser, requireReviewer } = require('../middleware/auth');
const { 
  validateSubmissionCreation, 
  validateSubmissionUpdate, 
  validateStatusUpdate,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');

// Import ImageService for S3/local storage handling
const { ImageService } = require('../config/imageService');

const router = express.Router();

// Use memory storage for multer since we'll handle storage through ImageService
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed!'), false);
    }
  }
});

// GET /api/submissions - Consolidated endpoint for submissions with status filtering
router.get('/', validatePagination, async (req, res) => {
  try {
    const { status, type, limit = 20, skip = 0, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    // Build query based on status
    const query = {};
    if (status) query.status = status;
    if (type) query.submissionType = type;
    
    // Different field selection based on status
    let selectFields;
    if (status === 'published') {
      selectFields = 'title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime tags userId seo';
    } else {
      selectFields = 'title excerpt imageUrl readingTime submissionType tags userId reviewedBy createdAt reviewedAt';
    }
    
    const submissions = await Submission.find(query)
      .select(selectFields)
      .populate('userId', 'username email profileImage')
      .populate('reviewedBy', 'username')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Submission.countDocuments(query);
    
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
        author: {
          _id: sub.userId._id,
          username: sub.userId.username,
          profileImage: sub.userId.profileImage
        }
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
        submitterName: sub.userId?.username || 'Unknown',
        reviewerName: sub.reviewedBy?.username || 'Unknown',
        createdAt: sub.createdAt,
        reviewedAt: sub.reviewedAt
      }));
    }
    
    res.json({
      submissions: transformedSubmissions,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit)),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submissions', error: error.message });
  }
});

// GET /api/submissions/published - Get published submissions (legacy support)
router.get('/published', validatePagination, async (req, res) => {
  try {
    const result = await SubmissionService.getPublishedSubmissions(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching published submissions', error: error.message });
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

// GET /api/submissions/search/:query - Search submissions
router.get('/search/:query', validatePagination, async (req, res) => {
  try {
    const result = await SubmissionService.searchSubmissions(req.params.query, req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error searching submissions', error: error.message });
  }
});

// GET /api/submissions/user/me - Get current user's submissions (must come before /:userId)
router.get('/user/me', authenticateUser, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(400).json({ message: 'User not authenticated' });
    }
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
    const Submission = require('../models/Submission');
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

// GET /api/submissions/:id - Get submission by ID
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

// GET /api/submissions/:id/contents - Get submission with contents
router.get('/:id/contents', validateObjectId('id'), async (req, res) => {
  try {
    const submission = await SubmissionService.getSubmissionWithContent(req.params.id);
    res.json(submission);
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching submission with contents', error: error.message });
  }
});

// POST /api/submissions - Create new submission
router.post('/', validateSubmissionCreation, async (req, res) => {
  try {
    const submission = await SubmissionService.createSubmission(req.body);
    res.status(201).json({
      message: 'Submission created successfully',
      submission
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error creating submission', error: error.message });
  }
});

// GET /api/submissions/user/me - Get current user's submissions
router.get('/user/me', authenticateUser, async (req, res) => {
  try {
    if (!req.user?.userId) {
      return res.status(400).json({ message: 'User not authenticated' });
    }
    const submissions = await SubmissionService.getUserSubmissions(req.user.userId);
    res.json({ submissions });
  } catch (error) {
    console.error('Error in /user/me:', error);
    res.status(500).json({ message: 'Error fetching user submissions', error: error.message });
  }
});

// PUT /api/submissions/:id - Update submission
router.put('/:id', authenticateUser, requireReviewer, validateObjectId('id'), validateSubmissionUpdate, async (req, res) => {
  try {
    const Submission = require('../models/Submission');
    const Content = require('../models/Content');
    
    const submission = await Submission.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }

    // Update contents if provided
    if (req.body.contents && Array.isArray(req.body.contents)) {
      for (const contentData of req.body.contents) {
        if (contentData._id) {
          await Content.findByIdAndUpdate(contentData._id, {
            title: contentData.title,
            body: contentData.body
          });
        }
      }
    }

    res.json({
      success: true,
      message: 'Submission updated successfully',
      submission
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating submission', error: error.message });
  }
});

// PATCH /api/submissions/:id/status - Update submission status
router.patch('/:id/status', authenticateUser, requireReviewer, validateObjectId('id'), validateStatusUpdate, async (req, res) => {
  try {
    const submission = await SubmissionService.updateSubmissionStatus(
      req.params.id, 
      req.body.status, 
      req.user._id
    );

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
    const Submission = require('../models/Submission');
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

    const Submission = require('../models/Submission');
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

// DELETE /api/submissions/:id - Delete submission
router.delete('/:id', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const result = await SubmissionService.deleteSubmission(req.params.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'Submission not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error deleting submission', error: error.message });
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

module.exports = router;