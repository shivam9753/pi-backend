const bcrypt = require('bcrypt');
const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const { SUBMISSION_STATUS } = require('../constants/status.constants');
const passwordService = require('./passwordService');

class UserService {
  static async registerUser(userData) {
    const { email, name, password, bio, socialLinks, role } = userData;

    // Check if user already exists (email is the unique identifier now)
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const hashedPassword = await passwordService.hashPassword(password);

    // Create user
    const user = new User({
      email,
      name: name || '',
      password: hashedPassword,
      bio: bio || '',
      socialLinks: socialLinks || {},
      role: role || 'user'
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
    const isValidPassword = await passwordService.comparePassword(password, user.password);
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
    return user.toPublicJSON();
  }

  static async updateUserProfile(userId, updateData) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }
    console.log('Current user data:', {
      name: user.name,
      bio: user.bio,
      profileImage: user.profileImage
    });
    const allowedFields = new Set(['name', 'bio', 'profileImage', 'socialLinks']);
    const updates = {};
    Object.keys(updateData).forEach(key => {
      if (allowedFields.has(key)) {
        updates[key] = updateData[key];
      }
    });
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
    const isValidPassword = await passwordService.comparePassword(currentPassword, user.password);
    if (!isValidPassword) {
      throw new Error('Current password is incorrect');
    }

    const hashedPassword = await passwordService.hashPassword(newPassword);
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
      .limit(Number.parseInt(limit))
      .skip(Number.parseInt(skip));

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
        { bio: { $regex: searchQuery, $options: 'i' } }
      ]
    };

    const users = await User.find(query, { password: 0 })
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(Number.parseInt(limit))
      .skip(Number.parseInt(skip));

    return users;
  }

  static async getAllUsers(options = {}) {
    const { limit = 50, skip = 0, role, sortBy = 'createdAt', order = 'desc', includeStats = false } = options;
    
    const query = {};
    if (role) query.role = role;
    
    const users = await User.find(query, { password: 0 })
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(Number.parseInt(limit))
      .skip(Number.parseInt(skip));

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
        limit: Number.parseInt(limit),
        skip: Number.parseInt(skip),
        hasMore: (Number.parseInt(skip) + Number.parseInt(limit)) < total
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

        // Project only required fields (removed username)
        {
          $project: {
            _id: 1,
            name: 1,
            email: 1,
            bio: 1,
            role: 1,
            profileImage: 1,
            isFeatured: 1,
            featuredAt: 1,
            createdAt: 1
          }
        },
        { $sort: sortObj },
        { $skip: Number.parseInt(skip) },
        { $limit: Number.parseInt(limit) }
      ];
      const users = await User.aggregate(pipeline);
      const totalCount = await User.countDocuments({ isFeatured: true });

      return {
        users,
        pagination: {
          total: totalCount,
          limit: Number.parseInt(limit),
          skip: Number.parseInt(skip),
          hasNext: (Number.parseInt(skip) + Number.parseInt(limit)) < totalCount,
          hasPrev: Number.parseInt(skip) > 0
         }
       };
     } catch (error) {
       console.error('Error fetching featured users:', error);
       throw new Error('Failed to fetch featured users');
     }
   }

   static async getUsersWithPublished(options = {}) {
     const { limit = 20, skip = 0, sortBy = 'name', order = 'desc' } = options;
     const Submission = require('../models/Submission');
     const sortOrder = order === 'asc' ? 1 : -1;
     try {
       const pipeline = [
         { $match: { status: SUBMISSION_STATUS.PUBLISHED } },
         { $group: { _id: '$userId', publishedCount: { $sum: 1 } } },
         {
           $lookup: {
             from: 'users',
             localField: '_id',
             foreignField: '_id',
             as: 'user'
           }
         },
         { $unwind: '$user' },
         {
           $project: {
             _id: '$user._id',
             name: '$user.name',
             profileImage: '$user.profileImage',
             publishedSubmissions: '$publishedCount'
           }
         },
         { $sort: { [sortBy]: sortOrder } },
         { $skip: Number.parseInt(skip) },
         { $limit: Number.parseInt(limit) }
       ];
       const users = await Submission.aggregate(pipeline);
       const totalAgg = await Submission.aggregate([
         { $match: { status: SUBMISSION_STATUS.PUBLISHED } },
         { $group: { _id: '$userId' } },
         { $count: 'total' }
       ]);

       const total = (totalAgg[0] && totalAgg[0].total) || 0;
       return {
         users,
         total,
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
         return null;
       }
       if (user.isFeatured) {
         return user;
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