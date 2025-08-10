const { body, param, query, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// User validation rules
const validateUserRegistration = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('username')
    .isLength({ min: 2, max: 40 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username must be 2-40 characters and contain only letters, numbers, underscores, and hyphens'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio must be less than 500 characters'),
  handleValidationErrors
];

const validateUserUpdate = [
  body('username')
    .optional()
    .isLength({ min: 2, max: 40 })
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username must be 2-40 characters and contain only letters, numbers, underscores, and hyphens'),
  body('name')
    .optional()
    .isLength({ max: 100 })
    .withMessage('Name must be less than 100 characters'),
  body('bio')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Bio must be less than 500 characters'),
  body('profileImage')
    .optional()
    .custom((value) => {
      // Allow localhost URLs for development
      if (value.startsWith('http://localhost:')) {
        return true;
      }
      // Allow S3 URLs and other valid URLs
      try {
        new URL(value);
        return true;
      } catch {
        throw new Error('Profile image URL must be valid');
      }
    }),
  body('profileCompleted')
    .optional()
    .isBoolean()
    .withMessage('Profile completed must be a boolean value'),
  body('socialLinks.website')
    .optional()
    .isURL()
    .withMessage('Website must be a valid URL'),
  handleValidationErrors
];

// Submission validation rules
const validateSubmissionCreation = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be 3-200 characters long'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description must be maximum 1000 characters long'),
  body('submissionType')
    .isIn(['poem', 'prose', 'article', 'book_review', 'cinema_essay', 'opinion'])
    .withMessage('Submission type must be poem, prose, article, book_review, cinema_essay, or opinion'),
  body('contents')
    .isArray({ min: 1 })
    .withMessage('At least one content item is required'),
  body('contents.*.title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Content title must be 3-200 characters long'),
  body('contents.*.body')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Content body must be at least 10 characters long'),
  body('contents.*.type')
    .isIn(['poem', 'prose', 'article', 'book_review', 'cinema_essay', 'opinion'])
    .withMessage('Content type must be poem, prose, article, book_review, cinema_essay, or opinion'),
  handleValidationErrors
];

const validateSubmissionUpdate = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be 3-200 characters long'),
  body('description')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 10, max: 1000 })
    .withMessage('Description must be 10-1000 characters long when provided'),
  body('imageUrl')
    .optional()
    .custom((value) => {
      // Allow localhost URLs for development
      if (value.startsWith('http://localhost:')) {
        return true;
      }
      // For other URLs, use standard URL validation
      try {
        new URL(value);
        return true;
      } catch {
        throw new Error('Image URL must be valid');
      }
    }),
  handleValidationErrors
];

const validateStatusUpdate = [
  body('status')
    .isIn(['pending_review', 'in_progress', 'needs_revision', 'accepted', 'rejected', 'draft', 'published'])
    .withMessage('Status must be pending_review, in_progress, needs_revision, accepted, rejected, draft, or published'),
  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Notes must be less than 1000 characters'),
  handleValidationErrors
];

// Content validation rules
const validateContentCreation = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be 3-200 characters long'),
  body('body')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Body must be at least 10 characters long'),
  body('type')
    .isIn(['poem', 'story', 'article', 'quote', 'cinema_essay'])
    .withMessage('Type must be poem, story, article, quote, or cinema_essay'),
  body('language')
    .optional()
    .isIn(['english', 'hindi', 'bengali', 'tamil', 'other'])
    .withMessage('Language must be english, hindi, bengali, tamil, or other'),
  handleValidationErrors
];

// Review validation rules
const validateReviewCreation = [
  body('status')
    .isIn(['accepted', 'rejected', 'needs_revision'])
    .withMessage('Status must be accepted, rejected, or needs_revision'),
  body('reviewNotes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Review notes must be less than 1000 characters'),
  body('rating')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  handleValidationErrors
];

// Common validation rules
const validateObjectId = (fieldName) => [
  param(fieldName)
    .isMongoId()
    .withMessage(`${fieldName} must be a valid ObjectId`),
  handleValidationErrors
];

const validatePagination = [
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('skip')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Skip must be a non-negative integer'),
  query('sortBy')
    .optional()
    .isAlpha()
    .withMessage('Sort field must contain only letters'),
  query('order')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Order must be asc or desc'),
  handleValidationErrors
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Valid email is required'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  validateUserRegistration,
  validateUserUpdate,
  validateSubmissionCreation,
  validateSubmissionUpdate,
  validateStatusUpdate,
  validateContentCreation,
  validateReviewCreation,
  validateObjectId,
  validatePagination,
  validateLogin
};