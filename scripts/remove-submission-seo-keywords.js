#!/usr/bin/env node
// Removes legacy `seo.keywords` arrays from Submission documents (and optionally Content documents).
// Usage:
//  - Dry run (show counts and examples): DRY_RUN=1 node scripts/remove-submission-seo-keywords.js
//  - Execute removal for submissions only: node scripts/remove-submission-seo-keywords.js
//  - Also remove from contents: REMOVE_CONTENT=1 node scripts/remove-submission-seo-keywords.js

const { connectDB } = require('../config/database');
const Submission = require('../models/Submission');
const Content = require('../models/Content');

(async function main() {
  try {
    await connectDB();
    const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
    const removeContent = process.env.REMOVE_CONTENT === '1' || process.env.REMOVE_CONTENT === 'true';

    console.log('Connected to DB. Dry run:', dryRun, 'Remove content:', removeContent);

    // Count submissions with seo.keywords
    const submissionsCount = await Submission.countDocuments({ 'seo.keywords': { $exists: true } });
    console.log(`Submissions with seo.keywords present: ${submissionsCount}`);

    if (submissionsCount > 0) {
      if (dryRun) {
        const samples = await Submission.find({ 'seo.keywords': { $exists: true } }).limit(5).select('_id seo').lean();
        console.log('Sample documents (first 5):');
        console.dir(samples, { depth: 3 });
      } else {
        const result = await Submission.updateMany({ 'seo.keywords': { $exists: true } }, { $unset: { 'seo.keywords': '' } });
        console.log('Submission update result:', result);
        console.log(`Submissions modified (modifiedCount): ${result.modifiedCount ?? result.nModified ?? result.modified ?? 0}`);
      }
    }

    if (removeContent) {
      const contentsCount = await Content.countDocuments({ 'seo.keywords': { $exists: true } });
      console.log(`Contents with seo.keywords present: ${contentsCount}`);
      if (contentsCount > 0) {
        if (dryRun) {
          const samples = await Content.find({ 'seo.keywords': { $exists: true } }).limit(5).select('_id seo').lean();
          console.log('Sample content docs (first 5):');
          console.dir(samples, { depth: 3 });
        } else {
          const result = await Content.updateMany({ 'seo.keywords': { $exists: true } }, { $unset: { 'seo.keywords': '' } });
          console.log('Content update result:', result);
          console.log(`Contents modified (modifiedCount): ${result.modifiedCount ?? result.nModified ?? result.modified ?? 0}`);
        }
      }
    }

    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Error during migration:', err);
    process.exit(2);
  }
})();
