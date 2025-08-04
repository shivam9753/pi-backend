const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');
const User = require('../models/User');

class SubmissionService {
  static async createSubmission(submissionData) {
    const { userId, authorId, title, description, submissionType, contents, profileData } = submissionData;
    
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

    // Extract unique tags
    const allTags = createdContents.reduce((tags, content) => {
      if (content.tags && Array.isArray(content.tags)) {
        return [...tags, ...content.tags];
      }
      return tags;
    }, []);
    const uniqueTags = [...new Set(allTags)];

    // Create submission
    const submission = new Submission({
      userId: actualUserId,
      title,
      description,
      contentIds: createdContents.map(c => c._id),
      submissionType,
      readingTime,
      excerpt,
      tags: uniqueTags
    });

    return await submission.save();
  }

  static async getAcceptedSubmissions(filters = {}) {
    const { type, limit = 20, skip = 0, sortBy = 'reviewedAt', order = 'desc' } = filters;
    
    const query = { status: 'accepted' };
    if (type) query.submissionType = type;

    // Use .select() to only fetch required fields - exclude large fields like description
    const submissions = await Submission.find(query)
      .select('title excerpt imageUrl readingTime reviewedAt submissionType tags userId reviewedBy')
      .populate('userId', 'username')
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
      submitterName: sub.userId?.username || 'Unknown',
      reviewerName: sub.reviewedBy?.username || 'Unknown'
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
    
    const query = { status: 'published' };
    if (type) query.submissionType = type;

    // Use .select() to exclude large fields like description and contentIds for listing
    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime tags userId')
      .populate('userId', 'username email profileImage')
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
        viewCount: sub.viewCount,
        likeCount: sub.likeCount,
        readingTime: sub.readingTime,
        tags: sub.tags,
        author: {
          _id: sub.userId._id,
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
      .populate('userId', 'username email profileImage')
      .populate('contentIds')
      .populate('reviewedBy', 'username');

    if (!submission) {
      throw new Error('Submission not found');
    }

    // Transform the response to match frontend expectations
    const submissionObj = submission.toObject();
    
    // Rename contentIds to contents for frontend compatibility
    if (submissionObj.contentIds) {
      submissionObj.contents = submissionObj.contentIds;
      delete submissionObj.contentIds;
    }

    console.log('Returning submission with contents:', submissionObj.contents?.length || 0, 'items');
    return submissionObj;
  }

  static async getPublishedSubmissionDetails(id) {
    const submission = await Submission.findOne({ 
      _id: id, 
      status: 'published' 
    })
      .populate('userId', 'username email profileImage')
      .populate('contentIds');

    if (!submission) {
      throw new Error('Published submission not found');
    }

    // Increment view count
    await submission.incrementViews();

    return {
      _id: submission._id,
      title: submission.title,
      description: submission.description,
      submissionType: submission.submissionType,
      authorName: submission.userId.username,
      authorId: submission.userId._id,
      publishedAt: submission.reviewedAt || submission.createdAt,
      readingTime: submission.readingTime,
      viewCount: submission.viewCount + 1,
      commentCount: submission.commentCount,
      likeCount: submission.likeCount,
      tags: submission.tags,
      imageUrl: submission.imageUrl,
      excerpt: submission.excerpt,
      contents: submission.contentIds,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    };
  }

  static async updateSubmissionStatus(id, status, reviewerId) {
    const submission = await Submission.findById(id);
    if (!submission) {
      throw new Error('Submission not found');
    }

    submission.status = status;
    submission.updatedAt = new Date();

    if (status === 'published' || status === 'accepted') {
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

    if (submission.status !== 'pending_review') {
      throw new Error('Only pending submissions can be reviewed');
    }

    // Create review record
    const review = new Review({
      submissionId: id,
      reviewerId: reviewData.reviewerId,
      reviewerName: reviewData.reviewerName,
      status: reviewData.status,
      reviewNotes: reviewData.reviewNotes || '',
      rating: reviewData.rating
    });

    await review.save();

    // Update submission
    submission.status = reviewData.status;
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
      .select('title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime tags userId')
      .populate('userId', 'username email profileImage')
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
      viewCount: sub.viewCount,
      likeCount: sub.likeCount,
      readingTime: sub.readingTime,
      tags: sub.tags,
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
          latestSubmission: { $max: '$reviewedAt' },
          totalViews: { $sum: '$viewCount' },
          totalLikes: { $sum: '$likeCount' }
        }
      },
      { $sort: { count: -1 } }
    ];

    const types = await Submission.aggregate(pipeline);
    
    return types.map(type => ({
      name: type._id,
      count: type.count,
      latestSubmission: type.latestSubmission,
      totalViews: type.totalViews,
      totalLikes: type.totalLikes
    }));
  }

  // Add efficient submission stats aggregation
  static async getSubmissionStats() {
    const pipeline = [
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          totalLikes: { $sum: '$likeCount' },
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
      totalViews: 0,
      totalLikes: 0,
      avgReadingTime: 0
    };

    stats.forEach(stat => {
      result[stat._id] = stat.count;
      if (stat._id === 'published') {
        result.totalViews = stat.totalViews;
        result.totalLikes = stat.totalLikes;
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
        { description: { $regex: searchQuery, $options: 'i' } },
        { tags: { $in: [new RegExp(searchQuery, 'i')] } }
      ]
    };

    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl reviewedAt createdAt viewCount likeCount readingTime tags userId')
      .populate('userId', 'username email profileImage')
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
        viewCount: sub.viewCount,
        likeCount: sub.likeCount,
        readingTime: sub.readingTime,
        tags: sub.tags,
        author: {
          _id: sub.userId._id,
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

    // Extract unique tags
    const allTags = createdContents.reduce((tags, content) => {
      if (content.tags && Array.isArray(content.tags)) {
        return [...tags, ...content.tags];
      }
      return tags;
    }, []);
    const uniqueTags = [...new Set(allTags)];

    // Create submission
    const submission = new Submission({
      userId: actualUserId,
      title,
      description,
      contentIds: createdContents.map(c => c._id),
      submissionType,
      readingTime,
      excerpt,
      tags: uniqueTags
    });

    return await submission.save();
  }

  static async getUserSubmissions(userId) {
    const submissions = await Submission.find({ userId })
      .populate('contentIds')
      .sort({ createdAt: -1 })
      .lean();

    // Transform for frontend
    return submissions.map(submission => ({
      _id: submission._id,
      title: submission.title,
      submissionType: submission.submissionType,
      status: submission.status,
      submittedAt: submission.createdAt,
      reviewedAt: submission.updatedAt,
      publishedWorkId: submission.status === 'published' ? submission._id : null,
      excerpt: submission.excerpt,
      content: submission.contentIds?.[0]?.body || '',
      tags: submission.tags || [],
      reviewFeedback: submission.reviewNotes || '',
      wordCount: submission.contentIds?.reduce((total, content) => total + (content.wordCount || 0), 0) || 0
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
        keywords: seoData.keywords || submission.tags,
        ogImage: seoData.ogImage || submission.imageUrl,
        canonical: seoData.canonical,
        publishSettings: {
          allowComments: seoData.allowComments !== false,
          enableSocialSharing: seoData.enableSocialSharing !== false,
          featuredOnHomepage: seoData.featuredOnHomepage === true
        }
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

    // Increment view count
    await submission.incrementViews();

    return {
      _id: submission._id,
      title: submission.title,
      description: submission.description,
      submissionType: submission.submissionType,
      authorName: submission.userId.username,
      authorId: submission.userId._id,
      publishedAt: submission.reviewedAt || submission.createdAt,
      readingTime: submission.readingTime,
      viewCount: submission.viewCount + 1,
      likeCount: submission.likeCount,
      tags: submission.tags,
      imageUrl: submission.imageUrl,
      excerpt: submission.excerpt,
      contents: submission.contentIds,
      seo: submission.seo,
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
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