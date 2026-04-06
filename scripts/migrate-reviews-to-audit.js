/**
 * Migration: Remove stale `hasInlineImages` field from contents collection
 *
 * Run with:
 *   node scripts/migrate-reviews-to-audit.js
 *
 * Safe to re-run — $unset on a missing field is a no-op.
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  const uri = 'mongodb+srv://poems_india_production_user:A2O92RnWqlrTanLr@pi-cluster.kicado1.mongodb.net/poemsindiadb?retryWrites=true&w=majority&appName=pi-cluster';

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const contents = mongoose.connection.db.collection('contents');

  const result = await contents.updateMany(
    { hasInlineImages: { $exists: true } },
    { $unset: { hasInlineImages: '' } }
  );

  console.log('\n--- Contents cleanup complete ---');
  console.log(`  Matched  : ${result.matchedCount}`);
  console.log(`  Modified : ${result.modifiedCount}`);
  console.log(`  Field removed: hasInlineImages`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
