const express = require('express');
const Content = require('../models/Content');
const { authenticateUser, requireReviewer } = require('../middleware/auth');
const { 
  validateContentCreation,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');

const router = express.Router();

// GET /api/content - Get all content
router.get('/', validatePagination, async (req, res) => {
  try {
    const { limit = 20, skip = 0, sortBy = 'createdAt', order = 'desc', type } = req.query;
    
    const query = {};
    if (type) query.type = type;
    
    const content = await Content.find(query)
      .populate('userId', 'username email profileImage')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Content.countDocuments(query);
    
    res.json({ 
      content,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching content', error: error.message });
  }
});

// GET /api/content/search/:query - Search content
router.get('/search/:query', validatePagination, async (req, res) => {
  try {
    const { query } = req.params;
    const { limit = 10, skip = 0, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const searchQuery = {
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { body: { $regex: query, $options: 'i' } },
        { tags: { $in: [new RegExp(query, 'i')] } }
      ]
    };

    const content = await Content.find(searchQuery)
      .populate('userId', 'username email profileImage')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    res.json({ content });
  } catch (error) {
    res.status(500).json({ message: 'Error searching content', error: error.message });
  }
});

// GET /api/content/user/:userId - Get content by user
router.get('/user/:userId', validateObjectId('userId'), validatePagination, async (req, res) => {
  try {
    const { limit = 20, skip = 0, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    const content = await Content.find({ userId: req.params.userId })
      .populate('userId', 'username email profileImage')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Content.countDocuments({ userId: req.params.userId });
    
    res.json({ 
      content,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user content', error: error.message });
  }
});

// GET /api/content/type/:type - Get content by type
router.get('/type/:type', validatePagination, async (req, res) => {
  try {
    const { type } = req.params;
    const { limit = 20, skip = 0, sortBy = 'createdAt', order = 'desc' } = req.query;
    
    if (!['poem', 'story', 'article', 'quote'].includes(type)) {
      return res.status(400).json({ message: 'Invalid content type' });
    }
    
    const content = await Content.find({ type })
      .populate('userId', 'username email profileImage')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Content.countDocuments({ type });
    
    res.json({ 
      content,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching content by type', error: error.message });
  }
});

// GET /api/content/:id - Get content by ID
router.get('/:id', validateObjectId('id'), async (req, res) => {
  try {
    const content = await Content.findById(req.params.id)
      .populate('userId', 'username email profileImage');
      
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    
    res.json({ content });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching content', error: error.message });
  }
});

// POST /api/content - Create new content
router.post('/', authenticateUser, validateContentCreation, async (req, res) => {
  try {
    const contentData = {
      ...req.body,
      userId: req.user._id
    };
    
    const content = new Content(contentData);
    await content.save();
    
    await content.populate('userId', 'username email profileImage');
    
    res.status(201).json({
      message: 'Content created successfully',
      content
    });
  } catch (error) {
    res.status(500).json({ message: 'Error creating content', error: error.message });
  }
});

// PUT /api/content/:id - Update content
router.put('/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const content = await Content.findById(req.params.id);
    
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    
    // Users can only update their own content, unless they're reviewer/admin
    if (content.userId.toString() !== req.user._id.toString() && 
        !['reviewer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Can only update your own content' });
    }
    
    Object.assign(content, req.body);
    await content.save();
    
    await content.populate('userId', 'username email profileImage');
    
    res.json({
      message: 'Content updated successfully',
      content
    });
  } catch (error) {
    res.status(500).json({ message: 'Error updating content', error: error.message });
  }
});

// DELETE /api/content/:id - Delete content
router.delete('/:id', authenticateUser, validateObjectId('id'), async (req, res) => {
  try {
    const content = await Content.findById(req.params.id);
    
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }
    
    // Users can only delete their own content, unless they're reviewer/admin
    if (content.userId.toString() !== req.user._id.toString() && 
        !['reviewer', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Can only delete your own content' });
    }
    
    await Content.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting content', error: error.message });
  }
});

module.exports = router;