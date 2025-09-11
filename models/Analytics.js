const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  // Event identification
  eventType: {
    type: String,
    enum: ['search_query', 'page_view', 'user_action', 'content_interaction'],
    required: true,
    index: true
  },
  
  // Event-specific data (flexible for future events)
  eventData: {
    // Search query fields
    query: String,
    resultsCount: Number,
    filters: Object,
    
    // Future fields (page views, interactions, etc.)
    contentId: String,
    duration: Number,
    action: String,
    value: Number
  },
  
  // User context
  userId: {
    type: String,
    ref: 'User',
    required: false
  },
  
  // Session/request context
  sessionId: String,
  userAgent: String,
  ip: String,
  
  // Timestamp
  timestamp: {
    type: Date,
    default: Date.now,
    expires: 2592000  // 30 days TTL (auto-cleanup)
  }
}, {
  versionKey: false
});

// Indexes for performance
analyticsSchema.index({ eventType: 1, timestamp: -1 });
analyticsSchema.index({ 'eventData.query': 1 }); // For search queries
analyticsSchema.index({ timestamp: -1 });

module.exports = mongoose.model('Analytics', analyticsSchema);