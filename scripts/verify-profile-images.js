#!/usr/bin/env node

/**
 * Script to verify and display current user profile images
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
    console.log('✅ Connected to production database');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

async function verifyProfileImages() {
  try {
    // Get users with profile images
    const users = await User.find({
      profileImage: { $exists: true, $ne: '', $ne: null }
    }).select('name email profileImage').lean();

    console.log(`\n📊 Found ${users.length} users with profile images:`);
    
    // Categorize by image source
    let s3Images = 0;
    let localImages = 0;
    let otherImages = 0;

    users.forEach((user, index) => {
      if (index < 10) { // Show first 10 users
        console.log(`  ${index + 1}. ${user.name} (${user.email})`);
        console.log(`     📷 ${user.profileImage.substring(0, 80)}...`);
      }
      
      if (user.profileImage.includes('s3.ap-south-1.amazonaws.com')) {
        s3Images++;
      } else if (user.profileImage.includes('localhost:3000')) {
        localImages++;
      } else {
        otherImages++;
      }
    });

    console.log(`\n📈 Image Sources:`);
    console.log(`  🌐 S3 Images: ${s3Images}`);
    console.log(`  🏠 Local Images: ${localImages}`);
    console.log(`  🔗 Other Sources: ${otherImages}`);

    // Check published poems with images
    const publishedPoems = await Submission.find({
      submissionType: 'poem',
      status: 'published',
      imageUrl: { $exists: true, $ne: '', $ne: null }
    }).populate('userId', '_id name email profileImage').lean();

    console.log(`\n🎭 Found ${publishedPoems.length} published poems with images:`);
    
    publishedPoems.forEach((poem, index) => {
      console.log(`  ${index + 1}. "${poem.title}"`);
      console.log(`     👤 Author: ${poem.userId?.name} (${poem.userId?.email})`);
      console.log(`     🖼️  Poem Image: ${poem.imageUrl.substring(0, 60)}...`);
      console.log(`     📷 Profile Image: ${poem.userId?.profileImage ? poem.userId.profileImage.substring(0, 60) + '...' : 'None'}`);
      console.log(`     🔄 Same Image: ${poem.imageUrl === poem.userId?.profileImage ? 'YES' : 'NO'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
}

async function main() {
  try {
    await connectToDatabase();
    await verifyProfileImages();
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

main();