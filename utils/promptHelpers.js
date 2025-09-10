// utils/promptHelpers.js
const { ObjectId } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

// Collection name
const COLLECTION_NAME = 'prompts';

// Prompt validation schema
const validatePrompt = (promptData) => {
  const errors = [];
  
  if (!promptData.title || typeof promptData.title !== 'string' || promptData.title.trim().length === 0) {
    errors.push('Title is required');
  }
  
  if (promptData.title && promptData.title.length > 200) {
    errors.push('Title must be 200 characters or less');
  }
  
  if (!promptData.description || typeof promptData.description !== 'string' || promptData.description.trim().length === 0) {
    errors.push('Description is required');
  }
  
  if (promptData.description && promptData.description.length > 1000) {
    errors.push('Description must be 1000 characters or less');
  }
  
  return errors;
};

// Create prompt document
const createPromptDoc = (promptData, userId) => {
  const now = new Date();
  
  return {
    _id: uuidv4(), // Generate string UUID for _id
    title: promptData.title.trim(),
    description: promptData.description.trim(),
    tags: promptData.tags ? promptData.tags.map(tag => tag.trim().toLowerCase()) : [],
    picture: promptData.picture || null,
    isActive: promptData.isActive !== undefined ? promptData.isActive : true,
    createdBy: userId,
    usageCount: 0,
    createdAt: now,
    updatedAt: now
  };
};

// Update prompt document
const updatePromptDoc = (existingPrompt, updateData) => {
  const updatedPrompt = { ...existingPrompt };
  
  if (updateData.title !== undefined) updatedPrompt.title = updateData.title.trim();
  if (updateData.description !== undefined) updatedPrompt.description = updateData.description.trim();
  if (updateData.tags !== undefined) updatedPrompt.tags = updateData.tags.map(tag => tag.trim().toLowerCase());
  if (updateData.picture !== undefined) updatedPrompt.picture = updateData.picture;
  if (updateData.isActive !== undefined) updatedPrompt.isActive = updateData.isActive;
  
  updatedPrompt.updatedAt = new Date();
  
  return updatedPrompt;
};

// Build query for prompts
const buildPromptsQuery = (filters = {}) => {
  const query = { isActive: true };
  
  if (filters.search) {
    query.$text = { $search: filters.search };
  }
  
  return query;
};

// Build sort options
const buildSortOptions = (sortBy = 'createdAt', sortOrder = 'desc') => {
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
  return sort;
};

// Format prompt for response
const formatPromptResponse = (prompt) => {
  return {
    ...prompt,
    formattedCreatedAt: prompt.createdAt ? prompt.createdAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }) : null
  };
};

// Aggregation pipeline for popular prompts
const getPopularPromptsAggregation = (limit = 10) => {
  const pipeline = [];
  
  // Match stage
  const matchStage = { isActive: true };
  pipeline.push({ $match: matchStage });
  
  // Sort by usage count and creation date
  pipeline.push({ $sort: { usageCount: -1, createdAt: -1 } });
  
  // Limit results
  pipeline.push({ $limit: limit });
  
  // Lookup user info
  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'createdBy',
      foreignField: '_id',
      as: 'createdBy',
      pipeline: [{ $project: { name: 1, email: 1 } }]
    }
  });
  
  // Unwind createdBy array
  pipeline.push({ $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } });
  
  return pipeline;
};

// Aggregation pipeline for search with text score
const getSearchAggregation = (searchText, limit = 20) => {
  const pipeline = [];
  
  // Match stage with text search
  const matchStage = {
    isActive: true,
    $text: { $search: searchText }
  };
  pipeline.push({ $match: matchStage });
  
  // Add text score
  pipeline.push({ $addFields: { score: { $meta: 'textScore' } } });
  
  // Sort by text score
  pipeline.push({ $sort: { score: { $meta: 'textScore' } } });
  
  // Limit results
  pipeline.push({ $limit: limit });
  
  // Lookup user info
  pipeline.push({
    $lookup: {
      from: 'users',
      localField: 'createdBy',
      foreignField: '_id',
      as: 'createdBy',
      pipeline: [{ $project: { name: 1, email: 1 } }]
    }
  });
  
  // Unwind createdBy array
  pipeline.push({ $unwind: { path: '$createdBy', preserveNullAndEmptyArrays: true } });
  
  return pipeline;
};

// Aggregation pipeline for stats
const getStatsAggregation = () => {
  return [
    {
      $facet: {
        totalActive: [
          { $match: { isActive: true } },
          { $count: 'count' }
        ],
        totalInactive: [
          { $match: { isActive: false } },
          { $count: 'count' }
        ],
        topUsed: [
          { $match: { isActive: true } },
          { $sort: { usageCount: -1 } },
          { $limit: 5 },
          { $project: { title: 1, usageCount: 1 } }
        ]
      }
    }
  ];
};

// Setup text index for search
const setupTextIndex = async (db) => {
  try {
    await db.collection(COLLECTION_NAME).createIndex({
      title: 'text',
      description: 'text',
      tags: 'text'
    });
    
    // Create other useful indexes
    await db.collection(COLLECTION_NAME).createIndex({ isActive: 1 });
    await db.collection(COLLECTION_NAME).createIndex({ createdAt: -1 });
    await db.collection(COLLECTION_NAME).createIndex({ usageCount: -1 });
    
    console.log('Prompt collection indexes created successfully');
  } catch (error) {
    console.error('Error creating prompt indexes:', error);
  }
};

module.exports = {
  COLLECTION_NAME,
  validatePrompt,
  createPromptDoc,
  updatePromptDoc,
  buildPromptsQuery,
  buildSortOptions,
  formatPromptResponse,
  getPopularPromptsAggregation,
  getSearchAggregation,
  getStatsAggregation,
  setupTextIndex
};