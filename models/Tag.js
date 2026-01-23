const mongoose = require('mongoose');

const tagSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: function() {
      const { v4: uuidv4 } = require('uuid');
      return uuidv4();
    }
  },
  name: {
    type: String,
    required: true,
    trim: true,
    unique: true
  },
  slug: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true
  }
}, {
  timestamps: true,
  versionKey: false,
  _id: false
});

// Index for fast lookup by slug is declared via the field's `unique: true` option above

module.exports = mongoose.model('Tag', tagSchema);
