/**
 * Centralized status constants for the PI backend
 * This ensures consistency across models, routes, and services
 */

// Submission Status Constants
const SUBMISSION_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  PENDING_REVIEW: 'pending_review',
  IN_PROGRESS: 'in_progress',
  SHORTLISTED: 'shortlisted',
  NEEDS_CHANGES: 'needs_changes',
  NEEDS_REVISION: 'needs_revision',
  APPROVED: 'approved',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  RESUBMITTED: 'resubmitted'
};

// Review Actions Constants
const REVIEW_ACTIONS = {
  SUBMITTED: 'submitted',
  MOVED_TO_IN_PROGRESS: 'moved_to_in_progress',
  SHORTLISTED: 'shortlisted',
  NEEDS_CHANGES: 'needs_changes',
  NEEDS_REVISION: 'needs_revision',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
  ARCHIVED: 'archived',
  MOVED_TO_DRAFT: 'moved_to_draft',
  RESUBMITTED: 'resubmitted'
};

// Submission Types Constants
const SUBMISSION_TYPES = {
  POEM: 'poem',
  PROSE: 'prose',
  ARTICLE: 'article',
  BOOK_REVIEW: 'book_review',
  CINEMA_ESSAY: 'cinema_essay',
  OPINION: 'opinion',
  BOOKS: 'books',
  NAPO_WRIMO: 'napoWrimo',
  INTERVIEW: 'interview'
};

// User Roles Constants
const USER_ROLES = {
  USER: 'user',
  WRITER: 'writer',
  REVIEWER: 'reviewer',
  ADMIN: 'admin'
};

// Review Status Constants (for Review model)
const REVIEW_STATUS = {
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  NEEDS_REVISION: 'needs_revision',
  SHORTLISTED: 'shortlisted'
};

// Status Arrays for easier validation
const STATUS_ARRAYS = {
  ALL_SUBMISSION_STATUSES: Object.values(SUBMISSION_STATUS),
  ALL_REVIEW_ACTIONS: Object.values(REVIEW_ACTIONS),
  ALL_SUBMISSION_TYPES: Object.values(SUBMISSION_TYPES),
  ALL_USER_ROLES: Object.values(USER_ROLES),
  ALL_REVIEW_STATUSES: Object.values(REVIEW_STATUS),
  
  // Functional groupings
  REVIEWABLE_STATUSES: [
    SUBMISSION_STATUS.PENDING_REVIEW,
    SUBMISSION_STATUS.IN_PROGRESS,
    SUBMISSION_STATUS.RESUBMITTED,
    SUBMISSION_STATUS.SHORTLISTED
  ],
  
  FINAL_STATUSES: [
    SUBMISSION_STATUS.PUBLISHED,
    SUBMISSION_STATUS.REJECTED,
    SUBMISSION_STATUS.ARCHIVED
  ],
  
  DRAFT_STATUSES: [
    SUBMISSION_STATUS.DRAFT,
    SUBMISSION_STATUS.NEEDS_CHANGES,
    SUBMISSION_STATUS.NEEDS_REVISION
  ],
  
  REVIEWER_ROLES: [
    USER_ROLES.REVIEWER,
    USER_ROLES.ADMIN
  ],
  
  WRITER_ROLES: [
    USER_ROLES.WRITER,
    USER_ROLES.REVIEWER,
    USER_ROLES.ADMIN
  ]
};

// Status Action Mappings for changeStatus method
const STATUS_ACTION_MAP = {
  [SUBMISSION_STATUS.IN_PROGRESS]: REVIEW_ACTIONS.MOVED_TO_IN_PROGRESS,
  [SUBMISSION_STATUS.SHORTLISTED]: REVIEW_ACTIONS.SHORTLISTED,
  [SUBMISSION_STATUS.NEEDS_CHANGES]: REVIEW_ACTIONS.NEEDS_CHANGES,
  [SUBMISSION_STATUS.APPROVED]: REVIEW_ACTIONS.APPROVED,
  [SUBMISSION_STATUS.ACCEPTED]: REVIEW_ACTIONS.APPROVED, // Map accepted status to approved action
  [SUBMISSION_STATUS.REJECTED]: REVIEW_ACTIONS.REJECTED,
  [SUBMISSION_STATUS.PUBLISHED]: REVIEW_ACTIONS.PUBLISHED,
  [SUBMISSION_STATUS.ARCHIVED]: REVIEW_ACTIONS.ARCHIVED,
  [SUBMISSION_STATUS.DRAFT]: REVIEW_ACTIONS.MOVED_TO_DRAFT,
  [SUBMISSION_STATUS.SUBMITTED]: REVIEW_ACTIONS.SUBMITTED,
  [SUBMISSION_STATUS.NEEDS_REVISION]: REVIEW_ACTIONS.NEEDS_REVISION, // Map needs_revision status to needs_revision action
  [SUBMISSION_STATUS.PENDING_REVIEW]: REVIEW_ACTIONS.SUBMITTED, // Map pending_review to submitted action
  [SUBMISSION_STATUS.RESUBMITTED]: REVIEW_ACTIONS.RESUBMITTED // Map resubmitted status to resubmitted action
};

// Review Action to Status Mappings (for unified action endpoint)
const ACTION_STATUS_MAP = {
  approve: SUBMISSION_STATUS.ACCEPTED,
  reject: SUBMISSION_STATUS.REJECTED,
  revision: SUBMISSION_STATUS.NEEDS_REVISION,
  shortlist: SUBMISSION_STATUS.SHORTLISTED
};

// Utility functions
const STATUS_UTILS = {
  /**
   * Check if a status is valid for submissions
   */
  isValidSubmissionStatus: (status) => {
    return STATUS_ARRAYS.ALL_SUBMISSION_STATUSES.includes(status);
  },

  /**
   * Check if a status allows review actions
   */
  isReviewableStatus: (status) => {
    return STATUS_ARRAYS.REVIEWABLE_STATUSES.includes(status);
  },

  /**
   * Check if a status is final (no further action)
   */
  isFinalStatus: (status) => {
    return STATUS_ARRAYS.FINAL_STATUSES.includes(status);
  },

  /**
   * Check if user role can review
   */
  canReview: (role) => {
    return STATUS_ARRAYS.REVIEWER_ROLES.includes(role);
  },

  /**
   * Check if user role can write/curate
   */
  canWrite: (role) => {
    return STATUS_ARRAYS.WRITER_ROLES.includes(role);
  },

  /**
   * Get action for status change
   */
  getActionForStatus: (newStatus) => {
    return STATUS_ACTION_MAP[newStatus];
  },

  /**
   * Get status for review action
   */
  getStatusForAction: (action) => {
    return ACTION_STATUS_MAP[action];
  },

  /**
   * Validate status transition
   */
  isValidStatusTransition: (fromStatus, toStatus) => {
    // Define valid transitions
    const validTransitions = {
      [SUBMISSION_STATUS.DRAFT]: [
        SUBMISSION_STATUS.SUBMITTED,
        SUBMISSION_STATUS.PENDING_REVIEW
      ],
      [SUBMISSION_STATUS.SUBMITTED]: [
        SUBMISSION_STATUS.PENDING_REVIEW,
        SUBMISSION_STATUS.IN_PROGRESS,
        SUBMISSION_STATUS.SHORTLISTED
      ],
      [SUBMISSION_STATUS.PENDING_REVIEW]: [
        SUBMISSION_STATUS.IN_PROGRESS,
        SUBMISSION_STATUS.SHORTLISTED,
        SUBMISSION_STATUS.APPROVED,
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.NEEDS_REVISION
      ],
      [SUBMISSION_STATUS.IN_PROGRESS]: [
        SUBMISSION_STATUS.APPROVED,
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.NEEDS_REVISION,
        SUBMISSION_STATUS.SHORTLISTED
      ],
      [SUBMISSION_STATUS.SHORTLISTED]: [
        SUBMISSION_STATUS.APPROVED,
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.IN_PROGRESS
      ],
      [SUBMISSION_STATUS.NEEDS_REVISION]: [
        SUBMISSION_STATUS.RESUBMITTED,
        SUBMISSION_STATUS.DRAFT
      ],
      [SUBMISSION_STATUS.NEEDS_CHANGES]: [
        SUBMISSION_STATUS.RESUBMITTED,
        SUBMISSION_STATUS.DRAFT
      ],
      [SUBMISSION_STATUS.RESUBMITTED]: [
        SUBMISSION_STATUS.PENDING_REVIEW,
        SUBMISSION_STATUS.IN_PROGRESS,
        SUBMISSION_STATUS.SHORTLISTED,
        SUBMISSION_STATUS.APPROVED,
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.NEEDS_REVISION
      ],
      [SUBMISSION_STATUS.APPROVED]: [
        SUBMISSION_STATUS.PUBLISHED,
        SUBMISSION_STATUS.ARCHIVED
      ],
      [SUBMISSION_STATUS.ACCEPTED]: [
        SUBMISSION_STATUS.PUBLISHED,
        SUBMISSION_STATUS.ARCHIVED
      ],
      [SUBMISSION_STATUS.PUBLISHED]: [
        SUBMISSION_STATUS.ARCHIVED
      ]
    };

    return validTransitions[fromStatus]?.includes(toStatus) || false;
  }
};

module.exports = {
  SUBMISSION_STATUS,
  REVIEW_ACTIONS,
  SUBMISSION_TYPES,
  USER_ROLES,
  REVIEW_STATUS,
  STATUS_ARRAYS,
  STATUS_ACTION_MAP,
  ACTION_STATUS_MAP,
  STATUS_UTILS
};