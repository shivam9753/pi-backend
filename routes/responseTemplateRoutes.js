const express = require('express');
const router = express.Router();
const ResponseTemplate = require('../models/ResponseTemplate');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');

// GET /api/response-templates?action=reject&submissionType=poem&tone=firm
// Returns type-specific templates + 'all' templates for the given action
router.get('/', authenticateUser, requireReviewer, async (req, res) => {
  try {
    const { action, submissionType, tone } = req.query;
    const filter = {};

    if (action) {
      if (!ResponseTemplate.ACTIONS.includes(action)) {
        return res.status(400).json({ success: false, message: `action must be one of: ${ResponseTemplate.ACTIONS.join(', ')}` });
      }
      filter.action = action;
    }

    if (submissionType) {
      if (!ResponseTemplate.SUBMISSION_TYPES.includes(submissionType)) {
        return res.status(400).json({ success: false, message: `submissionType must be one of: ${ResponseTemplate.SUBMISSION_TYPES.join(', ')}` });
      }
      // Include both type-specific and catch-all templates
      filter.submissionType = { $in: [submissionType, 'all'] };
    }

    if (tone) {
      filter.tone = tone;
    }

    const templates = await ResponseTemplate.find(filter)
      .sort({ submissionType: 1, tone: 1, createdAt: -1 })
      .lean();

    return res.json({ success: true, templates });
  } catch (error) {
    console.error('Error fetching response templates:', error);
    return res.status(500).json({ success: false, message: 'Error fetching templates', error: error.message });
  }
});

// POST /api/response-templates — create
router.post('/', authenticateUser, requireReviewer, async (req, res) => {
  try {
    const { title, action, submissionType, tone, body } = req.body;
    if (!title || !action || !body) {
      return res.status(400).json({ success: false, message: 'title, action, and body are required' });
    }
    const template = await ResponseTemplate.create({
      title: String(title).trim(),
      action,
      submissionType: submissionType || 'all',
      tone: tone || 'neutral',
      body: String(body).trim()
    });
    return res.status(201).json({ success: true, template });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(500).json({ success: false, message: 'Error creating template', error: error.message });
  }
});

// PATCH /api/response-templates/:id — update
router.patch('/:id', authenticateUser, requireReviewer, async (req, res) => {
  try {
    const template = await ResponseTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

    const allowed = ['title', 'action', 'submissionType', 'tone', 'body'];
    allowed.forEach(field => {
      if (Object.hasOwn(req.body, field)) template[field] = req.body[field];
    });

    await template.save();
    return res.json({ success: true, template });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error updating template', error: error.message });
  }
});

// DELETE /api/response-templates/:id
router.delete('/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const template = await ResponseTemplate.findByIdAndDelete(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    return res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error deleting template', error: error.message });
  }
});

module.exports = router;
