const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config();

let db;

async function connectDB() {
  try {
    const client = await MongoClient.connect(process.env.ATLAS_URL, { useNewUrlParser: true, useUnifiedTopology: true });
    db = client.db('poemsindiadb');
    console.log('Connected to MongoDB');
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