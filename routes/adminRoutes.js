const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Submission = require('../models/Submission');
const { authenticateUser } = require('../middleware/auth');

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
    const { name, username, email } = req.body;

    // Validate input
    if (!name || !username || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, username, and email are required' 
      });
    }

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
      password: hashedPassword,
      role: 'user',
      needsProfileCompletion: false,
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

// Get all submissions with author info
router.get('/submissions/all', async (req, res) => {
  try {
    const submissions = await Submission.find({})
      .populate('userId', 'name username email')
      .populate('reviewedBy', 'username')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      submissions
    });

  } catch (error) {
    console.error('Get all submissions error:', error);
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

    // Validate input
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

    // Update submission
    const submission = await Submission.findByIdAndUpdate(
      id,
      { userId: newUserId },
      { new: true }
    ).populate('userId', 'name username email');

    if (!submission) {
      return res.status(404).json({ 
        success: false, 
        message: 'Submission not found' 
      });
    }

    res.json({
      success: true,
      message: 'Submission reassigned successfully',
      submission
    });

  } catch (error) {
    console.error('Reassign submission error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
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

module.exports = router;