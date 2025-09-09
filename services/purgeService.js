const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');

class PurgeService {
  
  /**
   * Get purge statistics for admin dashboard
   */
  static async getPurgeStats() {
    const purgeableStatuses = ['rejected', 'needs_revision', 'draft'];
    const stats = await Submission.aggregate([
      {
        $match: {
          status: { $in: purgeableStatuses }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          oldestSubmission: { $min: '$updatedAt' },
          newestSubmission: { $max: '$updatedAt' }
        }
      }
    ]);
    
    const totalPurgeable = await Submission.countDocuments({
      status: { $in: purgeableStatuses }
    });
    
    return {
      totalPurgeable,
      byStatus: stats,
      lastUpdated: new Date()
    };
  }

  /**
   * Get list of submissions eligible for purging
   */
  static async getPurgeableSubmissions(options = {}) {
    const { 
      olderThanDays = 120, 
      limit = 50, 
      skip = 0,
      status = null 
    } = options;
    
    const cutoffDate = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
    const purgeableStatuses = ['rejected', 'needs_revision', 'draft'];
    
    let query = {
      status: status ? status : { $in: purgeableStatuses },
      updatedAt: { $lte: cutoffDate }
    };
    
    const submissions = await Submission.find(query)
      .populate('userId', 'username email')
      .select('title status createdAt updatedAt userId')
      .sort({ updatedAt: 1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();
    
    const total = await Submission.countDocuments(query);
    
    return {
      submissions: submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        status: sub.status,
        author: sub.userId ? {
          _id: sub.userId._id,
          id: sub.userId._id,
          name: sub.userId.name,
          username: sub.userId.username
        } : null,
        submittedAt: sub.createdAt,
        eligibleSince: sub.updatedAt,
        daysSinceEligible: Math.floor((Date.now() - sub.updatedAt) / (24 * 60 * 60 * 1000))
      })),
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    };
  }

  /**
   * Preview what will be deleted before actual purge
   */
  static async previewPurge(submissionIds) {
    const purgeableStatuses = ['rejected', 'needs_revision', 'draft'];
    const submissions = await Submission.find({
      _id: { $in: submissionIds },
      status: { $in: purgeableStatuses }
    }).populate('userId', 'username');

    const preview = {
      submissionsToDelete: submissions.length,
      contentToDelete: 0,
      reviewsToDelete: 0,
      affectedUsers: new Set(),
      details: []
    };

    for (const submission of submissions) {
      // Count associated content
      const contentCount = await Content.countDocuments({
        submissionId: submission._id
      });
      
      // Count associated reviews
      const reviewCount = await Review.countDocuments({
        submissionId: submission._id
      });

      preview.contentToDelete += contentCount;
      preview.reviewsToDelete += reviewCount;
      preview.affectedUsers.add(submission.userId.username);
      
      preview.details.push({
        submissionId: submission._id,
        title: submission.title,
        author: {
          _id: submission.userId._id,
          id: submission.userId._id,
          name: submission.userId.name,
          username: submission.userId.username
        },
        contentPieces: contentCount,
        reviews: reviewCount,
        status: submission.status
      });
    }

    preview.affectedUsers = Array.from(preview.affectedUsers);
    return preview;
  }

  /**
   * Execute purge for selected submissions
   */
  static async executePurge(submissionIds, adminId) {
    const results = {
      success: [],
      failed: [],
      totalSubmissions: 0,
      totalContent: 0,
      totalReviews: 0,
      errors: []
    };

    try {
      // Verify all submissions are eligible
      const purgeableStatuses = ['rejected', 'needs_revision', 'draft'];
      const submissions = await Submission.find({
        _id: { $in: submissionIds },
        status: { $in: purgeableStatuses }
      });

      if (submissions.length !== submissionIds.length) {
        throw new Error('Some submissions are not eligible for purging');
      }

      // Execute purge for each submission
      for (const submission of submissions) {
        try {
          // Delete associated content
          const deletedContent = await Content.deleteMany({
            submissionId: submission._id
          });
          
          // Delete associated reviews
          const deletedReviews = await Review.deleteMany({
            submissionId: submission._id
          });
          
          // Delete submission
          await Submission.findByIdAndDelete(submission._id);

          results.success.push({
            submissionId: submission._id,
            title: submission.title,
            contentDeleted: deletedContent.deletedCount,
            reviewsDeleted: deletedReviews.deletedCount
          });

          results.totalContent += deletedContent.deletedCount;
          results.totalReviews += deletedReviews.deletedCount;
          results.totalSubmissions++;

        } catch (error) {
          results.failed.push({
            submissionId: submission._id,
            title: submission.title,
            error: error.message
          });
          results.errors.push(`Failed to purge ${submission.title}: ${error.message}`);
        }
      }

      // Log purge activity
      console.log(`🗑️ PURGE EXECUTED by admin ${adminId}:`, {
        submissions: results.totalSubmissions,
        content: results.totalContent,
        reviews: results.totalReviews,
        failed: results.failed.length
      });

      return results;

    } catch (error) {
      console.error('❌ PURGE FAILED:', error);
      results.errors.push(error.message);
      return results;
    }
  }


  /**
   * Get purge recommendations based on age and status
   */
  static async getPurgeRecommendations() {
    const now = new Date();
    const fourMonthsAgo = new Date(now.getTime() - (120 * 24 * 60 * 60 * 1000));
    const oneMonthAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const purgeableStatuses = ['rejected', 'needs_revision', 'draft'];

    const recommendations = await Submission.aggregate([
      {
        $match: {
          status: { $in: purgeableStatuses }
        }
      },
      {
        $addFields: {
          recommendation: {
            $cond: {
              if: { 
                $and: [
                  { $eq: ['$status', 'rejected'] },
                  { $lte: ['$updatedAt', oneMonthAgo] }
                ]
              },
              then: 'High Priority - Rejected older than 1 month',
              else: {
                $cond: {
                  if: { 
                    $and: [
                      { $eq: ['$status', 'needs_revision'] },
                      { $lte: ['$updatedAt', fourMonthsAgo] }
                    ]
                  },
                  then: 'Medium Priority - Needs revision older than 4 months',
                  else: {
                    $cond: {
                      if: { 
                        $and: [
                          { $eq: ['$status', 'draft'] },
                          { $lte: ['$updatedAt', fourMonthsAgo] }
                        ]
                      },
                      then: 'Low Priority - Draft older than 4 months',
                      else: 'Recent - Review needed'
                    }
                  }
                }
              }
            }
          }
        }
      },
      {
        $group: {
          _id: '$recommendation',
          count: { $sum: 1 },
          oldestSubmission: { $min: '$updatedAt' }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);

    return recommendations;
  }
}

module.exports = PurgeService;