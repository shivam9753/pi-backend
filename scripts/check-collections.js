const mongoose = require('mongoose');
require('dotenv').config();

const DEV_DB_URL = process.env.ATLAS_URL;

async function checkCollections() {
  console.log('\n🔍 Checking database collections...');
  
  try {
    await mongoose.connect(DEV_DB_URL);
    console.log('✅ Connected to poemsindiadb-dev');
    
    const db = mongoose.connection.db;
    
    // List all collections
    const collections = await db.listCollections().toArray();
    console.log('\n📂 Available collections:');
    collections.forEach(col => {
      console.log(`   - ${col.name}`);
    });
    
    // Check topic pitch by ID directly in each possible collection name
    const topicId = '68b5814467f9912b2d236a4a';
    console.log(`\n🎯 Looking for topic ID: ${topicId}`);
    
    const possibleCollections = ['topicpitches', 'topic-pitches', 'topic_pitches', 'topicPitches'];
    
    for (const collectionName of possibleCollections) {
      try {
        const found = await db.collection(collectionName).findOne({ _id: topicId });
        if (found) {
          console.log(`✅ Found topic in collection "${collectionName}":`, found.title);
          break;
        }
      } catch (error) {
        // Collection might not exist, continue
      }
    }
    
    // Check if it's an ObjectId instead
    if (mongoose.Types.ObjectId.isValid(topicId)) {
      console.log('\n🔍 Also checking as ObjectId...');
      for (const collectionName of possibleCollections) {
        try {
          const found = await db.collection(collectionName).findOne({ _id: new mongoose.Types.ObjectId(topicId) });
          if (found) {
            console.log(`✅ Found topic as ObjectId in collection "${collectionName}":`, found.title);
            break;
          }
        } catch (error) {
          // Collection might not exist, continue
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

checkCollections();