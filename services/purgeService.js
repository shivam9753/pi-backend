const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');

class PurgeService {
  
  /**
   * Get purge statistics for admin dashboard
   */
  static async getPurgeStats() {
    const stats = await Submission.getPurgeStats();
    const totalPurgeable = await Submission.countDocuments({
      eligibleForPurge: true,
      markedForDeletion: { $ne: true }
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
    
    let query = {
      eligibleForPurge: true,
      purgeEligibleSince: { $lte: cutoffDate },
      markedForDeletion: { $ne: true }
    };
    
    if (status) {
      query.status = status;
    }
    
    const submissions = await Submission.find(query)
      .populate('userId', 'username email')
      .select('title status purgeEligibleSince createdAt userId')
      .sort({ purgeEligibleSince: 1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean();
    
    const total = await Submission.countDocuments(query);
    
    return {
      submissions: submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        status: sub.status,
        author: sub.userId?.username || 'Unknown',
        submittedAt: sub.createdAt,
        eligibleSince: sub.purgeEligibleSince,
        daysSinceEligible: Math.floor((Date.now() - sub.purgeEligibleSince) / (24 * 60 * 60 * 1000))
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
    const submissions = await Submission.find({
      _id: { $in: submissionIds },
      eligibleForPurge: true,
      markedForDeletion: { $ne: true }
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
        author: submission.userId.username,
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
      const submissions = await Submission.find({
        _id: { $in: submissionIds },
        eligibleForPurge: true,
        markedForDeletion: { $ne: true }
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
   * Bulk mark submissions as eligible for purge (for migration)
   */
  static async markExistingSubmissionsForPurge() {
    const purgeableStatuses = ['rejected', 'spam'];
    
    const result = await Submission.updateMany(
      { 
        status: { $in: purgeableStatuses },
        eligibleForPurge: { $ne: true }
      },
      {
        $set: {
          eligibleForPurge: true,
          purgeEligibleSince: new Date()
        }
      }
    );

    return {
      modified: result.modifiedCount,
      message: `Marked ${result.modifiedCount} existing submissions as eligible for purge`
    };
  }

  /**
   * Get purge recommendations based on age and status
   */
  static async getPurgeRecommendations() {
    const now = new Date();
    const fourMonthsAgo = new Date(now.getTime() - (120 * 24 * 60 * 60 * 1000));
    const oneMonthAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

    const recommendations = await Submission.aggregate([
      {
        $match: {
          eligibleForPurge: true,
          markedForDeletion: { $ne: true }
        }
      },
      {
        $addFields: {
          recommendation: {
            $cond: {
              if: { 
                $and: [
                  { $eq: ['$status', 'spam'] },
                  { $lte: ['$purgeEligibleSince', oneMonthAgo] }
                ]
              },
              then: 'High Priority - Spam older than 1 month',
              else: {
                $cond: {
                  if: { 
                    $and: [
                      { $eq: ['$status', 'rejected'] },
                      { $lte: ['$purgeEligibleSince', fourMonthsAgo] }
                    ]
                  },
                  then: 'Medium Priority - Rejected older than 4 months',
                  else: 'Low Priority - Recent or under review'
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
          oldestSubmission: { $min: '$purgeEligibleSince' }
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