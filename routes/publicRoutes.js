const express = require('express');
const User = require('../models/User');
const UserService = require('../services/userService');
const { validateObjectId, validatePagination } = require('../middleware/validation');

const router = express.Router();

// Trending authors by featured content daily views
router.get('/trending', async (req, res) => {
  try {
    const { limit = 5, windowDays = 7 } = req.query;
    const days = Number.parseInt(windowDays, 10) || 7;
    const limitNum = Math.min(Number.parseInt(limit, 10) || 5, 50);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const DailyView = require('../models/DailyView');

    const pipeline = [
      { $match: { targetType: 'content', updatedAt: { $gte: cutoff } } },
      { $group: { _id: '$targetId', periodViews: { $sum: '$count' } } },
      { $lookup: { from: 'contents', localField: '_id', foreignField: '_id', as: 'content' } },
      { $unwind: '$content' },
      { $match: { 'content.isFeatured': true } },
      { $lookup: { from: 'submissions', localField: 'content.submissionId', foreignField: '_id', as: 'submission' } },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } },
      { $group: {
          _id: '$submission.userId',
          totalViews: { $sum: '$periodViews' },
          topSubmission: { $first: { _id: '$content._id', title: '$content.title', viewCount: '$content.viewCount', periodViews: '$periodViews' } }
        }
      },
      { $sort: { totalViews: -1 } },
      { $limit: limitNum },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'author' } },
      { $unwind: '$author' },
      { $project: {
          _id: 1,
          author: { _id: '$author._id', name: '$author.name', profileImage: '$author.profileImage', bio: '$author.bio' },
          totalViews: 1,
          topSubmission: 1
      } }
    ];

    const results = await DailyView.aggregate(pipeline);
    return res.json({ authors: results, total: results.length });
  } catch (error) {
    console.error('Error fetching trending authors:', error);
    return res.status(500).json({ message: 'Error fetching trending authors', error: error.message });
  }
});

// Featured users
router.get('/featured', validatePagination, async (req, res) => {
  try {
    const result = await UserService.getFeaturedUsers(req.query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching featured users', error: error.message });
  }
});

// Users with published counts
router.get('/published', validatePagination, async (req, res) => {
  try {
    const result = await UserService.getUsersWithPublished(req.query);
    res.json(result);
  } catch (error) {
    console.error('Error fetching users with published submissions:', error);
    res.status(500).json({ message: 'Error fetching users with published submissions', error: error.message });
  }
});

// Public user profile
router.get('/users/:id', validateObjectId('id'), async (req, res) => {
  try {
    const profile = await UserService.getUserProfile(req.params.id);
    res.json({ profile });
  } catch (error) {
    if (error.message === 'User not found') {
      return res.status(404).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

// Public: user's published works
router.get('/users/:id/published-works', validateObjectId('id'), validatePagination, async (req, res) => {
  try {
    const works = await UserService.getUserPublishedWorks(req.params.id, req.query);
    res.json({ 
      works,
      pagination: {
        total: works.length,
        limit: Number.parseInt(req.query.limit) || 10,
        skip: Number.parseInt(req.query.skip) || 0,
        hasMore: works.length === (Number.parseInt(req.query.limit) || 10)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user works', error: error.message });
  }
});

// Public user profile (lightweight) - returns only name, profileImage and bio for reader UI
router.get('/users/:id/briefprofile', validateObjectId('id'), async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId).select('name profileImage bio socialLinks createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({
      profile: {
        _id: user._id,
        name: user.name,
        profileImage: user.profileImage,
        bio: user.bio,
        socialLinks: user.socialLinks || {},
        joinedDate: user.createdAt
      }
    });
  } catch (error) {
    console.error('Error fetching public user profile (light):', error);
    return res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

// Public: trending submissions by recent DailyView (returns submissions list)
router.get('/trending-submissions', async (req, res) => {
  try {
    const { limit = 7, skip = 0, windowDays = 7, type } = req.query;
    const days = Number.parseInt(windowDays, 10) || 7;
    const limitNum = Math.min(Number.parseInt(limit, 10) || 7, 100);
    const skipNum = Math.max(Number.parseInt(skip, 10) || 0, 0);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const DailyView = require('../models/DailyView');

    // Aggregate recent daily view buckets for submissions
    const baseAgg = [
      { $match: { targetType: 'submission', updatedAt: { $gte: cutoff } } },
      { $group: { _id: '$targetId', periodViews: { $sum: '$count' } } },
      { $lookup: { from: 'submissions', localField: '_id', foreignField: '_id', as: 'submission' } },
      { $unwind: '$submission' },
      { $match: { 'submission.status': 'published' } }
    ];

    if (type && String(type).trim() !== '') {
      baseAgg.push({ $match: { 'submission.submissionType': String(type) } });
    }

    // Join author and project final submission shape
    const finalAgg = baseAgg.concat([
      { $lookup: { from: 'users', localField: 'submission.userId', foreignField: '_id', as: 'author' } },
      { $unwind: { path: '$author', preserveNullAndEmptyArrays: true } },
      { $project: {
          _id: '$submission._id',
          title: '$submission.title',
          submissionType: '$submission.submissionType',
          periodViews: 1,
          viewCount: { $ifNull: ['$submission.viewCount', 0] },
          publishedAt: '$submission.reviewedAt',
          seo: '$submission.seo',
          // include fields needed by the mapper so imageUrl/excerpt/readingTime/createdAt are available
          imageUrl: '$submission.imageUrl',
          excerpt: '$submission.excerpt',
          readingTime: '$submission.readingTime',
          createdAt: '$submission.createdAt',
          author: { _id: '$author._id', name: '$author.name', username: '$author.username', profileImage: '$author.profileImage' }
      } },
      { $sort: { periodViews: -1, viewCount: -1 } },
      { $skip: skipNum },
      { $limit: limitNum }
    ]);

    // Build count pipeline (same as baseAgg but count unique submissions)
    const countAgg = baseAgg.concat([{ $count: 'total' }]);

    const [submissions, countResult] = await Promise.all([
      DailyView.aggregate(finalAgg),
      DailyView.aggregate(countAgg)
    ]);

    const total = (countResult && countResult.length > 0) ? countResult[0].total : 0;

    // Normalize submission shape to match explore endpoint (/api/submissions/explore)
    const mapped = (submissions || []).map(s => ({
      _id: s._id,
      title: s.title,
      submissionType: s.submissionType,
      imageUrl: s.seo?.ogImage || s.imageUrl || '',
      excerpt: s.excerpt || '',
      readingTime: s.readingTime || 1,
      createdAt: s.createdAt || s.publishedAt || null,
      author: s.author ? { name: s.author.name, username: s.author.username } : null,
      slug: s.seo?.slug || (s.seo && s.seo.slug) || (s._id || ''),
      publishedAt: s.publishedAt || null,
      viewCount: s.viewCount || 0,
      featured: !!s.featured
    }));

    const limitVal = limitNum;
    const skipVal = skipNum;
    const currentPage = Math.floor(skipVal / limitVal) + 1;
    const totalPages = limitVal > 0 ? Math.ceil(total / limitVal) : 1;
    const hasMore = (skipVal + limitVal) < total;

    return res.json({
      success: true,
      submissions: mapped,
      pagination: {
        currentPage,
        totalPages,
        limit: limitVal,
        skip: skipVal,
        hasMore
      },
      total,
      filters: {
        types: ['poem','prose','article','book_review','cinema_essay','opinion'],
        featured: false
      }
    });
  } catch (error) {
    console.error('Error fetching trending submissions:', error);
    return res.status(500).json({ message: 'Error fetching trending submissions', error: error.message });
  }
});

module.exports = router;
