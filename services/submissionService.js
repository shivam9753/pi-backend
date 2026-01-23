const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Review = require('../models/Review');
const User = require('../models/User');
const mongoose = require('mongoose');
const Tag = require('../models/Tag');
const { 
  SUBMISSION_STATUS, 
  STATUS_ARRAYS,
  STATUS_UTILS 
} = require('../constants/status.constants');
const { mapTagArray } = require('../utils/tagMapping');
const tagService = require('./tagService');

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
    // Ensure we do NOT persist any tag data coming from the client at submission creation time.
    // Tags will be created/associated only during content publish flows.
    const contentDocs = contents.map(content => ({
      title: content.title,
      body: content.body,
      type: content.type || submissionType,
      userId: actualUserId,
      submissionId: savedSubmission._id,
      footnotes: content.footnotes || '',
      tags: [], // explicitly empty to avoid persisting client-sent tags
      seo: content.seo || {}
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
      // Note: Submission-level tags are no longer stored. To get tags, call getSubmissionWithContent or published details.
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
          id: sub.userId._id,
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

    // Ensure tag objects ( {_id, name, slug} ) are present everywhere
    await SubmissionService._ensureTagObjects(populatedSubmission);

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

    // Ensure tag objects ( {_id, name, slug} ) are present
    await SubmissionService._ensureTagObjects(populatedSubmission);

    return {
      _id: populatedSubmission._id,
      title: populatedSubmission.title,
      description: populatedSubmission.description,
      submissionType: populatedSubmission.submissionType,
      author: {
        _id: populatedSubmission.userId._id,
        id: populatedSubmission.userId._id,
        name: populatedSubmission.userId.name,
        username: populatedSubmission.userId.username
      },
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

    // Update author's ATS (Author Trust Score) for specific review outcomes
    // This update happens in the same request as the review action and is defensive
    try {
      const authorId = submission.userId;
      if (authorId) {
        const author = await User.findById(authorId);
        if (author) {
          let delta = 0;

          if (reviewData.status === SUBMISSION_STATUS.ACCEPTED) delta = 6;
          else if (reviewData.status === SUBMISSION_STATUS.NEEDS_REVISION) delta = 1;
          else if (reviewData.status === SUBMISSION_STATUS.REJECTED) delta = -4;

          if (delta !== 0) {
            const currentATS = (typeof author.ats === 'number') ? author.ats : 50;
            let newATS = currentATS + delta;
            newATS = Math.max(0, Math.min(100, newATS));
            author.ats = newATS;
            await author.save();
          }
        }
      }
    } catch (atsError) {
      // Do not block the review flow if ATS update fails; log and continue
      console.warn('Failed to update author ATS:', atsError);
    }

    return { submission, review };
  }

  static async getFeaturedSubmissions(filters = {}) {
    const { type, limit = 10 } = filters;

    const query = { status: 'published', isFeatured: true };
    if (type) query.submissionType = type;

    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl reviewedAt createdAt readingTime userId contentIds')
      .populate('userId', 'name username email profileImage')
      .sort({ reviewedAt: -1 })
      .limit(parseInt(limit))
      .lean(); // Use lean() for better performance

    return submissions.map(sub => ({
      _id: sub._id,
      contentId: sub.contentIds && sub.contentIds.length > 0 ? sub.contentIds[0] : sub._id,
      title: sub.title,
      submissionType: sub.submissionType,
      excerpt: sub.excerpt,
      imageUrl: sub.imageUrl,
      publishedAt: sub.reviewedAt || sub.createdAt,
      readingTime: sub.readingTime,
      author: {
        _id: sub.userId._id,
        name: sub.userId.name,
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
          id: sub.userId._id,
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
    console.log('🔍 getUserSubmissions called with userId:', userId);
    const submissions = await Submission.find({ userId })
      .sort({ createdAt: -1 })
      .lean();
    console.log('🔍 Found submissions count:', submissions.length);
    console.log('🔍 Submissions IDs:', submissions.map(s => s._id));

    // Transform for frontend - only metadata, no content
    return submissions.map(submission => ({
      _id: submission._id,
      title: submission.title,
      submissionType: submission.submissionType,
      status: submission.status,
      submittedAt: submission.createdAt,
      reviewedAt: submission.reviewedAt,
      publishedWorkId: submission.status === 'published' ? submission._id : null,
      excerpt: submission.excerpt,
      // Submission-level tags removed. Use getSubmissionWithContent or getBySlug to retrieve aggregated tags.
      
      // Don't include content body - only metadata for cards
      reviewFeedback: submission.reviewNotes || '',
      revisionNotes: submission.revisionNotes || '', // Add revision notes for needs_revision status
      wordCount: submission.wordCount || 0, // Use stored wordCount instead of calculating from content
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt
    }));
  }

  // SEO-related methods
  static async publishWithSEO(id, seoData, publisherId) {
    // Wrap the publish flow in a transaction to ensure atomic updates
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      // Reload submission in transaction
      const submission = await Submission.findById(id).populate('userId', 'username').session(session);
      if (!submission) throw new Error('Submission not found');

      // Accept either a nested submissionMeta object or legacy flat seoData fields.
      const submissionMeta = seoData && seoData.submissionMeta && typeof seoData.submissionMeta === 'object'
        ? { ...seoData.submissionMeta }
        : { ...(seoData || {}) };

      // Backwards compatibility: allow top-level primaryKeyword to be honored
      if (!submissionMeta.primaryKeyword && seoData && seoData.primaryKeyword) {
        submissionMeta.primaryKeyword = String(seoData.primaryKeyword).trim();
      }

      // Remove unsupported flags
      if ('featuredPost' in submissionMeta) delete submissionMeta.featuredPost;

      // Generate slug if not provided
      if (!submissionMeta.slug) {
        submissionMeta.slug = Submission.generateSlug(submission.title, submission.userId.username);
      }

      // Ensure slug is unique (exclude current submission)
      let uniqueSlug = submissionMeta.slug;
      let counter = 1;
      while (await Submission.findOne({ 'seo.slug': uniqueSlug, _id: { $ne: id } }).session(session)) {
        uniqueSlug = `${submissionMeta.slug}-${counter}`;
        counter++;
      }

      // Build the update data including title/description/excerpt persistence
      const updateData = {
        title: seoData && seoData.title !== undefined ? seoData.title : submission.title,
        description: seoData && seoData.description !== undefined ? seoData.description : submission.description,
        excerpt: seoData && seoData.excerpt !== undefined ? seoData.excerpt : submission.excerpt,
        status: 'published',
        reviewedAt: new Date(),
        reviewedBy: publisherId,
        seo: {
          slug: uniqueSlug,
          metaTitle: submissionMeta.metaTitle || submission.title,
          metaDescription: submissionMeta.metaDescription || submission.excerpt,
          // Primary submission-level SEO keyword (editor-provided or default to submission title)
          primaryKeyword: (submissionMeta && submissionMeta.primaryKeyword) ? String(submissionMeta.primaryKeyword).trim() : (submission.title || ''),
          ogImage: submissionMeta.ogImage || submission.imageUrl,
          canonical: submissionMeta.canonical
        }
      };

      if (submission.imageUrl) updateData.imageUrl = submission.imageUrl;

      // Fetch contents in transaction
      const contents = await Content.find({ submissionId: id }).session(session);

      // Build per-content tag names and collect provided tag ids from UI if any
      const perContentTagNames = new Map();
      const perContentProvidedTagIds = new Map();
      const allNamesSet = new Set();
      const providedPerContentTags = seoData && seoData.perContentTags ? seoData.perContentTags : null;

      for (const c of contents) {
        const cid = String(c._id);
        let names = [];
        const provided = providedPerContentTags && providedPerContentTags[cid] ? providedPerContentTags[cid] : null;

        if (provided && Array.isArray(provided)) {
          // Separate provided ids and names. Accept existing tag ids (UUID or 24 hex) or names
          const ids = [];
          for (const item of provided) {
            if (!item) continue;
            // Support object form { _id } or { id }
            if (typeof item === 'object' && (item._id || item.id)) {
              const idVal = String(item._id || item.id).trim();
              if (idVal) ids.push(idVal);
              continue;
            }

            const s = String(item).trim();
            const isHex24 = /^[0-9a-fA-F]{24}$/.test(s);
            const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(s);
            if (isHex24 || isUuid) ids.push(s);
            else names.push(s);
          }
          if (ids.length > 0) perContentProvidedTagIds.set(cid, ids);
        } else if (Array.isArray(c.tags) && c.tags.length > 0) {
          const stringTags = c.tags.filter(t => typeof t === 'string');
          names = mapTagArray(stringTags);
        }

        perContentTagNames.set(cid, names);
        names.forEach(n => allNamesSet.add(n));
      }

      const allNames = Array.from(allNamesSet);

      // Resolve Tag documents directly here so we can include tag creation in the transaction.
      const TagModel = mongoose.model('Tag');
      const tagNameToId = new Map();

      if (allNames.length > 0) {
        const existing = await TagModel.find({ name: { $in: allNames } }).session(session);
        existing.forEach(t => tagNameToId.set(t.name, String(t._id)));

        const missing = allNames.filter(n => !tagNameToId.has(n));
        if (missing.length > 0) {
          try {
            const created = await TagModel.insertMany(missing.map(name => ({ name })), { session, ordered: false });
            created.forEach(t => tagNameToId.set(t.name, String(t._id)));
          } catch (err) {
            // handle duplicate key race by reconciling
            if (err && (err.code === 11000 || (err.writeErrors && err.writeErrors.some(e => e.code === 11000)))) {
              const reconciled = await TagModel.find({ name: { $in: allNames } }).session(session);
              reconciled.forEach(t => tagNameToId.set(t.name, String(t._id)));
            } else {
              throw err;
            }
          }
        }
      }

      // Build Content bulk ops using both provided tag ids and created/found tag ids
      const contentBulkOps = [];
      // Helper: return an id string when input is valid (ObjectId, UUID, or non-empty string), otherwise null
      const toHexIdSafe = (v) => {
        if (!v && v !== 0) return null;
        if (v instanceof mongoose.Types.ObjectId) return String(v);
        const s = String(v).trim();
        if (s.length === 0) return null;
        return s;
      };
       for (const c of contents) {
         const cid = String(c._id);
         const names = perContentTagNames.get(cid) || [];
         const nameIds = names.map(n => tagNameToId.get(n)).filter(Boolean);
         const providedIds = perContentProvidedTagIds.get(cid) || [];

         // Normalize to id string safely
         const combinedSet = new Set();
         for (const pid of providedIds) {
           const hex = toHexIdSafe(pid);
           if (hex) combinedSet.add(hex);
         }
         for (const nid of nameIds) {
           const hex = toHexIdSafe(nid);
           if (hex) combinedSet.add(hex);
         }
         const combined = Array.from(combinedSet); // array of id strings (UUIDs or hex)

         contentBulkOps.push({
           updateOne: {
             filter: { _id: c._id },
             update: { $set: { tags: combined } }
           }
         });
       }

       if (contentBulkOps.length > 0) {
         await Content.bulkWrite(contentBulkOps, { session });
       }

      // Persist per-content SEO (primaryKeyword, metaTitle, metaDescription)
      const perContentMeta = seoData && seoData.perContentMeta ? seoData.perContentMeta : null;
      const seoBulkOps = [];
      for (const c of contents) {
        const cid = String(c._id);
        const metaFromFront = perContentMeta && perContentMeta[cid] ? perContentMeta[cid] : {};
        const keywordCandidate = metaFromFront && metaFromFront.primaryKeyword ? metaFromFront.primaryKeyword : null;
        const keyword = (keywordCandidate && String(keywordCandidate).trim()) ? String(keywordCandidate).trim() : ((c.seo && c.seo.keyword) ? c.seo.keyword : (c.title || ''));
        const metaTitle = (metaFromFront && metaFromFront.metaTitle && String(metaFromFront.metaTitle).trim()) ? String(metaFromFront.metaTitle).trim() : ((c.seo && c.seo.metaTitle) ? c.seo.metaTitle : (c.title || ''));
        const metaDescription = (metaFromFront && metaFromFront.metaDescription && String(metaFromFront.metaDescription).trim()) ? String(metaFromFront.metaDescription).trim() : ((c.seo && c.seo.metaDescription) ? c.seo.metaDescription : (c.title || ''));

        seoBulkOps.push({
          updateOne: {
            filter: { _id: c._id },
            update: { $set: { 'seo.keyword': keyword, 'seo.metaTitle': metaTitle, 'seo.metaDescription': metaDescription } }
          }
        });
      }

      if (seoBulkOps.length > 0) {
        await Content.bulkWrite(seoBulkOps, { session });
      }

      // Update submission within transaction
      const updatedSubmission = await Submission.findByIdAndUpdate(id, updateData, { new: true, session });

      await session.commitTransaction();
      session.endSession();

      const populated = await Submission.findById(updatedSubmission._id)
        .populate('userId', 'name username email profileImage');

      return await Submission.populateContentIds(populated);
    } catch (err) {
      try { await session.abortTransaction(); } catch (e) { /* noop */ }
      session.endSession();
      throw err;
    }
   }

  static async getBySlug(slug) {
    // Use model helper to find published submission by slug and populate content/tags
    const submission = await Submission.findBySlug(slug);
    if (!submission) {
      throw new Error('Published submission not found');
    }

    // Ensure we have a plain object we can safely mutate
    let populated;
    try {
      populated = await Submission.populateContentIds(submission);
    } catch (err) {
      console.warn('populateContentIds failed in getBySlug:', err && (err.message || err));
      populated = submission && submission.toObject ? submission.toObject() : { ...submission };
    }

    // If contentIds exists but contains ID values (not full content objects), try to load the actual content docs
    try {
      const hasContentObjects = Array.isArray(populated.contentIds) && populated.contentIds.length > 0 && typeof populated.contentIds[0] === 'object' && ('body' in populated.contentIds[0] || 'title' in populated.contentIds[0]);

      if (!hasContentObjects) {
        let foundContents = [];

        // If there is a contentIds array (likely IDs), try to fetch those documents first
        if (Array.isArray(populated.contentIds) && populated.contentIds.length > 0) {
          try {
            foundContents = await Content.find({ _id: { $in: populated.contentIds } }).lean();
          } catch (e) {
            // ignore and try other fallbacks
            console.warn('Failed to find contents by _id list in getBySlug:', e && (e.message || e));
          }
        }

        // If still nothing, try querying by submissionId with multiple type/field fallbacks
        if (!foundContents || foundContents.length === 0) {
          const orClauses = [
            { submissionId: populated._id },
            { submission_id: populated._id },
            { submission: populated._id }
          ];

          // If submission._id looks like an ObjectId, include ObjectId variants
          if (typeof populated._id === 'string' && mongoose.Types.ObjectId.isValid(populated._id)) {
            try {
              const oid = mongoose.Types.ObjectId(populated._id);
              orClauses.push({ submissionId: oid }, { submission_id: oid }, { submission: oid });
            } catch (convErr) {
              // ignore conversion errors
            }
          }

          try {
            foundContents = await Content.find({ $or: orClauses }).lean();
          } catch (e) {
            console.warn('Fallback Content.find by submissionId failed in getBySlug:', e && (e.message || e));
          }
        }

        if (foundContents && foundContents.length > 0) {
          populated.contentIds = foundContents;
        }
      }
    } catch (e) {
      console.warn('Error while resolving contents in getBySlug fallback:', e && (e.message || e));
    }

    // Normalize shape for public reading interface: rename contentIds -> contents
    if (populated.contentIds) {
      populated.contents = populated.contentIds;
      delete populated.contentIds;
    }

    // Populate tag documents for contents so frontend gets name & slug
    try {
      if (Array.isArray(populated.contents)) {
        const allTagIds = new Set();
        populated.contents.forEach(c => {
          if (Array.isArray(c.tags)) c.tags.forEach(t => { if (t) allTagIds.add(String(t)); });
        });

        let tagDocs = [];
        if (allTagIds.size > 0) {
          const tagIds = Array.from(allTagIds);
          try {
            tagDocs = await Tag.find({ _id: { $in: tagIds } }).select('_id name slug').lean();
          } catch (e) {
            // non-fatal - we'll synthesize tag objects below
            console.warn('Warning: failed to load Tag docs:', e && (e.message || e));
          }
        }

        // Helper to create a safe slug when missing
        const makeSlug = (s) => {
          if (!s) return '';
          return String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
        };

        const tagMap = new Map(tagDocs.map(t => [String(t._id), { _id: String(t._id), name: t.name || '', slug: t.slug || makeSlug(t.name || t._id) }]));

        // Replace each content's tags with a stable object: { _id|null, name, slug }
        populated.contents = populated.contents.map(c => {
          const mappedTags = Array.isArray(c.tags)
            ? c.tags.map(raw => {
                // If tag is an object (may already be a doc), prefer its _id
                if (raw && typeof raw === 'object') {
                  const id = raw._id ? String(raw._id) : (raw.id ? String(raw.id) : null);
                  const name = raw.name || raw.label || raw.tag || (id ? id : '');
                  if (id && tagMap.has(id)) return tagMap.get(id);
                  return { _id: id || null, name, slug: raw.slug || makeSlug(name || id) };
                }

                // Otherwise treat raw as either an id string or a plain name
                const rawStr = String(raw);
                if (tagMap.has(rawStr)) return tagMap.get(rawStr);

                // No Tag doc found - treat as display name and synthesize slug
                return { _id: null, name: rawStr, slug: makeSlug(rawStr) };
              }).filter(Boolean)
            : [];

          return { ...c, tags: mappedTags };
        });
      }
    } catch (err) {
      console.warn('Failed to populate tag docs in getBySlug:', err && (err.message || err));
    }

    // Ensure content tags are objects with name and slug for frontend
    // (This normalization is idempotent given the mapping above)
    if (Array.isArray(populated.contents)) {
      populated.contents = populated.contents.map(c => {
        const tagObjs = Array.isArray(c.tags)
          ? c.tags.map(t => ({ _id: t && t._id ? t._id : null, name: t && t.name ? t.name : (t && t.slug ? t.slug.replace(/-/g, ' ') : ''), slug: t && t.slug ? t.slug : (t && t.name ? String(t.name).trim().toLowerCase().replace(/\s+/g, '-') : '') })).filter(Boolean)
          : [];
        return {
          ...c,
          tags: tagObjs
        };
      });
    }

    // Also expose top-level submission.tags as array of tag objects ({ _id, name, slug }) so frontend doesn't need to resolve names
    if (Array.isArray(populated.tags)) {
      const makeSlug = (s) => {
        if (!s) return '';
        return String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
      };

      populated.tags = populated.tags.map(t => {
        if (!t) return null;
        if (typeof t === 'string') {
          return { _id: null, name: t, slug: makeSlug(t) };
        }
        if (typeof t === 'object') {
          const name = t.name || t.tag || t.label || '';
          const id = t._id || t.id || null;
          return { _id: id, name: name || (id ? id : ''), slug: t.slug || makeSlug(name || id) };
        }
        return null;
      }).filter(Boolean);
    }

    return populated;
  }

  // Helper: ensure tags on submission and contents are objects with _id, name, slug
  static async _ensureTagObjects(populatedSubmission) {
    if (!populatedSubmission) return;

    const makeSlug = (s) => {
      if (!s) return '';
      return String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    };

    // Normalize contents array
    const contents = Array.isArray(populatedSubmission.contents) ? populatedSubmission.contents : (Array.isArray(populatedSubmission.contentIds) ? populatedSubmission.contentIds : []);

    // Collect candidate tag ids (strings) to resolve from Tag collection
    const candidateIds = new Set();
    contents.forEach(c => {
      if (Array.isArray(c.tags)) {
        c.tags.forEach(t => {
          if (!t) return;
          if (typeof t === 'string') candidateIds.add(String(t));
          else if (t && typeof t === 'object' && (t._id || t.id)) candidateIds.add(String(t._id || t.id));
        });
      }
    });

    let tagDocs = [];
    if (candidateIds.size > 0) {
      try {
        tagDocs = await Tag.find({ _id: { $in: Array.from(candidateIds) } }).select('_id name slug').lean();
      } catch (err) {
        console.warn('Failed to resolve Tag docs in _ensureTagObjects:', err && (err.message || err));
        tagDocs = [];
      }
    }

    const tagMap = new Map(tagDocs.map(t => [String(t._id), { _id: String(t._id), name: t.name || '', slug: t.slug || makeSlug(t.name || t._id) }]));

    // Replace each content's tags with stable objects
    populatedSubmission.contents = contents.map(c => {
      const mapped = Array.isArray(c.tags) ? c.tags.map(raw => {
        if (!raw) return null;
        if (typeof raw === 'object') {
          const id = raw._id ? String(raw._id) : (raw.id ? String(raw.id) : null);
          const name = raw.name || raw.label || raw.tag || (id ? id : '');
          if (id && tagMap.has(id)) return tagMap.get(id);
          return { _id: id || null, name, slug: raw.slug || makeSlug(name || id) };
        }
        // raw is string
        const rawStr = String(raw);
        if (tagMap.has(rawStr)) return tagMap.get(rawStr);
        return { _id: null, name: rawStr, slug: makeSlug(rawStr) };
      }).filter(Boolean) : [];

      return { ...c, tags: mapped };
    });

    // Normalize top-level submission.tags to objects
    if (Array.isArray(populatedSubmission.tags)) {
      populatedSubmission.tags = populatedSubmission.tags.map(t => {
        if (!t) return null;
        if (typeof t === 'string') return { _id: null, name: t, slug: makeSlug(t) };
        if (typeof t === 'object') {
          const id = t._id || t.id || null;
          const name = t.name || t.tag || t.label || (id ? id : '');
          return { _id: id, name, slug: t.slug || makeSlug(name || id) };
        }
        return null;
      }).filter(Boolean);
    }
  }
}

module.exports = SubmissionService;