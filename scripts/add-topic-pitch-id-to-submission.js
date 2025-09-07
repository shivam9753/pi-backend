const mongoose = require('mongoose');
require('dotenv').config();

// Database connection URL for development
const DEV_DB_URL = process.env.ATLAS_URL; // poemsindiadb-dev

async function addTopicPitchIdToSubmission() {
  console.log('\n🔧 Starting topic pitch ID update for specific submission...');
  
  try {
    // Connect to development database
    await mongoose.connect(DEV_DB_URL);
    console.log('✅ Connected to poemsindiadb-dev');
    
    const db = mongoose.connection.db;
    
    // Submission details
    const submissionId = '13fe2b15-7084-477d-be27-cf2ad813acfa';
    const topicPitchId = '68b5814467f9912b2d236a4a';
    
    console.log(`📝 Updating submission: ${submissionId}`);
    console.log(`🎯 Adding topicPitchId: ${topicPitchId}`);
    
    // First, verify the submission exists
    const existingSubmission = await db.collection('submissions').findOne({ _id: submissionId });
    
    if (!existingSubmission) {
      console.error(`❌ Submission ${submissionId} not found!`);
      return;
    }
    
    console.log(`✅ Found submission: "${existingSubmission.title}"`);
    console.log(`📊 Current status: ${existingSubmission.status}`);
    console.log(`👤 User ID: ${existingSubmission.userId}`);
    
    // Check if topicPitchId already exists
    if (existingSubmission.topicPitchId) {
      console.log(`⚠️  Submission already has topicPitchId: ${existingSubmission.topicPitchId}`);
      console.log('🤔 Do you want to overwrite it? (This script will proceed anyway)');
    }
    
    // Verify the topic pitch exists (check as ObjectId since that's how it's stored)
    const existingTopicPitch = await db.collection('topicpitches').findOne({ 
      _id: new mongoose.Types.ObjectId(topicPitchId) 
    });
    
    if (!existingTopicPitch) {
      console.error(`❌ Topic pitch ${topicPitchId} not found!`);
      console.log('🔍 Please verify the topic pitch ID is correct.');
      return;
    }
    
    console.log(`✅ Found topic pitch: "${existingTopicPitch.title}"`);
    console.log(`📊 Topic status: ${existingTopicPitch.status}`);
    console.log(`👤 Pitched by: ${existingTopicPitch.pitcherName}`);
    
    // Perform the update
    console.log('\n🚀 Executing update...');
    const updateResult = await db.collection('submissions').updateOne(
      { _id: submissionId },
      { 
        $set: { 
          topicPitchId: topicPitchId,
          updatedAt: new Date() // Update timestamp
        } 
      }
    );
    
    if (updateResult.matchedCount === 0) {
      console.error('❌ No submission matched the ID');
      return;
    }
    
    if (updateResult.modifiedCount === 0) {
      console.log('⚠️  Submission found but no changes made (possibly same value)');
    } else {
      console.log('✅ Submission updated successfully!');
    }
    
    // Verify the update
    console.log('\n🔍 Verifying update...');
    const updatedSubmission = await db.collection('submissions').findOne({ _id: submissionId });
    
    if (updatedSubmission && updatedSubmission.topicPitchId === topicPitchId) {
      console.log(`✅ Verification successful! topicPitchId is now: ${updatedSubmission.topicPitchId}`);
      console.log(`📅 Updated at: ${updatedSubmission.updatedAt}`);
    } else {
      console.error('❌ Verification failed! Update may not have been applied correctly.');
    }
    
    // Test the filter query
    console.log('\n🧪 Testing topic submissions filter...');
    const topicSubmissions = await db.collection('submissions').find({
      topicPitchId: { $ne: null }
    }).toArray();
    
    console.log(`📊 Found ${topicSubmissions.length} submissions with topic pitch references:`);
    topicSubmissions.forEach(sub => {
      console.log(`   - ${sub._id}: "${sub.title}" (topicPitchId: ${sub.topicPitchId})`);
    });
    
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Error updating submission:', error);
    throw error;
  } finally {
    // Close connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  addTopicPitchIdToSubmission()
    .then(() => {
      console.log('\n🎉 Database update completed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = addTopicPitchIdToSubmission;