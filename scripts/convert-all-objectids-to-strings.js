#!/usr/bin/env node

/**
 * CONVERT ALL OBJECT IDS TO STRINGS IN PRODUCTION DATABASE
 * This script converts ObjectIds to strings across all collections to match application logic
 */

const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs').promises;
const path = require('path');

require('dotenv').config();

const PRODUCTION_URI = process.env.ATLAS_URL || process.env.MONGODB_URI_PROD;
const DRY_RUN = process.argv.includes('--dry-run');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

async function convertAllObjectIdsToStrings() {
  const client = new MongoClient(PRODUCTION_URI);
  
  try {
    await client.connect();
    const db = client.db('poemsindiadb');
    
    console.log(`🚀 Converting all ObjectIds to strings${DRY_RUN ? ' (DRY RUN)' : ''}...`);
    
    // Create backup directory
    const backupDir = path.join(__dirname, 'objectid-conversion-backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    let totalConverted = 0;
    
    // 1. Convert Users collection
    console.log('\n👤 Converting Users collection...');
    const users = await db.collection('users').find({}).toArray();
    console.log(`Found ${users.length} users`);
    
    if (!DRY_RUN && users.length > 0) {
      // Backup users
      const usersBackupPath = path.join(backupDir, `${TIMESTAMP}-users-backup.json`);
      await fs.writeFile(usersBackupPath, JSON.stringify(users, null, 2));
      console.log(`📦 Users backup created: ${usersBackupPath}`);
      
      // Drop the collection and recreate with string IDs
      await db.collection('users').drop();
      
      // Convert user _ids and recreate collection
      const convertedUsers = users.map(user => ({
        ...user,
        _id: user._id.toString()
      }));
      
      if (convertedUsers.length > 0) {
        await db.collection('users').insertMany(convertedUsers);
        totalConverted += convertedUsers.length;
        console.log(`   Converted ${convertedUsers.length} users with string IDs`);
      }
    }
    
    // 2. Convert Submissions collection
    console.log('\n📝 Converting Submissions collection...');
    const submissions = await db.collection('submissions').find({}).toArray();
    console.log(`Found ${submissions.length} submissions`);
    
    if (!DRY_RUN && submissions.length > 0) {
      // Backup submissions
      const submissionsBackupPath = path.join(backupDir, `${TIMESTAMP}-submissions-backup.json`);
      await fs.writeFile(submissionsBackupPath, JSON.stringify(submissions, null, 2));
      console.log(`📦 Submissions backup created: ${submissionsBackupPath}`);
      
      // Drop the collection and recreate with string IDs
      await db.collection('submissions').drop();
      
      // Convert submission _ids and userIds
      const convertedSubmissions = submissions.map(submission => {
        const stringId = submission._id.toString();
        const stringUserId = submission.userId ? submission.userId.toString() : null;
        
        // Convert contentIds if they're ObjectIds
        let stringContentIds = submission.contentIds || [];
        if (stringContentIds.length > 0) {
          stringContentIds = stringContentIds.map(id => 
            typeof id === 'object' && id.toString ? id.toString() : id
          );
        }
        
        return { 
          ...submission, 
          _id: stringId,
          userId: stringUserId,
          contentIds: stringContentIds
        };
      });
      
      if (convertedSubmissions.length > 0) {
        await db.collection('submissions').insertMany(convertedSubmissions);
        totalConverted += convertedSubmissions.length;
        console.log(`   Converted ${convertedSubmissions.length} submissions with string IDs`);
      }
    }
    
    // 3. Contents collection already has string IDs, but update submissionId references
    console.log('\n📄 Updating Contents collection references...');
    const contents = await db.collection('contents').find({}).toArray();
    console.log(`Found ${contents.length} contents`);
    
    if (!DRY_RUN && contents.length > 0) {
      // Backup contents
      const contentsBackupPath = path.join(backupDir, `${TIMESTAMP}-contents-backup.json`);
      await fs.writeFile(contentsBackupPath, JSON.stringify(contents, null, 2));
      console.log(`📦 Contents backup created: ${contentsBackupPath}`);
      
      // Update submissionId references to strings (they should already be strings but double-check)
      for (const content of contents) {
        const updates = {};
        let needsUpdate = false;
        
        // Convert submissionId if it's an ObjectId
        if (content.submissionId && typeof content.submissionId === 'object') {
          updates.submissionId = content.submissionId.toString();
          needsUpdate = true;
        }
        
        // Convert userId if it exists and is ObjectId
        if (content.userId && typeof content.userId === 'object') {
          updates.userId = content.userId.toString();
          needsUpdate = true;
        }
        
        if (needsUpdate) {
          await db.collection('contents').updateOne(
            { _id: content._id },
            { $set: updates }
          );
          totalConverted++;
          console.log(`   Updated content: "${content.title}"`);
        }
      }
    }
    
    // 4. Convert Reviews collection if it exists
    console.log('\n📋 Converting Reviews collection...');
    const reviews = await db.collection('reviews').find({}).toArray();
    console.log(`Found ${reviews.length} reviews`);
    
    if (!DRY_RUN && reviews.length > 0) {
      // Backup reviews
      const reviewsBackupPath = path.join(backupDir, `${TIMESTAMP}-reviews-backup.json`);
      await fs.writeFile(reviewsBackupPath, JSON.stringify(reviews, null, 2));
      console.log(`📦 Reviews backup created: ${reviewsBackupPath}`);
      
      // Drop the collection and recreate with string IDs
      await db.collection('reviews').drop();
      
      // Convert review _ids and references
      const convertedReviews = reviews.map(review => ({
        ...review,
        _id: review._id.toString(),
        submissionId: review.submissionId ? review.submissionId.toString() : null,
        reviewerId: review.reviewerId ? review.reviewerId.toString() : null
      }));
      
      if (convertedReviews.length > 0) {
        await db.collection('reviews').insertMany(convertedReviews);
        totalConverted += convertedReviews.length;
        console.log(`   Converted ${convertedReviews.length} reviews with string IDs`);
      }
    }
    
    console.log(`\n📊 Conversion Summary:`);
    console.log(`   Total documents converted: ${totalConverted}`);
    console.log(`   Users: ${users.length}`);
    console.log(`   Submissions: ${submissions.length}`);
    console.log(`   Contents updated: ${contents.filter(c => c.submissionId && typeof c.submissionId === 'object').length}`);
    console.log(`   Reviews: ${reviews.length}`);
    
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN completed - no changes made');
    } else {
      console.log('\n✅ ObjectId to string conversion completed!');
      console.log('🔍 Verifying conversion...');
      
      // Verify conversion
      const userCheck = await db.collection('users').findOne({});
      const submissionCheck = await db.collection('submissions').findOne({});
      
      console.log(`   User _id type: ${typeof userCheck._id}`);
      console.log(`   Submission _id type: ${typeof submissionCheck._id}`);
      console.log(`   Submission userId type: ${typeof submissionCheck.userId}`);
    }
    
  } catch (error) {
    console.error('❌ Conversion failed:', error);
  } finally {
    await client.close();
  }
}

// Usage info
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🔧 ObjectId to String Conversion Tool

This script converts all ObjectIds to strings in the production database
to match the application's expected data types.

Usage:
  node convert-all-objectids-to-strings.js [options]

Options:
  --dry-run      Preview changes without executing
  --help         Show this help message

Examples:
  # Preview the conversion
  node convert-all-objectids-to-strings.js --dry-run
  
  # Execute the conversion
  node convert-all-objectids-to-strings.js
`);
  process.exit(0);
}

convertAllObjectIdsToStrings().catch(console.error);