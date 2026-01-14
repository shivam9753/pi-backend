const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateUser, requireRole } = require('../middleware/auth');
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const User = require('../models/User');
const Review = require('../models/Review');

// Middleware: All analytics endpoints require admin/reviewer role
router.use(authenticateUser);
router.use(requireRole(['admin', 'reviewer']));

// GET /analytics/top-content
// Top performing and trending content
// Supports query params: period=week|month|all (default: month), limit, type
router.get('/top-content', async (req, res) => {
  try {
    const { period = 'month', limit = 10, type, metric = 'recent' } = req.query;
    const limitNum = parseInt(limit) || 10;

    // Calculate date range based on period
    let startDate = null;
    const now = new Date();

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startDate = null;
        break;
    }

    // Build match filter (published only)
    const matchFilter = { status: 'published' };
    if (startDate) {
      matchFilter.$or = [
        { publishedAt: { $gte: startDate } },
        { reviewedAt: { $gte: startDate } },
        { createdAt: { $gte: startDate } }
      ];
    }

    if (type && type.toString().trim() !== '') {
      matchFilter.submissionType = type;
    }

    // Prepare two queries: top by total views and top by recent activity
    const topByViewsPipeline = [
      { $match: matchFilter },
      { $addFields: { viewCount: { $ifNull: ['$viewCount', 0] } } },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'author' } },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, title: 1, submissionType: 1, viewCount: 1, publishedAt: 1, 'seo.slug': 1, author: { name: '$author.name', username: '$author.username', _id: '$author._id' } } },
      { $sort: { viewCount: -1 } },
      { $limit: limitNum }
    ];

    const topByRecentPipeline = [
      { $match: { ...matchFilter, $or: [{ recentViews: { $gt: 0 } }, { viewCount: { $gte: 0 } }] } },
      { $addFields: { recentViews: { $ifNull: ['$recentViews', 0] }, viewCount: { $ifNull: ['$viewCount', 0] } } },
      { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'author' } },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      { $project: { _id: 1, title: 1, submissionType: 1, recentViews: 1, viewCount: 1, publishedAt: 1, 'seo.slug': 1, author: { name: '$author.name', username: '$author.username', _id: '$author._id' } } },
      { $sort: { recentViews: -1, viewCount: -1 } },
      { $limit: limitNum }
    ];

    const [topByViews, topByRecent] = await Promise.all([
      Submission.aggregate(topByViewsPipeline),
      Submission.aggregate(topByRecentPipeline)
    ]);

    let finalTop = [];
    if (metric === 'views' || period === 'all') {
      finalTop = topByViews;
    } else {
      finalTop = (topByRecent && topByRecent.length > 0) ? topByRecent : topByViews;
    }

    const typePipeline = [
      { $match: matchFilter },
      { $group: { _id: '$submissionType', count: { $sum: 1 }, views: { $sum: { $ifNull: ['$viewCount', 0] } } } },
      { $project: { type: '$_id', posts: '$count', views: '$views', _id: 0 } },
      { $sort: { views: -1 } }
    ];

    const typeBreakdown = await Submission.aggregate(typePipeline);

    const result = {
      metricUsed: metric,
      period: period,
      top: finalTop.map(item => ({
        _id: item._id,
        title: item.title,
        submissionType: item.submissionType,
        viewCount: item.viewCount || 0,
        recentViews: item.recentViews || 0,
        author: item.author?.name || item.author?.username || 'Unknown',
        slug: item.seo?.slug || item._id
      })),
      typeBreakdown,
      supportsRecent: topByRecent && topByRecent.length > 0
    };

    res.json(result);

  } catch (error) {
    console.error('❌ Top Content Error:', error);
    res.status(500).json({ error: 'Failed to fetch top content', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// GET /analytics/content-types
// Analytics breakdown by content type (supports period toggle)
router.get('/content-types', async (req, res) => {
  try {
    const { period = 'month', type } = req.query;
    const now = new Date();
    let startDate = null;

    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'all':
      default:
        startDate = null;
        break;
    }

    const matchFilter = { status: 'published' };
    if (startDate) {
      matchFilter.$or = [
        { publishedAt: { $gte: startDate } },
        { reviewedAt: { $gte: startDate } },
        { createdAt: { $gte: startDate } }
      ];
    }

    if (type && type.toString().trim() !== '') {
      matchFilter.submissionType = type;
    }

    const pipeline = [
      { $match: matchFilter },
      { $group: { _id: '$submissionType', posts: { $sum: 1 }, views: { $sum: { $ifNull: ['$viewCount', 0] } }, avg: { $avg: { $ifNull: ['$viewCount', 0] } } } },
      { $project: { type: '$_id', posts: '$posts', views: '$views', avg: { $round: ['$avg', 0] }, _id: 0 } },
      { $sort: { views: -1 } }
    ];

    const breakdown = await Submission.aggregate(pipeline);
    res.json({ period, breakdown });
  } catch (error) {
    console.error('❌ Content Types Error:', error);
    res.status(500).json({ error: 'Failed to fetch content type analytics', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

module.exports = router;