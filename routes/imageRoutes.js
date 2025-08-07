const express = require('express');
const multer = require('multer');
const { ImageService } = require('../config/imageService');
const Content = require('../models/Content');
const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// POST /api/images/upload - Upload image to S3
router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No image file provided'
      });
    }

    const { submissionType = 'article', alt = '', caption = '' } = req.body;

    // Determine folder based on submission type
    const folderMap = {
      'article': 'articles',
      'cinema_essay': 'essays', 
      'story': 'stories',
      'poem': 'poems'
    };

    const folder = folderMap[submissionType] || 'general';

    // Upload using environment-aware service (S3 for prod, local for dev)
    const uploadResult = await ImageService.uploadImage(
      req.file.buffer,
      req.file.originalname,
      {
        quality: 85,
        maxWidth: 1200,
        maxHeight: 800,
        format: 'jpeg',
        folder: folder
      }
    );

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload image',
        error: uploadResult.error
      });
    }

    // Return image data for frontend
    res.json({
      success: true,
      image: {
        url: uploadResult.url,
        cdnUrl: uploadResult.cdnUrl,
        s3Key: uploadResult.fileName,
        originalName: req.file.originalname,
        size: uploadResult.size,
        originalSize: uploadResult.originalSize,
        compressionRatio: uploadResult.compressionRatio,
        dimensions: uploadResult.dimensions,
        alt: alt,
        caption: caption
      }
    });

  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// POST /api/images/attach/:contentId - Attach uploaded image to content
router.post('/attach/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    const imageData = req.body;

    if (!imageData.url || !imageData.s3Key) {
      return res.status(400).json({
        success: false,
        message: 'Invalid image data'
      });
    }

    // Add image to content
    const updatedContent = await Content.addS3Image(contentId, imageData);

    res.json({
      success: true,
      message: 'Image attached to content successfully',
      content: updatedContent
    });

  } catch (error) {
    console.error('Image attach error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// DELETE /api/images/:imageId/content/:contentId - Remove image from content and S3
router.delete('/:imageId/content/:contentId', async (req, res) => {
  try {
    const { imageId, contentId } = req.params;

    // Remove image from content and get S3 key
    const s3Key = await Content.removeS3Image(contentId, imageId);

    // Delete using environment-aware service
    const deleteResult = await ImageService.deleteImage(s3Key);

    if (!deleteResult.success) {
      console.error('Failed to delete from S3:', deleteResult.error);
      // Continue anyway - image removed from DB
    }

    res.json({
      success: true,
      message: 'Image removed successfully'
    });

  } catch (error) {
    console.error('Image delete error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// GET /api/images/content/:contentId - Get all images for content
router.get('/content/:contentId', async (req, res) => {
  try {
    const { contentId } = req.params;
    
    const content = await Content.findById(contentId).select('images');
    if (!content) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.json({
      success: true,
      images: content.images
    });

  } catch (error) {
    console.error('Get images error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 10MB.'
      });
    }
  }
  
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      success: false,
      message: 'Only image files are allowed'
    });
  }

  res.status(500).json({
    success: false,
    message: 'Upload error',
    error: error.message
  });
});

module.exports = router;