const express = require('express');
const multer = require('multer');
const { ImageService } = require('../config/imageService');
const Content = require('../models/Content');
const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB limit
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

    const { submissionType = 'article', alt = '', caption = '', temporary = 'false', folder: customFolder } = req.body;
    const isTemporary = temporary === 'true' || temporary === true;

    // Determine folder based on submission type and temporary status
    const folderMap = {
      'article': 'articles',
      'cinema_essay': 'essays',
      'story': 'stories',
      'poem': 'poems'
    };

    // Use custom folder if provided (e.g., 'profiles'), otherwise use folderMap
    const baseFolder = customFolder === 'profiles' ? 'profiles' : (folderMap[submissionType] || 'general');
    const folder = isTemporary ? `temp/${baseFolder}` : baseFolder;

    // Upload using environment-aware service (S3 for prod, local for dev)
    const uploadOptions = {
      quality: 85,
      maxWidth: 1200,
      maxHeight: 800,
      format: 'jpeg',
      folder: folder
    };

    // Add minimum file size requirement for profile images
    if (folder === 'profiles') {
      uploadOptions.minimumFileSize = 100 * 1024; // 100KB minimum for profiles
    }

    const uploadResult = await ImageService.uploadImage(
      req.file.buffer,
      req.file.originalname,
      uploadOptions
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
        qualityUsed: uploadResult.qualityUsed,
        appliedMinimumSize: uploadResult.appliedMinimumSize,
        alt: alt,
        caption: caption,
        temporary: isTemporary
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

// DELETE /api/images/delete - Delete image by S3 key (for rich text editor)
router.delete('/delete', async (req, res) => {
  try {
    const { s3Key } = req.body;

    if (!s3Key) {
      return res.status(400).json({
        success: false,
        message: 'S3 key is required'
      });
    }

    // Delete using environment-aware service
    const deleteResult = await ImageService.deleteImage(s3Key);

    if (!deleteResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete image',
        error: deleteResult.error
      });
    }

    res.json({
      success: true,
      message: 'Image deleted successfully'
    });

  } catch (error) {
    console.error('Image delete error:', error);
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

// POST /api/images/move-to-permanent - Move images from temp to permanent folder
router.post('/move-to-permanent', async (req, res) => {
  try {
    const { imageUrls } = req.body;
    
    if (!imageUrls || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return res.json({
        success: true,
        message: 'No images to move',
        movedImages: []
      });
    }

    const movedImages = [];
    
    // For each image URL, check if it's a temp image and move it
    for (const imageUrl of imageUrls) {
      try {
        // Extract S3 key from URL (assuming URL structure)
        const urlParts = imageUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];
        
        // Check if it's a temp image URL
        if (imageUrl.includes('/temp/')) {
          // For S3, we need to copy from temp to permanent location
          if (ImageService.getStorageType && ImageService.getStorageType() === 's3') {
            const S3ImageService = require('../config/s3').S3ImageService;
            
            // Extract temp key from URL
            const tempKey = imageUrl.split('.amazonaws.com/')[1] || 
                           imageUrl.split('.cloudfront.net/')[1];
            
            if (tempKey && tempKey.startsWith('temp/')) {
              const permanentKey = tempKey.replace(/^temp\//, '');
              
              const copyResult = await S3ImageService.moveFromTemp(tempKey, permanentKey);
              
              if (copyResult.success) {
                movedImages.push({
                  originalUrl: imageUrl,
                  newUrl: copyResult.url,
                  moved: true
                });
              }
            }
          } else {
            // For local storage, just note that it would be moved
            movedImages.push({
              originalUrl: imageUrl,
              newUrl: imageUrl.replace('/temp/', '/'),
              moved: true
            });
          }
        } else {
          // Already permanent, just keep as is
          movedImages.push({
            originalUrl: imageUrl,
            newUrl: imageUrl,
            moved: false
          });
        }
      } catch (error) {
        console.error(`Error moving image ${imageUrl}:`, error);
        movedImages.push({
          originalUrl: imageUrl,
          newUrl: imageUrl,
          moved: false,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      message: `Processed ${imageUrls.length} images`,
      movedImages
    });

  } catch (error) {
    console.error('Move to permanent error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 2MB.'
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