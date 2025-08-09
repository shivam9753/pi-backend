const express = require('express');
const multer = require('multer');
const Submission = require('../models/Submission');
const SubmissionService = require('../services/submissionService');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
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

// GET /api/submissions/:id/history - Get submission with full history
router.get('/:id/history', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('userId', 'name username email')
      .populate('history.user', 'name username email');
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Check permissions - only reviewer/admin or submission owner can view
    const isOwner = submission.userId._id.toString() === req.user._id.toString();
    const isReviewer = ['reviewer', 'admin'].includes(req.user.role);
    
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

// GET /api/submissions - Consolidated endpoint for submissions with status filtering
router.get('/', validatePagination, async (req, res) => {
  try {
    const { status, type, limit = 20, skip = 0, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    // Build query based on status
    const query = {};
    if (status) {
      // Handle special status for published and draft
      if (status === 'published_and_draft') {
        query.status = { $in: ['published', 'draft'] };
      } else {
        query.status = status;
      }
    }
    if (type) query.submissionType = type;
    
    // Different field selection based on status
    let selectFields;
    if (status === 'published' || status === 'published_and_draft') {
      selectFields = 'title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime tags userId seo status';
    } else {
      selectFields = 'title excerpt imageUrl readingTime submissionType tags userId reviewedBy createdAt reviewedAt status';
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
        submitterName: sub.userId?.username || 'Unknown',
        reviewerName: sub.reviewedBy?.username || 'Unknown',
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

// PUT /api/submissions/:id/resubmit - User resubmit needs_revision submission
router.put('/:id/resubmit', authenticateUser, validateObjectId('id'), validateSubmissionUpdate, async (req, res) => {
  try {
    const Submission = require('../models/Submission');
    const Content = require('../models/Content');
    
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
    
    // Add history entry and change status to pending_review
    await submission.changeStatus('pending_review', req.user._id, 'Resubmitted after revision');
    
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
      message: 'Submission resubmitted successfully',
      submission
    });
  } catch (error) {
    res.status(500).json({ message: 'Error resubmitting submission', error: error.message });
  }
});

// PUT /api/submissions/:id - Update submission (admin/reviewer only)
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
    const Submission = require('../models/Submission');
    
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

// DELETE /api/submissions/:id/image - Delete submission image
router.delete('/:id/image', authenticateUser, requireReviewer, validateObjectId('id'), async (req, res) => {
  try {
    const Submission = require('../models/Submission');
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

    // Remove image URL from submission
    submission.imageUrl = '';
    await submission.save();

    res.json({
      success: true,
      message: 'Image deleted successfully',
      submission
    });
  } catch (error) {
    console.error('Error deleting submission image:', error);
    res.status(500).json({ message: 'Error deleting image', error: error.message });
  }
});

// DELETE /api/submissions/:id - Delete submission (admin only)
router.delete('/:id', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const Submission = require('../models/Submission');
    
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
    
    if (submission.status !== 'published') {
      return res.status(400).json({ message: 'Only published submissions can be unpublished' });
    }
    
    await submission.changeStatus('draft', req.user._id, notes || 'Unpublished by admin');
    
    res.json({
      success: true,
      message: 'Submission unpublished successfully',
      submission: await Submission.findById(req.params.id).populate('userId', 'username').populate('history.user', 'username')
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

module.exports = router;