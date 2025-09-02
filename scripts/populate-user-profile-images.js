#!/usr/bin/env node

/**
 * Script to populate user profile images from existing published poem submission images
 * This script connects to the production database and copies submission images to user profiles
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.production' });

// Import models
const User = require('../models/User');
const Submission = require('../models/Submission');

// Production database URL
const ATLAS_URL = process.env.ATLAS_URL;

if (!ATLAS_URL) {
  console.error('❌ ATLAS_URL not found in environment variables');
  process.exit(1);
}

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

async function populateUserProfileImages() {
  try {
    console.log('🔍 Finding published poems with images...');

    // Find all published poems that have imageUrl
    const publishedPoems = await Submission.find({
      submissionType: 'poem',
      status: 'published',
      imageUrl: { $exists: true, $ne: '', $ne: null }
    }).populate('userId', '_id name email profileImage').lean();

    console.log(`📊 Found ${publishedPoems.length} published poems with images`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const poem of publishedPoems) {
      try {
        if (!poem.userId) {
          console.log(`⚠️  Skipping poem "${poem.title}" - no userId`);
          skippedCount++;
          continue;
        }

        const user = poem.userId;
        
        // Skip if user already has a profile image
        if (user.profileImage && user.profileImage.trim() !== '') {
          console.log(`⏭️  Skipping user ${user.name} (${user.email}) - already has profile image`);
          skippedCount++;
          continue;
        }

        // Update user with the poem's image
        await User.findByIdAndUpdate(user._id, {
          profileImage: poem.imageUrl
        });

        console.log(`✅ Updated ${user.name} (${user.email}) with image: ${poem.imageUrl.substring(0, 60)}...`);
        updatedCount++;

      } catch (error) {
        console.error(`❌ Error updating user for poem "${poem.title}":`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`✅ Users updated: ${updatedCount}`);
    console.log(`⏭️  Users skipped: ${skippedCount}`);
    console.log(`❌ Errors: ${errorCount}`);
    console.log(`📊 Total poems processed: ${publishedPoems.length}`);

    return { updatedCount, skippedCount, errorCount };

  } catch (error) {
    console.error('❌ Error in populateUserProfileImages:', error);
    throw error;
  }
}

async function verifyResults() {
  try {
    console.log('\n🔍 Verifying results...');
    
    const usersWithImages = await User.countDocuments({
      profileImage: { $exists: true, $ne: '', $ne: null }
    });
    
    const totalUsers = await User.countDocuments();
    
    console.log(`📊 Users with profile images: ${usersWithImages} / ${totalUsers}`);
    console.log(`📈 Coverage: ${((usersWithImages / totalUsers) * 100).toFixed(1)}%`);
    
  } catch (error) {
    console.error('❌ Error verifying results:', error);
  }
}

async function main() {
  try {
    console.log('🚀 Starting user profile image population script...');
    console.log(`🔗 Connecting to: ${ATLAS_URL.replace(/\/\/.*@/, '//***@')}`);
    
    await connectToDatabase();
    
    const results = await populateUserProfileImages();
    
    await verifyResults();
    
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
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

module.exports = { populateUserProfileImages };