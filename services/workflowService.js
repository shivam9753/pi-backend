const Submission = require('../models/Submission');
const User = require('../models/User');

class WorkflowService {
  /**
   * Define valid state transitions for each role
   */
  static getValidTransitions() {
    return {
      // Author transitions
      author: {
        'draft': ['submitted'],
        'needs_changes': ['draft', 'submitted']
      },
      
      // Curator transitions
      curator: {
        'submitted': ['in_progress'],
        'in_progress': ['shortlisted', 'needs_changes', 'rejected']
      },
      
      // Reviewer transitions (includes all curator powers)
      reviewer: {
        'submitted': ['in_progress'],
        'in_progress': ['shortlisted', 'needs_changes', 'rejected', 'approved'],
        'shortlisted': ['in_progress', 'approved', 'needs_changes', 'rejected']
      },
      
      // Admin transitions (includes all powers)
      admin: {
        'submitted': ['in_progress'],
        'in_progress': ['shortlisted', 'needs_changes', 'rejected', 'approved'],
        'shortlisted': ['in_progress', 'approved', 'needs_changes', 'rejected'],
        'approved': ['published', 'needs_changes'],
        'published': ['archived']
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
      await submission.changeStatus(targetStatus, userId, userRole, notes);

      // Return updated submission with populated fields
      return await Submission.findById(submissionId)
        .populate('userId', 'username email profileImage')
        .populate('assignedTo', 'username email profileImage role')
        .populate('reviewedBy', 'username email profileImage role')
        .populate('history.user', 'username role');

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
      
      case 'curator':
        // Curators see submitted and in_progress submissions
        return { 
          status: { $in: ['submitted', 'in_progress'] }
        };
      
      case 'reviewer':
        // Reviewers see submitted, in_progress, and shortlisted submissions
        return { 
          status: { $in: ['submitted', 'in_progress', 'shortlisted'] }
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
        actions.push({ action: 'submit', label: 'Submit for Review', targetStatus: 'submitted' });
      }
      if (currentStatus === 'needs_changes') {
        actions.push(
          { action: 'edit', label: 'Edit Draft', targetStatus: 'draft' },
          { action: 'resubmit', label: 'Resubmit', targetStatus: 'submitted' }
        );
      }
      return actions;
    }

    // Editorial staff actions
    if (['curator', 'reviewer', 'admin'].includes(userRole)) {
      
      // Move to In Progress (only if not already assigned)
      if (currentStatus === 'submitted' && !submission.assignedTo) {
        actions.push({ action: 'take', label: 'Take In Progress', targetStatus: 'in_progress' });
      }

      // Actions available when assigned to this user
      if (currentStatus === 'in_progress' && isAssignedToUser) {
        if (userRole === 'curator') {
          actions.push(
            { action: 'shortlist', label: 'Shortlist', targetStatus: 'shortlisted' },
            { action: 'needs_changes', label: 'Needs Changes', targetStatus: 'needs_changes' },
            { action: 'reject', label: 'Reject', targetStatus: 'rejected' }
          );
        }
        
        if (['reviewer', 'admin'].includes(userRole)) {
          actions.push(
            { action: 'shortlist', label: 'Shortlist', targetStatus: 'shortlisted' },
            { action: 'approve', label: 'Approve', targetStatus: 'approved' },
            { action: 'needs_changes', label: 'Needs Changes', targetStatus: 'needs_changes' },
            { action: 'reject', label: 'Reject', targetStatus: 'rejected' }
          );
        }

        // Release assignment
        actions.push({ action: 'release', label: 'Release Assignment', targetStatus: 'submitted' });
      }

      // Reviewers and admins can act on shortlisted content
      if (currentStatus === 'shortlisted' && ['reviewer', 'admin'].includes(userRole)) {
        actions.push(
          { action: 'take', label: 'Take In Progress', targetStatus: 'in_progress' },
          { action: 'approve', label: 'Approve', targetStatus: 'approved' }
        );
      }

      // Admin-only actions
      if (userRole === 'admin') {
        if (currentStatus === 'approved') {
          actions.push({ action: 'publish', label: 'Publish', targetStatus: 'published' });
        }
        if (currentStatus === 'published') {
          actions.push({ action: 'archive', label: 'Archive', targetStatus: 'archived' });
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
        $set: { status: 'submitted' },
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