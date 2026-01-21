const express = require('express');
const router = express.Router();
const emailService = require('../services/emailService');
const User = require('../models/User');
const Submission = require('../models/Submission');
const { authenticateUser } = require('../middleware/auth');

// Simple send-email endpoint - admin or reviewer can send an email to a user by id or arbitrary email
// POST /api/sendemail/:id - send to user id
// POST /api/sendemail     - send to email (body.email)

// Apply authentication
router.use(authenticateUser);

// Helper to check permission
function hasPermission(user) {
  return user && user.role && (user.role === 'admin' || user.role === 'reviewer');
}

// POST /api/sendemail/:id
router.post('/:id', async (req, res) => {
  try {
    const user = req.user;
    if (!hasPermission(user)) return res.status(403).json({ message: 'Reviewer or admin access required' });

    const { subject, message, template, submissionId } = req.body;

    // If a template is requested, require a submissionId and send a template email using emailService helpers
    if (template) {
      if (!submissionId) return res.status(400).json({ message: 'submissionId is required when sending a template email' });

      // Validate template value
      const allowed = ['approved', 'rejected', 'revision', 'shortlisted'];
      if (!allowed.includes(template)) return res.status(400).json({ message: 'Invalid template name' });

      // Find submission and target user
      const submission = await Submission.findById(submissionId);
      if (!submission) return res.status(404).json({ message: 'Submission not found' });

      const targetUser = await User.findById(req.params.id).select('email name username');
      if (!targetUser || !targetUser.email) return res.status(404).json({ message: 'Target user not found or has no email' });

      // Use review message as reviewNotes for template functions
      const reviewNotes = (typeof message === 'string' && message.trim()) ? message.trim() : '';

      let result;
      switch (template) {
        case 'approved':
          result = await emailService.sendSubmissionApproved(submission, targetUser, reviewNotes);
          break;
        case 'rejected':
          result = await emailService.sendSubmissionRejected(submission, targetUser, reviewNotes);
          break;
        case 'revision':
          result = await emailService.sendRevisionRequested(submission, targetUser, reviewNotes);
          break;
        case 'shortlisted':
          result = await emailService.sendSubmissionShortlisted(submission, targetUser, reviewNotes);
          break;
        default:
          return res.status(400).json({ message: 'Unsupported template' });
      }

      if (result && result.success) {
        return res.json({ success: true, message: `Template email (${template}) sent to ${targetUser.email}`, messageId: result.messageId });
      }

      return res.status(500).json({ success: false, message: 'Failed to send template email', error: result && (result.error || result.reason) });
    }

    // Fallback: plain text email
    if (!subject || !subject.trim()) return res.status(400).json({ message: 'Email subject is required' });
    if (!message || !message.trim()) return res.status(400).json({ message: 'Email message is required' });

    const targetUser = await User.findById(req.params.id).select('email name username');
    if (!targetUser || !targetUser.email) return res.status(404).json({ message: 'Target user not found or has no email' });

    const plainText = `Dear ${targetUser.name || targetUser.username},\n\n${message}\n\nBest regards,\nThe PoemsIndia Editorial Team`;
    const result = await emailService.sendPlainTextEmail(targetUser.email, subject, plainText);

    if (result && result.success) {
      return res.json({ success: true, message: `Email sent to ${targetUser.email}`, messageId: result.messageId });
    }
    return res.status(500).json({ success: false, message: 'Failed to send email', error: result && (result.error || result.reason) });

  } catch (error) {
    console.error('Error in POST /api/sendemail/:id', error);
    res.status(500).json({ message: 'Error sending email', error: error.message });
  }
});

// POST /api/sendemail
router.post('/', async (req, res) => {
  try {
    const user = req.user;
    if (!hasPermission(user)) return res.status(403).json({ message: 'Reviewer or admin access required' });

    const { email, subject, message, template } = req.body;

    // For the arbitrary-email endpoint we only support plain-text sends; template sends should use the /:id route with submissionId
    if (template) {
      return res.status(400).json({ message: 'Template emails are only supported when sending to a user id via /api/sendemail/:id with a submissionId' });
    }

    if (!email || !email.trim()) return res.status(400).json({ message: 'Target email is required' });
    if (!subject || !subject.trim()) return res.status(400).json({ message: 'Email subject is required' });
    if (!message || !message.trim()) return res.status(400).json({ message: 'Email message is required' });

    const plainText = `Dear ${email},\n\n${message}\n\nBest regards,\nThe PoemsIndia Editorial Team`;
    const result = await emailService.sendPlainTextEmail(email, subject, plainText);

    if (result && result.success) {
      return res.json({ success: true, message: `Email sent to ${email}`, messageId: result.messageId });
    }
    return res.status(500).json({ success: false, message: 'Failed to send email', error: result && (result.error || result.reason) });

  } catch (error) {
    console.error('Error in POST /api/sendemail', error);
    res.status(500).json({ message: 'Error sending email', error: error.message });
  }
});

module.exports = router;
