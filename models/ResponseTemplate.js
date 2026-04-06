const mongoose = require('mongoose');

const ACTIONS = ['accept', 'reject', 'revision', 'shortlist'];
const SUBMISSION_TYPES = ['poem', 'article', 'prose', 'opinion', 'cinema_essay', 'book_review', 'all'];
const TONES = ['warm', 'neutral', 'firm'];

const responseTemplateSchema = new mongoose.Schema(
  {
    // Short label shown in the picker list
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    // Which review decision this belongs to
    action: {
      type: String,
      required: true,
      enum: ACTIONS,
      index: true
    },
    // Narrow to a specific type, or 'all' to appear for every type
    submissionType: {
      type: String,
      required: true,
      enum: SUBMISSION_TYPES,
      default: 'all',
      index: true
    },
    // Tone of the response
    tone: {
      type: String,
      enum: TONES,
      default: 'neutral'
    },
    // The response text pasted into the review notes field
    body: {
      type: String,
      required: true,
      trim: true
    }
  },
  { timestamps: true }
);

// Primary query index: fetch by action + type in one shot
responseTemplateSchema.index({ action: 1, submissionType: 1 });

const ResponseTemplate = mongoose.model('ResponseTemplate', responseTemplateSchema);

module.exports = ResponseTemplate;
module.exports.ACTIONS = ACTIONS;
module.exports.SUBMISSION_TYPES = SUBMISSION_TYPES;
module.exports.TONES = TONES;
