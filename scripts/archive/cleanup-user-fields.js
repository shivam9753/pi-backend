const mongoose = require('mongoose');

// Connect to MongoDB
async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/poemsindiadb-dev', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Cleanup user fields
async function cleanupUserFields() {
  try {
    const User = require('../models/User');
    
    console.log('🧹 Starting user fields cleanup...');
    
    // Remove unnecessary fields from all user documents
    const result = await User.updateMany(
      {}, // Match all documents
      {
        $unset: {
          // Remove old fields that are no longer needed
          tempBio: "",
          tempProfileImage: "",
          profileApproval: "",
          socialLinks: "",
          stats: "",
          preferences: "",
          profileCompleted: "",
          firstLogin: ""
        },
        $set: {
          // Add needsProfileCompletion field if it doesn't exist
          needsProfileCompletion: false
        }
      },
      {
        multi: true
      }
    );
    
    console.log(`✅ Updated ${result.modifiedCount} user documents`);
    console.log(`📊 Matched ${result.matchedCount} user documents`);
    
    // Show sample of cleaned user data
    const sampleUsers = await User.find({}).limit(3).select('_id email username name role bio profileImage needsProfileCompletion');
    console.log('\n📋 Sample cleaned user data:');
    sampleUsers.forEach(user => {
      console.log({
        _id: user._id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
        bio: user.bio?.substring(0, 50) + '...',
        profileImage: user.profileImage?.substring(0, 50) + '...',
        needsProfileCompletion: user.needsProfileCompletion
      });
    });
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    throw error;
  }
}

// Main execution
async function main() {
  try {
    await connectDatabase();
    await cleanupUserFields();
    console.log('\n✅ User fields cleanup completed successfully!');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('📝 Database connection closed');
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { cleanupUserFields };