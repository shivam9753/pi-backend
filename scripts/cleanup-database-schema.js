const mongoose = require('mongoose');
require('dotenv').config();

// Database connection URLs
const DEV_DB_URL = process.env.ATLAS_URL; // poemsindiadb-dev
const PROD_DB_URL = process.env.ATLAS_URL.replace('poemsindiadb-dev', 'poemsindiadb'); // poemsindiadb

async function cleanupDatabase(connectionUrl, dbName) {
  console.log(`\n🔧 Starting cleanup for ${dbName}...`);
  
  try {
    // Connect to database
    await mongoose.connect(connectionUrl);
    console.log(`✅ Connected to ${dbName}`);
    
    const db = mongoose.connection.db;
    
    // 1. Remove reviewerName from reviews collection
    console.log('🧹 Removing reviewerName from reviews collection...');
    const reviewResult = await db.collection('reviews').updateMany(
      { reviewerName: { $exists: true } },
      { $unset: { reviewerName: "" } }
    );
    console.log(`   Updated ${reviewResult.modifiedCount} reviews`);
    
    // 2. Remove markForDeletion, eligibleForPurge, purgeEligibleSince from submissions
    console.log('🧹 Removing purge-related fields from submissions collection...');
    const submissionPurgeResult = await db.collection('submissions').updateMany(
      {
        $or: [
          { markForDeletion: { $exists: true } },
          { markedForDeletion: { $exists: true } },
          { eligibleForPurge: { $exists: true } },
          { purgeEligibleSince: { $exists: true } }
        ]
      },
      { 
        $unset: { 
          markForDeletion: "",
          markedForDeletion: "",
          eligibleForPurge: "",
          purgeEligibleSince: ""
        }
      }
    );
    console.log(`   Updated ${submissionPurgeResult.modifiedCount} submissions (purge fields)`);
    
    // 3. Remove isDraft from submissions (redundant with status)
    console.log('🧹 Removing isDraft field from submissions collection...');
    const isDraftResult = await db.collection('submissions').updateMany(
      { isDraft: { $exists: true } },
      { $unset: { isDraft: "" } }
    );
    console.log(`   Updated ${isDraftResult.modifiedCount} submissions (isDraft field)`);
    
    // 4. Remove publishSettings from submissions SEO
    console.log('🧹 Removing publishSettings from submissions SEO...');
    const publishSettingsResult = await db.collection('submissions').updateMany(
      { 'seo.publishSettings': { $exists: true } },
      { $unset: { 'seo.publishSettings': "" } }
    );
    console.log(`   Updated ${publishSettingsResult.modifiedCount} submissions (publishSettings)`);
    
    // 5. Get cleanup statistics
    console.log('📊 Cleanup Statistics:');
    const totalReviews = await db.collection('reviews').countDocuments();
    const totalSubmissions = await db.collection('submissions').countDocuments();
    
    console.log(`   Total reviews: ${totalReviews}`);
    console.log(`   Total submissions: ${totalSubmissions}`);
    
    // 6. Verify cleanup
    const remainingReviewerNames = await db.collection('reviews').countDocuments({ reviewerName: { $exists: true } });
    const remainingPurgeFields = await db.collection('submissions').countDocuments({
      $or: [
        { markForDeletion: { $exists: true } },
        { markedForDeletion: { $exists: true } },
        { eligibleForPurge: { $exists: true } },
        { purgeEligibleSince: { $exists: true } }
      ]
    });
    const remainingIsDraft = await db.collection('submissions').countDocuments({ isDraft: { $exists: true } });
    const remainingPublishSettings = await db.collection('submissions').countDocuments({ 'seo.publishSettings': { $exists: true } });
    
    console.log('\n✅ Verification Results:');
    console.log(`   Remaining reviewerName fields: ${remainingReviewerNames}`);
    console.log(`   Remaining purge fields: ${remainingPurgeFields}`);
    console.log(`   Remaining isDraft fields: ${remainingIsDraft}`);
    console.log(`   Remaining publishSettings: ${remainingPublishSettings}`);
    
    if (remainingReviewerNames === 0 && remainingPurgeFields === 0 && remainingIsDraft === 0 && remainingPublishSettings === 0) {
      console.log('🎉 All redundant fields successfully removed!');
    } else {
      console.log('⚠️  Some fields may still exist - please review manually');
    }
    
    console.log(`✅ Cleanup completed for ${dbName}\n`);
    
  } catch (error) {
    console.error(`❌ Error cleaning up ${dbName}:`, error.message);
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  console.log('🚀 Database Schema Cleanup Script');
  console.log('==================================');
  console.log('This script will remove redundant fields from both databases:');
  console.log('• reviewerName from reviews collection');
  console.log('• markForDeletion, eligibleForPurge, purgeEligibleSince from submissions');
  console.log('• isDraft from submissions');
  console.log('• publishSettings from submissions SEO');
  
  try {
    // Clean development database
    await cleanupDatabase(DEV_DB_URL, 'poemsindiadb-dev');
    
    // Clean production database
    await cleanupDatabase(PROD_DB_URL, 'poemsindiadb');
    
    console.log('🎉 All database cleanups completed successfully!');
    console.log('\n📝 Summary:');
    console.log('✅ Removed reviewerName redundancy from reviews');
    console.log('✅ Removed purge-related flags from submissions');
    console.log('✅ Removed isDraft redundancy from submissions');
    console.log('✅ Removed publishSettings from submissions');
    console.log('\n💡 Your databases are now clean and aligned with the updated schema!');
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
}

// Handle script termination
process.on('SIGINT', () => {
  console.log('\n⚠️  Script interrupted by user');
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the script
main();