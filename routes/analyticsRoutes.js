const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateUser, requireRole } = require('../middleware/auth');
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const User = require('../models/User');
const Review = require('../models/Review');
const DailyView = require('../models/DailyView');

// Middleware: All analytics endpoints require admin/reviewer role
router.use(authenticateUser);
router.use(requireRole(['admin', 'reviewer']));

// Helper: compute startDate for period
function getStartDateForPeriod(period) {
  const now = new Date();
  switch ((period || 'week').toString()) {
    case 'day':
    case 'today':
      // today's midnight
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return null;
  }
}

// GET /analytics/top-content
// Top performing and trending content (submissions)
// Supports query params: period=day|week|month|all (default: week), limit, type
// Responses no longer include recentViews/windowStartTime. Instead, `periodViews` (views in selected period) and `viewCount` (lifetime) are returned.
router.get('/top-content', async (req, res) => {
  try {
    const { period = 'week', limit = 10, type } = req.query;
    const limitNum = Number.parseInt(limit, 10) || 10;
    const startDate = getStartDateForPeriod(period);

    // If period === 'all', use lifetime viewCount on Submission for ranking
    if (!startDate) {
      const matchFilter = { status: 'published' };
      if (type && type.toString().trim() !== '') matchFilter.submissionType = type;

      const pipeline = [
        { $match: matchFilter },
        { $addFields: { viewCount: { $ifNull: ['$viewCount', 0] } } },
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'author' } },
        { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
        { $project: { _id: 1, title: 1, submissionType: 1, viewCount: 1, publishedAt: 1, 'seo.slug': 1, author: { name: '$author.name', username: '$author.username', _id: '$author._id' } } },
        { $sort: { viewCount: -1 } },
        { $limit: limitNum }
      ];

      const top = await Submission.aggregate(pipeline);

      const result = {
        period: 'all',
        top: top.map(item => ({
          _id: item._id,
          title: item.title,
          submissionType: item.submissionType,
          viewCount: item.viewCount || 0,
          periodViews: item.viewCount || 0, // for all-time the periodViews == lifetime
          author: item.author?.name || item.author?.username || 'Unknown',
          slug: item.seo?.slug || item._id
        }))
      };

      return res.json(result);
    }

    // For day/week/month: aggregate DailyView buckets for submissions in the date range
    const dailyAgg = [
      { $match: { targetType: 'submission', updatedAt: { $gte: startDate } } },
      { $group: { _id: '$targetId', periodViews: { $sum: '$count' } } },
      { $lookup: { from: 'submissions', localField: '_id', foreignField: '_id', as: 'submission' } },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } }
    ];

    if (type && type.toString().trim() !== '') {
      dailyAgg.push({ $match: { 'submission.submissionType': type } });
    }

    dailyAgg.push(
      { $lookup: { from: 'users', localField: 'submission.userId', foreignField: '_id', as: 'author' } },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      { $project: { _id: '$submission._id', title: '$submission.title', submissionType: '$submission.submissionType', periodViews: 1, viewCount: { $ifNull: ['$submission.viewCount', 0] }, publishedAt: '$submission.publishedAt', 'seo.slug': '$submission.seo.slug', author: { name: '$author.name', username: '$author.username', _id: '$author._id' } } },
      { $sort: { periodViews: -1, viewCount: -1 } },
      { $limit: limitNum }
    );

    const topByPeriod = await DailyView.aggregate(dailyAgg);

    const result = {
      period,
      top: topByPeriod.map(item => ({
        _id: item._id,
        title: item.title,
        submissionType: item.submissionType,
        viewCount: item.viewCount || 0,
        periodViews: item.periodViews || 0,
        author: item.author?.name || item.author?.username || 'Unknown',
        slug: item.seo || item._id
      }))
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
    const startDate = getStartDateForPeriod(period);

    if (!startDate) {
      // all-time: use submission viewCount sums grouped by submissionType
      const pipeline = [
        { $match: { status: 'published' } },
        ...(type && type.toString().trim() !== '' ? [{ $match: { submissionType: type } }] : []),
        { $group: { _id: '$submissionType', posts: { $sum: 1 }, views: { $sum: { $ifNull: ['$viewCount', 0] } }, avg: { $avg: { $ifNull: ['$viewCount', 0] } } } },
        { $project: { type: '$_id', posts: '$posts', views: '$views', avg: { $round: ['$avg', 0] }, _id: 0 } },
        { $sort: { views: -1 } }
      ];

      const breakdown = await Submission.aggregate(pipeline);
      return res.json({ period: 'all', breakdown });
    }

    // period-limited: aggregate DailyView for submissions and join to submissionType
    const pipeline = [
      { $match: { targetType: 'submission', updatedAt: { $gte: startDate } } },
      { $group: { _id: '$targetId', views: { $sum: '$count' } } },
      { $lookup: { from: 'submissions', localField: '_id', foreignField: '_id', as: 'submission' } },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } },
      ...(type && type.toString().trim() !== '' ? [{ $match: { 'submission.submissionType': type } }] : []),
      { $group: { _id: '$submission.submissionType', posts: { $sum: 1 }, views: { $sum: '$views' }, avg: { $avg: '$views' } } },
      { $project: { type: '$_id', posts: '$posts', views: '$views', avg: { $round: ['$avg', 0] }, _id: 0 } },
      { $sort: { views: -1 } }
    ];

    const breakdown = await DailyView.aggregate(pipeline);
    res.json({ period, breakdown });
  } catch (error) {
    console.error('❌ Content Types Error:', error);
    res.status(500).json({ error: 'Failed to fetch content type analytics', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// GET /analytics/overview
// Overview metrics: published counts and combined view totals (content + submissions)
router.get('/overview', async (req, res) => {
  try {
    // published counts
    const publishedCountAgg = await Submission.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: null, publishedCount: { $sum: 1 }, submissionViews: { $sum: { $ifNull: ['$viewCount', 0] } } } }
    ]);

    const contentViewsAgg = await Content.aggregate([
      { $match: { status: 'published' } },
      { $group: { _id: null, contentViews: { $sum: { $ifNull: ['$viewCount', 0] } } } }
    ]);

    const s = publishedCountAgg[0] || {};
    const c = contentViewsAgg[0] || {};

    const overview = {
      publishedCount: s.publishedCount || 0,
      submissionViews: s.submissionViews || 0,
      contentViews: c.contentViews || 0,
      totalViews: (s.submissionViews || 0) + (c.contentViews || 0)
    };

    res.json({ success: true, overview });
  } catch (error) {
    console.error('❌ Analytics Overview Error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics overview', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

// POST /analytics/cleanup-dailyviews
// Deletes DailyView entries older than `days` (default 7). Protected endpoint.
router.post('/cleanup-dailyviews', async (req, res) => {
  try {
    const { days = 7 } = req.body || {};
    const daysNum = Number.parseInt(days, 10) || 7;
    const cutoff = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    const result = await DailyView.deleteMany({ updatedAt: { $lt: cutoff } });

    res.json({ success: true, deletedCount: result.deletedCount || 0, cutoff: cutoff.toISOString() });
  } catch (error) {
    console.error('❌ Cleanup DailyView Error:', error);
    res.status(500).json({ error: 'Failed to cleanup daily view buckets', details: process.env.NODE_ENV === 'development' ? error.message : undefined });
  }
});

module.exports = router;