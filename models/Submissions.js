const mongoose = require('mongoose');

const poemSchema = new mongoose.Schema({
  title: String,
  content: String
});

const submissionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  type: String,
  title: String,
  poems: [poemSchema],
  status: String
}, {
  timestamps: true
});

module.exports = mongoose.model('Submission', submissionSchema);
