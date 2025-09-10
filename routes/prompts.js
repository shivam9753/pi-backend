// routes/prompts.js
const express = require('express');
const router = express.Router();
// ID validation helper - supports both UUID and MongoDB ObjectId formats for backward compatibility
const isValidId = (str) => {
  // UUID format (primary)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // MongoDB ObjectId format (backward compatibility)
  const objectIdRegex = /^[0-9a-fA-F]{24}$/;
  
  return uuidRegex.test(str) || objectIdRegex.test(str);
};
const { authenticateUser, requireRole } = require('../middleware/auth');
const {
  COLLECTION_NAME,
  validatePrompt,
  createPromptDoc,
  updatePromptDoc,
  buildPromptsQuery,
  buildSortOptions,
  formatPromptResponse,
  getPopularPromptsAggregation,
  getSearchAggregation,
  getStatsAggregation
} = require('../utils/promptHelpers');
const { getDB } = require('../db');

// GET /api/prompts - Get all prompts with filtering and search
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    const {
      search,
      popular,
      limit = 20,
      page = 1,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    let prompts;
    let total;

    // Handle search with text index
    if (search) {
      const searchPipeline = getSearchAggregation(search, parseInt(limit));
      prompts = await collection.aggregate(searchPipeline).toArray();
      return res.json({
        success: true,
        data: prompts.map(formatPromptResponse),
        total: prompts.length,
        searchTerm: search
      });
    }

    // Handle popular prompts
    if (popular === 'true') {
      const popularPipeline = getPopularPromptsAggregation(parseInt(limit));
      prompts = await collection.aggregate(popularPipeline).toArray();
      return res.json({
        success: true,
        data: prompts.map(formatPromptResponse),
        total: prompts.length,
        popular: true
      });
    }


    // Regular filtering and pagination
    const query = buildPromptsQuery({});
    const sort = buildSortOptions(sortBy, sortOrder);
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get prompts with pagination
    prompts = await collection
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit))
      .toArray();

    // Populate user info
    for (let prompt of prompts) {
      if (prompt.createdBy) {
        const user = await db.collection('users').findOne(
          { _id: prompt.createdBy },
          { projection: { name: 1, email: 1 } }
        );
        prompt.createdBy = user;
      }
    }

    // Get total count
    total = await collection.countDocuments(query);

    res.json({
      success: true,
      data: prompts.map(formatPromptResponse),
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });

  } catch (error) {
    console.error('Error fetching prompts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching prompts',
      error: error.message
    });
  }
});

router.get('/all', authenticateUser, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    // Get all prompts (for admin interface)
    const prompts = await collection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // Populate user info for each prompt
    for (let prompt of prompts) {
      if (prompt.createdBy) {
        const user = await db.collection('users').findOne(
          { _id: prompt.createdBy },
          { projection: { name: 1, email: 1 } }
        );
        prompt.createdBy = user;
      }
    }

    res.json({
      success: true,
      data: prompts.map(formatPromptResponse),
      total: prompts.length
    });

  } catch (error) {
    console.error('Error fetching all prompts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching all prompts',
      error: error.message
    });
  }
});

// GET /api/prompts/:id - Get single prompt
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    const prompt = await collection.findOne({ _id: req.params.id });

    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // Populate user info
    if (prompt.createdBy) {
      const user = await db.collection('users').findOne(
        { _id: prompt.createdBy },
        { projection: { name: 1, email: 1 } }
      );
      prompt.createdBy = user;
    }

    res.json({
      success: true,
      data: formatPromptResponse(prompt)
    });

  } catch (error) {
    console.error('Error fetching prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching prompt',
      error: error.message
    });
  }
});

// POST /api/prompts - Create new prompt (Admin only)
router.post('/', authenticateUser, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    // Validate input
    const validationErrors = validatePrompt(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Create prompt document
    const promptDoc = createPromptDoc(req.body, req.user.id);
    
    // Insert into database
    const result = await collection.insertOne(promptDoc);
    
    // Get the created prompt with user info (use our custom _id)
    const createdPrompt = await collection.findOne({ _id: promptDoc._id });
    const user = await db.collection('users').findOne(
      { _id: createdPrompt.createdBy },
      { projection: { name: 1, email: 1 } }
    );
    createdPrompt.createdBy = user;

    res.status(201).json({
      success: true,
      message: 'Prompt created successfully',
      data: formatPromptResponse(createdPrompt)
    });

  } catch (error) {
    console.error('Error creating prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating prompt',
      error: error.message
    });
  }
});

// PUT /api/prompts/:id - Update prompt (Admin only)
router.put('/:id', authenticateUser, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    // Validate input
    const validationErrors = validatePrompt(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors
      });
    }

    // Get existing prompt
    const existingPrompt = await collection.findOne({ _id: req.params.id });
    if (!existingPrompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // Update document
    const updatedDoc = updatePromptDoc(existingPrompt, req.body);
    
    // Update in database
    await collection.updateOne(
      { _id: req.params.id },
      { $set: updatedDoc }
    );

    // Get updated prompt with user info
    const updatedPrompt = await collection.findOne({ _id: req.params.id });
    const user = await db.collection('users').findOne(
      { _id: updatedPrompt.createdBy },
      { projection: { name: 1, email: 1 } }
    );
    updatedPrompt.createdBy = user;

    res.json({
      success: true,
      message: 'Prompt updated successfully',
      data: formatPromptResponse(updatedPrompt)
    });

  } catch (error) {
    console.error('Error updating prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating prompt',
      error: error.message
    });
  }
});

// DELETE /api/prompts/:id - Delete prompt (Admin only)
router.delete('/:id', authenticateUser, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    const result = await collection.deleteOne({ _id: req.params.id });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    res.json({
      success: true,
      message: 'Prompt deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting prompt:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting prompt',
      error: error.message
    });
  }
});


// GET /api/prompts/stats/overview - Get prompt statistics (Admin only)
router.get('/stats/overview', authenticateUser, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    const statsResult = await collection.aggregate(getStatsAggregation()).toArray();
    const stats = statsResult[0];

    // Format the response
    const formattedStats = {
      totalPrompts: stats.totalActive[0]?.count || 0,
      totalInactive: stats.totalInactive[0]?.count || 0,
      topUsed: stats.topUsed || []
    };

    res.json({
      success: true,
      data: formattedStats
    });

  } catch (error) {
    console.error('Error fetching prompt stats:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching prompt statistics',
      error: error.message
    });
  }
});

// PATCH /api/prompts/:id/toggle-status - Toggle prompt active status (Admin only)
router.patch('/:id/toggle-status', authenticateUser, requireRole(['admin']), async (req, res) => {
  try {
    const db = getDB();
    const collection = db.collection(COLLECTION_NAME);
    
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid prompt ID'
      });
    }

    // Get current prompt
    const prompt = await collection.findOne({ _id: req.params.id });
    if (!prompt) {
      return res.status(404).json({
        success: false,
        message: 'Prompt not found'
      });
    }

    // Toggle status
    const newStatus = !prompt.isActive;
    await collection.updateOne(
      { _id: req.params.id },
      { 
        $set: { 
          isActive: newStatus,
          updatedAt: new Date()
        }
      }
    );

    res.json({
      success: true,
      message: `Prompt ${newStatus ? 'activated' : 'deactivated'} successfully`,
      isActive: newStatus
    });

  } catch (error) {
    console.error('Error toggling prompt status:', error);
    res.status(500).json({
      success: false,
      message: 'Error toggling prompt status',
      error: error.message
    });
  }
});




module.exports = router;