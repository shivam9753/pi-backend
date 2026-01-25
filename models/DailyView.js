const mongoose = require('mongoose');
const { Schema } = mongoose;

const dailyViewSchema = new Schema({
  targetType: { type: String, enum: ['submission', 'content'], required: true, index: true },
  // Use String for targetId to support UUID-style submission IDs as well as ObjectId
  targetId: { type: String, required: true, index: true },
  date: { type: String, required: true, index: true }, // YYYY-MM-DD
  count: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now, index: true }
});

// unique per day per target
dailyViewSchema.index({ targetType: 1, targetId: 1, date: 1 }, { unique: true });

// TTL: automatically remove old buckets. Default retention 30 days.
const retentionSeconds = process.env.DAILYVIEW_RETENTION_SECONDS ? parseInt(process.env.DAILYVIEW_RETENTION_SECONDS, 10) : 30 * 24 * 60 * 60;
dailyViewSchema.index({ updatedAt: 1 }, { expireAfterSeconds: retentionSeconds });

module.exports = mongoose.model('DailyView', dailyViewSchema);
