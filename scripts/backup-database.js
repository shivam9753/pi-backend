#!/usr/bin/env node

/**
 * Database Backup Script
 * 
 * Creates a JSON backup of all collections before running cleanup
 * 
 * Usage:
 *   node scripts/backup-database.js
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

const createBackup = async () => {
  const backupDir = path.join(__dirname, '..', 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `backup-${timestamp}`);
  
  try {
    // Create backup directory
    await fs.mkdir(backupPath, { recursive: true });
    console.log(`📁 Created backup directory: ${backupPath}`);
    
    const collections = ['submissions', 'contents', 'users', 'reviews'];
    const backupInfo = {
      timestamp: new Date().toISOString(),
      database: mongoose.connection.db.databaseName,
      environment: NODE_ENV,
      collections: {}
    };
    
    for (const collectionName of collections) {
      console.log(`💾 Backing up ${collectionName}...`);
      
      const collection = mongoose.connection.db.collection(collectionName);
      const documents = await collection.find({}).toArray();
      
      // Save collection data
      const filePath = path.join(backupPath, `${collectionName}.json`);
      await fs.writeFile(filePath, JSON.stringify(documents, null, 2));
      
      backupInfo.collections[collectionName] = {
        count: documents.length,
        file: `${collectionName}.json`
      };
      
      console.log(`   ✅ Backed up ${documents.length} documents`);
    }
    
    // Save backup info
    await fs.writeFile(
      path.join(backupPath, 'backup-info.json'), 
      JSON.stringify(backupInfo, null, 2)
    );
    
    console.log(`\n✅ Backup completed successfully!`);
    console.log(`📂 Backup location: ${backupPath}`);
    console.log(`📊 Collections backed up:`);
    
    Object.entries(backupInfo.collections).forEach(([name, info]) => {
      console.log(`   ${name}: ${info.count} documents`);
    });
    
    return backupPath;
    
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    throw error;
  }
};

const main = async () => {
  console.log('💾 Starting database backup...\n');
  
  try {
    await connectDB();
    const backupPath = await createBackup();
    
    console.log('\n🎉 Backup process completed!');
    console.log(`📁 Your data is safely backed up at: ${backupPath}`);
    console.log('💡 You can now safely run the cleanup script.');
    
  } catch (error) {
    console.error('\n❌ Backup process failed:', error.message);
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

module.exports = { createBackup };