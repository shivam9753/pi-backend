const express = require('express');
const mongoose = require('mongoose');
const Content = require('../models/Content');
const Submission = require('../models/Submission');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
const { validateObjectId, validatePagination } = require('../middleware/validation');
const { mapSingleTag, filterUnmappedUuids, isUuidTag } = require('../utils/tagMapping');

const router = express.Router();


// GET /api/content - Consolidated content discovery endpoint (REFACTORED for new schema)
router.get('/', validatePagination, async (req, res) => {
  try {
    const {
      published,
      type,
      limit = 20,
      skip = 0,
      sortBy = 'publishedAt',
      order = 'desc',
      tags,
      tag,
      author,
      userId,
      search,
      fields
    } = req.query;

    // Build aggregation pipeline
    const pipeline = [];
    
    // Step 1: Match content documents
    const contentMatch = {};
    
    // Tags filter (multiple tags)
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      contentMatch.tags = { $in: tagArray.map(t => t.trim().toLowerCase()) };
    }
    
    // Single tag filter
    if (tag) {
      contentMatch.tags = tag.toLowerCase();
    }
    
    if (Object.keys(contentMatch).length > 0) {
      pipeline.push({ $match: contentMatch });
    }
    
    // Step 2: Join with submissions to get publication status and user info
    pipeline.push({
      $lookup: {
        from: 'submissions',
        localField: 'submissionId',
        foreignField: '_id',
        as: 'submission'
      }
    });
    
    pipeline.push({ $unwind: '$submission' });
    
    // Step 3: Filter based on new schema rules
    const submissionMatch = {};
    
    // Published filter (defaults to true for backward compatibility)
    if (published === 'false') {
      submissionMatch['submission.status'] = { $ne: 'published' };
    } else {
      submissionMatch['submission.status'] = 'published';
    }
    
    // Type filter (from submission, not content)
    if (type) {
      submissionMatch['submission.submissionType'] = type;
    }
    
    // Author filter (from submission, not content)
    if (author || userId) {
      submissionMatch['submission.userId'] = author || userId;
    }
    
    pipeline.push({ $match: submissionMatch });
    
    // Step 4: Join with users for author info
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'submission.userId',
        foreignField: '_id',
        as: 'author'
      }
    });
    
    pipeline.push({ $unwind: '$author' });
    
    // Step 5: Featured filter (content-level)
    if (req.query.featured === 'true') {
      pipeline.push({ $match: { isFeatured: true } });
    } else if (req.query.featured === 'false') {
      pipeline.push({ $match: { isFeatured: false } });
    }
    
    // Step 6: Search filter (title and author name)
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      pipeline.push({
        $match: {
          $or: [
            { title: searchRegex },
            { 'author.name': searchRegex },
            { 'author.username': searchRegex },
            { 'submission.title': searchRegex }
          ]
        }
      });
    }
    
    // Step 7: Add derived fields for sorting
    pipeline.push({
      $addFields: {
        publishedAt: '$submission.publishedAt',
        submissionType: '$submission.submissionType'
      }
    });
    
    // Step 8: Sort
    const sortOrder = order === 'asc' ? 1 : -1;
    let sortField;
    if (sortBy === 'publishedAt') {
      sortField = 'publishedAt';
    } else if (sortBy === 'featuredAt') {
      sortField = 'featuredAt';
    } else {
      sortField = 'createdAt';
    }
    pipeline.push({ $sort: { [sortField]: sortOrder } });
    
    // Step 9: Paginate
    pipeline.push({ $skip: parseInt(skip) });
    pipeline.push({ $limit: parseInt(limit) });
    
    // Step 10: Project final shape - support field selection
    let projection = {};

    if (fields && fields.trim()) {
      // Parse fields parameter (comma-separated)
      const fieldList = fields.split(',').map(f => f.trim()).filter(f => f);

      // Always include _id for consistency
      projection._id = 1;

      // Map requested fields to projection
      fieldList.forEach(field => {
        switch (field) {
          case 'title':
            projection.title = 1;
            break;
          case 'body':
            projection.body = 1;
            break;
          case 'tags':
            projection.tags = 1;
            break;
          case 'footnotes':
            projection.footnotes = 1;
            break;
          case 'isFeatured':
            projection.isFeatured = 1;
            break;
          case 'featuredAt':
            projection.featuredAt = 1;
            break;
          case 'viewCount':
            projection.viewCount = 1;
            break;
          case 'createdAt':
            projection.createdAt = 1;
            break;
          case 'publishedAt':
            projection.publishedAt = 1;
            break;
          case 'submissionType':
            projection.submissionType = 1;
            break;
          case 'seo':
            projection.seo = 1;
            break;
          case 'author':
            projection.author = {
              _id: '$author._id',
              id: '$author._id',
              username: '$author.username',
              name: '$author.name',
              profileImage: '$author.profileImage'
            };
            break;
          case 'submission':
            projection.submission = {
              _id: '$submission._id',
              title: '$submission.title',
              type: '$submission.submissionType',
              slug: '$submission.seo.slug'
            };
            break;
        }
      });
    } else {
      // Default projection - return all fields
      projection = {
        _id: 1,
        title: 1,
        body: 1,
        tags: 1,
        footnotes: 1,
        isFeatured: 1,
        featuredAt: 1,
        viewCount: 1,
        createdAt: 1,
        publishedAt: 1,
        submissionType: 1,
        seo: 1,  // Include full SEO object
        author: {
          _id: '$author._id',
          id: '$author._id',
          username: '$author.username',
          name: '$author.name',
          profileImage: '$author.profileImage'
        },
        submission: {
          _id: '$submission._id',
          title: '$submission.title',
          type: '$submission.submissionType',
          slug: '$submission.seo.slug'
        }
      };
    }

    pipeline.push({ $project: projection });

    const contents = await Content.aggregate(pipeline);
    
    // Get total count for pagination
    const countPipeline = pipeline.slice(0, -3); // Remove skip, limit, project
    countPipeline.push({ $count: 'total' });
    const totalResult = await Content.aggregate(countPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    const response = {
      contents,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total,
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };

    // Add metadata based on query parameters
    if (tag) response.tag = tag;
    if (author || userId) {
      response.author = contents.length > 0 ? contents[0].author : null;
    }
    
    // Log search query analytics (non-blocking)
    if (search && search.trim()) {
      // Analytics logging removed (analytics DB dropped)
    }
    
    res.json(response);

  } catch (error) {
    console.error('Error fetching published content:', error);
    res.status(500).json({ message: 'Error fetching published content', error: error.message });
  }
});

// GET /api/content/id/:contentId - Get individual content by ID with author's featured content (REFACTORED)
router.get('/id/:contentId', validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;

    const pipeline = [
      { $match: { _id: contentId } },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission'
        }
      },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } },
      {
        $lookup: {
          from: 'users',
          localField: 'submission.userId',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: '$author' },
      {
        $project: {
          _id: 1,
          title: 1,
          body: 1,
          tags: 1,
          footnotes: 1,
          isFeatured: 1,
          featuredAt: 1,
          viewCount: 1,
          createdAt: 1,
          publishedAt: '$submission.publishedAt',
          submissionType: '$submission.submissionType',
          seo: 1,
          author: {
            _id: '$author._id',
            id: '$author._id',
            username: '$author.username',
            name: '$author.name',
            profileImage: '$author.profileImage',
            bio: '$author.bio'
          },
          submission: {
            _id: '$submission._id',
            title: '$submission.title',
            type: '$submission.submissionType',
            slug: '$submission.seo.slug'
          }
        }
      }
    ];

    const results = await Content.aggregate(pipeline);
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Published content not found' });
    }

    const content = results[0];

    // Get author's other featured content (limit to 5, excluding current content)
    const authorFeaturedPipeline = [
      { 
        $match: { 
          _id: { $ne: contentId },  // Exclude current content
          isFeatured: true 
        } 
      },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission'
        }
      },
      { $unwind: '$submission' },
      { 
        $match: { 
          'submission.status': 'published',
          'submission.userId': content.author._id  // Same author
        } 
      },
      { $sort: { featuredAt: -1 } },  // Most recently featured first
      { $limit: 5 },
      {
        $project: {
          _id: 1,
          title: 1,
          viewCount: 1,
          featuredAt: 1,
          submissionType: '$submission.submissionType',
          slug: '$submission.seo.slug'
        }
      }
    ];

    const authorFeaturedContent = await Content.aggregate(authorFeaturedPipeline);

    // Add featured content to response
    content.authorFeaturedContent = authorFeaturedContent;

    res.json(content);

  } catch (error) {
    console.error('Error fetching content by ID:', error);
    res.status(500).json({ message: 'Error fetching content', error: error.message });
  }
});

// GET /api/content/:slug - Get individual content by slug (REFACTORED)
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const pipeline = [
      { $match: { 'seo.slug': slug } },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission'
        }
      },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } },
      {
        $lookup: {
          from: 'users',
          localField: 'submission.userId',
          foreignField: '_id',
          as: 'author'
        }
      },
      { $unwind: '$author' },
      {
        $project: {
          _id: 1,
          title: 1,
          body: 1,
          tags: 1,
          footnotes: 1,
          isFeatured: 1,
          featuredAt: 1,
          viewCount: 1,
          createdAt: 1,
          publishedAt: '$submission.publishedAt',
          submissionType: '$submission.submissionType',
          seo: 1,
          author: {
            _id: '$author._id',
            id: '$author._id',
            username: '$author.username',
            name: '$author.name',
            profileImage: '$author.profileImage',
            bio: '$author.bio'
          },
          submission: {
            _id: '$submission._id',
            title: '$submission.title',
            type: '$submission.submissionType',
            slug: '$submission.seo.slug'
          }
        }
      }
    ];

    const results = await Content.aggregate(pipeline);
    
    if (results.length === 0) {
      return res.status(404).json({ message: 'Published content not found' });
    }

    // Helper function to convert UUID tags to readable names
    const convertTagsToNames = (tags) => {
      if (!Array.isArray(tags)) return [];
      
      // Map UUID tags to readable names
      const tagMapping = {
        'bc1f1725-d6f4-4686-8094-11c8bd39183f': 'psychology',
        '325213e4-4607-42b2-9d5d-fd99e8228552': 'philosophy',
        // Add more mappings as needed
      };
      
      return tags.map(tag => {
        // Check if tag is a UUID format and exists in mapping
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(tag) && tagMapping[tag]) {
          return tagMapping[tag];
        }
        // Return original tag if not a UUID or no mapping found
        return tag;
      });
    };

    const content = results[0];
    content.tags = convertTagsToNames(content.tags);

    res.json({ content });

  } catch (error) {
    console.error('Error fetching content by slug:', error);
    res.status(500).json({ message: 'Error fetching content', error: error.message });
  }
});


// POST /api/content/:contentId/view - Increment view count (simple approach like submissions)
router.post('/:contentId/view', validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;
    const { windowDays = 7 } = req.body;

    // Check if content is published via submission status
    const pipeline = [
      { $match: { _id: contentId } },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission'
        }
      },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } }
    ];

    const publishedContent = await Content.aggregate(pipeline);

    if (publishedContent.length === 0) {
      return res.status(404).json({ message: 'Published content not found' });
    }

    // Use the rolling window method (same as submissions)
    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    await content.logView(windowDays);

    // Also log view on the parent submission using the rolling window method
    const Submission = require('../models/Submission');
    try {
      const submission = await Submission.findById(publishedContent[0].submission._id);
      if (submission) {
        await submission.logView(windowDays);
      }
    } catch (submissionError) {
      console.warn('Error logging submission view:', submissionError);
      // Don't fail if submission view update fails
    }

    res.json({
      success: true,
      viewCount: content.viewCount,
      recentViews: content.recentViews,
      windowStartTime: content.windowStartTime.toISOString(),
      trendingScore: content.getTrendingScore()
    });

  } catch (error) {
    console.error('Error incrementing view count:', error);
    res.status(500).json({ message: 'Error updating view count', error: error.message });
  }
});

// POST /api/content/:contentId/feature - Mark content as featured (REFACTORED)
router.post('/:contentId/feature', authenticateUser, requireReviewer, validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;

    // Check if content is published via submission status
    const pipeline = [
      { $match: { _id: contentId } },
      {
        $lookup: {
          from: 'submissions',
          localField: 'submissionId',
          foreignField: '_id',
          as: 'submission'
        }
      },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } }
    ];

    const results = await Content.aggregate(pipeline);
    
    if (results.length === 0) {
      return res.status(404).json({ 
        message: 'Content not found or not published' 
      });
    }

    const content = await Content.findById(contentId);

    // Check if already featured
    if (content.isFeatured) {
      return res.status(400).json({ message: 'Content is already featured' });
    }

    // Mark as featured
    content.isFeatured = true;
    content.featuredAt = new Date();
    await content.save();

    // Find the submission to get the author's user ID
    const Submission = require('../models/Submission');
    const UserService = require('../services/userService');

    try {
      const submission = await Submission.findById(content.submissionId);
      if (submission && submission.userId) {
        // Automatically mark the author as featured
        await UserService.markUserAsFeaturedByContent(submission.userId);
      }
    } catch (userError) {
      // Log error but don't fail the content featuring
      console.error('Error marking author as featured:', userError);
    }

    res.json({
      success: true,
      message: 'Content marked as featured successfully',
      content: {
        _id: content._id,
        title: content.title,
        isFeatured: content.isFeatured,
        featuredAt: content.featuredAt
      }
    });

  } catch (error) {
    console.error('Error featuring content:', error);
    res.status(500).json({ message: 'Error featuring content', error: error.message });
  }
});

// POST /api/content/:contentId/unfeature - Remove featured status (Admin/Reviewer only)
router.post('/:contentId/unfeature', authenticateUser, requireReviewer, validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;

    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    if (!content.isFeatured) {
      return res.status(400).json({ message: 'Content is not featured' });
    }

    // Remove featured status
    content.isFeatured = false;
    content.featuredAt = null;
    await content.save();

    res.json({
      success: true,
      message: 'Featured status removed successfully',
      content: {
        _id: content._id,
        title: content.title,
        isFeatured: content.isFeatured
      }
    });

  } catch (error) {
    console.error('Error unfeaturing content:', error);
    res.status(500).json({ message: 'Error unfeaturing content', error: error.message });
  }
});

// LEGACY ENDPOINTS - These should be deprecated after migration

// GET /api/content/published - Get published content pieces - DEPRECATED
router.get('/published', validatePagination, async (req, res) => {
  try {
    console.warn('DEPRECATED: /api/content/published endpoint used. Please use /api/content with published=true');
    
    // Forward to main endpoint with published=true
    req.query.published = 'true';
    
    // Use the refactored main handler
    return router.handle(req, res);
    
  } catch (error) {
    console.error('Error in deprecated published endpoint:', error);
    res.status(500).json({ message: 'Error fetching published content', error: error.message });
  }
});


// GET /api/content/by-author/:userId - Get published content by author - DEPRECATED
router.get('/by-author/:userId', validateObjectId('userId'), validatePagination, async (req, res) => {
  try {
    console.warn('DEPRECATED: /api/content/by-author/:userId endpoint used. Please use /api/content?author=');
    
    // Forward to main endpoint with author parameter
    req.query.author = req.params.userId;
    req.query.published = 'true';
    
    // Use the refactored main handler
    return router.handle(req, res);
    
  } catch (error) {
    console.error('Error in deprecated by-author endpoint:', error);
    res.status(500).json({ message: 'Error fetching content by author', error: error.message });
  }
});

module.exports = router;