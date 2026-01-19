const bcrypt = require('bcrypt');
const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const { SUBMISSION_STATUS } = require('../constants/status.constants');

class UserService {
  static async registerUser(userData) {
    const { email, name, username, password, bio, socialLinks } = userData;

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }]
    });

    if (existingUser) {
      const field = existingUser.email === email ? 'email' : 'username';
      throw new Error(`User with this ${field} already exists`);
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const user = new User({
      email,
      name: name || '',
      username,
      password: hashedPassword,
      bio: bio || '',
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    return {
      user,
      token
    };
  }

  static async loginUser(email, password) {
    // Find user by email
    const user = await User.findByEmail(email);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new Error('Invalid credentials');
    }

    // Generate token
    const token = generateToken(user._id);

    return {
      user,
      token
    };
  }

  static async getUserProfile(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Get user stats from submissions
    const Submission = require('../models/Submission');
    
    // Get counts by status
    const [
      totalSubmissions, 
      publishedSubmissions, 
      pendingSubmissions, 
      needsRevisionSubmissions,
      draftSubmissions,
      acceptedSubmissions,
      rejectedSubmissions
    ] = await Promise.all([
      Submission.countDocuments({ userId }),
      Submission.countDocuments({ userId, status: SUBMISSION_STATUS.PUBLISHED }),
      Submission.countDocuments({ userId, status: { $in: [SUBMISSION_STATUS.PENDING_REVIEW, SUBMISSION_STATUS.IN_PROGRESS, SUBMISSION_STATUS.SHORTLISTED, SUBMISSION_STATUS.SUBMITTED, SUBMISSION_STATUS.RESUBMITTED] } }),
      Submission.countDocuments({ userId, status: { $in: [SUBMISSION_STATUS.NEEDS_REVISION, SUBMISSION_STATUS.NEEDS_CHANGES] } }),
      Submission.countDocuments({ userId, status: SUBMISSION_STATUS.DRAFT }),
      Submission.countDocuments({ userId, status: { $in: [SUBMISSION_STATUS.ACCEPTED, SUBMISSION_STATUS.APPROVED] } }),
      Submission.countDocuments({ userId, status: SUBMISSION_STATUS.REJECTED })
    ]);

    // Get counts by submission type
    const submissionTypeCounts = await Submission.aggregate([
      { $match: { userId: userId } },
      { $group: { _id: '$submissionType', count: { $sum: 1 } } }
    ]);

    const userProfile = user.toPublicJSON();
    userProfile.submissionStats = {
      total: totalSubmissions,
      published: publishedSubmissions,
      pending: pendingSubmissions,
      needsRevision: needsRevisionSubmissions,
      draft: draftSubmissions,
      accepted: acceptedSubmissions,
      rejected: rejectedSubmissions,
      byType: submissionTypeCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {
        poem: 0,
        prose: 0, 
        article: 0,
        opinion: 0
      })
    };

    return userProfile;
  }

  static async updateUserProfile(userId, updateData) {
    console.log('🔄 UserService.updateUserProfile called with:', { userId, updateData });
    
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    console.log('👤 Current user data:', {
      name: user.name,
      bio: user.bio,
      profileImage: user.profileImage
    });

    // Update allowed fields
    const allowedFields = ['name', 'username', 'bio', 'profileImage', 'socialLinks', 'preferences'];
    const updates = {};

    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        updates[key] = updateData[key];
      }
    });
    
    console.log('✅ Filtered updates to apply:', updates);

    // Check if username is being updated and is unique
    if (updates.username && updates.username !== user.username) {
      const existingUser = await User.findByUsername(updates.username);
      if (existingUser) {
        throw new Error('Username already taken');
      }
    }

    Object.assign(user, updates);
    await user.save();
    
    console.log('💾 User saved successfully:', {
      name: user.name,
      bio: user.bio,
      profileImage: user.profileImage
    });

    return user.toPublicJSON();
  }

  static async changePassword(userId, currentPassword, newPassword) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    user.password = hashedPassword;
    await user.save();

    return { message: 'Password updated successfully' };
  }

  static async getUserPublishedWorks(userId, options = {}) {
    const { limit = 10, skip = 0, type, sortBy = 'reviewedAt', order = 'desc' } = options;
    
    const Submission = require('../models/Submission');
    
    const query = {
      userId,
      status: 'published'
    };
    
    if (type) {
      query.submissionType = type;
    }
    
    const submissions = await Submission.find(query)
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    // Manually populate contentIds for each submission
    const populatedSubmissions = await Promise.all(
      submissions.map(async (submission) => {
        return await Submission.populateContentIds(submission);
      })
    );

    return populatedSubmissions;
  }

  static async searchUsers(searchQuery, options = {}) {
    const { limit = 10, skip = 0, sortBy = 'createdAt', order = 'desc' } = options;
    
    const query = {
      $or: [
        { name: { $regex: searchQuery, $options: 'i' } },
        { email: { $regex: searchQuery, $options: 'i' } },
        { username: { $regex: searchQuery, $options: 'i' } },
        { bio: { $regex: searchQuery, $options: 'i' } }
      ]
    };

    const users = await User.find(query, { password: 0 })
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    return users;
  }

  static async getAllUsers(options = {}) {
    const { limit = 50, skip = 0, role, sortBy = 'createdAt', order = 'desc', includeStats = false } = options;
    
    const query = {};
    if (role) query.role = role;
    
    const users = await User.find(query, { password: 0 })
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await User.countDocuments(query);

    // Calculate stats if requested
    let stats = null;
    if (includeStats) {
      const [userCount, reviewerCount, adminCount] = await Promise.all([
        User.countDocuments({ role: 'user' }),
        User.countDocuments({ role: 'reviewer' }),
        User.countDocuments({ role: 'admin' })
      ]);
      
      stats = {
        users: userCount,
        reviewers: reviewerCount,
        admins: adminCount,
        total: userCount + reviewerCount + adminCount
      };
    }

    return {
      users,
      total,
      stats,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total
      }
    };
  }

  static async updateUserRole(userId, newRole) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const allowedRoles = ['user', 'reviewer', 'admin', 'writer'];
    if (!allowedRoles.includes(newRole)) {
      throw new Error('Invalid role');
    }

    user.role = newRole;
    await user.save();

    return user.toPublicJSON();
  }

  static async deleteUser(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Delete user's submissions and content
    const Submission = require('../models/Submission');
    const Content = require('../models/Content');
    const Review = require('../models/Review');

    const userSubmissions = await Submission.find({ userId });
    const contentIds = userSubmissions.reduce((ids, sub) => 
      ids.concat(sub.contentIds || []), []
    );

    // Delete in order: reviews, content, submissions, user
    await Review.deleteMany({ 
      $or: [
        { reviewerId: userId },
        { submissionId: { $in: userSubmissions.map(s => s._id) } }
      ]
    });
    
    if (contentIds.length > 0) {
      await Content.deleteMany({ _id: { $in: contentIds } });
    }
    
    await Submission.deleteMany({ userId });
    await User.findByIdAndDelete(userId);

    return {
      message: 'User and all associated data deleted successfully',
      deletedSubmissions: userSubmissions.length,
      deletedContent: contentIds.length
    };
  }

  static async checkFirstTimeSubmitter(userId) {
    const User = require('../models/User');
    const Submission = require('../models/Submission');

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Check if user has any submissions
    const submissionCount = await Submission.countDocuments({ userId });
    
    return submissionCount === 0;
  }

  static async approveUserBio(userId, approvedBio, adminId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Update the user's bio and clear temp bio
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        bio: approvedBio,
        tempBio: '',
        'profileApproval.bioApproved': true,
        'profileApproval.approvedBy': adminId,
        'profileApproval.approvedAt': new Date()
      },
      { new: true }
    );

    return updatedUser.toPublicJSON();
  }

  static async approveUserProfileImage(userId, adminId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Move temp profile image to main profile image
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        profileImage: user.tempProfileImage,
        tempProfileImage: '',
        'profileApproval.imageApproved': true,
        'profileApproval.approvedBy': adminId,
        'profileApproval.approvedAt': new Date()
      },
      { new: true }
    );

    return updatedUser.toPublicJSON();
  }

  static async markUserFeatured(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (user.isFeatured) {
      throw new Error('User is already featured');
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        isFeatured: true,
        featuredAt: new Date()
      },
      { new: true }
    );

    return updatedUser.toPublicJSON();
  }

  static async unmarkUserFeatured(userId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.isFeatured) {
      throw new Error('User is not currently featured');
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        isFeatured: false,
        featuredAt: null
      },
      { new: true }
    );

    return updatedUser.toPublicJSON();
  }

  static async getFeaturedUsers(options = {}) {
    const {
      limit = 20,
      skip = 0,
      sortBy = 'featuredAt',
      order = 'desc'
    } = options;

    const sortOrder = order === 'asc' ? 1 : -1;
    const sortObj = { [sortBy]: sortOrder };

    try {
      // Get featured users with basic stats
      const pipeline = [
        // Match only featured users
        { $match: { isFeatured: true } },

        // Lookup published submissions count
        {
          $lookup: {
            from: 'submissions',
            let: { userId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$userId', '$$userId'] },
                      { $eq: ['$status', 'published'] }
                    ]
                  }
                }
              },
              { $count: 'count' }
            ],
            as: 'publishedCount'
          }
        },

        // Add computed fields
        {
          $addFields: {
            publishedSubmissions: {
              $ifNull: [{ $arrayElemAt: ['$publishedCount.count', 0] }, 0]
            }
          }
        },

        // Project only required fields
        {
          $project: {
            _id: 1,
            username: 1,
            name: 1,
            email: 1,
            bio: 1,
            role: 1,
            profileImage: 1,
            isFeatured: 1,
            featuredAt: 1,
            createdAt: 1,
            publishedSubmissions: 1
          }
        },

        // Sort
        { $sort: sortObj },

        // Pagination
        { $skip: parseInt(skip) },
        { $limit: parseInt(limit) }
      ];

      const users = await User.aggregate(pipeline);

      // Get total count of featured users
      const totalCount = await User.countDocuments({ isFeatured: true });

      return {
        users,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasNext: (parseInt(skip) + parseInt(limit)) < totalCount,
          hasPrev: parseInt(skip) > 0
        }
      };
    } catch (error) {
      console.error('Error fetching featured users:', error);
      throw new Error('Failed to fetch featured users');
    }
  }

  // New: Get users who have at least one published submission
  static async getUsersWithPublished(options = {}) {
    const { limit = 20, skip = 0, sortBy = 'name', order = 'desc' } = options;
    const Submission = require('../models/Submission');

    const sortOrder = order === 'asc' ? 1 : -1;

    try {
      // Aggregate published submissions grouped by userId
      const pipeline = [
        { $match: { status: SUBMISSION_STATUS.PUBLISHED } },
        { $group: { _id: '$userId', publishedCount: { $sum: 1 } } },

        // Join with users collection
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'user'
          }
        },
        { $unwind: '$user' },

        // Project only required minimal fields: id, name, profileImage
        {
          $project: {
            _id: '$user._id',
            name: { $ifNull: ['$user.name', '$user.username'] },
            profileImage: '$user.profileImage'
          }
        },

        // Sorting
        { $sort: { [sortBy]: sortOrder } },

        // Pagination
        { $skip: Number.parseInt(skip) },
        { $limit: Number.parseInt(limit) }
      ];

      const users = await Submission.aggregate(pipeline);

      // Get total number of distinct users who have published submissions
      const totalAgg = await Submission.aggregate([
        { $match: { status: SUBMISSION_STATUS.PUBLISHED } },
        { $group: { _id: '$userId' } },
        { $count: 'total' }
      ]);

      const total = (totalAgg[0] && totalAgg[0].total) || 0;

      return {
        users,
        pagination: {
          total,
          limit: Number.parseInt(limit),
          skip: Number.parseInt(skip),
          hasNext: (Number.parseInt(skip) + Number.parseInt(limit)) < total,
          hasPrev: Number.parseInt(skip) > 0
        }
      };
    } catch (error) {
      console.error('Error fetching users with published submissions:', error);
      throw new Error('Failed to fetch users with published submissions');
    }
  }

  static async markUserAsFeaturedByContent(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        return null; // User not found, but don't throw error for background operation
      }

      if (user.isFeatured) {
        return user; // Already featured
      }

      const updatedUser = await User.findByIdAndUpdate(
        userId,
        {
          isFeatured: true,
          featuredAt: new Date()
        },
        { new: true }
      );

      return updatedUser;
    } catch (error) {
      console.error('Error marking user as featured by content:', error);
      return null; // Don't throw error for background operation
    }
  }
}

module.exports = UserService;