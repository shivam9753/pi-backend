const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment-specific .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile });

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.ATLAS_URL);

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Create indexes for better performance
    await createIndexes();
    
    return conn;
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    const db = mongoose.connection.db;
    
    // User indexes - handled by Mongoose schema unique: true
    // await db.collection('users').createIndex({ email: 1 }, { unique: true });
    // await db.collection('users').createIndex({ username: 1 }, { unique: true });
    
    // Submission indexes
    await db.collection('submissions').createIndex({ userId: 1 });
    await db.collection('submissions').createIndex({ status: 1 });
    await db.collection('submissions').createIndex({ submissionType: 1 });
    await db.collection('submissions').createIndex({ createdAt: -1 });
    await db.collection('submissions').createIndex({ reviewedAt: -1 });
    await db.collection('submissions').createIndex({ tags: 1 });
    
    // Content indexes (using proper collection name)
    await db.collection('contents').createIndex({ userId: 1 });
    await db.collection('contents').createIndex({ type: 1 });
    await db.collection('contents').createIndex({ tags: 1 });
    await db.collection('contents').createIndex({ createdAt: -1 });
    
    // Review indexes
    await db.collection('reviews').createIndex({ submissionId: 1 });
    await db.collection('reviews').createIndex({ reviewerId: 1 });
    
    console.log('Database indexes created successfully');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
};

module.exports = { connectDB };