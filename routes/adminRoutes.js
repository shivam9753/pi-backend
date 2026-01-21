const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const User = require('../models/User');
const Submission = require('../models/Submission');
const { authenticateUser } = require('../middleware/auth');
const { ImageService } = require('../config/imageService');
const S3MediaService = require('../services/s3MediaService');

// Configure multer for profile image uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Middleware to ensure admin access
const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
  next();
};

// Apply auth middleware to all routes
router.use(authenticateUser);
router.use(adminOnly);

// Create new user
router.post('/users', async (req, res) => {
  try {
    const { name, username, email, bio, role } = req.body;

    // Validate input
    if (!name || !username || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, username, and email are required' 
      });
    }

    // Validate role if provided
    const validRoles = ['user', 'writer', 'reviewer', 'admin'];
    const userRole = role && validRoles.includes(role) ? role : 'user';

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        message: 'User with this email or username already exists' 
      });
    }

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Create user
    const user = new User({
      name,
      username,
      email,
      bio: bio || '', // Include bio field
      password: hashedPassword,
      role: userRole, // Use validated role
      isEmailVerified: true
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        email: user.email,
        tempPassword // Send temp password in response (in real app, send via email)
      }
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find({}, 'name username email role createdAt')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      users
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});


// Reassign submission to different user
router.put('/submissions/:id/reassign', async (req, res) => {
  try {
    const { id } = req.params;
    const { newUserId } = req.body;

    console.log(`🔄 Admin reassignment request: ${id} -> ${newUserId}`);

    // Validate input with detailed error logging
    if (!id || typeof id !== 'string') {
      console.error('❌ Invalid submission ID:', id);
      return res.status(400).json({ 
        success: false, 
        message: 'Valid submission ID is required' 
      });
    }

    if (!newUserId || typeof newUserId !== 'string') {
      console.error('❌ Invalid new user ID:', newUserId);
      return res.status(400).json({ 
        success: false, 
        message: 'Valid new user ID is required' 
      });
    }

    // Check if new user exists with enhanced error handling
    let newUser;
    try {
      newUser = await User.findById(newUserId);
      console.log(`👤 Target user lookup result: ${newUser ? 'Found' : 'Not found'}`);
    } catch (userError) {
      console.error('❌ Error finding new user:', userError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error validating new user' 
      });
    }

    if (!newUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'New user not found' 
      });
    }

    // Update submission with enhanced error handling
    let submission;
    try {
      submission = await Submission.findByIdAndUpdate(
        id,
        { userId: newUserId },
        { new: true, runValidators: true }
      ).populate('userId', 'name username email');
      
      console.log(`📝 Submission update result: ${submission ? 'Success' : 'Not found'}`);
    } catch (updateError) {
      console.error('❌ Error updating submission:', updateError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error updating submission' 
      });
    }

    if (!submission) {
      return res.status(404).json({ 
        success: false, 
        message: 'Submission not found' 
      });
    }

    console.log(`✅ Successfully reassigned submission ${id} to user ${newUser.name}`);

    res.json({
      success: true,
      message: `Submission successfully reassigned to ${newUser.name}`,
      submission
    });

  } catch (error) {
    console.error('💥 CRITICAL ERROR in submission reassignment:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
    
    // Always return a response to prevent hanging requests
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false, 
        message: 'Internal server error during reassignment' 
      });
    }
  }
});

// Bulk reassign multiple submissions to different user
router.put('/submissions/bulk-reassign', async (req, res) => {
  try {
    const { submissionIds, newUserId } = req.body;

    // Validate input
    if (!submissionIds || !Array.isArray(submissionIds) || submissionIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Submission IDs array is required' 
      });
    }

    if (!newUserId) {
      return res.status(400).json({ 
        success: false, 
        message: 'New user ID is required' 
      });
    }

    // Check if new user exists
    const newUser = await User.findById(newUserId);
    if (!newUser) {
      return res.status(404).json({ 
        success: false, 
        message: 'New user not found' 
      });
    }

    // Update multiple submissions
    const result = await Submission.updateMany(
      { _id: { $in: submissionIds } },
      { userId: newUserId }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'No submissions found with provided IDs' 
      });
    }

    res.json({
      success: true,
      message: `Successfully reassigned ${result.modifiedCount} submission(s) to ${newUser.name}`,
      reassignedCount: result.modifiedCount,
      totalRequested: submissionIds.length
    });

  } catch (error) {
    console.error('Bulk reassign submissions error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
});

// POST /api/admin/users/:id/upload-profile-image - Upload profile image for user (admin only)
router.post('/users/:id/upload-profile-image', 
  (req, res, next) => {
    upload.single('profileImage')(req, res, (err) => {
      if (err) {
        console.log('❌ Multer error:', err.message);
        return res.status(400).json({ message: 'File upload error: ' + err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('🔧 Profile image upload for user:', req.params.id);
      console.log('🔧 File received:', req.file ? 'YES' : 'NO');
      
      if (!req.file) {
        console.log('❌ No file in request');
        return res.status(400).json({ message: 'No image file provided' });
      }

      console.log('🔧 File details:', {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });

      const user = await User.findById(req.params.id);
      if (!user) {
        console.log('❌ User not found:', req.params.id);
        return res.status(404).json({ message: 'User not found' });
      }

      console.log('🔧 User found:', user.name);

      // Upload image using ImageService
      console.log('🔧 Starting ImageService upload...');
      const uploadResult = await ImageService.uploadImage(
        req.file.buffer, 
        req.file.originalname,
        { folder: 'profiles' }
      );

      console.log('🔧 Upload result:', uploadResult);

      if (!uploadResult.success) {
        console.log('❌ Image upload failed:', uploadResult.error);
        return res.status(500).json({ 
          message: 'Image upload failed', 
          error: uploadResult.error 
        });
      }

      console.log('✅ Image uploaded successfully:', uploadResult.url);

      // Update user profile image
      user.profileImage = uploadResult.url;
      await user.save();

      console.log('✅ User profile updated with image URL');

      res.json({
        success: true,
        message: 'Profile image uploaded successfully',
        imageUrl: uploadResult.url,
        user: user.toPublicJSON()
      });
    } catch (error) {
      console.error('❌ Error uploading profile image:', error);
      res.status(500).json({ message: 'Error uploading profile image', error: error.message });
    }
  }
);

// Helper to detect DB references for a given S3 key
async function findUsageForKey(key) {
  const usages = [];
  try {
    // Check Content.images.s3Key (exact match)
    const contents = await require('../models/Content').find({ 'images.s3Key': key }).select('_id submissionId title');
    if (contents && contents.length) {
      contents.forEach(c => usages.push({ type: 'content', id: c._id, info: { submissionId: c.submissionId } }));
    }

    // Check Users by profileImage (contains key)
    const users = await require('../models/User').find({ profileImage: { $regex: key } }).select('_id username');
    if (users && users.length) {
      users.forEach(u => usages.push({ type: 'user', id: u._id, info: { username: u.username } }));
    }

    // Check Submission.imageUrl and seo.ogImage (contains key)
    const submissions = await require('../models/Submission').find({
      $or: [
        { imageUrl: { $regex: key } },
        { 'seo.ogImage': { $regex: key } }
      ]
    }).select('_id title');
    if (submissions && submissions.length) {
      submissions.forEach(s => usages.push({ type: 'submission', id: s._id, info: { title: s.title } }));
    }

  } catch (err) {
    console.error('Error finding usage for key', key, err);
  }
  return usages;
}

// GET /api/admin/media/list
router.get('/media/list', async (req, res) => {
  try {
    const prefix = req.query.prefix || '';
    const continuationToken = req.query.continuationToken || null;
    const maxKeys = req.query.maxKeys || 100;
    const filter = req.query.filter || 'all'; // all | orphan | inuse

    const listResult = await S3MediaService.listObjects(prefix, continuationToken, maxKeys);
    if (!listResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to list S3 objects', error: listResult.error });
    }

    // For each object, find DB usage (best-effort) but limit to first 50 objects to avoid heavy DB load
    const objects = listResult.objects || [];
    const limited = objects.slice(0, 50);

    const annotated = await Promise.all(limited.map(async (obj) => {
      const usedBy = await findUsageForKey(obj.Key);
      return { key: obj.Key, size: obj.Size, lastModified: obj.LastModified, url: obj.Url, usedBy };
    }));

    // Apply server-side filter if requested
    let filtered = annotated;
    if (filter === 'orphan') {
      filtered = annotated.filter(o => !o.usedBy || o.usedBy.length === 0);
    } else if (filter === 'inuse') {
      filtered = annotated.filter(o => o.usedBy && o.usedBy.length > 0);
    }

    res.json({ success: true, objects: filtered, isTruncated: listResult.isTruncated, nextContinuationToken: listResult.nextContinuationToken });
  } catch (err) {
    console.error('Media list error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// DELETE /api/admin/media - body: { key }
router.delete('/media', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ success: false, message: 'S3 object key required' });

    const deleteResult = await S3MediaService.deleteObject(key);
    if (!deleteResult.success) {
      return res.status(500).json({ success: false, message: 'Failed to delete S3 object', error: deleteResult.error });
    }

    res.json({ success: true, message: 'Object deleted' });
  } catch (err) {
    console.error('Delete media error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;