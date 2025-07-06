const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  bio: String,
  profilePic: String,
  role: String,
  createdAt: Date,
});

module.exports = mongoose.model('User', userSchema);