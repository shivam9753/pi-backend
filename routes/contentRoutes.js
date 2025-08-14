const express = require('express');
const Content = require('../models/Content');
const Submission = require('../models/Submission');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
const { validateObjectId, validatePagination } = require('../middleware/validation');

const router = express.Router();

// GET /api/content - Consolidated content discovery endpoint
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
      userId
    } = req.query;

    // Build query
    let query = {};
    
    // Published filter (defaults to true for backward compatibility)
    if (published === 'false') {
      query.isPublished = false;
    } else {
      query.isPublished = true;
    }
    
    // Type filter
    if (type) query.type = type;
    
    // Tags filter (multiple tags)
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      query.tags = { $in: tagArray.map(t => t.trim().toLowerCase()) };
    }
    
    // Single tag filter
    if (tag) {
      query.tags = tag.toLowerCase();
    }
    
    // Author filter
    if (author || userId) {
      query.userId = author || userId;
    }

    const sortOrder = order === 'asc' ? 1 : -1;
    const sortField = sortBy === 'publishedAt' ? 'publishedAt' : 'createdAt';

    const contents = await Content.find(query)
      .populate('userId', 'username name profileImage')
      .populate('submissionId', 'title submissionType seo')
      .sort({ [sortField]: sortOrder })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Content.countDocuments(query);

    // Transform for frontend
    const transformedContents = contents.map(content => ({
      _id: content._id,
      title: content.title,
      body: content.body,
      type: content.type,
      tags: content.tags,
      publishedAt: content.publishedAt,
      slug: content.seo?.slug,
      author: {
        _id: content.userId._id,
        username: content.userId.username,
        name: content.userId.name,
        profileImage: content.userId.profileImage
      },
      submission: {
        _id: content.submissionId._id,
        title: content.submissionId.title,
        type: content.submissionId.submissionType,
        slug: content.submissionId.seo?.slug
      }
    }));

    const response = {
      contents: transformedContents,
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
      response.author = transformedContents.length > 0 ? transformedContents[0].author : null;
    }
    
    res.json(response);

  } catch (error) {
    console.error('Error fetching published content:', error);
    res.status(500).json({ message: 'Error fetching published content', error: error.message });
  }
});

// LEGACY: GET /api/content/published - Get published content pieces - DEPRECATED
router.get('/published', validatePagination, async (req, res) => {
  try {
    // Forward to consolidated endpoint with published=true
    const consolidatedQuery = { ...req.query, published: 'true' };
    req.query = consolidatedQuery;
    
    // Call the main content handler logic
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
      userId
    } = req.query;

    let query = { isPublished: true };
    if (type) query.type = type;
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      query.tags = { $in: tagArray.map(t => t.trim().toLowerCase()) };
    }

    const sortOrder = order === 'asc' ? 1 : -1;
    const sortField = sortBy === 'publishedAt' ? 'publishedAt' : 'createdAt';

    const contents = await Content.find(query)
      .populate('userId', 'username name profileImage')
      .populate('submissionId', 'title submissionType seo')
      .sort({ [sortField]: sortOrder })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();

    const total = await Content.countDocuments(query);

    const transformedContents = contents.map(content => ({
      _id: content._id,
      title: content.title,
      body: content.body,
      type: content.type,
      tags: content.tags,
      publishedAt: content.publishedAt,
      slug: content.seo?.slug,
      author: {
        _id: content.userId._id,
        username: content.userId.username,
        name: content.userId.name,
        profileImage: content.userId.profileImage
      },
      submission: {
        _id: content.submissionId._id,
        title: content.submissionId.title,
        type: content.submissionId.submissionType,
        slug: content.submissionId.seo?.slug
      }
    }));

    res.json({
      contents: transformedContents,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total,
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching published content:', error);
    res.status(500).json({ message: 'Error fetching published content', error: error.message });
  }
});

// LEGACY: GET /api/content/by-tag/:tag - Get content by specific tag - DEPRECATED  
router.get('/by-tag/:tag', validatePagination, async (req, res) => {
  try {
    const { tag } = req.params;
    const query = { isPublished: true, tags: tag.toLowerCase() };
    
    if (req.query.type) query.type = req.query.type;
    
    const contents = await Content.find(query)
      .populate('userId', 'username name profileImage')
      .populate('submissionId', 'title submissionType seo')
      .sort({ publishedAt: -1 })
      .limit(parseInt(req.query.limit) || 20)
      .skip(parseInt(req.query.skip) || 0)
      .lean();

    const total = await Content.countDocuments(query);

    const transformedContents = contents.map(content => ({
      _id: content._id,
      title: content.title,
      body: content.body,
      type: content.type,
      tags: content.tags,
      publishedAt: content.publishedAt,
      slug: content.seo?.slug,
      author: {
        _id: content.userId._id,
        username: content.userId.username,
        name: content.userId.name,
        profileImage: content.userId.profileImage
      },
      submission: {
        _id: content.submissionId._id,
        title: content.submissionId.title,
        type: content.submissionId.submissionType,
        slug: content.submissionId.seo?.slug
      }
    }));

    res.json({
      tag,
      contents: transformedContents,
      total,
      pagination: {
        limit: parseInt(req.query.limit) || 20,
        skip: parseInt(req.query.skip) || 0,
        hasMore: (parseInt(req.query.skip) || 0) + transformedContents.length < total
      }
    });
  } catch (error) {
    console.error('Error fetching content by tag:', error);
    res.status(500).json({ message: 'Error fetching content by tag', error: error.message });
  }
});

// LEGACY: GET /api/content/by-author/:userId - Get published content by author - DEPRECATED
router.get('/by-author/:userId', validateObjectId('userId'), validatePagination, async (req, res) => {
  try {
    const { userId } = req.params;
    const query = { isPublished: true, userId };
    
    if (req.query.type) query.type = req.query.type;

    const contents = await Content.find(query)
      .populate('userId', 'username name profileImage')
      .populate('submissionId', 'title submissionType seo')
      .sort({ publishedAt: -1 })
      .limit(parseInt(req.query.limit) || 20)
      .skip(parseInt(req.query.skip) || 0)
      .lean();

    const total = await Content.countDocuments(query);
    const author = contents.length > 0 ? contents[0].userId : null;

    const transformedContents = contents.map(content => ({
      _id: content._id,
      title: content.title,
      body: content.body,
      type: content.type,
      tags: content.tags,
      publishedAt: content.publishedAt,
      slug: content.seo?.slug,
      submission: {
        _id: content.submissionId._id,
        title: content.submissionId.title,
        type: content.submissionId.submissionType,
        slug: content.submissionId.seo?.slug
      }
    }));

    res.json({
      author,
      contents: transformedContents,
      total,
      pagination: {
        limit: parseInt(req.query.limit) || 20,
        skip: parseInt(req.query.skip) || 0,
        hasMore: (parseInt(req.query.skip) || 0) + transformedContents.length < total
      }
    });
  } catch (error) {
    console.error('Error fetching content by author:', error);
    res.status(500).json({ message: 'Error fetching content by author', error: error.message });
  }
});

// GET /api/content/:slug - Get individual content by slug  
router.get('/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const content = await Content.findOne({ 
      'seo.slug': slug,
      isPublished: true 
    })
      .populate('userId', 'username name profileImage')
      .populate('submissionId', 'title submissionType seo');

    if (!content) {
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

    // Transform for frontend
    const transformedContent = {
      _id: content._id,
      title: content.title,
      body: content.body,
      type: content.type,
      tags: convertTagsToNames(content.tags),
      publishedAt: content.publishedAt,
      createdAt: content.createdAt,
      seo: content.seo,
      author: {
        _id: content.userId._id,
        username: content.userId.username,
        name: content.userId.name,
        profileImage: content.userId.profileImage
      },
      submission: {
        _id: content.submissionId._id,
        title: content.submissionId.title,
        type: content.submissionId.submissionType,
        slug: content.submissionId.seo?.slug
      }
    };

    res.json({ content: transformedContent });

  } catch (error) {
    console.error('Error fetching content by slug:', error);
    res.status(500).json({ message: 'Error fetching content', error: error.message });
  }
});

// GET /api/content/tags/popular - Get trending/popular tags
router.get('/tags/popular', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    const popularTags = await Content.aggregate([
      { $match: { isPublished: true } },
      { $unwind: '$tags' },
      { 
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          latestPublished: { $max: '$publishedAt' }
        }
      },
      { $sort: { count: -1, latestPublished: -1 } },
      { $limit: parseInt(limit) },
      {
        $project: {
          tag: '$_id',
          count: 1,
          latestPublished: 1,
          _id: 0
        }
      }
    ]);

    res.json({ 
      tags: popularTags.map(t => t.tag),
      details: popularTags
    });

  } catch (error) {
    console.error('Error fetching popular tags:', error);
    res.status(500).json({ message: 'Error fetching popular tags', error: error.message });
  }
});

// Admin/Reviewer routes for content publishing

// POST /api/content/:contentId/publish - Publish individual content (Admin/Reviewer only)
router.post('/:contentId/publish', authenticateUser, requireReviewer, validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;
    const { seo = {} } = req.body;

    // Get content with submission
    const content = await Content.findById(contentId).populate('submissionId');
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    // Check if parent submission is accepted
    if (content.submissionId.status !== 'accepted') {
      return res.status(400).json({ 
        message: 'Can only publish content from accepted submissions' 
      });
    }

    // Generate slug if not provided
    let slug = seo.slug;
    if (!slug) {
      slug = content.title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60);
    }

    // Ensure slug is unique
    let uniqueSlug = slug;
    let counter = 1;
    while (await Content.findOne({ 'seo.slug': uniqueSlug })) {
      uniqueSlug = `${slug}-${counter}`;
      counter++;
    }

    // Update content with publishing data
    content.isPublished = true;
    content.publishedAt = new Date();
    content.seo = {
      slug: uniqueSlug,
      metaTitle: seo.metaTitle || content.title,
      metaDescription: seo.metaDescription || content.body.substring(0, 160)
    };

    await content.save();

    res.json({
      success: true,
      message: 'Content published successfully',
      content: {
        _id: content._id,
        title: content.title,
        isPublished: content.isPublished,
        publishedAt: content.publishedAt,
        slug: content.seo.slug
      }
    });

  } catch (error) {
    console.error('Error publishing content:', error);
    res.status(500).json({ message: 'Error publishing content', error: error.message });
  }
});

// POST /api/content/:contentId/unpublish - Unpublish individual content (Admin only)
router.post('/:contentId/unpublish', authenticateUser, requireAdmin, validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;

    const content = await Content.findById(contentId);
    if (!content) {
      return res.status(404).json({ message: 'Content not found' });
    }

    if (!content.isPublished) {
      return res.status(400).json({ message: 'Content is not published' });
    }

    // Unpublish content
    content.isPublished = false;
    content.publishedAt = null;
    await content.save();

    res.json({
      success: true,
      message: 'Content unpublished successfully',
      content: {
        _id: content._id,
        title: content.title,
        isPublished: content.isPublished
      }
    });

  } catch (error) {
    console.error('Error unpublishing content:', error);
    res.status(500).json({ message: 'Error unpublishing content', error: error.message });
  }
});

// POST /api/content/:contentId/view - Increment view count (no auth required)
router.post('/:contentId/view', validateObjectId('contentId'), async (req, res) => {
  try {
    const { contentId } = req.params;

    const content = await Content.findOneAndUpdate(
      { _id: contentId, isPublished: true },
      { $inc: { viewCount: 1 } },
      { new: true, select: 'viewCount' }
    );

    if (!content) {
      return res.status(404).json({ message: 'Published content not found' });
    }

    res.json({
      success: true,
      viewCount: content.viewCount
    });

  } catch (error) {
    console.error('Error incrementing view count:', error);
    res.status(500).json({ message: 'Error updating view count', error: error.message });
  }
});

module.exports = router;
