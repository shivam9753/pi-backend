#!/usr/bin/env node

/**
 * Script to investigate the database structure and find where published poems with images are stored
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '.env.production' });

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

async function investigateDatabase() {
  try {
    // Get all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('\n📋 Available collections:');
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });

    // Check different possible collections for poems
    const possibleCollections = ['contents', 'submissions', 'poems', 'articles'];
    
    for (const collectionName of possibleCollections) {
      try {
        const collection = mongoose.connection.db.collection(collectionName);
        const count = await collection.countDocuments();
        
        if (count > 0) {
          console.log(`\n🔍 Investigating ${collectionName} (${count} documents):`);
          
          // Get sample documents
          const samples = await collection.find({}).limit(3).toArray();
          
          // Check for poems with images
          const poemsWithImages = await collection.find({
            $or: [
              { submissionType: 'poem', imageUrl: { $exists: true, $ne: '', $ne: null } },
              { type: 'poem', imageUrl: { $exists: true, $ne: '', $ne: null } },
              { contentType: 'poem', imageUrl: { $exists: true, $ne: '', $ne: null } },
              { submissionType: 'poem', image: { $exists: true, $ne: '', $ne: null } },
              { type: 'poem', image: { $exists: true, $ne: '', $ne: null } }
            ]
          }).limit(5).toArray();
          
          console.log(`  📊 Poems with images: ${poemsWithImages.length}`);
          
          if (poemsWithImages.length > 0) {
            console.log('  🖼️  Sample poem with image:');
            const sample = poemsWithImages[0];
            console.log(`    Title: ${sample.title || sample.name || 'N/A'}`);
            console.log(`    Type: ${sample.submissionType || sample.type || sample.contentType || 'N/A'}`);
            console.log(`    Status: ${sample.status || 'N/A'}`);
            console.log(`    Image: ${sample.imageUrl || sample.image || 'N/A'}`);
            console.log(`    User: ${sample.userId || sample.authorId || sample.author || 'N/A'}`);
            console.log(`    Fields: ${Object.keys(sample).join(', ')}`);
          }
          
          // Check different status values
          const statuses = await collection.distinct('status');
          if (statuses.length > 0) {
            console.log(`  📈 Available statuses: ${statuses.join(', ')}`);
          }
          
          // Check different types
          const types = await collection.distinct('submissionType');
          if (types.length > 0) {
            console.log(`  📝 Available submission types: ${types.join(', ')}`);
          }
        }
      } catch (error) {
        // Collection doesn't exist, skip
      }
    }

    // Check users collection
    try {
      const usersCollection = mongoose.connection.db.collection('users');
      const userCount = await usersCollection.countDocuments();
      const usersWithImages = await usersCollection.countDocuments({
        profileImage: { $exists: true, $ne: '', $ne: null }
      });
      
      console.log(`\n👥 Users: ${usersWithImages}/${userCount} have profile images`);
      
      // Sample user with profile image
      const userWithImage = await usersCollection.findOne({
        profileImage: { $exists: true, $ne: '', $ne: null }
      });
      
      if (userWithImage) {
        console.log(`  📷 Sample user with image: ${userWithImage.name} - ${userWithImage.profileImage?.substring(0, 60)}...`);
      }
      
    } catch (error) {
      console.error('Error checking users:', error.message);
    }

  } catch (error) {
    console.error('❌ Investigation failed:', error);
  }
}

async function main() {
  try {
    await connectToDatabase();
    await investigateDatabase();
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
}

main();