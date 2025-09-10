const express = require('express');
const mongoose = require('mongoose');
const Content = require('../models/Content');
const Submission = require('../models/Submission');
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

    // Build aggregation pipeline for all tags from published content
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
      // Filter out empty tags and apply search if provided
      {
        $match: {
          tags: { 
            $ne: '', 
            $ne: null, 
            $exists: true,
            ...(search && { $regex: search, $options: 'i' })
          }
        }
      },
      // Group by tag and count frequency
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          // Get latest usage date
          lastUsed: { $max: '$createdAt' }
        }
      },
      // Format output
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1,
          lastUsed: 1
        }
      }
    ];

    // Add sorting
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortField = sortBy === 'alphabetical' ? 'tag' : sortBy === 'lastUsed' ? 'lastUsed' : 'count';
    pipeline.push({ $sort: { [sortField]: sortOrder } });

    // Get total count for pagination
    const totalPipeline = [...pipeline, { $count: 'total' }];
    const totalResult = await Content.aggregate(totalPipeline);
    const total = totalResult.length > 0 ? totalResult[0].total : 0;

    // Add pagination
    pipeline.push({ $skip: parseInt(skip) });
    pipeline.push({ $limit: parseInt(limit) });

    const tagResults = await Content.aggregate(pipeline);

    // Filter out UUID tags and map to readable names
    const mappedTags = tagResults
      .map(tagInfo => ({
        ...tagInfo,
        tag: mapSingleTag(tagInfo.tag),
        originalTag: tagInfo.tag
      }))
      .filter(tagInfo => tagInfo.tag.length > 0); // Filter out empty tags (UUIDs)

    res.json({
      success: true,
      tags: mappedTags,
      pagination: {
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total,
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
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

    const limitNum = Math.min(parseInt(limit) || 15, 20); // Cap at 20
    const windowDaysNum = parseInt(windowDays) || 7;

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

    // Get tags from content associated with trending submissions
    const tagAggregation = await Content.aggregate([
      // Match content from trending submissions
      {
        $match: {
          submissionId: { $in: submissionIds }
        }
      },
      // Unwind tags array
      { $unwind: { path: '$tags', preserveNullAndEmptyArrays: false } },
      // Filter out empty tags
      { $match: { tags: { $ne: '', $ne: null, $exists: true } } },
      // Group by tag and count frequency in trending posts
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 },
          // Track which submissions used this tag
          submissions: { $addToSet: '$submissionId' }
        }
      },
      // Sort by count descending
      { $sort: { count: -1 } },
      // Get more than needed for filtering
      { $limit: limitNum * 2 },
      // Format output
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1,
          trendingScore: { $size: '$submissions' } // How many trending posts use this tag
        }
      }
    ]);

    // Filter out UUID tags and map to readable names
    const mappedTags = tagAggregation
      .map(tagInfo => ({
        ...tagInfo,
        tag: mapSingleTag(tagInfo.tag),
        originalTag: tagInfo.tag
      }))
      .filter(tagInfo => tagInfo.tag.length > 0) // Filter out empty tags (UUIDs)
      .slice(0, limitNum); // Apply final limit

    res.json({
      success: true,
      tags: mappedTags.map(t => t.tag), // Return just tag names for backward compatibility
      tagDetails: mappedTags, // Full details if needed
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

// GET /api/tags/trending - Alias for popular (for semantic clarity)
router.get('/trending', (req, res) => {
  // Forward to popular endpoint
  req.url = req.url.replace('/trending', '/popular');
  router.handle(req, res);
});

// GET /api/tags/search - Search tags by name
router.get('/search', async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Search query is required'
      });
    }

    const searchQuery = q.trim();
    const limitNum = Math.min(parseInt(limit) || 10, 50);

    // Search tags using aggregation
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
      // Search filter
      {
        $match: {
          tags: { 
            $regex: searchQuery, 
            $options: 'i',
            $ne: '', 
            $ne: null, 
            $exists: true 
          }
        }
      },
      // Group by tag and count
      {
        $group: {
          _id: '$tags',
          count: { $sum: 1 }
        }
      },
      // Sort by count descending
      { $sort: { count: -1 } },
      // Limit results
      { $limit: limitNum },
      // Format output
      {
        $project: {
          _id: 0,
          tag: '$_id',
          count: 1
        }
      }
    ];

    const searchResults = await Content.aggregate(pipeline);

    // Filter out UUID tags and map to readable names
    const mappedResults = searchResults
      .map(tagInfo => ({
        ...tagInfo,
        tag: mapSingleTag(tagInfo.tag),
        originalTag: tagInfo.tag
      }))
      .filter(tagInfo => tagInfo.tag.length > 0 && 
        tagInfo.tag.toLowerCase().includes(searchQuery.toLowerCase())); // Double-check search after mapping

    res.json({
      success: true,
      query: searchQuery,
      tags: mappedResults,
      total: mappedResults.length
    });

  } catch (error) {
    console.error('Error searching tags:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching tags',
      error: error.message
    });
  }
});

module.exports = router;