/**
 * Migration: Backfill empty excerpts on pending_review / in_progress / resubmitted submissions
 *
 * Finds submissions in those statuses with a blank excerpt, fetches the first
 * content document, and fills excerpt from the first 100 characters of content.body.
 *
 * Run with:
 *   node scripts/migrate-reviews-to-audit.js
 *
 * Safe to re-run — skips submissions that already have an excerpt.
 */

require('dotenv').config();
const mongoose = require('mongoose');

const STATUSES = ['pending_review', 'in_progress', 'resubmitted'];
const MAX_LENGTH = 100;

function buildExcerpt(body) {
  if (!body) return '';
  const plain = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length <= MAX_LENGTH ? plain : plain.slice(0, MAX_LENGTH).trimEnd() + '…';
}

async function run() {
  const uri = 'mongodb+srv://poems_india_production_user:A2O92RnWqlrTanLr@pi-cluster.kicado1.mongodb.net/poemsindiadb-dev?retryWrites=true&w=majority&appName=pi-cluster';

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const submissions = mongoose.connection.db.collection('submissions');
  const contents = mongoose.connection.db.collection('contents');

  // Find all submissions in target statuses with blank excerpt
  const targets = await submissions.find({
    status: { $in: STATUSES },
    $or: [{ excerpt: '' }, { excerpt: { $exists: false } }, { excerpt: null }]
  }).project({ _id: 1, contentIds: 1 }).toArray();

  console.log(`Found ${targets.length} submission(s) with empty excerpt`);

  let updated = 0;
  let skipped = 0;

  for (const sub of targets) {
    const firstContentId = Array.isArray(sub.contentIds) && sub.contentIds[0];
    if (!firstContentId) { skipped++; continue; }

    const content = await contents.findOne({ _id: firstContentId }, { projection: { body: 1 } });
    if (!content || !content.body) { skipped++; continue; }

    const excerpt = buildExcerpt(content.body);
    if (!excerpt) { skipped++; continue; }

    await submissions.updateOne({ _id: sub._id }, { $set: { excerpt } });
    updated++;
  }

  console.log('\n--- Backfill complete ---');
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped} (no contentIds or empty body)`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

