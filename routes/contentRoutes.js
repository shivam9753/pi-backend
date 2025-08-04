const express = require('express');
const Content = require('../models/Content');
const { authenticateUser, requireReviewer } = require('../middleware/auth');
const { 
  validateContentCreation,
  validateObjectId,
  validatePagination 
} = require('../middleware/validation');

const router = express.Router();

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