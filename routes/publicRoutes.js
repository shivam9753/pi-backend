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
    const user = await User.findById(userId).select('name profileImage bio');
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ profile: { _id: user._id, name: user.name, profileImage: user.profileImage, bio: user.bio } });
  } catch (error) {
    console.error('Error fetching public user profile (light):', error);
    return res.status(500).json({ message: 'Error fetching user profile', error: error.message });
  }
});

module.exports = router;
