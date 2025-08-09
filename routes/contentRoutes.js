const express = require('express');
const Content = require('../models/Content');
const Submission = require('../models/Submission');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
const { validateObjectId, validatePagination } = require('../middleware/validation');

const router = express.Router();

// GET /api/content/published - Get published content pieces
router.get('/published', validatePagination, async (req, res) => {
  try {
    const { 
      type, 
      limit = 20, 
      skip = 0, 
      sortBy = 'publishedAt', 
      order = 'desc',
      tags
    } = req.query;

    // Build query
    let query = { isPublished: true };
    
    if (type) query.type = type;
    if (tags) {
      const tagArray = Array.isArray(tags) ? tags : tags.split(',');
      query.tags = { $in: tagArray.map(tag => tag.trim().toLowerCase()) };
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

// GET /api/content/by-tag/:tag - Get content by specific tag
router.get('/by-tag/:tag', validatePagination, async (req, res) => {
  try {
    const { tag } = req.params;
    const { 
      type, 
      limit = 20, 
      skip = 0, 
      sortBy = 'publishedAt', 
      order = 'desc' 
    } = req.query;

    // Build query
    let query = { 
      isPublished: true,
      tags: tag.toLowerCase()
    };
    
    if (type) query.type = type;

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

    res.json({
      tag: tag,
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
    console.error('Error fetching content by tag:', error);
    res.status(500).json({ message: 'Error fetching content by tag', error: error.message });
  }
});

// GET /api/content/by-author/:userId - Get published content by author
router.get('/by-author/:userId', validateObjectId('userId'), validatePagination, async (req, res) => {
  try {
    const { userId } = req.params;
    const { 
      type, 
      limit = 20, 
      skip = 0, 
      sortBy = 'publishedAt', 
      order = 'desc' 
    } = req.query;

    // Build query
    let query = { 
      isPublished: true,
      userId: userId
    };
    
    if (type) query.type = type;

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

    // Get author info
    const author = contents.length > 0 ? contents[0].userId : null;

    // Transform for frontend
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
      author: author ? {
        _id: author._id,
        username: author.username,
        name: author.name,
        profileImage: author.profileImage
      } : null,
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

    // Transform for frontend
    const transformedContent = {
      _id: content._id,
      title: content.title,
      body: content.body,
      type: content.type,
      tags: content.tags,
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

module.exports = router;