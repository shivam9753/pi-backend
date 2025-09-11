const express = require('express');
const router = express.Router();
const Analytics = require('../models/Analytics');
const { authenticateUser, requireRole } = require('../middleware/auth');

// ========================================
// SEARCH ANALYTICS API ROUTES
// ========================================

// Middleware: All search analytics endpoints require admin/reviewer role
router.use(authenticateUser);
router.use(requireRole(['admin', 'reviewer']));

// GET /analytics/search/popular
// Get most popular search queries
router.get('/popular', async (req, res) => {
  try {
    const { limit = 20, days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    console.log('📊 Popular search queries request');
    
    const popular = await Analytics.aggregate([
      {
        $match: {
          eventType: 'search_query',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventData.query',
          searchCount: { $sum: 1 },
          avgResults: { $avg: '$eventData.resultsCount' },
          uniqueUsers: { $addToSet: '$userId' },
          lastSearched: { $max: '$timestamp' },
          searchTypes: { $addToSet: '$eventData.filters.type' }
        }
      },
      {
        $project: {
          query: '$_id',
          searchCount: 1,
          avgResults: { $round: ['$avgResults', 1] },
          uniqueUsers: { $size: '$uniqueUsers' },
          lastSearched: 1,
          searchTypes: {
            $filter: {
              input: '$searchTypes',
              as: 'type',
              cond: { $ne: ['$$type', null] }
            }
          },
          _id: 0
        }
      },
      {
        $sort: { searchCount: -1 }
      },
      {
        $limit: parseInt(limit)
      }
    ]);
    
    res.json({
      success: true,
      data: popular,
      metadata: {
        period: `${days} days`,
        totalQueries: popular.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching popular searches:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching popular searches',
      error: error.message 
    });
  }
});

// GET /analytics/search/zero-results
// Get searches that returned no results (content gap opportunities)
router.get('/zero-results', async (req, res) => {
  try {
    const { limit = 50, days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    console.log('📊 Zero result searches request');
    
    const zeroResults = await Analytics.aggregate([
      {
        $match: {
          eventType: 'search_query',
          'eventData.resultsCount': 0,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventData.query',
          searchCount: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' },
          lastSearched: { $max: '$timestamp' },
          searchTypes: { $addToSet: '$eventData.filters.type' }
        }
      },
      {
        $project: {
          query: '$_id',
          searchCount: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
          lastSearched: 1,
          searchTypes: {
            $filter: {
              input: '$searchTypes',
              as: 'type',
              cond: { $ne: ['$$type', null] }
            }
          },
          _id: 0
        }
      },
      {
        $sort: { searchCount: -1 }
      },
      {
        $limit: parseInt(limit)
      }
    ]);
    
    res.json({
      success: true,
      data: zeroResults,
      metadata: {
        period: `${days} days`,
        totalQueries: zeroResults.length,
        description: 'Searches that returned no results - potential content opportunities'
      }
    });
    
  } catch (error) {
    console.error('Error fetching zero result searches:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching zero result searches',
      error: error.message 
    });
  }
});

// GET /analytics/search/trends
// Get search trends over time
router.get('/trends', async (req, res) => {
  try {
    const { days = 30, groupBy = 'day' } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    console.log('📊 Search trends request');
    
    // Determine date format based on groupBy
    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = '%Y-%m-%d %H:00';
        break;
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%Y-W%U';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }
    
    const trends = await Analytics.aggregate([
      {
        $match: {
          eventType: 'search_query',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: dateFormat, date: '$timestamp' }
          },
          totalSearches: { $sum: 1 },
          uniqueQueries: { $addToSet: '$eventData.query' },
          uniqueUsers: { $addToSet: '$userId' },
          avgResultsCount: { $avg: '$eventData.resultsCount' },
          zeroResultSearches: {
            $sum: {
              $cond: [{ $eq: ['$eventData.resultsCount', 0] }, 1, 0]
            }
          }
        }
      },
      {
        $project: {
          period: '$_id',
          totalSearches: 1,
          uniqueQueries: { $size: '$uniqueQueries' },
          uniqueUsers: { $size: '$uniqueUsers' },
          avgResultsCount: { $round: ['$avgResultsCount', 1] },
          zeroResultSearches: 1,
          zeroResultRate: { 
            $round: [{ 
              $multiply: [{ 
                $divide: ['$zeroResultSearches', '$totalSearches'] 
              }, 100] 
            }, 1] 
          },
          _id: 0
        }
      },
      {
        $sort: { period: 1 }
      }
    ]);
    
    res.json({
      success: true,
      data: trends,
      metadata: {
        period: `${days} days`,
        groupBy,
        totalPeriods: trends.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching search trends:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching search trends',
      error: error.message 
    });
  }
});

// GET /analytics/search/overview
// Get comprehensive search analytics overview
router.get('/overview', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    console.log('📊 Search analytics overview request');
    
    // Run parallel aggregations for performance
    const [
      totalStats,
      topQueries,
      recentTrend,
      searchTypes
    ] = await Promise.all([
      // Total statistics
      Analytics.aggregate([
        {
          $match: {
            eventType: 'search_query',
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalSearches: { $sum: 1 },
            uniqueQueries: { $addToSet: '$eventData.query' },
            uniqueUsers: { $addToSet: '$userId' },
            avgResultsCount: { $avg: '$eventData.resultsCount' },
            zeroResultSearches: {
              $sum: {
                $cond: [{ $eq: ['$eventData.resultsCount', 0] }, 1, 0]
              }
            }
          }
        },
        {
          $project: {
            totalSearches: 1,
            uniqueQueries: { $size: '$uniqueQueries' },
            uniqueUsers: { $size: '$uniqueUsers' },
            avgResultsCount: { $round: ['$avgResultsCount', 1] },
            zeroResultSearches: 1,
            zeroResultRate: { 
              $round: [{ 
                $multiply: [{ 
                  $divide: ['$zeroResultSearches', '$totalSearches'] 
                }, 100] 
              }, 1] 
            },
            _id: 0
          }
        }
      ]),
      
      // Top 5 queries
      Analytics.aggregate([
        {
          $match: {
            eventType: 'search_query',
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$eventData.query',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 5
        },
        {
          $project: {
            query: '$_id',
            count: 1,
            _id: 0
          }
        }
      ]),
      
      // Recent trend (last 7 days)
      Analytics.aggregate([
        {
          $match: {
            eventType: 'search_query',
            timestamp: { 
              $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
            },
            count: { $sum: 1 }
          }
        },
        {
          $sort: { _id: 1 }
        },
        {
          $project: {
            date: '$_id',
            count: 1,
            _id: 0
          }
        }
      ]),
      
      // Search types breakdown
      Analytics.aggregate([
        {
          $match: {
            eventType: 'search_query',
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$eventData.filters.type',
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            type: { $ifNull: ['$_id', 'content'] },
            count: 1,
            _id: 0
          }
        },
        {
          $sort: { count: -1 }
        }
      ])
    ]);
    
    const stats = totalStats[0] || {
      totalSearches: 0,
      uniqueQueries: 0,
      uniqueUsers: 0,
      avgResultsCount: 0,
      zeroResultSearches: 0,
      zeroResultRate: 0
    };
    
    res.json({
      success: true,
      data: {
        overview: stats,
        topQueries,
        recentTrend,
        searchTypes
      },
      metadata: {
        period: `${days} days`,
        generatedAt: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('Error fetching search analytics overview:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching search analytics overview',
      error: error.message 
    });
  }
});

module.exports = router;