const mongoose = require('mongoose');

const AUDIT_ACTIONS = [
  // Author-side
  'pending_review',     // submission created and submitted for review
  'resubmitted',        // author resubmitted after revision request
  'draft',              // moved back to draft

  // Editorial workflow
  'in_progress',           // reviewer claimed it
  'needs_revision',        // editorial asked for changes (covers 'needs_changes')
  'accepted',              // accepted by editorial (covers 'approved')
  'rejected',

  // Publishing
  'published',
  'republished',        // published again after an edit
  'unpublished'         // taken down / moved back to accepted
];

const auditSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: function () {
      const { v4: uuidv4 } = require('uuid');
      return uuidv4();
    }
  },

  // What submission this event belongs to
  submissionId: {
    type: String,
    ref: 'Submission',
    required: true,
    index: true
  },

  // What happened
  action: {
    type: String,
    enum: AUDIT_ACTIONS,
    required: true
  },

  // The resulting submission status after this action
  resultingStatus: {
    type: String,
    required: true
  },

  // Who did it
  userId: {
    type: String,
    ref: 'User',
    required: true
  },
  // Optional free-text notes (review feedback, revision request, etc.)
  notes: {
    type: String,
    default: '',
    maxlength: 2000
  }
}, {
  timestamps: true,   // createdAt = when the action happened
  versionKey: false,
  _id: false
});

// Indexes for the most common query patterns
auditSchema.index({ submissionId: 1, createdAt: -1 });
auditSchema.index({ userId: 1, createdAt: -1 });
auditSchema.index({ action: 1 });
auditSchema.index({ submissionId: 1, action: 1 });

module.exports = mongoose.model('Audit', auditSchema);
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
