#!/usr/bin/env node

/**
 * Script to populate profile images for REAL users (excluding Migration User) 
 * from their existing published poem submission images in S3
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.production' });

const User = require('../models/User');
const Submission = require('../models/Submission');

const ATLAS_URL = process.env.ATLAS_URL;

async function connectToDatabase() {
  try {
    await mongoose.connect(ATLAS_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to production database (poemsindiadb)');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

async function populateRealUserProfileImages(dryRun = true) {
  try {
    console.log(`\n🔍 Finding real users with published poems but no profile images...`);
    console.log(`📋 Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE UPDATE'}`);

    // Find published poems with S3 images by real users (not Migration User)
    const publishedPoems = await Submission.find({
      submissionType: 'poem',
      status: 'published',
      imageUrl: { $exists: true, $ne: '', $ne: null, $regex: /s3\.ap-south-1\.amazonaws\.com/ }
    }).populate('userId', '_id name email profileImage').lean();

    console.log(`📊 Found ${publishedPoems.length} published poems with S3 images`);

    // Filter out Migration User and users who already have profile images
    const candidatePoems = publishedPoems.filter(poem => {
      return poem.userId && 
             poem.userId.email !== 'migration@poemsindia.com' &&
             (!poem.userId.profileImage || poem.userId.profileImage.trim() === '');
    });

    console.log(`🎯 Found ${candidatePoems.length} candidate poems for profile image extraction`);

    // Group by user to avoid duplicates
    const userImageMap = new Map();
    candidatePoems.forEach(poem => {
      const userId = poem.userId._id.toString();
      if (!userImageMap.has(userId)) {
        userImageMap.set(userId, {
          user: poem.userId,
          imageUrl: poem.imageUrl,
          poemTitle: poem.title
        });
      }
    });

    console.log(`👥 Found ${userImageMap.size} unique users to update:`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const [userId, data] of userImageMap) {
      try {
        console.log(`\n  📝 ${data.user.name} (${data.user.email})`);
        console.log(`     📖 From poem: "${data.poemTitle.substring(0, 50)}..."`);
        console.log(`     🖼️  Image: ${data.imageUrl.substring(0, 70)}...`);
        
        if (!dryRun) {
          await User.findByIdAndUpdate(userId, {
            profileImage: data.imageUrl
          });
          console.log(`     ✅ Updated profile image`);
        } else {
          console.log(`     🔄 Would update profile image (dry run)`);
        }
        
        updatedCount++;

      } catch (error) {
        console.error(`     ❌ Error updating user ${data.user.name}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n📈 Results Summary:`);
    console.log(`✅ Users ${dryRun ? 'to be updated' : 'updated'}: ${updatedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    
    return { updatedCount, errorCount, dryRun };

  } catch (error) {
    console.error('❌ Error in populateRealUserProfileImages:', error);
    throw error;
  }
}

async function verifyResults() {
  try {
    console.log('\n🔍 Verifying current state...');
    
    const totalUsers = await User.countDocuments({
      email: { $ne: 'migration@poemsindia.com' }
    });
    
    const realUsersWithImages = await User.countDocuments({
      email: { $ne: 'migration@poemsindia.com' },
      profileImage: { $exists: true, $ne: '', $ne: null }
    });
    
    const s3Images = await User.countDocuments({
      email: { $ne: 'migration@poemsindia.com' },
      profileImage: { $regex: /s3\.ap-south-1\.amazonaws\.com/ }
    });
    
    console.log(`👥 Real users with profile images: ${realUsersWithImages} / ${totalUsers}`);
    console.log(`📈 Coverage: ${((realUsersWithImages / totalUsers) * 100).toFixed(1)}%`);
    console.log(`🌐 S3 images: ${s3Images}`);
    
  } catch (error) {
    console.error('❌ Error verifying results:', error);
  }
}

async function main() {
  try {
    console.log('🚀 Starting real user profile image population script...');
    console.log(`🔗 Database: poemsindiadb (production)`);
    
    await connectToDatabase();
    
    // First run in dry-run mode to show what would be changed
    console.log('\n=== DRY RUN MODE ===');
    const dryResults = await populateRealUserProfileImages(true);
    
    await verifyResults();
    
    // Ask for confirmation to proceed with actual updates
    if (dryResults.updatedCount > 0) {
      console.log('\n❓ Do you want to proceed with the actual updates?');
      console.log('   To run with actual updates, restart the script with --live flag:');
      console.log('   node scripts/populate-real-user-profile-images.js --live');
      
      // Check if --live flag is passed
      if (process.argv.includes('--live')) {
        console.log('\n=== LIVE UPDATE MODE ===');
        const liveResults = await populateRealUserProfileImages(false);
        
        await verifyResults();
        console.log('\n✅ Profile image population completed!');
      }
    } else {
      console.log('\n✅ No users need profile image updates');
    }
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

// Handle script interruption
process.on('SIGINT', async () => {
  console.log('\n⚠️  Script interrupted by user');
  await mongoose.connection.close();
  process.exit(0);
});

// Run the script
if (require.main === module) {
  main();
}

module.exports = { populateRealUserProfileImages };