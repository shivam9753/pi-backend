#!/usr/bin/env node

/**
 * Database Restore Script
 * 
 * Restores database from a JSON backup created by backup-database.js
 * 
 * Usage:
 *   node scripts/restore-database.js <backup-directory>
 *   
 * Example:
 *   node scripts/restore-database.js backups/backup-2025-01-04T12-30-00-000Z
 */

const mongoose = require('mongoose');
const fs = require('fs').promises;
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
console.log(`Loading environment config: ${envFile}`);
dotenv.config({ path: envFile });

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

const restoreFromBackup = async (backupPath) => {
  try {
    // Check if backup directory exists
    const backupInfoPath = path.join(backupPath, 'backup-info.json');
    const backupInfoData = await fs.readFile(backupInfoPath, 'utf8');
    const backupInfo = JSON.parse(backupInfoData);
    
    console.log(`📋 Backup Information:`);
    console.log(`   Created: ${backupInfo.timestamp}`);
    console.log(`   Database: ${backupInfo.database}`);
    console.log(`   Environment: ${backupInfo.environment}`);
    console.log(`   Collections: ${Object.keys(backupInfo.collections).join(', ')}\n`);
    
    for (const [collectionName, info] of Object.entries(backupInfo.collections)) {
      console.log(`🔄 Restoring ${collectionName}...`);
      
      const filePath = path.join(backupPath, info.file);
      const data = await fs.readFile(filePath, 'utf8');
      const documents = JSON.parse(data);
      
      // Drop existing collection
      try {
        await mongoose.connection.db.collection(collectionName).drop();
        console.log(`   🗑️  Dropped existing ${collectionName} collection`);
      } catch (error) {
        if (error.code === 26) {
          console.log(`   ℹ️  Collection ${collectionName} doesn't exist, creating new`);
        } else {
          throw error;
        }
      }
      
      // Insert documents
      if (documents.length > 0) {
        await mongoose.connection.db.collection(collectionName).insertMany(documents);
        console.log(`   ✅ Restored ${documents.length} documents to ${collectionName}`);
      } else {
        console.log(`   ℹ️  No documents to restore for ${collectionName}`);
      }
    }
    
    console.log(`\n✅ Database restore completed successfully!`);
    
  } catch (error) {
    console.error('❌ Restore failed:', error.message);
    throw error;
  }
};

const main = async () => {
  const backupPath = process.argv[2];
  
  if (!backupPath) {
    console.error('❌ Please provide a backup directory path');
    console.log('Usage: node scripts/restore-database.js <backup-directory-path>');
    process.exit(1);
  }
  
  const fullBackupPath = path.resolve(backupPath);
  console.log(`🔄 Starting database restore from: ${fullBackupPath}\n`);
  
  try {
    await connectDB();
    await restoreFromBackup(fullBackupPath);
    
    console.log('\n🎉 Restore process completed successfully!');
    console.log('📊 Your database has been restored from the backup.');
    
  } catch (error) {
    console.error('\n❌ Restore process failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
  }
};

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { restoreFromBackup };