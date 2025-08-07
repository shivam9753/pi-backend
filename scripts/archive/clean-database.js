#!/usr/bin/env node

/**
 * Database Cleanup Script
 * 
 * This script removes irrelevant fields from existing documents
 * according to the new model specifications:
 * 
 * Submission model:
 * - Remove: hasImages, imageStorage, tags, viewCount, likeCount, __v
 * 
 * Content model:  
 * - Remove: language, wordCount, createdAt, updatedAt, __v
 * 
 * All models:
 * - Remove: __v (version key)
 * 
 * Usage:
 *   node scripts/clean-database.js
 * 
 * IMPORTANT: This will permanently modify your database!
 * Make sure you have a backup before running this script.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
console.log(`Loading environment config: ${envFile}`);
dotenv.config({ path: envFile });

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.ATLAS_URL);
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.db.databaseName}`);
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

// Database cleanup functions
const cleanupSubmissions = async () => {
  console.log('\n🧹 Cleaning Submissions collection...');
  
  try {
    // Remove the unwanted fields from all submissions
    const result = await mongoose.connection.db.collection('submissions').updateMany(
      {}, // Match all documents
      {
        $unset: {
          hasImages: '',
          imageStorage: '',
          tags: '',
          viewCount: '',
          likeCount: '',
          __v: ''
        }
      }
    );
    
    console.log(`   ✅ Updated ${result.modifiedCount} submission documents`);
    
    // Get stats
    const totalSubmissions = await mongoose.connection.db.collection('submissions').countDocuments();
    console.log(`   📊 Total submissions: ${totalSubmissions}`);
    
    // Show status breakdown
    const statusStats = await mongoose.connection.db.collection('submissions').aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('   📈 Status breakdown:');
    statusStats.forEach(stat => {
      console.log(`      ${stat._id}: ${stat.count}`);
    });
    
  } catch (error) {
    console.error('❌ Error cleaning submissions:', error.message);
    throw error;
  }
};

const cleanupContents = async () => {
  console.log('\n🧹 Cleaning Contents collection...');
  
  try {
    // Remove the unwanted fields from all contents
    const result = await mongoose.connection.db.collection('contents').updateMany(
      {}, // Match all documents
      {
        $unset: {
          language: '',
          wordCount: '',
          createdAt: '',
          updatedAt: '',
          __v: ''
        }
      }
    );
    
    console.log(`   ✅ Updated ${result.modifiedCount} content documents`);
    
    // Get stats
    const totalContents = await mongoose.connection.db.collection('contents').countDocuments();
    console.log(`   📊 Total contents: ${totalContents}`);
    
    // Show type breakdown
    const typeStats = await mongoose.connection.db.collection('contents').aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('   📈 Type breakdown:');
    typeStats.forEach(stat => {
      console.log(`      ${stat._id}: ${stat.count}`);
    });
    
  } catch (error) {
    console.error('❌ Error cleaning contents:', error.message);
    throw error;
  }
};

const cleanupUsers = async () => {
  console.log('\n🧹 Cleaning Users collection...');
  
  try {
    // Remove version key from all users
    const result = await mongoose.connection.db.collection('users').updateMany(
      {}, // Match all documents
      {
        $unset: {
          __v: ''
        }
      }
    );
    
    console.log(`   ✅ Updated ${result.modifiedCount} user documents`);
    
    // Get stats
    const totalUsers = await mongoose.connection.db.collection('users').countDocuments();
    console.log(`   📊 Total users: ${totalUsers}`);
    
    // Show role breakdown
    const roleStats = await mongoose.connection.db.collection('users').aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();
    
    console.log('   📈 Role breakdown:');
    roleStats.forEach(stat => {
      console.log(`      ${stat._id}: ${stat.count}`);
    });
    
  } catch (error) {
    console.error('❌ Error cleaning users:', error.message);
    throw error;
  }
};

const cleanupReviews = async () => {
  console.log('\n🧹 Cleaning Reviews collection...');
  
  try {
    // Remove version key from all reviews
    const result = await mongoose.connection.db.collection('reviews').updateMany(
      {}, // Match all documents
      {
        $unset: {
          __v: ''
        }
      }
    );
    
    console.log(`   ✅ Updated ${result.modifiedCount} review documents`);
    
    // Get stats
    const totalReviews = await mongoose.connection.db.collection('reviews').countDocuments();
    console.log(`   📊 Total reviews: ${totalReviews}`);
    
    if (totalReviews > 0) {
      // Show status breakdown
      const statusStats = await mongoose.connection.db.collection('reviews').aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort: { count: -1 } }
      ]).toArray();
      
      console.log('   📈 Status breakdown:');
      statusStats.forEach(stat => {
        console.log(`      ${stat._id}: ${stat.count}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error cleaning reviews:', error.message);
    throw error;
  }
};

const removeOrphanedContent = async () => {
  console.log('\n🗑️  Checking for orphaned content...');
  
  try {
    // Find content that doesn't belong to any submission
    const orphanedContent = await mongoose.connection.db.collection('contents').aggregate([
      {
        $lookup: {
          from: 'submissions',
          localField: '_id',
          foreignField: 'contentIds',
          as: 'submissions'
        }
      },
      {
        $match: {
          submissions: { $size: 0 }
        }
      },
      {
        $project: {
          _id: 1,
          title: 1,
          type: 1
        }
      }
    ]).toArray();
    
    if (orphanedContent.length > 0) {
      console.log(`   ⚠️  Found ${orphanedContent.length} orphaned content items:`);
      orphanedContent.forEach(content => {
        console.log(`      - ${content.title} (${content.type}) [${content._id}]`);
      });
      
      // Uncomment the lines below if you want to actually delete orphaned content
      // const deleteResult = await mongoose.connection.db.collection('contents').deleteMany({
      //   _id: { $in: orphanedContent.map(c => c._id) }
      // });
      // console.log(`   🗑️  Deleted ${deleteResult.deletedCount} orphaned content items`);
      
      console.log('   ℹ️  Orphaned content found but not deleted. Uncomment deletion code if needed.');
    } else {
      console.log('   ✅ No orphaned content found');
    }
    
  } catch (error) {
    console.error('❌ Error checking orphaned content:', error.message);
    throw error;
  }
};

const validateDataIntegrity = async () => {
  console.log('\n🔍 Validating data integrity...');
  
  try {
    // Check submissions without contentIds
    const submissionsWithoutContent = await mongoose.connection.db.collection('submissions').countDocuments({
      $or: [
        { contentIds: { $exists: false } },
        { contentIds: { $size: 0 } }
      ]
    });
    
    if (submissionsWithoutContent > 0) {
      console.log(`   ⚠️  ${submissionsWithoutContent} submissions have no content`);
    } else {
      console.log('   ✅ All submissions have content');
    }
    
    // Check content without userId
    const contentWithoutUser = await mongoose.connection.db.collection('contents').countDocuments({
      userId: { $exists: false }
    });
    
    if (contentWithoutUser > 0) {
      console.log(`   ⚠️  ${contentWithoutUser} content items have no userId`);
    } else {
      console.log('   ✅ All content items have userId');
    }
    
    // Verify no unwanted fields remain
    const submissionsWithOldFields = await mongoose.connection.db.collection('submissions').countDocuments({
      $or: [
        { hasImages: { $exists: true } },
        { imageStorage: { $exists: true } },
        { tags: { $exists: true } },
        { viewCount: { $exists: true } },
        { likeCount: { $exists: true } },
        { __v: { $exists: true } }
      ]
    });
    
    const contentsWithOldFields = await mongoose.connection.db.collection('contents').countDocuments({
      $or: [
        { language: { $exists: true } },
        { wordCount: { $exists: true } },
        { __v: { $exists: true } }
      ]
    });
    
    if (submissionsWithOldFields === 0 && contentsWithOldFields === 0) {
      console.log('   ✅ All unwanted fields successfully removed');
    } else {
      console.log(`   ⚠️  Still found old fields: ${submissionsWithOldFields} submissions, ${contentsWithOldFields} contents`);
    }
    
  } catch (error) {
    console.error('❌ Error validating data integrity:', error.message);
    throw error;
  }
};

// Main execution function
const main = async () => {
  console.log('🚀 Starting database cleanup...');
  console.log('⚠️  WARNING: This will permanently modify your database!');
  console.log('💾 Make sure you have a backup before proceeding.\n');
  
  try {
    await connectDB();
    
    // Perform cleanup operations
    await cleanupSubmissions();
    await cleanupContents();
    await cleanupUsers();
    await cleanupReviews();
    
    // Check for orphaned data
    await removeOrphanedContent();
    
    // Validate the cleanup
    await validateDataIntegrity();
    
    console.log('\n✅ Database cleanup completed successfully!');
    console.log('📊 Summary:');
    console.log('   - Removed irrelevant fields from all collections');
    console.log('   - Removed __v version keys from all documents');
    console.log('   - Checked for orphaned content');
    console.log('   - Validated data integrity');
    
  } catch (error) {
    console.error('\n❌ Database cleanup failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
};

// Run if called directly
if (require.main === module) {
  // Add a confirmation prompt
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  rl.question('Are you sure you want to proceed? This will permanently modify your database. Type "yes" to continue: ', (answer) => {
    if (answer.toLowerCase() === 'yes') {
      rl.close();
      main();
    } else {
      console.log('Operation cancelled.');
      rl.close();
      process.exit(0);
    }
  });
}

module.exports = {
  cleanupSubmissions,
  cleanupContents,
  cleanupUsers,
  cleanupReviews,
  removeOrphanedContent,
  validateDataIntegrity
};