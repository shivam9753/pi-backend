const mongoose = require('mongoose');
require('dotenv').config();

// Database connection URLs
const DEV_DB_URL = process.env.ATLAS_URL; // poemsindiadb-dev
const PROD_DB_URL = process.env.ATLAS_URL.replace('poemsindiadb-dev', 'poemsindiadb'); // poemsindiadb

async function verifyDatabase(connectionUrl, dbName) {
  console.log(`\n🔍 Verifying ${dbName}...`);
  
  try {
    await mongoose.connect(connectionUrl);
    console.log(`✅ Connected to ${dbName}`);
    
    const db = mongoose.connection.db;
    
    // Check for any remaining problematic fields
    const checks = [
      {
        name: 'reviewerName in reviews',
        collection: 'reviews',
        query: { reviewerName: { $exists: true } }
      },
      {
        name: 'markForDeletion in submissions',
        collection: 'submissions', 
        query: { markForDeletion: { $exists: true } }
      },
      {
        name: 'markedForDeletion in submissions',
        collection: 'submissions',
        query: { markedForDeletion: { $exists: true } }
      },
      {
        name: 'eligibleForPurge in submissions',
        collection: 'submissions',
        query: { eligibleForPurge: { $exists: true } }
      },
      {
        name: 'purgeEligibleSince in submissions',
        collection: 'submissions',
        query: { purgeEligibleSince: { $exists: true } }
      },
      {
        name: 'isDraft in submissions',
        collection: 'submissions',
        query: { isDraft: { $exists: true } }
      },
      {
        name: 'publishSettings in submissions',
        collection: 'submissions',
        query: { 'seo.publishSettings': { $exists: true } }
      }
    ];
    
    let allClean = true;
    
    for (const check of checks) {
      const count = await db.collection(check.collection).countDocuments(check.query);
      if (count > 0) {
        console.log(`❌ Found ${count} documents with ${check.name}`);
        allClean = false;
      } else {
        console.log(`✅ No ${check.name} found`);
      }
    }
    
    // Sample a few documents to verify structure
    console.log('\n📋 Sample Document Structures:');
    
    const sampleReview = await db.collection('reviews').findOne({});
    if (sampleReview) {
      console.log('   Review fields:', Object.keys(sampleReview).sort());
    }
    
    const sampleSubmission = await db.collection('submissions').findOne({});
    if (sampleSubmission) {
      const submissionFields = Object.keys(sampleSubmission).sort();
      console.log('   Submission fields:', submissionFields);
      
      if (sampleSubmission.seo) {
        console.log('   Submission SEO fields:', Object.keys(sampleSubmission.seo).sort());
      }
    }
    
    if (allClean) {
      console.log(`\n🎉 ${dbName} is fully clean!`);
    } else {
      console.log(`\n⚠️  ${dbName} still has some issues that need attention`);
    }
    
  } catch (error) {
    console.error(`❌ Error verifying ${dbName}:`, error.message);
  } finally {
    await mongoose.disconnect();
  }
  
  console.log(`${dbName} verification complete`);
  return allClean;
}

async function main() {
  console.log('🔍 Database Schema Verification');
  console.log('===============================');
  
  try {
    const devClean = await verifyDatabase(DEV_DB_URL, 'poemsindiadb-dev');
    const prodClean = await verifyDatabase(PROD_DB_URL, 'poemsindiadb');
    
    console.log('\n📊 Final Verification Summary:');
    console.log(`   poemsindiadb-dev: ${devClean ? '✅ Clean' : '❌ Issues Found'}`);
    console.log(`   poemsindiadb: ${prodClean ? '✅ Clean' : '❌ Issues Found'}`);
    
    if (devClean && prodClean) {
      console.log('\n🎉 Both databases are fully clean and ready!');
    } else {
      console.log('\n⚠️  Some databases still need attention');
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
}

main();