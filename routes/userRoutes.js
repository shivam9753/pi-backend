const express = require('express');
const multer = require('multer');
const User = require('../models/User');
const UserService = require('../services/userService');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { 
  validateUserUpdate,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');
const { ImageService } = require('../config/imageService');

const router = express.Router();

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

// Search users (admin)
router.get('/search', authenticateUser, requireAdmin, validatePagination, async (req, res) => {
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

// List users (admin)
router.get('/', authenticateUser, requireAdmin, validatePagination, async (req, res) => {
  try {
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

// Update user role (admin)
router.patch('/:id/role', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !['user', 'reviewer', 'admin', 'writer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be one of: user, reviewer, admin, writer' });
    }
    const updatedUser = await UserService.updateUserRole(req.params.id, role);
    res.json({ message: `User role updated to ${role} successfully`, user: updatedUser });
  } catch (error) {
    if (error.message === 'User not found') return res.status(404).json({ message: error.message });
    res.status(500).json({ message: 'Error updating user role', error: error.message });
  }
});

// Mark user featured / unfeature (admin)
router.patch('/:id/feature', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const updatedUser = await UserService.markUserFeatured(req.params.id);
    res.json({ message: 'User marked as featured successfully', user: updatedUser });
  } catch (error) {
    if (error.message === 'User not found') return res.status(404).json({ message: error.message });
    res.status(500).json({ message: 'Error marking user as featured', error: error.message });
  }
});

router.patch('/:id/unfeature', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const updatedUser = await UserService.unmarkUserFeatured(req.params.id);
    res.json({ message: 'User featured status removed successfully', user: updatedUser });
  } catch (error) {
    if (error.message === 'User not found') return res.status(404).json({ message: error.message });
    res.status(500).json({ message: 'Error removing user featured status', error: error.message });
  }
});

// Delete user (admin)
router.delete('/:id', authenticateUser, requireAdmin, validateObjectId('id'), async (req, res) => {
  try {
    const result = await UserService.deleteUser(req.params.id);
    res.json(result);
  } catch (error) {
    if (error.message === 'User not found') return res.status(404).json({ message: error.message });
    res.status(500).json({ message: 'Error deleting user', error: error.message });
  }
});

// Current user profile
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const profile = await UserService.getUserProfile(req.user.userId);
    res.json({ profile });
  } catch (error) {
    if (error.message === 'User not found') return res.status(404).json({ message: error.message });
    res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

// Update profile (owner or admin)
router.put('/:id', authenticateUser, validateObjectId('id'), validateUserUpdate, async (req, res) => {
  try {
    if (req.user._id.toString() !== req.params.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Can only update your own profile' });
    }
    const updatedUser = await UserService.updateUserProfile(req.params.id, req.body);
    res.json({ message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    if (error.message === 'User not found') return res.status(404).json({ message: error.message });
    if (error.message === 'Username already taken') return res.status(409).json({ message: error.message });
    res.status(500).json({ message: 'Error updating user', error: error.message });
  }
});

// Change password (owner)
router.post('/:id/change-password', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Current password and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters long' });
    if (req.user._id.toString() !== req.params.id) return res.status(403).json({ message: 'Can only change your own password' });
    const result = await UserService.changePassword(req.params.id, currentPassword, newPassword);
    res.json(result);
  } catch (error) {
    if (error.message === 'User not found' || error.message === 'Current password is incorrect') return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Error changing password', error: error.message });
  }
});

module.exports = router;

