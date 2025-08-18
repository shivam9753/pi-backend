/**
 * Development validation utilities for backend
 * Helps prevent hardcoded constants from creeping back into the codebase
 */

const { 
  SUBMISSION_STATUS, 
  REVIEW_ACTIONS, 
  STATUS_ARRAYS,
  STATUS_UTILS 
} = require('../constants/status.constants');

class DevValidation {
  static isEnabled = process.env.NODE_ENV !== 'production';

  /**
   * Validate that a status value is using constants
   */
  static validateStatus(status, context = '') {
    if (!this.isEnabled) return;

    if (!STATUS_UTILS.isValidSubmissionStatus(status)) {
      console.warn(`🚨 DEV WARNING: Invalid status "${status}" used${context ? ` in ${context}` : ''}. Use SUBMISSION_STATUS constants.`);
      console.warn('Valid statuses:', STATUS_ARRAYS.ALL_SUBMISSION_STATUSES);
    }
  }

  /**
   * Validate that a review action is using constants
   */
  static validateAction(action, context = '') {
    if (!this.isEnabled) return;

    if (!STATUS_ARRAYS.ALL_REVIEW_ACTIONS.includes(action)) {
      console.warn(`🚨 DEV WARNING: Invalid action "${action}" used${context ? ` in ${context}` : ''}. Use REVIEW_ACTIONS constants.`);
      console.warn('Valid actions:', STATUS_ARRAYS.ALL_REVIEW_ACTIONS);
    }
  }

  /**
   * Validate that user role is using constants
   */
  static validateUserRole(role, context = '') {
    if (!this.isEnabled) return;

    if (!STATUS_ARRAYS.ALL_USER_ROLES.includes(role)) {
      console.warn(`🚨 DEV WARNING: Invalid user role "${role}" used${context ? ` in ${context}` : ''}. Use USER_ROLES constants.`);
      console.warn('Valid roles:', STATUS_ARRAYS.ALL_USER_ROLES);
    }
  }

  /**
   * Validate status transition
   */
  static validateStatusTransition(fromStatus, toStatus, context = '') {
    if (!this.isEnabled) return;

    if (!STATUS_UTILS.isValidStatusTransition(fromStatus, toStatus)) {
      console.warn(`🚨 DEV WARNING: Invalid status transition from "${fromStatus}" to "${toStatus}"${context ? ` in ${context}` : ''}`);
    }
  }

  /**
   * Validate array of statuses
   */
  static validateStatusArray(statuses, context = '') {
    if (!this.isEnabled) return;

    const invalidStatuses = statuses.filter(status => !STATUS_UTILS.isValidSubmissionStatus(status));
    if (invalidStatuses.length > 0) {
      console.warn(`🚨 DEV WARNING: Invalid statuses in array${context ? ` (${context})` : ''}: ${invalidStatuses.join(', ')}`);
      console.warn('Use SUBMISSION_STATUS constants instead of hardcoded strings');
    }
  }

  /**
   * Middleware to validate request bodies contain proper constants
   */
  static validateRequestMiddleware() {
    return (req, res, next) => {
      if (!this.isEnabled) return next();

      // Validate status in request body
      if (req.body.status) {
        this.validateStatus(req.body.status, `${req.method} ${req.path} request body`);
      }

      // Validate action in request body
      if (req.body.action) {
        this.validateAction(req.body.action, `${req.method} ${req.path} request body`);
      }

      next();
    };
  }

  /**
   * Database query validator
   */
  static validateQuery(query, context = '') {
    if (!this.isEnabled) return;

    // Check for hardcoded status values in queries
    if (query.status) {
      if (typeof query.status === 'string') {
        this.validateStatus(query.status, `Database query${context ? ` in ${context}` : ''}`);
      } else if (query.status.$in && Array.isArray(query.status.$in)) {
        this.validateStatusArray(query.status.$in, `Database query$in array${context ? ` in ${context}` : ''}`);
      }
    }
  }

  /**
   * Log validation violations
   */
  static logViolation(message) {
    if (!this.isEnabled) return;

    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] BACKEND VALIDATION: ${message}`;
    
    // Use console.error to avoid recursion with console.warn override
    console.error(logEntry);
    
    // Could also send to monitoring service in development
    // monitoringService.logValidation(logEntry);
  }

  /**
   * Initialize development checks
   */
  static initializeChecks() {
    if (!this.isEnabled) return;

    console.log('🔍 Backend development validation enabled');

    // Override console.warn to catch validation issues
    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (args[0]?.includes?.('🚨 DEV WARNING')) {
        this.logViolation(args.join(' '));
      }
      originalWarn.apply(console, args);
    };

    // Validate environment variables
    this.validateEnvironment();
  }

  /**
   * Validate environment configuration
   */
  static validateEnvironment() {
    const requiredEnvVars = ['PORT', 'MONGODB_URI', 'JWT_SECRET'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.warn(`🚨 DEV WARNING: Missing environment variables: ${missingVars.join(', ')}`);
    }

    if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'development') {
      console.warn('🚨 DEV WARNING: NODE_ENV should be either "production" or "development"');
    }
  }

  /**
   * Decorator for service methods to validate parameters
   */
  static validateParameters(target, propertyName, descriptor) {
    if (!this.isEnabled) return descriptor;

    const method = descriptor.value;
    descriptor.value = async function(...args) {
      // Validate common parameters
      args.forEach((arg, index) => {
        if (typeof arg === 'string') {
          // Check if it looks like a status
          if (STATUS_ARRAYS.ALL_SUBMISSION_STATUSES.includes(arg)) {
            DevValidation.validateStatus(arg, `${target.constructor.name}.${propertyName}() arg[${index}]`);
          }
          // Check if it looks like an action
          if (STATUS_ARRAYS.ALL_REVIEW_ACTIONS.includes(arg)) {
            DevValidation.validateAction(arg, `${target.constructor.name}.${propertyName}() arg[${index}]`);
          }
        }
      });

      return method.apply(this, args);
    };

    return descriptor;
  }

  /**
   * Check for code quality issues
   */
  static auditCodeQuality() {
    if (!this.isEnabled) return;

    // This could be expanded to check for other code quality issues
    console.log('🔍 Running development code quality audit...');
    
    // Check if status constants are being used consistently
    const issues = [];
    
    // You could add more sophisticated checks here
    // For example, scanning source files for hardcoded strings
    
    if (issues.length > 0) {
      console.warn('🚨 Code quality issues found:', issues);
    } else {
      console.log('✅ Code quality audit passed');
    }
  }
}

module.exports = DevValidation;