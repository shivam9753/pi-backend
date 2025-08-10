const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Content = require('../models/Content');

async function debugDatabase() {
  try {
    console.log('🔍 Debugging Database Connection and Data...');
    
    // Load environment variables
    require('dotenv').config();
    
    if (!process.env.ATLAS_URL) {
      console.error('❌ ATLAS_URL environment variable not found');
      return;
    }
    
    console.log('📊 Connecting to database...');
    console.log('📊 Database URL:', process.env.ATLAS_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
    
    // Connect to database
    await mongoose.connect(process.env.ATLAS_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to database successfully');
    
    // Check database and collection names
    const db = mongoose.connection.db;
    const admin = db.admin();
    const dbs = await admin.listDatabases();
    console.log('📊 Available databases:', dbs.databases.map(d => d.name));
    
    const collections = await db.listCollections().toArray();
    console.log('📊 Collections in current database:', collections.map(c => c.name));
    
    // Check each available database for data
    console.log('\n🔍 Checking data in each database...');
    
    for (const dbInfo of dbs.databases) {
      if (['admin', 'local', 'config'].includes(dbInfo.name)) continue;
      
      console.log(`\n📊 Checking database: ${dbInfo.name}`);
      const testDb = mongoose.connection.client.db(dbInfo.name);
      
      try {
        const submissionsCollection = testDb.collection('submissions');
        const contentsCollection = testDb.collection('contents');
        
        const submissionCount = await submissionsCollection.countDocuments();
        const contentCount = await contentsCollection.countDocuments();
        
        console.log(`   📋 Submissions: ${submissionCount}`);
        console.log(`   📝 Contents: ${contentCount}`);
        
        if (submissionCount > 0 || contentCount > 0) {
          console.log(`   🎯 Found data in database: ${dbInfo.name}!`);
          
          // Check for published submissions in this database
          const publishedCount = await submissionsCollection.countDocuments({ status: 'published' });
          console.log(`   📰 Published submissions: ${publishedCount}`);
        }
      } catch (err) {
        console.log(`   ❌ Error checking ${dbInfo.name}:`, err.message);
      }
    }
    
    // Check submissions in current database
    console.log('\n📋 Checking Submissions in current database...');
    const totalSubmissions = await Submission.countDocuments();
    console.log(`📊 Total submissions: ${totalSubmissions}`);
    
    if (totalSubmissions > 0) {
      const submissionsByStatus = await Submission.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);
      
      console.log('📊 Submissions by status:');
      submissionsByStatus.forEach(stat => {
        console.log(`   ${stat._id}: ${stat.count}`);
      });
      
      // Sample submission
      const sampleSubmission = await Submission.findOne().lean();
      if (sampleSubmission) {
        console.log('\n📋 Sample submission structure:');
        console.log('   _id:', sampleSubmission._id);
        console.log('   status:', sampleSubmission.status);
        console.log('   title:', sampleSubmission.title);
        console.log('   contentIds length:', sampleSubmission.contentIds?.length || 0);
        console.log('   eligibleForPurge:', sampleSubmission.eligibleForPurge);
        console.log('   reviewedAt:', sampleSubmission.reviewedAt);
      }
    }
    
    // Check content
    console.log('\n📝 Checking Content...');
    const totalContent = await Content.countDocuments();
    console.log(`📊 Total content: ${totalContent}`);
    
    if (totalContent > 0) {
      const contentByType = await Content.aggregate([
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 }
          }
        },
        { $sort: { count: -1 } }
      ]);
      
      console.log('📊 Content by type:');
      contentByType.forEach(stat => {
        console.log(`   ${stat._id}: ${stat.count}`);
      });
      
      // Sample content
      const sampleContent = await Content.findOne().lean();
      if (sampleContent) {
        console.log('\n📝 Sample content structure:');
        console.log('   _id:', sampleContent._id);
        console.log('   title:', sampleContent.title);
        console.log('   type:', sampleContent.type);
        console.log('   userId:', sampleContent.userId);
        console.log('   submissionId:', sampleContent.submissionId);
        console.log('   isPublished:', sampleContent.isPublished);
        console.log('   tags:', sampleContent.tags);
      }
      
      // Check published content
      const publishedContent = await Content.countDocuments({ isPublished: true });
      console.log(`📊 Already published content: ${publishedContent}`);
    }
    
    // Check for specific migration needs
    console.log('\n🔧 Migration Analysis:');
    
    // Check submissions eligible for purge
    const rejectedCount = await Submission.countDocuments({ status: 'rejected' });
    const spamCount = await Submission.countDocuments({ status: 'spam' });
    const alreadyEligible = await Submission.countDocuments({ eligibleForPurge: true });
    
    console.log(`📊 Rejected submissions: ${rejectedCount}`);
    console.log(`📊 Spam submissions: ${spamCount}`);
    console.log(`📊 Already eligible for purge: ${alreadyEligible}`);
    
    // Check content without submissionId
    const contentWithoutSubmissionId = await Content.countDocuments({
      submissionId: { $exists: false }
    });
    console.log(`📊 Content without submissionId: ${contentWithoutSubmissionId}`);
    
    // Check published submissions vs published content
    const publishedSubmissions = await Submission.countDocuments({ status: 'published' });
    const publishedContentCount = await Content.countDocuments({ isPublished: true });
    
    console.log(`📊 Published submissions: ${publishedSubmissions}`);
    console.log(`📊 Published content: ${publishedContentCount}`);
    
    if (publishedSubmissions > 0) {
      console.log('\n📋 Sample published submission:');
      const samplePublished = await Submission.findOne({ status: 'published' })
        .populate('contentIds')
        .lean();
      
      if (samplePublished) {
        console.log('   _id:', samplePublished._id);
        console.log('   title:', samplePublished.title);
        console.log('   contentIds:', samplePublished.contentIds.map(c => c._id));
        console.log('   Content published flags:', samplePublished.contentIds.map(c => c.isPublished));
      }
    }
    
    console.log('\n✅ Database debug complete!');
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('📊 Disconnected from database');
  }
}

// Run debug if called directly
if (require.main === module) {
  debugDatabase().then(() => process.exit(0));
}

module.exports = { debugDatabase };