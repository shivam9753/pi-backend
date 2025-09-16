const express = require('express');
const multer = require('multer');
const User = require('../models/User');
const Analytics = require('../models/Analytics');
const UserService = require('../services/userService');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { 
  validateUserUpdate,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');
const { ImageService } = require('../config/imageService');

const router = express.Router();

// Configure multer for profile image uploads
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

// GET /api/users/trending - Get trending authors based on featured content views (public)
router.get('/trending', async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const pipeline = [
      // Join contents with submissions to get author info
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission'
        }
      },
      { $unwind: '$submission' },

      // Filter for featured content only
      { $match: { isFeatured: true } },

      // Join with users to get author details
      {
        $lookup: {
          from: 'users',
          localField: 'submission.userId',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: '$author' },

      // Additional filter: only include featured authors
      { $match: { 'author.isFeatured': true } },

      // Group by author and sum view counts
      {
        $group: {
          _id: '$author._id',
          author: { $first: '$author' },
          totalViews: { $sum: '$viewCount' },
          featuredCount: { $sum: 1 },
          latestFeaturedContent: {
            $first: {
              _id: '$_id',
              title: '$title',
              viewCount: '$viewCount',
              featuredAt: '$featuredAt'
            }
          }
        }
      },

      // Sort by total views descending
      { $sort: { totalViews: -1 } },

      // Limit results
      { $limit: parseInt(limit) },

      // Project final shape
      {
        $project: {
          _id: 1,
          author: {
            _id: '$author._id',
            name: '$author.name',
            username: '$author.username',
            profileImage: '$author.profileImage',
            bio: '$author.bio',
            isFeatured: '$author.isFeatured',
            featuredAt: '$author.featuredAt'
          },
          totalViews: 1,
          featuredCount: 1,
          trendingContent: '$latestFeaturedContent'
        }
      }
    ];

    const Content = require('../models/Content');
    const trendingAuthors = await Content.aggregate(pipeline);

    res.json({
      authors: trendingAuthors,
      total: trendingAuthors.length
    });

  } catch (error) {
    console.error('Error fetching trending authors:', error);
    res.status(500).json({ message: 'Error fetching trending authors', error: error.message });
  }
});

// POST /admin/users - Create new user (admin only)
router.post('/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { name, username, email, bio = '', role = 'user' } = req.body;
    
    // Validate required fields
    if (!name || !username || !email) {
      return res.status(400).json({ message: 'Name, username, and email are required' });
    }
    
    // Validate role
    if (!['user', 'reviewer', 'admin', 'writer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be user, writer, reviewer, or admin' });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });
    
    if (existingUser) {
      return res.status(409).json({ 
        message: existingUser.email === email ? 'Email already exists' : 'Username already taken'
      });
    }
    
    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);
    
    // Create user
    const user = new User({
      name,
      username,
      email,
      bio,
      role,
      password: tempPassword,
    });
    
    await user.save();
    
    res.status(201).json({
      message: 'User created successfully',
      user: user.toPublicJSON(),
      tempPassword // In production, this should be sent via email
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ message: 'Error creating user', error: error.message });
  }
});


// GET /api/users/search - Search users (admin function, no analytics tracking)
router.get('/search', authenticateUser, requireAdmin, validatePagination, async (req, res) => {
  try {
    const { q: query } = req.query;

    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const users = await UserService.searchUsers(query, req.query);

    // Note: No analytics tracking for admin user searches
    // Analytics tracking should only be for public content searches

    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Error searching users', error: error.message });
  }
});

// GET /api/users - Get all users (admin only)
router.get('/', authenticateUser, requireAdmin, validatePagination, async (req, res) => {
  try {
    // Include stats if requested via query parameter
    const options = {
      ...req.query,
      includeStats: req.query.includeStats === 'true'
    };
    const result = await UserService.getAllUsers(options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users', error: error.message });
  }
});

// GET /api/users/profile - Get current user's profile (must come before /:id/profile)
router.get('/profile', authenticateUser, async (req, res) => {
  try {
    const profile = await UserService.getUserProfile(req.user.userId);
    res.json({ profile });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

// GET /api/users/:id/profile - Get user profile with stats
router.get('/:id/profile', validateObjectId('id'), async (req, res) => {
  try {
    const profile = await UserService.getUserProfile(req.params.id);
    res.json({ profile });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

// GET /api/users/:id/submission-history - Check if user is first-time submitter
router.get('/:id/submission-history', validateObjectId('id'), async (req, res) => {
  try {
    const isFirstTime = await UserService.checkFirstTimeSubmitter(req.params.id);
    res.json({ isFirstTime });
  } catch (error) {
    console.error('Error in submission history check:', error);
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error checking submission history', error: error.message });
  }
});


// GET /api/users/:id/published-works - Get user's published works
router.get('/:id/published-works', validateObjectId('id'), validatePagination, async (req, res) => {
  try {
    const works = await UserService.getUserPublishedWorks(req.params.id, req.query);
    res.json({ 
      works,
      pagination: {
        total: works.length,
        limit: parseInt(req.query.limit) || 10,
        skip: parseInt(req.query.skip) || 0,
        hasMore: works.length === (parseInt(req.query.limit) || 10)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user works', error: error.message });
  }
});

// GET /api/users/:id - Get user by ID
router.get('/:id', validateObjectId('id'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ user: user.toPublicJSON() });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user', error: error.message });
  }
});

// PUT /api/users/:id - Update user profile
router.put('/:id', authenticateUser, validateObjectId('id'), validateUserUpdate, async (req, res) => {
  try {
    // Users can only update their own profile, unless they're admin
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Can only update your own profile' });
    }

    const updatedUser = await UserService.updateUserProfile(req.params.id, req.body);
    res.json({
      message: 'User updated successfully',
      user: updatedUser
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    if (error.message === 'Username already taken') {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error updating user', error: error.message });
  }
});

// PATCH /api/users/:id/role - Update user role (admin only)
router.patch('/:id/role', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!role || !['user', 'reviewer', 'admin', 'writer'].includes(role)) {
      return res.status(400).json({ 
        message: 'Invalid role. Must be one of: user, reviewer, admin, writer' 
      });
    }
    
    const updatedUser = await UserService.updateUserRole(req.params.id, role);
    res.json({
      message: `User role updated to ${role} successfully`,
      user: updatedUser
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error updating user role', error: error.message });
  }
});

// POST /api/users/:id/change-password - Change password
router.post('/:id/change-password', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current password and new password are required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    }
    
    // Users can only change their own password
    if (req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ message: 'Can only change your own password' });
    }
    
    const result = await UserService.changePassword(req.params.id, currentPassword, newPassword);
    res.json(result);
  } catch (error) {
    if (error.message === 'User not found' || error.message === 'Current password is incorrect') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error changing password', error: error.message });
  }
});

// REMOVED: Profile completion logic is no longer used

// DELETE /api/users/:id - Delete user (admin only)
router.delete('/:id', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const result = await UserService.deleteUser(req.params.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error deleting user', error: error.message });
  }
});

// PATCH /api/users/:id/feature - Mark user as featured (admin only)
router.patch('/:id/feature', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const updatedUser = await UserService.markUserFeatured(req.params.id);
    res.json({
      message: 'User marked as featured successfully',
      user: updatedUser
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error marking user as featured', error: error.message });
  }
});

// PATCH /api/users/:id/unfeature - Remove featured status from user (admin only)
router.patch('/:id/unfeature', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const updatedUser = await UserService.unmarkUserFeatured(req.params.id);
    res.json({
      message: 'User featured status removed successfully',
      user: updatedUser
    });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error removing user featured status', error: error.message });
  }
});

// GET /api/users/featured - Get all featured users (public)
router.get('/featured', validatePagination, async (req, res) => {
  try {
    const result = await UserService.getFeaturedUsers(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching featured users', error: error.message });
  }
});


module.exports = router;