const mongoose = require('mongoose');
require('dotenv').config();

// Database connection URL for development
const DEV_DB_URL = process.env.ATLAS_URL; // poemsindiadb-dev

async function findSubmissions() {
  console.log('\n🔍 Searching for submissions...');
  
  try {
    // Connect to development database
    await mongoose.connect(DEV_DB_URL);
    console.log('✅ Connected to poemsindiadb-dev');
    
    const db = mongoose.connection.db;
    
    // Search for submissions containing the partial ID
    const partialId = '3fe2b15';
    console.log(`🔎 Searching for submissions containing: ${partialId}`);
    
    const submissions = await db.collection('submissions').find({
      _id: { $regex: partialId, $options: 'i' }
    }).toArray();
    
    console.log(`📊 Found ${submissions.length} matching submissions:`);
    
    if (submissions.length === 0) {
      // Let's check recent submissions instead
      console.log('\n🔎 Checking recent submissions...');
      const recentSubmissions = await db.collection('submissions').find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
      
      console.log(`📊 Recent ${recentSubmissions.length} submissions:`);
      recentSubmissions.forEach((sub, index) => {
        console.log(`${index + 1}. ID: ${sub._id}`);
        console.log(`   Title: "${sub.title}"`);
        console.log(`   Status: ${sub.status}`);
        console.log(`   Created: ${sub.createdAt}`);
        console.log(`   User: ${sub.userId}`);
        if (sub.topicPitchId) {
          console.log(`   TopicPitchId: ${sub.topicPitchId}`);
        }
        console.log('');
      });
    } else {
      submissions.forEach((sub, index) => {
        console.log(`${index + 1}. ID: ${sub._id}`);
        console.log(`   Title: "${sub.title}"`);
        console.log(`   Status: ${sub.status}`);
        console.log(`   Created: ${sub.createdAt}`);
        console.log(`   User: ${sub.userId}`);
        if (sub.topicPitchId) {
          console.log(`   TopicPitchId: ${sub.topicPitchId}`);
        }
        console.log('');
      });
    }
    
    // Also check topic pitches
    console.log('\n🎯 Checking topic pitches...');
    const topicPitches = await db.collection('topicpitches').find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    
    console.log(`📊 Found ${topicPitches.length} recent topic pitches:`);
    topicPitches.forEach((topic, index) => {
      console.log(`${index + 1}. ID: ${topic._id}`);
      console.log(`   Title: "${topic.title}"`);
      console.log(`   Status: ${topic.status}`);
      console.log(`   Pitcher: ${topic.pitcherName}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error searching submissions:', error);
    throw error;
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  findSubmissions()
    .then(() => {
      console.log('\n🎉 Search completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = findSubmissions;