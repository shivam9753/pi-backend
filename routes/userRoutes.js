const express = require('express');
const UserService = require('../services/userService');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { 
  validateUserUpdate,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');

const router = express.Router();

// GET /api/users/search - Search users
router.get('/search', validatePagination, async (req, res) => {
  try {
    const { q: query } = req.query;
    
    if (!query) {
      return res.status(400).json({ message: 'Search query is required' });
    }
    
    const users = await UserService.searchUsers(query, req.query);
    res.json({ users });
  } catch (error) {
    res.status(500).json({ message: 'Error searching users', error: error.message });
  }
});

// GET /api/users - Get all users (admin only)
router.get('/', authenticateUser, requireAdmin, validatePagination, async (req, res) => {
  try {
    const result = await UserService.getAllUsers(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching users', error: error.message });
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

// POST /api/users/:id/approve-bio - Approve user bio (admin only)
router.post('/:id/approve-bio', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { approvedBio } = req.body;
    const user = await UserService.approveUserBio(req.params.id, approvedBio, req.user.userId);
    res.json({ message: 'Bio approved successfully', user });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error approving bio', error: error.message });
  }
});

// POST /api/users/:id/approve-profile-image - Approve user profile image (admin only)
router.post('/:id/approve-profile-image', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const user = await UserService.approveUserProfileImage(req.params.id, req.user.userId);
    res.json({ message: 'Profile image approved successfully', user });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error approving profile image', error: error.message });
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
    const User = require('../models/User');
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
    
    if (!role || !['user', 'reviewer', 'admin'].includes(role)) {
      return res.status(400).json({ 
        message: 'Invalid role. Must be one of: user, reviewer, admin' 
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

module.exports = router;