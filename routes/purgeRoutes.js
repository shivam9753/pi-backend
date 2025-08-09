const express = require('express');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { validateObjectId, validatePagination } = require('../middleware/validation');
const PurgeService = require('../services/purgeService');

const router = express.Router();

// All routes require admin access
router.use(authenticateUser, requireAdmin);

// GET /api/purge/stats - Get purge statistics for dashboard
router.get('/stats', async (req, res) => {
  try {
    const stats = await PurgeService.getPurgeStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching purge stats:', error);
    res.status(500).json({ message: 'Error fetching purge statistics', error: error.message });
  }
});

// GET /api/purge/recommendations - Get purge recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const recommendations = await PurgeService.getPurgeRecommendations();
    res.json({ recommendations });
  } catch (error) {
    console.error('Error fetching purge recommendations:', error);
    res.status(500).json({ message: 'Error fetching purge recommendations', error: error.message });
  }
});

// GET /api/purge/submissions - Get list of purgeable submissions
router.get('/submissions', validatePagination, async (req, res) => {
  try {
    const { 
      olderThanDays = 120, 
      limit = 50, 
      skip = 0,
      status 
    } = req.query;

    const options = {
      olderThanDays: parseInt(olderThanDays),
      limit: parseInt(limit),
      skip: parseInt(skip)
    };

    if (status) options.status = status;

    const result = await PurgeService.getPurgeableSubmissions(options);
    res.json(result);
  } catch (error) {
    console.error('Error fetching purgeable submissions:', error);
    res.status(500).json({ message: 'Error fetching purgeable submissions', error: error.message });
  }
});

// POST /api/purge/preview - Preview what will be deleted
router.post('/preview', async (req, res) => {
  try {
    const { submissionIds } = req.body;

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return res.status(400).json({ message: 'submissionIds array is required' });
    }

    // Validate all IDs
    for (const id of submissionIds) {
      if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ message: `Invalid submission ID: ${id}` });
      }
    }

    const preview = await PurgeService.previewPurge(submissionIds);
    res.json({
      preview,
      message: `Preview: ${preview.submissionsToDelete} submissions, ${preview.contentToDelete} content pieces, ${preview.reviewsToDelete} reviews will be permanently deleted`
    });
  } catch (error) {
    console.error('Error generating purge preview:', error);
    res.status(500).json({ message: 'Error generating purge preview', error: error.message });
  }
});

// POST /api/purge/execute - Execute purge (DANGEROUS - permanent deletion)
router.post('/execute', async (req, res) => {
  try {
    const { submissionIds, confirmPurge } = req.body;

    if (!Array.isArray(submissionIds) || submissionIds.length === 0) {
      return res.status(400).json({ message: 'submissionIds array is required' });
    }

    if (!confirmPurge) {
      return res.status(400).json({ 
        message: 'confirmPurge must be true to execute purge operation' 
      });
    }

    // Additional safety check - limit batch size
    if (submissionIds.length > 100) {
      return res.status(400).json({ 
        message: 'Maximum 100 submissions can be purged at once for safety' 
      });
    }

    // Validate all IDs
    for (const id of submissionIds) {
      if (!id.match(/^[0-9a-fA-F]{24}$/)) {
        return res.status(400).json({ message: `Invalid submission ID: ${id}` });
      }
    }

    console.log(`🗑️ ADMIN PURGE INITIATED by ${req.user.email} for ${submissionIds.length} submissions`);

    const results = await PurgeService.executePurge(submissionIds, req.user._id);

    // Log the purge operation
    const logMessage = `Admin ${req.user.email} purged ${results.totalSubmissions} submissions, ${results.totalContent} content pieces, ${results.totalReviews} reviews`;
    console.log(`🗑️ ${logMessage}`);

    if (results.failed.length > 0) {
      return res.status(207).json({
        success: true,
        message: `Purge completed with some failures. ${results.totalSubmissions} submissions deleted successfully, ${results.failed.length} failed.`,
        results,
        warnings: results.errors
      });
    }

    res.json({
      success: true,
      message: `Successfully purged ${results.totalSubmissions} submissions and associated data`,
      results
    });

  } catch (error) {
    console.error('❌ PURGE EXECUTION FAILED:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error executing purge operation', 
      error: error.message 
    });
  }
});

// POST /api/purge/mark-existing - Mark existing rejected/spam submissions for purge (migration helper)
router.post('/mark-existing', async (req, res) => {
  try {
    const result = await PurgeService.markExistingSubmissionsForPurge();
    
    console.log(`📋 Admin ${req.user.email} marked ${result.modified} existing submissions for purge eligibility`);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error marking existing submissions for purge:', error);
    res.status(500).json({ message: 'Error marking existing submissions for purge', error: error.message });
  }
});

module.exports = router;