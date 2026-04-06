const Submission = require('../models/Submission');
const Content = require('../models/Content');
const Audit = require('../models/Audit');
const AuditService = require('./auditService');
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
    const actualUserId = userId || authorId;
    const user = await User.findById(actualUserId);
    if (!user) {
      throw new Error('User not found');
    }

    if (profileData && profileData.isFirstTimeSubmission) {
      await User.findByIdAndUpdate(actualUserId, {
        tempBio: profileData.tempBio || ''
      });
    }

    const submission = new Submission({
      userId: actualUserId,
      title,
      description,
      contentIds: [],
      submissionType,
      status: status || SUBMISSION_STATUS.DRAFT,
      excerpt: '' 
    });

    // Prepare content documents (do this before any DB ops so we can reuse in both transactional and fallback flows)
    const contentDocs = Array.isArray(contents) ? contents.map(content => ({
      title: content.title,
      body: content.body,
      type: content.type || submissionType,
      userId: actualUserId,
      submissionId: submission._id, // this will be the generated id even before save because _id default is deterministic (uuid)
      footnotes: content.footnotes || '',
      tags: [], // explicitly empty to avoid persisting client-sent tags
      seo: content.seo || {}
    })) : [];

    // Try to perform creation in a transaction when supported to avoid partial writes (contents created but submission not updated)
    let session = null;
    try {
      if (typeof mongoose.startSession === 'function') {
        session = await mongoose.startSession();
        session.startTransaction();
      }

      // Save submission (within session if available)
      const savedSubmission = await submission.save({ session });

      // Use insertMany for bulk creation (honors session when provided)
      const createdContents = await Content.insertMany(contentDocs, { session, ordered: true });
      const excerpt = Submission.generateExcerpt(createdContents);

      // Ensure we store string IDs consistently
      const contentIds = createdContents.map(c => String(c._id));

      // Update submission atomically (within transaction if available)
      const updatedSubmission = await Submission.findByIdAndUpdate(
        savedSubmission._id,
        { $set: { contentIds, excerpt } },
        { new: true, session }
      );

      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      const result = updatedSubmission || savedSubmission;
      // Log the 'pending_review' audit event (non-blocking)
      AuditService.log({
        submissionId: result._id,
        action: 'pending_review',
        resultingStatus: result.status || SUBMISSION_STATUS.DRAFT,
        userId: actualUserId,
        notes: 'Submission submitted'
      }).catch(e => console.warn('Audit log failed for createSubmission:', e?.message));
      return result;
    } catch (err) {
      // Abort transaction if something went wrong
      if (session) {
        try {
          await session.abortTransaction();
        } catch (e) {
          // ignore
        }
        session.endSession();
      }

      // Log the failure and attempt a safe non-transactional fallback
      console.warn('SubmissionService.createSubmission transaction failed, falling back to non-transactional flow:', err && (err.message || err));

      try {
        // Ensure submission exists (save if not already saved)
        let savedSubmissionFallback = await Submission.findById(submission._id);
        if (!savedSubmissionFallback) {
          savedSubmissionFallback = await submission.save();
        }

        // Create contents (non-transactional)
        const createdContentsFallback = await Content.create(contentDocs);

        const excerpt = Submission.generateExcerpt(createdContentsFallback);
        const contentIds = createdContentsFallback.map(c => String(c._id));

        // Use findByIdAndUpdate (atomic single write) to ensure contentIds are written even if previous save succeeded
        await Submission.findByIdAndUpdate(savedSubmissionFallback._id, { $set: { contentIds, excerpt } });

        const fallbackResult = await Submission.findById(savedSubmissionFallback._id);
        AuditService.log({
          submissionId: fallbackResult._id,
          action: 'pending_review',
          resultingStatus: fallbackResult.status || SUBMISSION_STATUS.DRAFT,
          userId: actualUserId,
          notes: 'Submission submitted'
        }).catch(e => console.warn('Audit log failed for createSubmission fallback:', e?.message));
        return fallbackResult;
      } catch (fallbackErr) {
        // If fallback fails, log and throw the original error for upper layers to handle
        console.error('SubmissionService.createSubmission fallback failed:', fallbackErr && (fallbackErr.message || fallbackErr));
        throw err;
      }
    }
  }

  static async getAcceptedSubmissions(filters = {}) {
    const { type, limit = 20, skip = 0, sortBy = 'reviewedAt', order = 'desc' } = filters;
    
    const query = { status: SUBMISSION_STATUS.ACCEPTED };
    if (type) query.submissionType = type;

    // Use .select() to only fetch required fields - exclude large fields like description
    const submissions = await Submission.find(query)
      .select('title excerpt imageUrl submissionType userId')
      .populate('userId', 'name username')
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
    const { type, limit = 20, skip = 0, sortBy = 'publishedAt', order = 'desc' } = filters;
    
    const query = { status: SUBMISSION_STATUS.PUBLISHED };
    if (type) query.submissionType = type;

    // Use .select() to exclude large fields like description and contentIds for listing
    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl publishedAt createdAt userId seo')
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
        publishedAt: sub.publishedAt || sub.createdAt,
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
      .populate('userId', 'name username email profileImage');

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

  // Resolve tags (ids, names or partial objects) to full Tag objects ({ _id, name, slug })
  static async _ensureTagObjects(populatedSubmission) {
    try {
      if (!populatedSubmission) return;

      const TagModel = Tag; // required at top
      const contents = populatedSubmission.contents || populatedSubmission.contentIds || [];

      // Collect ids and slugs to query in batch
      const idSet = new Set();
      const slugSet = new Set();
      const nameToSlug = (name) => {
        if (!name || typeof name !== 'string') return '';
        return (tagService && typeof tagService.generateSlug === 'function')
          ? tagService.generateSlug(tagService.normalizeName(name))
          : String(name).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      };

      // Map to remember original raw tags per content index for reconciling later
      const contentRawTags = [];

      contents.forEach((c, idx) => {
        const raw = Array.isArray(c.tags) ? c.tags.slice() : [];
        contentRawTags[idx] = raw;
        raw.forEach(t => {
          if (!t && t !== 0) return;
          if (typeof t === 'object') {
            // If object with _id, prefer that for lookup
            if (t._id) idSet.add(String(t._id));
            else if (t.slug) slugSet.add(String(t.slug));
            else if (t.name) slugSet.add(nameToSlug(t.name));
          } else if (typeof t === 'string') {
            const s = t.trim();
            if (/^[0-9a-fA-F]{24}$/.test(s) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(s)) {
              idSet.add(s);
            } else {
              const slug = nameToSlug(s);
              if (slug) slugSet.add(slug);
            }
          }
        });
      });

      const ids = Array.from(idSet);
      const slugs = Array.from(slugSet);

      // Query tags by id and slug
      const query = [];
      if (ids.length > 0) query.push({ _id: { $in: ids } });
      if (slugs.length > 0) query.push({ slug: { $in: slugs } });

      let foundTags = [];
      if (query.length > 0) {
        foundTags = await TagModel.find({ $or: query }).lean();
      }

      const tagById = new Map();
      const tagBySlug = new Map();
      foundTags.forEach(t => {
        if (t._id) tagById.set(String(t._id), { _id: String(t._id), name: t.name, slug: t.slug });
        if (t.slug) tagBySlug.set(String(t.slug), { _id: String(t._id), name: t.name, slug: t.slug });
      });

      // Reconcile per-content tags
      contents.forEach((c, idx) => {
        const raw = contentRawTags[idx] || [];
        const resolved = [];

        raw.forEach(t => {
          if (!t && t !== 0) return;
          if (typeof t === 'object') {
            if (t._id && tagById.has(String(t._id))) {
              resolved.push(tagById.get(String(t._id)));
            } else if (t.slug && tagBySlug.has(String(t.slug))) {
              resolved.push(tagBySlug.get(String(t.slug)));
            } else if (t.name) {
              const slug = nameToSlug(t.name);
              if (tagBySlug.has(slug)) resolved.push(tagBySlug.get(slug));
            } else if (t._id) {
              // keep minimal object
              resolved.push({ _id: String(t._id), name: t.name || '', slug: t.slug || '' });
            }
          } else if (typeof t === 'string') {
            const s = t.trim();
            if (/^[0-9a-fA-F]{24}$/.test(s) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(s)) {
              if (tagById.has(s)) resolved.push(tagById.get(s));
            } else {
              const slug = nameToSlug(s);
              if (tagBySlug.has(slug)) resolved.push(tagBySlug.get(slug));
            }
          }
        });

        // Deduplicate
        const seen = new Set();
        const uniq = [];
        resolved.forEach(r => {
          const key = r && r._id ? r._id : JSON.stringify(r);
          if (!seen.has(key)) {
            seen.add(key);
            uniq.push(r);
          }
        });

        // Replace the content's tags with resolved objects (keep original shape if none found)
        if (uniq.length > 0) {
          c.tags = uniq;
        } else {
          // If nothing resolved, normalize to empty array to avoid mixed types
          c.tags = [];
        }
      });

      // If submission-level tags exist (legacy), attempt same resolution
      if (Array.isArray(populatedSubmission.tags) && populatedSubmission.tags.length > 0) {
        const raw = populatedSubmission.tags.slice();
        const resolved = [];
        raw.forEach(t => {
          if (!t) return;
          if (typeof t === 'object' && t._id && tagById.has(String(t._id))) resolved.push(tagById.get(String(t._id)));
          else if (typeof t === 'object' && t.slug && tagBySlug.has(String(t.slug))) resolved.push(tagBySlug.get(String(t.slug)));
          else if (typeof t === 'string') {
            if (tagById.has(t)) resolved.push(tagById.get(t));
            else {
              const slug = nameToSlug(t);
              if (tagBySlug.has(slug)) resolved.push(tagBySlug.get(slug));
            }
          }
        });
        populatedSubmission.tags = resolved;
      }

    } catch (err) {
      // Fail silently - reading a submission should not error because tags couldn't be resolved
      console.warn('SubmissionService._ensureTagObjects failed:', err && (err.message || err));
    }
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
      imageUrl: populatedSubmission.imageUrl,
      excerpt: populatedSubmission.excerpt,
      contents: populatedSubmission.contentIds,
      createdAt: populatedSubmission.createdAt
    };
  }

  // Return submissions for a specific user (used by /api/submissions/user/me)
  static async getUserSubmissions(userId, options = {}) {
    if (!userId) throw new Error('userId required');

    const { limit = 20, skip = 0, status } = options;
    console.log("Submissions query for userId:", userId, "with status filter:", status);
    const query = { userId: String(userId) };
    if (status) {
      // Support comma-separated status values (e.g. "published,resubmitted") or a single value
      const statusList = String(status).split(',').map(s => s.trim()).filter(Boolean);
      query.status = statusList.length === 1 ? statusList[0] : { $in: statusList };
    }

    const submissions = await Submission.find(query)
      .select('title excerpt status submissionType imageUrl createdAt updatedAt seo')
      .populate('userId', 'name username profileImage')
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip))
      .lean();
    return submissions;
  }

  static async getBySlug(slug) {
    if (!slug || typeof slug !== 'string') {
      throw new Error('Slug is required');
    }

    // Normalize incoming slug
    const normalized = String(slug).trim();

    // Try to find published submission by seo.slug
    const submission = await Submission.findOne({ 'seo.slug': normalized, status: SUBMISSION_STATUS.PUBLISHED })
      .populate('userId', 'name username email profileImage')
      .populate('reviewedBy', 'username');

    if (!submission) {
      throw new Error('Published submission not found');
    }

    // Populate contentIds into full content objects
    const populatedSubmission = await Submission.populateContentIds(submission);

    // Ensure tag objects are present on contents and submission
    await SubmissionService._ensureTagObjects(populatedSubmission);

    // For frontend compatibility, expose contents array instead of contentIds
    if (populatedSubmission.contentIds) {
      populatedSubmission.contents = populatedSubmission.contentIds;
      delete populatedSubmission.contentIds;
    }

    return populatedSubmission;
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

  /**
   * Update Author Trust Score for a review decision.
   * Called from reviewRoutes after a status transition.
   */
  static async updateAuthorAts(submissionId, reviewStatus) {
    try {
      const submission = await Submission.findById(submissionId).select('userId').lean();
      if (!submission) return;
      const author = await User.findById(submission.userId);
      if (!author) return;

      const delta = {
        [SUBMISSION_STATUS.ACCEPTED]: 6,
        [SUBMISSION_STATUS.NEEDS_REVISION]: 1,
        [SUBMISSION_STATUS.REJECTED]: -4
      }[reviewStatus] || 0;

      if (delta !== 0) {
        const current = typeof author.ats === 'number' ? author.ats : 50;
        author.ats = Math.max(0, Math.min(100, current + delta));
        await author.save();
      }
    } catch (atsError) {
      console.warn('Failed to update author ATS:', atsError);
    }
  }

  static async reviewSubmission(id, reviewData) {
    const submission = await Submission.findById(id);
    if (!submission) {
      throw new Error('Submission not found');
    }

    // Allow reviewing submissions in various states for different actions
    const allowedStatuses = [...STATUS_ARRAYS.REVIEWABLE_STATUSES];
    if (reviewData.status === SUBMISSION_STATUS.NEEDS_REVISION) {
      allowedStatuses.push(SUBMISSION_STATUS.NEEDS_REVISION);
    }
    
    if (!allowedStatuses.includes(submission.status)) {
      throw new Error(`Only submissions with status ${allowedStatuses.join(', ')} can be reviewed`);
    }

    // Update review-related fields on submission
    submission.reviewedAt = new Date();
    submission.reviewedBy = reviewData.reviewerId;
    await submission.save();

    return { submission };
  }

  static async getFeaturedSubmissions(filters = {}) {
    const { type, limit = 10 } = filters;

    const query = { status: 'published', isFeatured: true };
    if (type) query.submissionType = type;

    const submissions = await Submission.find(query)
      .select('title submissionType excerpt imageUrl publishedAt createdAt userId contentIds')
      .populate('userId', 'name username email profileImage')
      .sort({ publishedAt: -1 })
      .limit(parseInt(limit))
      .lean(); // Use lean() for better performance

    return submissions.map(sub => ({
      _id: sub._id,
      contentId: sub.contentIds && sub.contentIds.length > 0 ? sub.contentIds[0] : sub._id,
      title: sub.title,
      submissionType: sub.submissionType,
      excerpt: sub.excerpt,
      imageUrl: sub.imageUrl,
      publishedAt: sub.publishedAt || sub.createdAt,
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
          count: { $sum: 1 }
        }
      }
    ];

    const stats = await Submission.aggregate(pipeline);
    
    // Transform to more usable format
    const result = {
      pending_review: 0,
      accepted: 0,
      published: 0,
      rejected: 0
    };

    stats.forEach(stat => {
      result[stat._id] = stat.count;
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
      .select('title submissionType excerpt imageUrl publishedAt createdAt userId')
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
        publishedAt: sub.publishedAt || sub.createdAt,
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

    // Delete associated content. Use both submission.contentIds and submissionId fallback
    try {
      const query = [];
      if (Array.isArray(submission.contentIds) && submission.contentIds.length > 0) {
        query.push({ _id: { $in: submission.contentIds } });
      }
      // Always include submissionId fallback to catch any content rows referencing the submission
      query.push({ submissionId: id });

      const deleteResult = await Content.deleteMany({ $or: query });

      // Delete associated reviews (now Audit entries)
      await AuditService.deleteBySubmissionIds([id]);

      // Delete submission
      await Submission.findByIdAndDelete(id);

      return {
        message: 'Submission and associated content deleted successfully',
        contentDeleted: typeof deleteResult.deletedCount === 'number' ? deleteResult.deletedCount : 0
      };
    } catch (err) {
      // On error, log and rethrow for the route layer to surface
      console.error('Error deleting submission and contents:', err && (err.message || err));
      throw err;
    }
  }

  // New: Bulk delete multiple submissions and their related Content/Review documents
  static async deleteSubmissions(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('ids array required');
    }

    const uniqueIds = [...new Set(ids.map(i => String(i)) )];
    let session = null;

    try {
      if (typeof mongoose.startSession === 'function') {
        session = await mongoose.startSession();
        session.startTransaction();
      }

      // Delete contents that reference these submissions (by submissionId)
      const contentDeleteResult = await Content.deleteMany(
        { submissionId: { $in: uniqueIds } },
        session ? { session } : undefined
      );

      // Delete any audit entries linked to these submissions
      await Audit.deleteMany(
        { submissionId: { $in: uniqueIds } },
        session ? { session } : undefined
      );

      // Finally delete the submissions themselves
      const submissionDeleteResult = await Submission.deleteMany(
        { _id: { $in: uniqueIds } },
        session ? { session } : undefined
      );

      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      return {
        message: 'Bulk delete completed',
        deletedSubmissions: typeof submissionDeleteResult.deletedCount === 'number' ? submissionDeleteResult.deletedCount : 0,
        deletedContents: typeof contentDeleteResult.deletedCount === 'number' ? contentDeleteResult.deletedCount : 0
      };
    } catch (err) {
      if (session) {
        try { await session.abortTransaction(); } catch (e) { /* ignore */ }
        session.endSession();
      }
      console.error('Error deleting multiple submissions:', err && (err.message || err));
      throw err;
    }
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

    // First create submission without content IDs
    const submission = new Submission({
      userId: actualUserId,
      title,
      description,
      contentIds: [], // Empty initially
      submissionType,
      status: SUBMISSION_STATUS.DRAFT, // Default to draft
      excerpt: '' // Default, will be updated
    });

    // Prepare content documents (do this before any DB ops so we can reuse in both transactional and fallback flows)
    const contentDocs = Array.isArray(contents) ? contents.map(content => ({
      title: content.title,
      body: content.body,
      type: content.type || submissionType,
      userId: actualUserId,
      submissionId: submission._id, // this will be the generated id even before save because _id default is deterministic (uuid)
      footnotes: content.footnotes || '',
      tags: [], // explicitly empty to avoid persisting client-sent tags
      seo: content.seo || {}
    })) : [];

    // Try to perform creation in a transaction when supported to avoid partial writes (contents created but submission not updated)
    let session = null;
    try {
      if (typeof mongoose.startSession === 'function') {
        session = await mongoose.startSession();
        session.startTransaction();
      }

      // Save submission (within session if available)
      const savedSubmission = await submission.save({ session });

      // Use insertMany for bulk creation (honors session when provided)
      const createdContents = await Content.insertMany(contentDocs, { session, ordered: true });

      // Calculate excerpt
      const excerpt = Submission.generateExcerpt(createdContents);

      // Ensure we store string IDs consistently
      const contentIds = createdContents.map(c => String(c._id));

      // Update submission atomically (within transaction if available)
      const updatedSubmission = await Submission.findByIdAndUpdate(
        savedSubmission._id,
        { $set: { contentIds, excerpt } },
        { new: true, session }
      );

      if (session) {
        await session.commitTransaction();
        session.endSession();
      }

      return updatedSubmission || savedSubmission;
    } catch (err) {
      // Abort transaction if something went wrong
      if (session) {
        try {
          await session.abortTransaction();
        } catch (e) {
          // ignore
        }
        session.endSession();
      }

      // Log the failure and attempt a safe non-transactional fallback
      console.warn('SubmissionService.createSubmission transaction failed, falling back to non-transactional flow:', err && (err.message || err));

      try {
        // Ensure submission exists (save if not already saved)
        let savedSubmissionFallback = await Submission.findById(submission._id);
        if (!savedSubmissionFallback) {
          savedSubmissionFallback = await submission.save();
        }

        // Create contents (non-transactional)
        const createdContentsFallback = await Content.create(contentDocs);

        const excerpt = Submission.generateExcerpt(createdContentsFallback);
        const contentIds = createdContentsFallback.map(c => String(c._id));

        // Use findByIdAndUpdate (atomic single write) to ensure contentIds are written even if previous save succeeded
        await Submission.findByIdAndUpdate(savedSubmissionFallback._id, { $set: { contentIds, excerpt } });

        return await Submission.findById(savedSubmissionFallback._id);
      } catch (fallbackErr) {
        // If fallback fails, log and throw the original error for upper layers to handle
        console.error('SubmissionService.createSubmission fallback failed:', fallbackErr && (fallbackErr.message || fallbackErr));
        throw err;
      }
    }
  }

  static async publishWithSEO(id, seoData = {}, publisherId) {
    if (!id) throw new Error('Submission id required');

    const submission = await Submission.findById(id);
    if (!submission) throw new Error('Submission not found');

    // Extract expected payload pieces
    const submissionMeta = seoData?.submissionMeta ?? {};
    const perContentTags = seoData?.perContentTags ?? {};
    const perContentMeta = seoData?.perContentMeta ?? {};
    const perContentBody = seoData?.perContentBody ?? {};
    const keywords = seoData.keywords || submissionMeta.keywords || [];

    // --- Slug uniqueness check (before any writes) ---
    const incomingSlug = submissionMeta.slug ? String(submissionMeta.slug).trim() : null;
    if (incomingSlug) {
      const slugConflict = await Submission.findOne({
        'seo.slug': incomingSlug,
        _id: { $ne: id }
      }).select('_id').lean();
      if (slugConflict) {
        throw new Error(`Slug "${incomingSlug}" is already in use by another submission`);
      }
    }

    // Ensure submission.seo exists
    submission.seo = submission.seo || {};

    if (incomingSlug) submission.seo.slug = incomingSlug;
    if (submissionMeta.metaTitle) submission.seo.metaTitle = String(submissionMeta.metaTitle).trim();
    if (submissionMeta.metaDescription) submission.seo.metaDescription = String(submissionMeta.metaDescription).trim();
    if (submissionMeta.primaryKeyword) submission.seo.primaryKeyword = String(submissionMeta.primaryKeyword).trim();
    if (submissionMeta.ogImage) submission.seo.ogImage = String(submissionMeta.ogImage);
    if (typeof submissionMeta.featuredOnHomepage !== 'undefined') submission.seo.featuredOnHomepage = !!submissionMeta.featuredOnHomepage;
    if (Array.isArray(keywords)) submission.seo.keywords = keywords;

    // Update per-content tags and content-level SEO
    try {
      // Collect all content ids referenced in either tags, meta, or body edits
      const contentIdSet = new Set([
        ...Object.keys(perContentTags),
        ...Object.keys(perContentMeta),
        ...Object.keys(perContentBody)
      ]);

      for (const contentId of contentIdSet) {
        const updateFields = {};

        // --- Body / title / footnotes edits ---
        const bodyEdit = perContentBody[contentId];
        if (bodyEdit) {
          if (typeof bodyEdit.body === 'string') updateFields.body = bodyEdit.body;
          if (typeof bodyEdit.title === 'string' && bodyEdit.title.trim()) updateFields.title = bodyEdit.title.trim();
          if (typeof bodyEdit.footnotes === 'string') updateFields.footnotes = bodyEdit.footnotes;
        }

        // --- Tags ---
        const tagsForContent = Array.isArray(perContentTags[contentId])
          ? perContentTags[contentId].map(t => (t || '').trim()).filter(Boolean)
          : [];
        if (tagsForContent.length > 0) {
          // Create/find Tag documents and set Content.tags to array of Tag _id
          const createdTags = await tagService.findOrCreateMany(tagsForContent);
          updateFields.tags = createdTags.map(t => t._id);
        }

        // --- Content-level SEO ---
        // Content schema uses `seo.keyword` (singular), not `primaryKeyword`
        const meta = perContentMeta[contentId];
        if (meta) {
          const seoUpdate = {};
          if (meta.metaTitle !== undefined) seoUpdate['seo.metaTitle'] = String(meta.metaTitle || '').trim();
          if (meta.metaDescription !== undefined) seoUpdate['seo.metaDescription'] = String(meta.metaDescription || '').trim();
          if (meta.primaryKeyword !== undefined) seoUpdate['seo.keyword'] = String(meta.primaryKeyword || '').trim();
          if (meta.slug !== undefined) seoUpdate['seo.slug'] = String(meta.slug || '').trim();
          Object.assign(updateFields, seoUpdate);
        }

        if (Object.keys(updateFields).length > 0) {
          await Content.findByIdAndUpdate(contentId, { $set: updateFields });
        }
      }
    } catch (err) {
      // Non-fatal: log and continue. Publishing should not completely fail for tag/meta persistence issues.
      console.warn('SubmissionService.publishWithSEO - failed to update content tags/meta:', err && (err.message || err));
    }

    // Apply any top-level submission fields provided in the payload (title, description, excerpt)
    // Frontend sends these at the top level when calling publish-with-seo; ensure they're saved.
    if (Object.prototype.hasOwnProperty.call(seoData, 'title')) {
      submission.title = String(seoData.title || submission.title || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(seoData, 'description')) {
      submission.description = String(seoData.description || submission.description || '').trim();
    }
    if (Object.prototype.hasOwnProperty.call(seoData, 'excerpt')) {
      const raw = String(seoData.excerpt || submission.excerpt || '').trim();
      submission.excerpt = raw.length <= 300 ? raw : raw.slice(0, 300).trimEnd() + '…';
    }

    // Mark submission as published
    submission.status = SUBMISSION_STATUS.PUBLISHED;
    // Preserve publishedAt on re-publish: only set it the first time.
    // Guard against both undefined AND null (schema default is null).
    if (!submission.publishedAt || submission.publishedAt === null) {
      // Check Audit collection for a prior publish event (handles the case where
      // publishedAt was accidentally nulled on an already-published submission).
      const wasAlreadyPublished = await AuditService.wasEverPublished(id);
      submission.publishedAt = wasAlreadyPublished
        ? (submission.reviewedAt || submission.createdAt || new Date())
        : new Date();
    }

    // Write a 'published' or 'republished' audit entry
    const auditAction = (await AuditService.wasEverPublished(id)) ? 'republished' : 'published';
    await AuditService.log({
      submissionId: id,
      action: auditAction,
      resultingStatus: SUBMISSION_STATUS.PUBLISHED,
      userId: publisherId || 'system',
      notes: 'Published via admin publish flow'
    });

    await submission.save();

    // Return populated submission — use the already-saved in-memory document directly
    // to avoid a redundant DB round-trip.
    const populated = await Submission.populateContentIds(submission);
    await SubmissionService._ensureTagObjects(populated);
    if (populated.contentIds) {
      populated.contents = populated.contentIds;
      delete populated.contentIds;
    }

    return populated;
  }
}

module.exports = SubmissionService;