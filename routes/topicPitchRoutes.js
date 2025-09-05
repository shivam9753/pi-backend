const express = require('express');
const TopicPitch = require('../models/TopicPitch');
const { authenticateUser } = require('../middleware/auth');
const { 
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');

const router = express.Router();

// Validation middleware for topic pitch creation
const validateTopicPitchCreation = (req, res, next) => {
  const { title, description, contentType } = req.body;
  const errors = [];

  if (!title || title.trim().length < 3) {
    errors.push('Title must be at least 3 characters long');
  }
  if (title && title.length > 200) {
    errors.push('Title must be less than 200 characters');
  }
  if (!description || description.trim().length < 10) {
    errors.push('Description must be at least 10 characters long');
  }
  if (!contentType || !['article', 'opinion', 'cinema_essay', 'story'].includes(contentType)) {
    errors.push('Valid content type is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Validation failed', 
      errors 
    });
  }

  next();
};

// Middleware to check if user can pitch (creator, curator, admin)
const requirePitchPermission = (req, res, next) => {
  const userRole = req.user.role;
  
  if (!['curator', 'admin'].includes(userRole)) {
    return res.status(403).json({
      success: false,
      message: 'Only curators and admins can pitch topics'
    });
  }
  
  next();
};

// GET /api/topic-pitches - Get all topic pitches with filtering and pagination
router.get('/', authenticateUser, validatePagination, async (req, res) => {
  try {
    const {
      status = 'all',
      contentType,
      priority,
      pitchedBy,
      searchTerm,
      tags,
      dateFrom,
      dateTo,
      limit = 10,
      skip = 0
    } = req.query;

    // Build query
    let query = {};
    
    if (status !== 'all') {
      query.status = status;
    }
    
    if (contentType && contentType !== 'all') {
      query.contentType = contentType;
    }
    
    if (priority) {
      query.priority = priority;
    }
    
    if (pitchedBy) {
      query.pitchedBy = pitchedBy;
    }
    
    if (searchTerm) {
      query.$or = [
        { title: { $regex: searchTerm, $options: 'i' } },
        { description: { $regex: searchTerm, $options: 'i' } }
      ];
    }
    
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : [tags];
      query.tags = { $in: tagArray };
    }
    
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    // Execute query with pagination
    const pitches = await TopicPitch.find(query)
      .populate('pitchedBy', 'username name role')
      .populate('claimedBy', 'username name')
      .sort({ priority: -1, createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await TopicPitch.countDocuments(query);

    // Calculate stats
    const stats = await TopicPitch.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statsObject = {
      available: 0,
      claimed: 0,
      completed: 0,
      cancelled: 0,
      total: total
    };

    stats.forEach(stat => {
      statsObject[stat._id] = stat.count;
    });

    res.json({
      success: true,
      topics: pitches,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasNext: skip + limit < total,
        hasPrev: skip > 0
      },
      stats: statsObject
    });

  } catch (error) {
    console.error('Error fetching topic pitches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch topic pitches',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/topic-pitches - Create a new topic pitch
router.post('/', authenticateUser, requirePitchPermission, validateTopicPitchCreation, async (req, res) => {
  try {
    const { title, description, contentType, deadline, priority = 'medium', tags } = req.body;
    
    // Process tags
    let processedTags = [];
    if (tags) {
      if (Array.isArray(tags)) {
        processedTags = tags.filter(tag => tag && tag.trim()).map(tag => tag.trim().toLowerCase());
      } else if (typeof tags === 'string') {
        processedTags = tags.split(',').filter(tag => tag && tag.trim()).map(tag => tag.trim().toLowerCase());
      }
    }

    const topicPitch = new TopicPitch({
      title: title.trim(),
      description: description.trim(),
      contentType,
      pitchedBy: req.user._id,
      pitcherName: req.user.name || req.user.username.replace(/_\d+$/, '').replace(/_/g, ' ') || req.user.username,
      pitcherRole: req.user.role,
      deadline: deadline ? new Date(deadline) : null,
      priority,
      tags: processedTags
    });

    await topicPitch.save();
    
    // Populate the response
    await topicPitch.populate('pitchedBy', 'username name role');

    res.status(201).json({
      success: true,
      message: 'Topic pitch created successfully',
      topic: topicPitch
    });

  } catch (error) {
    console.error('Error creating topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/topic-pitches/:id - Get a specific topic pitch
router.get('/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const topicPitch = await TopicPitch.findById(req.params.id)
      .populate('pitchedBy', 'username name role bio')
      .populate('claimedBy', 'username name')
      .populate('submissionId');

    if (!topicPitch) {
      return res.status(404).json({
        success: false,
        message: 'Topic pitch not found'
      });
    }

    res.json({
      success: true,
      topic: topicPitch
    });

  } catch (error) {
    console.error('Error fetching topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// PUT /api/topic-pitches/:id - Update a topic pitch (only by pitcher or admin)
router.put('/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const topicPitch = await TopicPitch.findById(req.params.id);
    
    if (!topicPitch) {
      return res.status(404).json({
        success: false,
        message: 'Topic pitch not found'
      });
    }

    // Check permissions - only pitcher or admin can update
    if (topicPitch.pitchedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only update your own pitches'
      });
    }

    const { title, description, contentType, deadline, priority, tags, status } = req.body;
    
    // Update allowed fields
    if (title !== undefined) topicPitch.title = title.trim();
    if (description !== undefined) topicPitch.description = description.trim();
    if (contentType !== undefined) topicPitch.contentType = contentType;
    if (deadline !== undefined) topicPitch.deadline = deadline ? new Date(deadline) : null;
    if (priority !== undefined) topicPitch.priority = priority;
    
    if (tags !== undefined) {
      let processedTags = [];
      if (Array.isArray(tags)) {
        processedTags = tags.filter(tag => tag && tag.trim()).map(tag => tag.trim().toLowerCase());
      } else if (typeof tags === 'string') {
        processedTags = tags.split(',').filter(tag => tag && tag.trim()).map(tag => tag.trim().toLowerCase());
      }
      topicPitch.tags = processedTags;
    }
    
    // Only admin can change status
    if (status !== undefined && req.user.role === 'admin') {
      topicPitch.status = status;
    }

    await topicPitch.save();
    await topicPitch.populate('pitchedBy', 'username name role');

    res.json({
      success: true,
      message: 'Topic pitch updated successfully',
      topic: topicPitch
    });

  } catch (error) {
    console.error('Error updating topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/topic-pitches/:id/claim - Claim a topic pitch
router.post('/:id/claim', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const topicPitch = await TopicPitch.findById(req.params.id);
    
    if (!topicPitch) {
      return res.status(404).json({
        success: false,
        message: 'Topic pitch not found'
      });
    }

    if (topicPitch.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'Topic pitch is not available for claiming'
      });
    }

    // Prevent self-claiming
    if (topicPitch.pitchedBy.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot claim your own pitch'
      });
    }

    // Claim the pitch
    const { userDeadline } = req.body;
    
    topicPitch.status = 'claimed';
    topicPitch.claimedBy = req.user._id;
    topicPitch.claimedByName = req.user.name || req.user.username.replace(/_\d+$/, '').replace(/_/g, ' ') || req.user.username;
    topicPitch.claimedAt = new Date();
    
    // Set user deadline if provided
    if (userDeadline) {
      topicPitch.userDeadline = new Date(userDeadline);
    }
    
    await topicPitch.save();
    
    await topicPitch.populate('pitchedBy', 'username name role');
    await topicPitch.populate('claimedBy', 'username name');

    res.json({
      success: true,
      message: 'Topic pitch claimed successfully',
      topic: topicPitch
    });

  } catch (error) {
    console.error('Error claiming topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to claim topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/topic-pitches/:id/unclaim - Unclaim a topic pitch
router.post('/:id/unclaim', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const topicPitch = await TopicPitch.findById(req.params.id);
    
    if (!topicPitch) {
      return res.status(404).json({
        success: false,
        message: 'Topic pitch not found'
      });
    }

    // Only the claimer can unclaim (unless admin)
    if (topicPitch.claimedBy && 
        topicPitch.claimedBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only unclaim topics you have claimed'
      });
    }

    // Reset claim fields
    topicPitch.status = 'available';
    topicPitch.claimedBy = null;
    topicPitch.claimedByName = null;
    topicPitch.claimedAt = null;
    topicPitch.userDeadline = null;
    
    await topicPitch.save();
    await topicPitch.populate('pitchedBy', 'username name role');

    res.json({
      success: true,
      message: 'Topic pitch unclaimed successfully',
      topic: topicPitch
    });

  } catch (error) {
    console.error('Error unclaiming topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unclaim topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/topic-pitches/:id/release - Release a claimed topic pitch (kept for backward compatibility)
router.post('/:id/release', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const topicPitch = await TopicPitch.findById(req.params.id);
    
    if (!topicPitch) {
      return res.status(404).json({
        success: false,
        message: 'Topic pitch not found'
      });
    }

    // Only the claimer or admin can release
    if (topicPitch.claimedBy && 
        topicPitch.claimedBy.toString() !== req.user._id.toString() && 
        req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only release pitches you have claimed'
      });
    }

    await topicPitch.release();
    await topicPitch.populate('pitchedBy', 'username name role');

    res.json({
      success: true,
      message: 'Topic pitch released successfully',
      topic: topicPitch
    });

  } catch (error) {
    console.error('Error releasing topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to release topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// DELETE /api/topic-pitches/:id - Delete a topic pitch (only pitcher or admin)
router.delete('/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const topicPitch = await TopicPitch.findById(req.params.id);
    
    if (!topicPitch) {
      return res.status(404).json({
        success: false,
        message: 'Topic pitch not found'
      });
    }

    // Check permissions - only pitcher or admin can delete
    if (topicPitch.pitchedBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own pitches'
      });
    }

    await TopicPitch.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Topic pitch deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting topic pitch:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete topic pitch',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/topic-pitches/my/pitches - Get current user's pitches (pitched + claimed)
router.get('/my/pitches', authenticateUser, validatePagination, async (req, res) => {
  try {
    const { status, limit = 10, skip = 0 } = req.query;
    
    const pitches = await TopicPitch.getByUser(req.user._id, { status, limit: parseInt(limit), skip: parseInt(skip) });
    const total = await TopicPitch.countDocuments({
      $or: [
        { pitchedBy: req.user._id },
        { claimedBy: req.user._id }
      ],
      ...(status && { status })
    });

    res.json({
      success: true,
      topics: pitches,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasNext: skip + limit < total,
        hasPrev: skip > 0
      }
    });

  } catch (error) {
    console.error('Error fetching user pitches:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your pitches',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;