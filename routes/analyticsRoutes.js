const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticateUser, requireRole } = require('../middleware/auth');
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const User = require('../models/User');
const Review = require('../models/Review');

// ========================================
// ANALYTICS API ROUTES
// ========================================

// Middleware: All analytics endpoints require admin/reviewer role
router.use(authenticateUser);
router.use(requireRole(['admin', 'reviewer']));

// GET /analytics/overview
// Comprehensive overview statistics
router.get('/overview', async (req, res) => {
  try {
    console.log('📊 Analytics Overview Request');

    // Parallel aggregation queries for performance
    const [
      totalStats,
      publishedStats,
      userStats,
      recentStats
    ] = await Promise.all([
      // Total submissions and views
      Submission.aggregate([
        {
          $match: { status: 'published' }
        },
        {
          $group: {
            _id: null,
            totalPosts: { $sum: 1 },
            totalViews: { $sum: '$viewCount' }
          }
        }
      ]),

      // Published content by time periods
      Submission.aggregate([
        {
          $match: { status: 'published' }
        },
        {
          $addFields: {
            today: {
              $gte: ['$publishedAt', new Date(new Date().setHours(0, 0, 0, 0))]
            },
            thisWeek: {
              $gte: ['$publishedAt', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)]
            },
            thisMonth: {
              $gte: ['$publishedAt', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)]
            }
          }
        },
        {
          $group: {
            _id: null,
            publishedToday: { 
              $sum: { $cond: ['$today', 1, 0] }
            },
            publishedThisWeek: { 
              $sum: { $cond: ['$thisWeek', 1, 0] }
            },
            publishedThisMonth: { 
              $sum: { $cond: ['$thisMonth', 1, 0] }
            }
          }
        }
      ]),

      // User statistics
      User.countDocuments({}),

      // Recent activity stats
      Submission.aggregate([
        {
          $match: { 
            createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    // Process results
    const totals = totalStats[0] || { totalPosts: 0, totalViews: 0 };
    const published = publishedStats[0] || { publishedToday: 0, publishedThisWeek: 0, publishedThisMonth: 0 };
    const totalUsers = userStats || 0;
    
    // Calculate average views per post
    const avgViewsPerPost = totals.totalPosts > 0 
      ? Math.round(totals.totalViews / totals.totalPosts) 
      : 0;

    const overview = {
      totalViews: totals.totalViews,
      totalPosts: totals.totalPosts,
      totalUsers: totalUsers,
      avgViewsPerPost: avgViewsPerPost,
      publishedToday: published.publishedToday,
      publishedThisWeek: published.publishedThisWeek,
      publishedThisMonth: published.publishedThisMonth
    };

    console.log('✅ Analytics Overview:', overview);
    res.json(overview);

  } catch (error) {
    console.error('❌ Analytics Overview Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch analytics overview',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /analytics/top-content
// Top performing and trending content
router.get('/top-content', async (req, res) => {
  try {
    const { period = 'month', limit = 10, type } = req.query;
    const limitNum = parseInt(limit) || 10;

    console.log('📊 Top Content Request:', { period, limit: limitNum, type });

    // Calculate date range based on period
    let dateFilter = {};
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
        // No date filter for 'all'
        startDate = null;
        break;
    }

    // Build match filter: use publishedAt OR reviewedAt OR createdAt so we don't miss docs
    const matchFilter = { status: 'published' };

    if (startDate) {
      matchFilter.$or = [
        { publishedAt: { $gte: startDate } },
        { reviewedAt: { $gte: startDate } },
        { createdAt: { $gte: startDate } }
      ];
    }

    // Add type filter if specified
    if (type && type.trim() !== '') {
      matchFilter.submissionType = type;
    }

    // Diagnostic: count documents that match the filter and log a sample if empty
    try {
      const matchingCount = await Submission.countDocuments(matchFilter);
      console.log('🔎 Submissions matching filter:', matchingCount, matchFilter);
      if (matchingCount === 0) {
        // Log a sample published submission (if any) to inspect field shapes
        const sample = await Submission.findOne({}).lean();
        console.log('🔎 Sample submission (any):', sample ? sample : 'none');
      }
    } catch (diagErr) {
      console.error('❌ Diagnostics failed while counting submissions:', diagErr);
    }

    // Parallel queries for different top content categories
    const [topByViews, trending] = await Promise.all([
      // Top by total views
      Submission.aggregate([
        { $match: matchFilter },
        { 
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'author'
          }
        },
        { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            title: 1,
            submissionType: 1,
            viewCount: { $ifNull: ['$viewCount', 0] },
            publishedAt: 1,
            'seo.slug': 1,
            author: {
              name: '$author.name',
              username: '$author.username',
              _id: '$author._id'
            }
          }
        },
        { $sort: { viewCount: -1 } },
        { $limit: limitNum }
      ]),

      // Trending (high recent activity relative to total views)
      Submission.aggregate([
        { 
          $match: {
            ...matchFilter,
            recentViews: { $gt: 0 }
          }
        },
        { 
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'author'
          }
        },
        { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            trendingScore: {
              $multiply: [
                { $divide: [
                  { $ifNull: ['$recentViews', 0] },
                  { $add: [{ $ifNull: ['$viewCount', 0] }, 1] }
                ]},
                100
              ]
            }
          }
        },
        {
          $project: {
            _id: 1,
            title: 1,
            submissionType: 1,
            viewCount: { $ifNull: ['$viewCount', 0] },
            recentViews: { $ifNull: ['$recentViews', 0] },
            trendingScore: 1,
            publishedAt: 1,
            'seo.slug': 1,
            author: {
              name: '$author.name',
              username: '$author.username',
              _id: '$author._id'
            }
          }
        },
        { $sort: { trendingScore: -1 } },
        { $limit: limitNum }
      ])
    ]);

    // If no results were found for the requested period (e.g. last month),
    // fall back to all-time results so the dashboard isn't empty for low-frequency sites.
    let finalTopByViews = topByViews || [];
    let finalTrending = trending || [];

    if ((finalTopByViews.length === 0 || finalTrending.length === 0) && period !== 'all') {
      console.log('⚠️ Top content empty for period', period, '— falling back to all-time results');

      const [allTimeTopByViews, allTimeTrending] = await Promise.all([
        Submission.aggregate([
          { $match: { status: 'published' } },
          { 
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'author'
            }
          },
          { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
          {
            $project: {
              _id: 1,
              title: 1,
              submissionType: 1,
              viewCount: { $ifNull: ['$viewCount', 0] },
              publishedAt: 1,
              'seo.slug': 1,
              author: {
                name: '$author.name',
                username: '$author.username',
                _id: '$author._id'
              }
            }
          },
          { $sort: { viewCount: -1 } },
          { $limit: limitNum }
        ]),

        Submission.aggregate([
          { 
            $match: { status: 'published', recentViews: { $gt: 0 } }
          },
          { 
            $lookup: {
              from: 'users',
              localField: 'userId',
              foreignField: '_id',
              as: 'author'
            }
          },
          { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
          {
            $addFields: {
              trendingScore: {
                $multiply: [
                  { $divide: [
                    { $ifNull: ['$recentViews', 0] },
                    { $add: [{ $ifNull: ['$viewCount', 0] }, 1] }
                  ]},
                  100
                ]
              }
            }
          },
          {
            $project: {
              _id: 1,
              title: 1,
              submissionType: 1,
              viewCount: { $ifNull: ['$viewCount', 0] },
              recentViews: { $ifNull: ['$recentViews', 0] },
              trendingScore: 1,
              publishedAt: 1,
              'seo.slug': 1,
              author: {
                name: '$author.name',
                username: '$author.username',
                _id: '$author._id'
              }
            }
          },
          { $sort: { trendingScore: -1 } },
          { $limit: limitNum }
        ])
      ]);

      finalTopByViews = allTimeTopByViews || [];
      finalTrending = allTimeTrending || [];
    }

    const result = {
      topByViews: finalTopByViews.map(item => ({
        ...item,
        author: item.author?.name || item.author?.username || 'Unknown',
        slug: item.seo?.slug || item._id
      })),
      topByEngagement: [], // Could implement engagement metrics later
      trending: finalTrending.map(item => ({
        ...item,
        author: item.author?.name || item.author?.username || 'Unknown',
        slug: item.seo?.slug || item._id
      }))
    };

    console.log('✅ Top Content Results:', {
      topByViews: result.topByViews.length,
      trending: result.trending.length
    });

    res.json(result);

  } catch (error) {
    console.error('❌ Top Content Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch top content',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /analytics/content-types
// Analytics breakdown by content type
router.get('/content-types', async (req, res) => {
  try {
    console.log('📊 Content Types Analytics Request');

    const contentTypeStats = await Submission.aggregate([
      {
        $match: { status: 'published' }
      },
      {
        $group: {
          _id: '$submissionType',
          count: { $sum: 1 },
          totalViews: { $sum: { $ifNull: ['$viewCount', 0] } }
        }
      },
      {
        $addFields: {
          avgViews: {
            $cond: [
              { $gt: ['$count', 0] },
              { $divide: ['$totalViews', '$count'] },
              0
            ]
          }
        }
      },
      {
        $sort: { totalViews: -1 }
      }
    ]);

    // Calculate total for percentages
    const totalCount = contentTypeStats.reduce((sum, type) => sum + type.count, 0);

    // Process results with percentages
    const types = contentTypeStats.map(type => ({
      type: type._id || 'Unknown',
      count: type.count,
      totalViews: type.totalViews,
      avgViews: Math.round(type.avgViews),
      percentage: totalCount > 0 ? Math.round((type.count / totalCount) * 100) : 0
    }));

    console.log('✅ Content Types:', types.length, 'types found');
    res.json({ types });

  } catch (error) {
    console.error('❌ Content Types Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch content type analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /analytics/views-time-series
// Time-series data for views over time
router.get('/views-time-series', async (req, res) => {
  try {
    const { period = 'month', groupBy = 'day' } = req.query;
    
    console.log('📊 Views Time Series Request:', { period, groupBy });

    // Calculate date range
    const now = new Date();
    let startDate, dateFormat;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        dateFormat = groupBy === 'day' ? '%Y-%m-%d' : '%Y-%m-%d';
        break;
      case 'quarter':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        dateFormat = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        dateFormat = groupBy === 'month' ? '%Y-%m' : '%Y-%m-%d';
        break;
      case 'month':
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        dateFormat = '%Y-%m-%d';
        break;
    }

    // Use a normalized eventDate (publishedAt || reviewedAt || createdAt) so we don't miss records
    const timeSeriesData = await Submission.aggregate([
      {
        $addFields: {
          eventDate: { $ifNull: ['$publishedAt', { $ifNull: ['$reviewedAt', '$createdAt'] }] },
          viewsVal: { $ifNull: ['$viewCount', 0] }
        }
      },
      {
        $match: {
          status: 'published',
          eventDate: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: dateFormat,
              date: '$eventDate'
            }
          },
          posts: { $sum: 1 },
          views: { $sum: '$viewsVal' }
        }
      },
      {
        $sort: { _id: 1 }
      },
      {
        $project: {
          date: '$_id',
          posts: 1,
          views: 1,
          _id: 0
        }
      }
    ]);

    // Diagnostic log
    console.log('🔎 Time series points returned:', timeSeriesData.length);

    // Calculate total views and growth
    const totalViews = timeSeriesData.reduce((sum, day) => sum + day.views, 0);
    
    // Calculate growth (compare first half vs second half)
    const midPoint = Math.floor(timeSeriesData.length / 2);
    const firstHalf = timeSeriesData.slice(0, midPoint);
    const secondHalf = timeSeriesData.slice(midPoint);
    
    const firstHalfViews = firstHalf.reduce((sum, day) => sum + day.views, 0);
    const secondHalfViews = secondHalf.reduce((sum, day) => sum + day.views, 0);
    
    const growth = firstHalfViews > 0 
      ? Math.round(((secondHalfViews - firstHalfViews) / firstHalfViews) * 100)
      : 0;

    const result = {
      data: timeSeriesData,
      total: totalViews,
      growth: growth
    };

    console.log('✅ Time Series:', timeSeriesData.length, 'data points, growth:', growth + '%');
    res.json(result);

  } catch (error) {
    console.error('❌ Views Time Series Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch views time series',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /analytics/user-engagement
// User engagement and activity analytics
router.get('/user-engagement', async (req, res) => {
  try {
    console.log('📊 User Engagement Analytics Request');

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      newUsers,
      topContributors,
      userGrowthData
    ] = await Promise.all([
      // Total users
      User.countDocuments({}),

      // Active users (submitted something in last 30 days)
      User.countDocuments({
        _id: {
          $in: await Submission.distinct('userId', {
            createdAt: { $gte: thirtyDaysAgo }
          })
        }
      }),

      // New users (joined in last 7 days)
      User.countDocuments({
        createdAt: { $gte: sevenDaysAgo }
      }),

      // Top contributors by published content
      Submission.aggregate([
        {
          $match: { status: 'published' }
        },
        {
          $group: {
            _id: '$userId',
            publishedCount: { $sum: 1 },
            totalViews: { $sum: { $ifNull: ['$viewCount', 0] } }
          }
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $project: {
            _id: 1,
            name: '$user.name',
            username: '$user.username',
            publishedCount: 1,
            totalViews: 1
          }
        },
        {
          $sort: { publishedCount: -1 }
        },
        {
          $limit: 10
        }
      ]),

      // User growth over time (last 30 days)
      User.aggregate([
        {
          $match: {
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt'
              }
            },
            newUsers: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        },
        {
          $project: {
            date: '$_id',
            newUsers: 1,
            _id: 0
          }
        }
      ])
    ]);

    // Calculate returning users
    const returningUsers = totalUsers - newUsers;

    const result = {
      activeUsers: activeUsers,
      newUsers: newUsers,
      returningUsers: Math.max(0, returningUsers),
      topContributors: topContributors,
      userGrowth: userGrowthData
    };

    console.log('✅ User Engagement:', {
      active: activeUsers,
      new: newUsers,
      returning: returningUsers,
      topContributors: topContributors.length
    });

    res.json(result);

  } catch (error) {
    console.error('❌ User Engagement Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch user engagement analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /analytics/submissions
// Submission workflow and review analytics
router.get('/submissions', async (req, res) => {
  try {
    console.log('📊 Submission Analytics Request');

    const [
      statusCounts,
      avgReviewTime,
      rejectionReasons,
      monthlyTrends
    ] = await Promise.all([
      // Count by status
      Submission.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Average review time (from submission to first review)
      Review.aggregate([
        {
          $match: {
            createdAt: { $exists: true }
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
        {
          $unwind: '$submission'
        },
        {
          $addFields: {
            reviewTimeDays: {
              $divide: [
                { $subtract: ['$createdAt', '$submission.createdAt'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            avgReviewTime: { $avg: '$reviewTimeDays' }
          }
        }
      ]),

      // Top rejection reasons
      Review.aggregate([
        {
          $match: {
            action: 'reject',
            reviewNotes: { $exists: true, $ne: '' }
          }
        },
        {
          $group: {
            _id: null,
            reasons: { $push: '$reviewNotes' }
          }
        }
      ]),

      // Monthly submission trends
      Submission.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              status: '$status'
            },
            count: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: {
              year: '$_id.year',
              month: '$_id.month'
            },
            statusCounts: {
              $push: {
                status: '$_id.status',
                count: '$count'
              }
            },
            totalSubmissions: { $sum: '$count' }
          }
        },
        {
          $sort: { '_id.year': 1, '_id.month': 1 }
        },
        {
          $project: {
            date: {
              $dateToString: {
                format: '%Y-%m',
                date: {
                  $dateFromParts: {
                    year: '$_id.year',
                    month: '$_id.month'
                  }
                }
              }
            },
            statusCounts: 1,
            totalSubmissions: 1,
            _id: 0
          }
        }
      ])
    ]);

    // Process status counts
    const statusMap = {};
    statusCounts.forEach(item => {
      statusMap[item._id] = item.count;
    });

    // Process average review time
    const avgReviewTimeDays = avgReviewTime[0]?.avgReviewTime || 0;

    // Process rejection reasons (simple keyword extraction)
    const rejectionKeywords = [];
    if (rejectionReasons[0]?.reasons) {
      const allReasons = rejectionReasons[0].reasons.join(' ').toLowerCase();
      const keywords = ['quality', 'grammar', 'format', 'content', 'plagiarism', 'inappropriate'];
      keywords.forEach(keyword => {
        const count = (allReasons.match(new RegExp(keyword, 'g')) || []).length;
        if (count > 0) {
          rejectionKeywords.push({ reason: keyword, count });
        }
      });
    }

    const result = {
      pending: statusMap['pending_review'] || 0,
      approved: statusMap['approved'] || 0,
      rejected: statusMap['rejected'] || 0,
      published: statusMap['published'] || 0,
      averageReviewTime: Math.round(avgReviewTimeDays * 10) / 10, // Round to 1 decimal
      rejectionReasons: rejectionKeywords,
      monthlyTrends: monthlyTrends
    };

    console.log('✅ Submission Analytics:', {
      pending: result.pending,
      approved: result.approved,
      rejected: result.rejected,
      published: result.published,
      avgReviewTime: result.averageReviewTime + ' days'
    });

    res.json(result);

  } catch (error) {
    console.error('❌ Submission Analytics Error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch submission analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Health check endpoint for analytics
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/analytics/overview',
      '/analytics/top-content',
      '/analytics/content-types',
      '/analytics/views-time-series',
      '/analytics/user-engagement',
      '/analytics/submissions'
    ]
  });
});

module.exports = router;