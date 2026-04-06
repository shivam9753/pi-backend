const Submission = require('../models/Submission');
const User = require('../models/User');
const AuditService = require('./auditService');
const { STATUS_UTILS } = require('../constants/status.constants');

class WorkflowService {
  /**
   * Define valid state transitions for each role
   */
  static getValidTransitions() {
    return {
      // Author transitions
      author: {
        'draft': ['pending_review'],
        'needs_revision': ['draft', 'pending_review']
      },
      
      // Writer transitions
      writer: {
        'pending_review': ['in_progress'],
        'in_progress': ['needs_revision', 'rejected']
      },
      
      // Reviewer transitions (includes all writer powers)
      reviewer: {
        'pending_review': ['in_progress'],
        'in_progress': ['needs_revision', 'rejected', 'accepted']
      },
      
      // Admin transitions (includes all powers)
      admin: {
        'pending_review': ['in_progress'],
        'in_progress': ['needs_revision', 'rejected', 'accepted'],
        'accepted': ['published'],
        'published': ['accepted']
      }
    };
  }

  /**
   * Check if a user can perform a specific transition
   */
  static canUserTransition(userRole, currentStatus, targetStatus, userId, submissionUserId) {
    // Authors can only transition their own submissions
    if (userRole === 'user' && userId !== submissionUserId) {
      return { canTransition: false, reason: 'Authors can only modify their own submissions' };
    }

    const validTransitions = this.getValidTransitions();
    const roleTransitions = validTransitions[userRole === 'user' ? 'author' : userRole];
    
    if (!roleTransitions) {
      return { canTransition: false, reason: 'Invalid user role' };
    }

    const allowedTargets = roleTransitions[currentStatus];
    if (!allowedTargets || !allowedTargets.includes(targetStatus)) {
      return { 
        canTransition: false, 
        reason: `${userRole} cannot transition from ${currentStatus} to ${targetStatus}` 
      };
    }

    return { canTransition: true };
  }

  /**
   * Execute a workflow transition with validation
   */
  static async executeTransition(submissionId, targetStatus, userId, userRole, notes = '') {
    try {
      const submission = await Submission.findById(submissionId).populate('userId', 'username email');
      
      if (!submission) {
        throw new Error('Submission not found');
      }

      // Check if user can perform this transition
      const transitionCheck = this.canUserTransition(
        userRole, 
        submission.status, 
        targetStatus, 
        userId, 
        submission.userId._id.toString()
      );

      if (!transitionCheck.canTransition) {
        throw new Error(transitionCheck.reason);
      }

      // Special handling for in_progress transition (exclusive assignment)
      if (targetStatus === 'in_progress') {
        const canMoveCheck = await Submission.canMoveToInProgress(submissionId);
        if (!canMoveCheck.canMove) {
          throw new Error(canMoveCheck.reason);
        }
      }

      // Execute the transition
      const fromStatus = submission.status;
      if (fromStatus !== targetStatus && !STATUS_UTILS.isValidStatusTransition(fromStatus, targetStatus)) {
        throw new Error(`Invalid status transition from ${fromStatus} to ${targetStatus}`);
      }

      // Handle assignment fields
      if (targetStatus === 'in_progress') {
        submission.assignedTo = userId;
        submission.assignedAt = new Date();
      } else if (['accepted', 'rejected', 'needs_revision', 'published', 'unpublished'].includes(targetStatus)) {
        submission.assignedTo = null;
        submission.assignedAt = null;
      }

      submission.status = targetStatus;
      await submission.save();

      const action = STATUS_UTILS.getActionForStatus(targetStatus) || targetStatus;
      await AuditService.log({
        submissionId,
        action,
        resultingStatus: targetStatus,
        userId,
        userRole,
        notes
      });

      // Return updated submission with populated fields
      return await Submission.findById(submissionId)
        .populate('userId', 'username email profileImage')
        .populate('assignedTo', 'username email profileImage role')
        .populate('reviewedBy', 'username email profileImage role');

    } catch (error) {
      throw new Error(`Workflow transition failed: ${error.message}`);
    }
  }

  /**
   * Get all submissions visible to a user based on their role
   */
  static getSubmissionFiltersForRole(userRole, userId) {
    switch (userRole) {
      case 'user':
        // Authors only see their own submissions
        return { userId: userId };
      
      case 'writer':
        // Writers see pending_review and in_progress submissions
        return { 
          status: { $in: ['pending_review', 'in_progress'] }
        };
      
      case 'reviewer':
        // Reviewers see pending_review and in_progress submissions
        return { 
          status: { $in: ['pending_review', 'in_progress'] }
        };
      
      case 'admin':
        // Admins see all submissions except drafts (unless they own them)
        return {
          $or: [
            { status: { $ne: 'draft' } },
            { userId: userId }
          ]
        };
      
      default:
        return { userId: userId };
    }
  }

  /**
   * Get available actions for a submission based on user role
   */
  static getAvailableActions(submission, userRole, userId) {
    const actions = [];
    const currentStatus = submission.status;
    const isOwner = submission.userId.toString() === userId.toString();
    const isAssignedToUser = submission.assignedTo && submission.assignedTo.toString() === userId.toString();

    // Authors can only act on their own submissions
    if (userRole === 'user' || userRole === 'author') {
      if (!isOwner) return [];
      
      if (currentStatus === 'draft') {
        actions.push({ action: 'submit', label: 'Submit for Review', targetStatus: 'pending_review' });
      }
      if (currentStatus === 'needs_revision') {
        actions.push(
          { action: 'edit', label: 'Edit Draft', targetStatus: 'draft' },
          { action: 'resubmit', label: 'Resubmit', targetStatus: 'pending_review' }
        );
      }
      return actions;
    }

    // Editorial staff actions
    if (['writer', 'reviewer', 'admin'].includes(userRole)) {
      
      // Move to In Progress (only if not already assigned)
      if (currentStatus === 'pending_review' && !submission.assignedTo) {
        actions.push({ action: 'take', label: 'Take In Progress', targetStatus: 'in_progress' });
      }

      // Actions available when assigned to this user
      if (currentStatus === 'in_progress' && isAssignedToUser) {
        if (userRole === 'writer') {
          actions.push(
            { action: 'needs_revision', label: 'Needs Revision', targetStatus: 'needs_revision' },
            { action: 'reject', label: 'Reject', targetStatus: 'rejected' }
          );
        }
        
        if (['reviewer', 'admin'].includes(userRole)) {
          actions.push(
            { action: 'accept', label: 'Accept', targetStatus: 'accepted' },
            { action: 'needs_revision', label: 'Needs Revision', targetStatus: 'needs_revision' },
            { action: 'reject', label: 'Reject', targetStatus: 'rejected' }
          );
        }

        // Release assignment
        actions.push({ action: 'release', label: 'Release Assignment', targetStatus: 'pending_review' });
      }

      // Admin-only actions
      if (userRole === 'admin') {
        if (currentStatus === 'accepted') {
          actions.push({ action: 'publish', label: 'Publish', targetStatus: 'published' });
        }
        if (currentStatus === 'published') {
          actions.push({ action: 'unpublish', label: 'Unpublish', targetStatus: 'accepted' });
        }
      }
    }

    return actions;
  }

  /**
   * Validate workflow integrity
   */
  static async validateWorkflowIntegrity() {
    const issues = [];

    // Check for submissions stuck in in_progress without assignment
    const orphanedInProgress = await Submission.find({
      status: 'in_progress',
      $or: [
        { assignedTo: null },
        { assignedTo: { $exists: false } }
      ]
    });

    if (orphanedInProgress.length > 0) {
      issues.push({
        type: 'orphaned_in_progress',
        count: orphanedInProgress.length,
        message: 'Submissions in progress without assignment'
      });
    }

    // Check for assignments on non-in_progress submissions
    const invalidAssignments = await Submission.find({
      status: { $ne: 'in_progress' },
      assignedTo: { $exists: true, $ne: null }
    });

    if (invalidAssignments.length > 0) {
      issues.push({
        type: 'invalid_assignments',
        count: invalidAssignments.length,
        message: 'Assignments on non-in-progress submissions'
      });
    }

    return issues;
  }

  /**
   * Fix workflow integrity issues
   */
  static async fixWorkflowIntegrity() {
    const fixes = [];

    // Fix orphaned in_progress submissions
    const orphanedFixed = await Submission.updateMany(
      {
        status: 'in_progress',
        $or: [
          { assignedTo: null },
          { assignedTo: { $exists: false } }
        ]
      },
      {
        $set: { status: 'pending_review' },
        $unset: { assignedTo: 1, assignedAt: 1 }
      }
    );

    if (orphanedFixed.modifiedCount > 0) {
      fixes.push({
        type: 'orphaned_in_progress_fixed',
        count: orphanedFixed.modifiedCount
      });
    }

    // Fix invalid assignments
    const invalidFixed = await Submission.updateMany(
      {
        status: { $ne: 'in_progress' },
        assignedTo: { $exists: true, $ne: null }
      },
      {
        $unset: { assignedTo: 1, assignedAt: 1 }
      }
    );

    if (invalidFixed.modifiedCount > 0) {
      fixes.push({
        type: 'invalid_assignments_fixed',
        count: invalidFixed.modifiedCount
      });
    }

    return fixes;
  }
}

module.exports = WorkflowService;