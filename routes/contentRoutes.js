const express = require('express');
const mongoose = require('mongoose');
const Content = require('../models/Content');
const Submission = require('../models/Submission');
const { authenticateUser, requireReviewer, requireAdmin } = require('../middleware/auth');
const { validateObjectId, validatePagination } = require('../middleware/validation');
const { mapSingleTag, filterUnmappedUuids, isUuidTag } = require('../utils/tagMapping');

const router = express.Router();

// GET /api/content/popular-tags - Get most popular tags from published content (MUST BE BEFORE CATCH-ALL)
router.get('/popular-tags', validatePagination, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    // Get tags from published content (handling string/ObjectId mismatch)
    const tagAggregation = await Content.aggregate([
      // Join with submissions to filter only published content
      // Handle the string submissionId to ObjectId conversion
      {
        $lookup: {
          from: 'submissions',
          let: { submissionIdStr: '$submissionId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: [{ $toString: '$_id' }, '$$submissionIdStr'] },
                    { $eq: ['$status', 'published'] }
                  ]
                }
              }
            }
          ],
          as: 'submission'
        }
      },
      // Only include content that has published submissions
      { $match: { submission: { $ne: [] } } },
      // Unwind tags array if it exists
      { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
      // Filter out empty tags
      { $match: { tags: { $ne: '', $ne: null, $exists: true } } },
      // Group by tag and count frequency
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 }
        }
      },
      // Sort by count descending
      { $sort: { count: -1 } },
      // Limit results
      { $limit: parseInt(limit) },
      // Format output
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1
        }
      }
    ]);

    // Extract just the tag names for the response
    const tags = tagAggregation.map(item => item.tag);

    res.json({
      success: true,
      tags,
      total: tags.length
    });

  } catch (error) {
    console.error('Error fetching popular tags:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching popular tags', 
      error: error.message 
    });
  }
});

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
      search
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
    
    // Step 10: Project final shape
    pipeline.push({
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
      }
    });

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
    
    res.json(response);

  } catch (error) {
    console.error('Error fetching published content:', error);
    res.status(500).json({ message: 'Error fetching published content', error: error.message });
  }
});

// GET /api/content/id/:contentId - Get individual content by ID (REFACTORED)
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
            profileImage: '$author.profileImage'
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

    res.json(results[0]);

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
            profileImage: '$author.profileImage'
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

// GET /api/content/tags/popular - Get trending/popular tags (REFACTORED)
router.get('/tags/popular', async (req, res) => {
  try {
    // Set cache control headers to prevent caching issues
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    const { limit = 10 } = req.query;

    // Get popular tags using aggregation on published submissions
    const pipeline = [
      { $match: { status: 'published' } },
      {
        $lookup: {
          from: 'contents',
          localField: 'contentIds',
          foreignField: '_id',
          as: 'contents'
        }
      },
      { $unwind: '$contents' },
      { $unwind: '$contents.tags' },
      { $match: { 'contents.tags': { $ne: null, $ne: '' } } },
      {
        $group: {
          _id: '$contents.tags',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } },
      { $limit: parseInt(limit) * 2 }, // Get more to filter UUID tags
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1
        }
      }
    ];

    const popularTags = await Submission.aggregate(pipeline);
    
    // Filter out UUID tags and keep only readable tags
    const mappedTags = popularTags
      .map(tagInfo => ({
        ...tagInfo,
        tag: mapSingleTag(tagInfo.tag)
      }))
      .filter(tagInfo => tagInfo.tag.length > 0) // Filter out empty tags (UUIDs get filtered to empty strings)
      .slice(0, parseInt(limit));
    
    res.json({ 
      tags: mappedTags.map(t => t.tag)
    });

  } catch (error) {
    console.error('Error fetching popular tags:', error);
    res.status(500).json({ message: 'Error fetching popular tags', error: error.message });
  }
});

// POST /api/content/:contentId/view - Increment view count (REFACTORED - checks publication via submission)
router.post('/:contentId/view', validateObjectId('contentId'), async (req, res) => {
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

    const publishedContent = await Content.aggregate(pipeline);
    
    if (publishedContent.length === 0) {
      return res.status(404).json({ message: 'Published content not found' });
    }

    // Increment view count
    const updatedContent = await Content.findByIdAndUpdate(
      contentId,
      { $inc: { viewCount: 1 } },
      { new: true, select: 'viewCount' }
    );

    // Also increment submission view count for trending calculations
    await Submission.findByIdAndUpdate(
      publishedContent[0].submission._id,
      { $inc: { viewCount: 1 } }
    );

    res.json({
      success: true,
      viewCount: updatedContent.viewCount
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

// GET /api/content/by-tag/:tag - Get content by specific tag - DEPRECATED  
router.get('/by-tag/:tag', validatePagination, async (req, res) => {
  try {
    console.warn('DEPRECATED: /api/content/by-tag/:tag endpoint used. Please use /api/content?tag=');
    
    // Forward to main endpoint with tag parameter
    req.query.tag = req.params.tag;
    req.query.published = 'true';
    
    // Use the refactored main handler
    return router.handle(req, res);
    
  } catch (error) {
    console.error('Error in deprecated by-tag endpoint:', error);
    res.status(500).json({ message: 'Error fetching content by tag', error: error.message });
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