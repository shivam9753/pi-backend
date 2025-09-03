const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');
const User = require('../models/User');
const { 
  SUBMISSION_STATUS, 
  STATUS_ARRAYS,
  STATUS_UTILS 
} = require('../constants/status.constants');
const { mapTagArray } = require('../utils/tagMapping');

class SubmissionService {
  static async createSubmission(submissionData) {
    const { userId, authorId, title, description, submissionType, contents, profileData, status } = submissionData;
    
    // Handle both userId and authorId (frontend compatibility)
    const actualUserId = userId || authorId;

    // Verify user exists
    const user = await User.findById(actualUserId);
    if (!user) {
      throw new Error('User not found');
    }

    // Handle first-time user profile data
    if (profileData && profileData.isFirstTimeSubmission) {
      await User.findByIdAndUpdate(actualUserId, {
        tempBio: profileData.tempBio || ''
      });
    }

    // First create submission without content IDs
    const submission = new Submission({
      userId: actualUserId,
      title,
      description,
      contentIds: [], // Empty initially
      submissionType,
      status: status || SUBMISSION_STATUS.DRAFT, // Use provided status or default to 'draft'
      readingTime: 1, // Default, will be updated
      excerpt: '' // Default, will be updated
    });

    const savedSubmission = await submission.save();

    // Now create content items with submissionId
    const contentDocs = contents.map(content => ({
      ...content,
      userId: actualUserId,
      type: content.type || submissionType,
      submissionId: savedSubmission._id
    }));

    const createdContents = await Content.create(contentDocs);
    
    // Calculate reading time and excerpt
    const readingTime = Submission.calculateReadingTime(createdContents);
    const excerpt = Submission.generateExcerpt(createdContents);

    // Update submission with content IDs and calculated values
    savedSubmission.contentIds = createdContents.map(c => c._id);
    savedSubmission.readingTime = readingTime;
    savedSubmission.excerpt = excerpt;

    return await savedSubmission.save();
  }

  static async getAcceptedSubmissions(filters = {}) {
    const { type, limit = 20, skip = 0, sortBy = 'reviewedAt', order = 'desc' } = filters;
    
    const query = { status: SUBMISSION_STATUS.ACCEPTED };
    if (type) query.submissionType = type;

    // Use .select() to only fetch required fields - exclude large fields like description
    const submissions = await Submission.find(query)
      .select('title excerpt imageUrl readingTime reviewedAt submissionType tags userId reviewedBy')
      .populate('userId', 'name username')
      .populate('reviewedBy', 'username')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean(); // Use lean() for better performance on read-only data

    const total = await Submission.countDocuments(query);

    // Return optimized data structure
    const optimizedSubmissions = submissions.map(sub => ({
      _id: sub._id,
      title: sub.title,
      excerpt: sub.excerpt,
      imageUrl: sub.imageUrl,
      readingTime: sub.readingTime,
      reviewedAt: sub.reviewedAt,
      submissionType: sub.submissionType,
      tags: sub.tags,
      submitterName: sub.userId?.name || sub.userId?.username || 'Unknown',
    }));

    return {
      submissions: optimizedSubmissions,
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  }

  static async getPublishedSubmissions(filters = {}) {
    const { type, limit = 20, skip = 0, sortBy = 'reviewedAt', order = 'desc' } = filters;
    
    const query = { status: SUBMISSION_STATUS.PUBLISHED };
    if (type) query.submissionType = type;

    // Use .select() to exclude large fields like description and contentIds for listing
    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl reviewedAt createdAt readingTime userId seo')
      .populate('userId', 'name username email profileImage')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean(); // Use lean() for better performance

    const total = await Submission.countDocuments(query);

    return {
      submissions: submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        submissionType: sub.submissionType,
        excerpt: sub.excerpt,
        imageUrl: sub.imageUrl,
        publishedAt: sub.reviewedAt || sub.createdAt,
        readingTime: sub.readingTime,
        slug: sub.seo?.slug,
        seo: sub.seo,
        author: {
          _id: sub.userId._id,
          name: sub.userId.name,
          username: sub.userId.username,
          profileImage: sub.userId.profileImage
        }
      })),
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total,
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  }

  static async getSubmissionWithContent(id) {
    const submission = await Submission.findById(id)
      .populate('userId', 'name username email profileImage')
      .populate('reviewedBy', 'username');

    if (!submission) {
      throw new Error('Submission not found');
    }

    // Use the helper method to manually populate contentIds
    const populatedSubmission = await Submission.populateContentIds(submission);
    
    // Rename contentIds to contents for frontend compatibility
    if (populatedSubmission.contentIds) {
      populatedSubmission.contents = populatedSubmission.contentIds;
      delete populatedSubmission.contentIds;
    }

    return populatedSubmission;
  }

  static async getPublishedSubmissionDetails(id) {
    const submission = await Submission.findOne({ 
      _id: id, 
      status: 'published' 
    })
      .populate('userId', 'name username email profileImage');

    if (!submission) {
      throw new Error('Published submission not found');
    }

    // Use the helper method to manually populate contentIds
    const populatedSubmission = await Submission.populateContentIds(submission);

    return {
      _id: populatedSubmission._id,
      title: populatedSubmission.title,
      description: populatedSubmission.description,
      submissionType: populatedSubmission.submissionType,
      authorName: populatedSubmission.userId.username,
      authorId: populatedSubmission.userId._id,
      publishedAt: populatedSubmission.reviewedAt || populatedSubmission.createdAt,
      readingTime: populatedSubmission.readingTime,
      imageUrl: populatedSubmission.imageUrl,
      excerpt: populatedSubmission.excerpt,
      contents: populatedSubmission.contentIds,
      createdAt: populatedSubmission.createdAt
    };
  }

  static async updateSubmissionStatus(id, status, reviewerId) {
    const submission = await Submission.findById(id);
    if (!submission) {
      throw new Error('Submission not found');
    }

    submission.status = status;

    if (status === SUBMISSION_STATUS.PUBLISHED || status === SUBMISSION_STATUS.ACCEPTED) {
      submission.reviewedAt = new Date();
      submission.reviewedBy = reviewerId;
    }

    return await submission.save();
  }

  static async reviewSubmission(id, reviewData) {
    const submission = await Submission.findById(id);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Allow reviewing submissions in various states for different actions
    const allowedStatuses = [...STATUS_ARRAYS.REVIEWABLE_STATUSES];
    if (reviewData.status === SUBMISSION_STATUS.NEEDS_REVISION) {
      // For revision requests, allow needs_revision status as well (in case of re-review)
      allowedStatuses.push(SUBMISSION_STATUS.NEEDS_REVISION);
    }
    
    if (!allowedStatuses.includes(submission.status)) {
      throw new Error(`Only submissions with status ${allowedStatuses.join(', ')} can be reviewed`);
    }

    // Create review record
    const review = new Review({
      submissionId: id,
      reviewerId: reviewData.reviewerId,
      status: reviewData.status,
      reviewNotes: reviewData.reviewNotes || '',
      rating: reviewData.rating
    });

    await review.save();

    // Update only review-related fields, not status (let route handle status with history)
    submission.reviewedAt = new Date();
    submission.reviewedBy = reviewData.reviewerId;
    await submission.save();

    return { submission, review };
  }

  static async getFeaturedSubmissions(filters = {}) {
    const { type, limit = 10 } = filters;
    
    const query = { status: 'published', isFeatured: true };
    if (type) query.submissionType = type;

    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl reviewedAt createdAt readingTime userId')
      .populate('userId', 'name username email profileImage')
      .sort({ reviewedAt: -1 })
      .limit(parseInt(limit))
      .lean(); // Use lean() for better performance

    return submissions.map(sub => ({
      _id: sub._id,
      title: sub.title,
      submissionType: sub.submissionType,
      excerpt: sub.excerpt,
      imageUrl: sub.imageUrl,
      publishedAt: sub.reviewedAt || sub.createdAt,
      readingTime: sub.readingTime,
      author: {
        _id: sub.userId._id,
        username: sub.userId.username,
        profileImage: sub.userId.profileImage
      }
    }));
  }

  static async getSubmissionTypes() {
    const pipeline = [
      { $match: { status: 'published' } },
      {
        $group: {
          _id: '$submissionType',
          count: { $sum: 1 },
          latestSubmission: { $max: '$reviewedAt' }
        }
      },
      { $sort: { count: -1 } }
    ];

    const types = await Submission.aggregate(pipeline);
    
    return types.map(type => ({
      name: type._id,
      count: type.count,
      latestSubmission: type.latestSubmission
    }));
  }

  // Add efficient submission stats aggregation
  static async getSubmissionStats() {
    const pipeline = [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgReadingTime: { $avg: '$readingTime' }
        }
      }
    ];

    const stats = await Submission.aggregate(pipeline);
    
    // Transform to more usable format
    const result = {
      pending_review: 0,
      accepted: 0,
      published: 0,
      rejected: 0,
      avgReadingTime: 0
    };

    stats.forEach(stat => {
      result[stat._id] = stat.count;
      if (stat._id === 'published') {
        result.avgReadingTime = Math.round(stat.avgReadingTime);
      }
    });

    return result;
  }

  static async searchSubmissions(searchQuery, options = {}) {
    const { limit = 10, skip = 0, sortBy = 'createdAt', order = 'desc' } = options;
    
    const query = {
      status: 'published',
      $or: [
        { title: { $regex: searchQuery, $options: 'i' } },
        { description: { $regex: searchQuery, $options: 'i' } }
      ]
    };

    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl reviewedAt createdAt readingTime userId')
      .populate('userId', 'name username email profileImage')
      .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip))
      .lean(); // Use lean() for better performance

    const total = await Submission.countDocuments(query);

    return {
      submissions: submissions.map(sub => ({
        _id: sub._id,
        title: sub.title,
        submissionType: sub.submissionType,
        excerpt: sub.excerpt,
        imageUrl: sub.imageUrl,
        publishedAt: sub.reviewedAt || sub.createdAt,
        readingTime: sub.readingTime,
        slug: sub.seo?.slug,
        seo: sub.seo,
        author: {
          _id: sub.userId._id,
          name: sub.userId.name,
          username: sub.userId.username,
          profileImage: sub.userId.profileImage
        }
      })),
      total,
      pagination: {
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + parseInt(limit)) < total,
        currentPage: Math.floor(parseInt(skip) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    };
  }

  static async deleteSubmission(id) {
    const submission = await Submission.findById(id);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Delete associated content
    if (submission.contentIds && submission.contentIds.length > 0) {
      await Content.deleteMany({ _id: { $in: submission.contentIds } });
    }

    // Delete associated reviews
    await Review.deleteMany({ submissionId: id });

    // Delete submission
    await Submission.findByIdAndDelete(id);

    return {
      message: 'Submission and associated content deleted successfully',
      contentDeleted: submission.contentIds ? submission.contentIds.length : 0
    };
  }

  static async createSubmissionWithProfile(submissionData, profileImage) {
    const { userId, authorId, title, description, submissionType, contents, profileData } = submissionData;
    
    // Handle both userId and authorId (frontend compatibility)
    const actualUserId = userId || authorId;

    // Verify user exists
    const user = await User.findById(actualUserId);
    if (!user) {
      throw new Error('User not found');
    }

    // Update user with temporary profile data
    if (profileData && profileData.isFirstTimeSubmission) {
      const updateData = {
        tempBio: profileData.tempBio || ''
      };

      // If profile image was uploaded, add it to temp field
      if (profileImage) {
        updateData.tempProfileImage = `/uploads/${profileImage.filename}`;
      }

      await User.findByIdAndUpdate(actualUserId, updateData);
    }

    // Create content items
    const contentDocs = contents.map(content => ({
      ...content,
      userId: actualUserId,
      type: content.type || submissionType
    }));

    const createdContents = await Content.create(contentDocs);
    
    // Calculate reading time and excerpt
    const readingTime = Submission.calculateReadingTime(createdContents);
    const excerpt = Submission.generateExcerpt(createdContents);

    // Create submission
    const submission = new Submission({
      userId: actualUserId,
      title,
      description,
      contentIds: createdContents.map(c => c._id),
      submissionType,
      readingTime,
      excerpt
    });

    return await submission.save();
  }

  static async getUserSubmissions(userId) {
    const submissions = await Submission.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    // Manually populate contentIds for each submission
    const populatedSubmissions = await Promise.all(
      submissions.map(async (submission) => {
        if (submission.contentIds && submission.contentIds.length > 0) {
          // Use direct MongoDB query with string IDs
          const contents = await Submission.db.collection('contents').find({
            _id: { $in: submission.contentIds }
          }).toArray();
          
          // Create a map for fast lookup and preserve order
          const contentMap = new Map(contents.map(content => [content._id, content]));
          const sortedContents = submission.contentIds
            .map(id => contentMap.get(id))
            .filter(Boolean);
          
          submission.contentIds = sortedContents;
        }
        return submission;
      })
    );

    // Transform for frontend
    return populatedSubmissions.map(submission => ({
      _id: submission._id,
      title: submission.title,
      submissionType: submission.submissionType,
      status: submission.status,
      submittedAt: submission.createdAt,
      reviewedAt: submission.reviewedAt,
      publishedWorkId: submission.status === 'published' ? submission._id : null,
      excerpt: submission.excerpt,
      content: submission.contentIds?.[0]?.body || '',
      reviewFeedback: submission.reviewNotes || '',
      revisionNotes: submission.revisionNotes || '', // Add revision notes for needs_revision status
      wordCount: submission.contentIds?.reduce((total, content) => {
        if (!content.body) return total;
        return total + content.body.trim().split(/\s+/).filter(word => word.length > 0).length;
      }, 0) || 0,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    }));
  }

  // SEO-related methods
  static async publishWithSEO(id, seoData, publisherId) {
    const submission = await Submission.findById(id).populate('userId', 'username');
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Generate slug if not provided
    if (!seoData.slug) {
      seoData.slug = Submission.generateSlug(submission.title, submission.userId.username);
    }

    // Ensure slug is unique
    let uniqueSlug = seoData.slug;
    let counter = 1;
    while (await Submission.findOne({ 'seo.slug': uniqueSlug })) {
      uniqueSlug = `${seoData.slug}-${counter}`;
      counter++;
    }

    // Update submission with SEO data and publish
    const updateData = {
      status: 'published',
      reviewedAt: new Date(),
      reviewedBy: publisherId,
      seo: {
        slug: uniqueSlug,
        metaTitle: seoData.metaTitle || submission.title,
        metaDescription: seoData.metaDescription || submission.excerpt,
        keywords: seoData.keywords || [],
        ogImage: seoData.ogImage || submission.imageUrl,
        canonical: seoData.canonical,
      }
    };

    const updatedSubmission = await Submission.findByIdAndUpdate(id, updateData, { new: true });
    return updatedSubmission;
  }

  static async getBySlug(slug) {
    const submission = await Submission.findBySlug(slug);
    if (!submission) {
      throw new Error('Published submission not found');
    }
    
    // Debug content structure
    if (submission.contentIds && submission.contentIds.length > 0) {
      console.log('🔍 Service debug - First content keys:', Object.keys(submission.contentIds[0]));
      console.log('🔍 Service debug - Title:', submission.contentIds[0].title);
      console.log('🔍 Service debug - Body length:', submission.contentIds[0].body?.length || 0);
    }

    // Helper function to convert UUID tags to readable names using centralized utility
    const convertTagsToNames = (tags) => {
      return mapTagArray(tags);
    };

    // Clean and minimal response
    return {
      _id: submission._id,
      title: submission.title,
      description: submission.description,
      submissionType: submission.submissionType,
      authorName: submission.userId.name || submission.userId.username,
      authorId: submission.userId._id,
      publishedAt: submission.publishedAt || submission.reviewedAt || submission.createdAt,
      readingTime: submission.readingTime,
      imageUrl: submission.imageUrl,
      excerpt: submission.excerpt,
      contents: (submission.contentIds || []).map(content => ({
        _id: content._id,
        title: content.title,
        body: content.body,
        type: submission.submissionType, // Use submission type since content no longer has type
        tags: convertTagsToNames(content.tags || []),
        footnotes: content.footnotes || '',
        seo: content.seo || {},
        viewCount: content.viewCount || 0,
        isFeatured: content.isFeatured || false,
        createdAt: content.createdAt
      })),
      tags: convertTagsToNames(submission.tags || []),
      viewCount: submission.viewCount || 0
    };
  }
  

  static async updateSEO(id, seoData) {
    const submission = await Submission.findById(id);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // If slug is being changed, ensure it's unique
    if (seoData.slug && seoData.slug !== submission.seo?.slug) {
      const existingSlug = await Submission.findOne({ 'seo.slug': seoData.slug });
      if (existingSlug && existingSlug._id.toString() !== id) {
        throw new Error('Slug already exists');
      }
    }

    const updateData = { seo: { ...submission.seo, ...seoData } };
    return await Submission.findByIdAndUpdate(id, updateData, { new: true });
  }
}

module.exports = SubmissionService;