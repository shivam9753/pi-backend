const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

// Load environment-specific .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile });

let db;
let client;

async function connectDB() {
  try {
    if (!client) {
      client = new MongoClient(process.env.ATLAS_URL);
      await client.connect();
      
      // Determine database name based on environment
      const dbName = NODE_ENV === 'production' ? 'poemsindiadb' : 'poemsindiadb-dev';
      db = client.db(dbName);
      console.log(`Connected to MongoDB database: ${dbName}`);
    }
    return db;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

function getDB() {
  if (!db) {
    throw new Error('Database not connected!');
  }
  return db;
}

module.exports = {
  connectDB,
  getDB,
};