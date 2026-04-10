const express = require('express');
const Audit = require('../models/Audit');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

router.get('/notes', authenticateUser, async (req, res) => {
  try {
    const { submissionId, action } = req.query;

    if (!submissionId || !action) {
      return res.status(400).json({ success: false, message: 'submissionId and action are required' });
    }

    const allowedActions = ['rejected', 'needs_revision'];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({ success: false, message: `action must be one of: ${allowedActions.join(', ')}` });
    }

    const auditEntry = await Audit.findOne({
      submissionId: String(submissionId),
      action,
      notes: { $exists: true, $ne: '' }
    })
      .sort({ createdAt: -1 })
      .populate('userId', 'name username')
      .lean();

    if (!auditEntry) {
      return res.json({ success: true, notes: null, message: 'No notes found for this action' });
    }

    return res.json({
      success: true,
      notes: auditEntry.notes,
      action: auditEntry.action,
      by: auditEntry.userId ? (auditEntry.userId.name || auditEntry.userId.username) : 'Unknown',
      date: auditEntry.createdAt
    });
  } catch (error) {
    console.error('Error fetching audit notes:', error);
    return res.status(500).json({ success: false, message: 'Error fetching audit notes', error: error.message });
  }
});

module.exports = router;
