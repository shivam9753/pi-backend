const express = require('express');
const mongoose = require('mongoose');
const Content = require('../models/Content');
const Submission = require('../models/Submission');
// Analytics model removed — analytics DB dropped
const { validatePagination } = require('../middleware/validation');
const { mapSingleTag, filterUnmappedUuids, isUuidTag } = require('../utils/tagMapping');

const router = express.Router();

// GET /api/tags - Get all tags with pagination
router.get('/', validatePagination, async (req, res) => {
  try {
    const { 
      limit = 20, 
      skip = 0, 
      sortBy = 'count', 
      order = 'desc',
      search 
    } = req.query;

    // Aggregate counts of Tag._id values from published content, then join with tags collection
    const pipeline = [
      // Join with submissions to filter only published content
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
      // Unwind tags array
      { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
      // Keep only tags that look like UUIDs (canonical Tag._id). Exclude legacy raw strings.
      { $match: { tags: { $type: 'string' } } },
      { $addFields: { tagId: '$tags' } },
      // Group by tagId and count frequency
      {
        $group: {
          _id: '$tagId',
          count: { $sum: 1 },
          lastUsed: { $max: '$createdAt' }
        }
      },
      // Join with tags collection to get name/slug
      {
        $lookup: {
          from: 'tags',
          localField: '_id',
          foreignField: '_id',
          as: 'tagDoc'
        }
      },
      { $unwind: { path: '$tagDoc', preserveNullAndEmptyArrays: false } },
      // Optionally filter by search on tag name
      ...(search ? [{ $match: { 'tagDoc.name': { $regex: search, $options: 'i' } } }] : []),
      // Format output
      {
        $project: {
          _id: 0,
          tagId: '$_id',
          tag: '$tagDoc.name',
          slug: '$tagDoc.slug',
          count: 1,
          lastUsed: 1
        }
      }
    ];

    // Add sorting
    const sortOrder = order === 'asc' ? 1 : -1;
    let sortField;
    if (sortBy === 'alphabetical') {
      sortField = 'tag';
    } else if (sortBy === 'lastUsed') {
      sortField = 'lastUsed';
    } else {
      sortField = 'count';
    }
    pipeline.push({ $sort: { [sortField]: sortOrder } });

    // Get total count for pagination
    const totalPipeline = [...pipeline, { $count: 'total' }];
    const totalResult = await Content.aggregate(totalPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    // Add pagination
    pipeline.push({ $skip: Number.parseInt(skip) }, { $limit: Number.parseInt(limit) });

    const tagResults = await Content.aggregate(pipeline);

    res.json({
      success: true,
      tags: tagResults,
      pagination: {
        total,
        limit: Number.parseInt(limit),
        skip: Number.parseInt(skip),
        hasMore: (Number.parseInt(skip) + Number.parseInt(limit)) < total,
        currentPage: Math.floor(Number.parseInt(skip) / Number.parseInt(limit)) + 1,
        totalPages: Math.ceil(total / Number.parseInt(limit))
      }
    });

  } catch (error) {
    console.error('Error fetching tags:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching tags',
      error: error.message
    });
  }
});

// GET /api/tags/popular - Get popular tags from trending submissions
router.get('/popular', async (req, res) => {
  try {
    const { 
      limit = 15, 
      windowDays = 7 
    } = req.query;

    const limitNum = Math.min(Number.parseInt(limit) || 15, 20); // Cap at 20
    const windowDaysNum = Number.parseInt(windowDays) || 7;

    // Get trending submissions first
    const trendingSubmissions = await Submission.findTrending(50, windowDaysNum); // Get more for better tag variety

    if (trendingSubmissions.length === 0) {
      return res.json({
        success: true,
        tags: [],
        total: 0
      });
    }

    // Extract submission IDs to get their content tags
    const submissionIds = trendingSubmissions.map(sub => sub._id.toString());

    // Aggregate tag usage for these submissions and join with tags collection
    const tagAggregation = await Content.aggregate([
      { $match: { submissionId: { $in: submissionIds } } },
      { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
      { $match: { tags: { $type: 'string' } } },
      { $group: { _id: '$tags', count: { $sum: 1 }, submissions: { $addToSet: '$submissionId' } } },
      { $sort: { count: -1 } },
      { $limit: limitNum * 2 },
      { $lookup: { from: 'tags', localField: '_id', foreignField: '_id', as: 'tagDoc' } },
      { $unwind: { path: '$tagDoc', preserveNullAndEmptyArrays: false } },
      { $project: { _id: 0, tagId: '$_id', tag: '$tagDoc.name', slug: '$tagDoc.slug', count: 1, trendingScore: { $size: '$submissions' } } }
    ]);

    const mappedTags = tagAggregation.slice(0, limitNum);

    res.json({
      success: true,
      tags: mappedTags.map(t => t.tag),
      tagDetails: mappedTags,
      total: mappedTags.length,
      windowDays: windowDaysNum,
      sourceTrendingPosts: trendingSubmissions.length
    });

  } catch (error) {
    console.error('Error fetching popular tags from trending:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching popular tags',
      error: error.message
    });
  }
});

// GET /api/tags/search - Search tags by name
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Search query is required' });
    }

    const searchQuery = q.trim();
    const limitNum = Math.min(Number.parseInt(limit) || 10, 50);

    // Search Tag collection directly
    const tags = await Submission.db.collection('tags').find({ name: { $regex: searchQuery, $options: 'i' } }).limit(limitNum).toArray();

    const results = await Promise.all(tags.map(async t => {
      // Count published contents using this tag
      const countResult = await Content.countDocuments({ tags: { $in: [t._id] } });
      return { tag: t.name, slug: t.slug, tagId: t._id, count: countResult };
    }));

    res.json({ success: true, query: searchQuery, tags: results, total: results.length });

  } catch (error) {
    console.error('Error searching tags:', error);
    res.status(500).json({ success: false, message: 'Error searching tags', error: error.message });
  }
});

module.exports = router;