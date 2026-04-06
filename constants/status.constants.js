/**
 * Centralized status constants for the PI backend
 * This ensures consistency across models, routes, and services
 */

// Submission Status Constants
const SUBMISSION_STATUS = {
  DRAFT: 'draft',
  PENDING_REVIEW: 'pending_review',
  IN_PROGRESS: 'in_progress',
  NEEDS_REVISION: 'needs_revision',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
  RESUBMITTED: 'resubmitted'
};

const REVIEW_ACTIONS = {
  PENDING_REVIEW: 'pending_review',
  MOVED_TO_IN_PROGRESS: 'in_progress',
  NEEDS_REVISION: 'needs_revision',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  PUBLISHED: 'published',
  RESUBMITTED: 'resubmitted'
};

const SUBMISSION_TYPES = {
  POEM: 'poem',
  PROSE: 'prose',
  ARTICLE: 'article',
  BOOK_REVIEW: 'book_review',
  CINEMA_ESSAY: 'cinema_essay',
  OPINION: 'opinion',
  BOOKS: 'books',
  NAPO_WRIMO: 'napoWrimo',
  INTERVIEW: 'interview',
  GRIEVANCE: 'grievance',
  WRITING_PROGRAM_APPLICATION: 'writing_program_application'
};

const USER_ROLES = {
  USER: 'user',
  WRITER: 'writer',
  REVIEWER: 'reviewer',
  ADMIN: 'admin'
};

// Review Status Constants (for Audit model)
const REVIEW_STATUS = {
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  NEEDS_REVISION: 'needs_revision'
};

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
    SUBMISSION_STATUS.RESUBMITTED
  ],
  
  FINAL_STATUSES: [
    SUBMISSION_STATUS.PUBLISHED,
    SUBMISSION_STATUS.REJECTED
  ],
  
  DRAFT_STATUSES: [
    SUBMISSION_STATUS.DRAFT,
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

// Status Action Mappings
const STATUS_ACTION_MAP = {
  [SUBMISSION_STATUS.IN_PROGRESS]: REVIEW_ACTIONS.MOVED_TO_IN_PROGRESS,
  [SUBMISSION_STATUS.ACCEPTED]: REVIEW_ACTIONS.ACCEPTED,
  [SUBMISSION_STATUS.REJECTED]: REVIEW_ACTIONS.REJECTED,
  [SUBMISSION_STATUS.PUBLISHED]: REVIEW_ACTIONS.PUBLISHED,
  [SUBMISSION_STATUS.NEEDS_REVISION]: REVIEW_ACTIONS.NEEDS_REVISION,
  [SUBMISSION_STATUS.PENDING_REVIEW]: REVIEW_ACTIONS.PENDING_REVIEW,
  [SUBMISSION_STATUS.RESUBMITTED]: REVIEW_ACTIONS.RESUBMITTED
};

// Review Action to Status Mappings (for unified action endpoint)
const ACTION_STATUS_MAP = {
  approve: SUBMISSION_STATUS.ACCEPTED,
  reject: SUBMISSION_STATUS.REJECTED,
  revision: SUBMISSION_STATUS.NEEDS_REVISION
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
    const validTransitions = {
      [SUBMISSION_STATUS.DRAFT]: [
        SUBMISSION_STATUS.PENDING_REVIEW
      ],
      [SUBMISSION_STATUS.PENDING_REVIEW]: [
        SUBMISSION_STATUS.IN_PROGRESS,
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.NEEDS_REVISION
      ],
      [SUBMISSION_STATUS.IN_PROGRESS]: [
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.NEEDS_REVISION
      ],
      [SUBMISSION_STATUS.NEEDS_REVISION]: [
        SUBMISSION_STATUS.RESUBMITTED,
        SUBMISSION_STATUS.DRAFT
      ],
      [SUBMISSION_STATUS.RESUBMITTED]: [
        SUBMISSION_STATUS.PENDING_REVIEW,
        SUBMISSION_STATUS.IN_PROGRESS,
        SUBMISSION_STATUS.ACCEPTED,
        SUBMISSION_STATUS.REJECTED,
        SUBMISSION_STATUS.NEEDS_REVISION
      ],
      [SUBMISSION_STATUS.ACCEPTED]: [
        SUBMISSION_STATUS.PUBLISHED
      ],
      [SUBMISSION_STATUS.PUBLISHED]: [
        // Allow admin to unpublish and move back to 'accepted'
        SUBMISSION_STATUS.ACCEPTED
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