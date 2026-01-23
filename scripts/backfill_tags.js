/*
Idempotent backfill migration script.
Usage:
  NODE_ENV=staging node scripts/backfill_tags.js
  NODE_ENV=production node scripts/backfill_tags.js

What it does (idempotent):
  1) Scans distinct tag strings from `contents.tags` and `submissions.tags`.
  2) Normalizes and upserts Tag documents into `tags` collection.
  3) Updates Content documents to populate `tagIds` (array of Tag._id) in batches.
     - If `legacyTags` is not present on a Content, it will be set to the original string tags for safety.
  4) Aggregates tagIds from Content and writes `derivedTags` on Submissions in batches.

Notes:
  - Safe to re-run. Uses upserts and only updates Content documents missing `tagIds`.
  - Requires `ATLAS_URL` and NODE_ENV to be set (db.js loads correct DB name based on NODE_ENV).
*/

const { connectDB } = require('../db');
const tagService = require('../services/tagService');
const { v4: uuidv4 } = require('uuid');

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 500;

async function main() {
  console.log('Starting backfill_tags migration. NODE_ENV=', process.env.NODE_ENV || 'development');
  const db = await connectDB();

  const contentsColl = db.collection('contents');
  const submissionsColl = db.collection('submissions');
  const tagsColl = db.collection('tags');

  // 1) Gather distinct tag strings from contents and submissions
  console.log('Collecting distinct tag strings from contents...');
  const contentTagsCursor = contentsColl.aggregate([
    { $match: { tags: { $exists: true, $ne: [] } } },
    { $unwind: '$tags' },
    { $group: { _id: null, tags: { $addToSet: '$tags' } } },
    { $project: { _id: 0, tags: 1 } }
  ]);

  const submissionTagsCursor = submissionsColl.aggregate([
    { $match: { tags: { $exists: true, $ne: [] } } },
    { $unwind: '$tags' },
    { $group: { _id: null, tags: { $addToSet: '$tags' } } },
    { $project: { _id: 0, tags: 1 } }
  ]);

  const uniqueTagSet = new Set();

  try {
    const cRes = await contentTagsCursor.toArray();
    if (cRes && cRes[0] && Array.isArray(cRes[0].tags)) {
      cRes[0].tags.forEach(t => uniqueTagSet.add(t));
    }
  } catch (err) {
    console.warn('Error reading content tags aggregation:', err);
  }

  try {
    const sRes = await submissionTagsCursor.toArray();
    if (sRes && sRes[0] && Array.isArray(sRes[0].tags)) {
      sRes[0].tags.forEach(t => uniqueTagSet.add(t));
    }
  } catch (err) {
    console.warn('Error reading submission tags aggregation:', err);
  }

  const uniqueTags = Array.from(uniqueTagSet).filter(Boolean);
  console.log(`Found ${uniqueTags.length} distinct legacy tag strings`);

  // 2) Upsert Tag documents
  const slugToId = new Map();
  for (const original of uniqueTags) {
    const normalized = tagService.normalizeName(original);
    const slug = tagService.generateSlug(normalized);
    if (!slug) continue;

    const now = new Date();
    const generatedId = uuidv4();

    try {
      // Use returnOriginal:false for wider driver compatibility
      const res = await tagsColl.findOneAndUpdate(
        { slug },
        { $setOnInsert: { _id: generatedId, name: normalized, slug, createdAt: now, updatedAt: now } },
        { upsert: true, returnOriginal: false }
      );

      let tagDoc = res && res.value;
      // some driver versions may not return the doc on upsert; re-query to be safe
      if (!tagDoc) {
        tagDoc = await tagsColl.findOne({ slug });
      }

      if (tagDoc && tagDoc._id) {
        slugToId.set(slug, tagDoc._id);
      }
    } catch (err) {
      console.error('Error upserting tag for', original, err);
      // continue; try remaining tags
    }
  }

  console.log(`Upserted ${slugToId.size} tag documents`);

  // 3) Update Content documents in batches where tagIds is missing or empty
  console.log('Updating contents to populate tagIds in batches...');

  const contentQuery = {
    tags: { $exists: true, $ne: [] },
    $or: [ { tagIds: { $exists: false } }, { tagIds: { $size: 0 } } ]
  };

  const totalToUpdate = await contentsColl.countDocuments(contentQuery);
  console.log(`Total contents to update: ${totalToUpdate}`);

  let updatedCount = 0;
  const cursor = contentsColl.find(contentQuery).batchSize(BATCH_SIZE);

  while (await cursor.hasNext()) {
    const batch = [];
    for (let i = 0; i < BATCH_SIZE && await cursor.hasNext(); i++) {
      const doc = await cursor.next();
      batch.push(doc);
    }

    const bulkOps = batch.map(doc => {
      const tags = Array.isArray(doc.tags) ? doc.tags : [];
      const tagIds = tags.map(t => {
        const slug = tagService.generateSlug(tagService.normalizeName(t));
        return slugToId.get(slug);
      }).filter(Boolean);

      const update = { $set: { tagIds } };
      // set legacyTags only if not present
      if (!doc.legacyTags) {
        update.$set.legacyTags = tags;
      }

      return {
        updateOne: {
          filter: { _id: doc._id },
          update,
          upsert: false
        }
      };
    });

    if (bulkOps.length === 0) continue;

    try {
      const res = await contentsColl.bulkWrite(bulkOps, { ordered: false });
      updatedCount += (res.modifiedCount || 0) + (res.upsertedCount || 0);
      console.log(`Processed batch, operations: ${bulkOps.length}, modified: ${res.modifiedCount}`);
    } catch (err) {
      console.error('Error bulk updating content batch:', err);
    }
  }

  console.log(`Contents updated with tagIds: ~${updatedCount}`);

  // 4) Backfill Submission.derivedTags by aggregating content.tagIds per submission
  console.log('Backfilling submission.derivedTags...');

  const submissionCursor = submissionsColl.find({}).batchSize(BATCH_SIZE);
  let submissionsUpdated = 0;

  while (await submissionCursor.hasNext()) {
    const batch = [];
    for (let i = 0; i < BATCH_SIZE && await submissionCursor.hasNext(); i++) {
      batch.push(await submissionCursor.next());
    }

    const bulkOps = [];
    for (const sub of batch) {
      // Get all contents for this submission and gather tags
      const contentCursor = contentsColl.find({ submissionId: sub._id, tagIds: { $exists: true, $ne: [] } }).project({ tagIds: 1 });
      const tagIdSet = new Set();
      while (await contentCursor.hasNext()) {
        const c = await contentCursor.next();
        (c.tagIds || []).forEach(tid => tagIdSet.add(tid));
      }

      const derivedTags = Array.from(tagIdSet);
      bulkOps.push({
        updateOne: {
          filter: { _id: sub._id },
          update: { $set: { derivedTags } },
          upsert: false
        }
      });
    }

    if (bulkOps.length === 0) continue;

    try {
      const res = await submissionsColl.bulkWrite(bulkOps, { ordered: false });
      submissionsUpdated += (res.modifiedCount || 0);
      console.log(`Processed submission batch, modified: ${res.modifiedCount}`);
    } catch (err) {
      console.error('Error bulk updating submissions batch:', err);
    }
  }

  console.log(`Submissions updated with derivedTags: ~${submissionsUpdated}`);

  console.log('Backfill migration completed');
  process.exit(0);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
