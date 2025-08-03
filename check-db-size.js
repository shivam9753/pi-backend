const mongoose = require('mongoose');
require('dotenv').config();

async function checkDatabaseSize() {
  try {
    await mongoose.connect(process.env.ATLAS_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');
    
    const db = mongoose.connection.db;
    
    // Get database stats
    const stats = await db.stats();
    
    console.log('\n=== DATABASE SIZE REPORT ===');
    console.log(`Database Name: ${db.databaseName}`);
    console.log(`Storage Size: ${(stats.storageSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`Data Size: ${(stats.dataSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`Index Size: ${(stats.indexSize / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`Total Size: ${((stats.storageSize + stats.indexSize) / (1024 * 1024)).toFixed(2)} MB`);
    console.log(`Collections: ${stats.collections}`);
    console.log(`Documents: ${stats.objects}`);
    console.log(`Average Document Size: ${(stats.avgObjSize / 1024).toFixed(2)} KB`);
    
    console.log('\n=== COLLECTION BREAKDOWN ===');
    
    // Check each collection size
    const collections = await db.listCollections().toArray();
    
    for (const collection of collections) {
      try {
        const collStats = await db.collection(collection.name).stats();
        console.log(`${collection.name}:`);
        console.log(`  Documents: ${collStats.count}`);
        console.log(`  Storage Size: ${(collStats.storageSize / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`  Index Size: ${(collStats.totalIndexSize / (1024 * 1024)).toFixed(2)} MB`);
        console.log(`  Average Doc Size: ${collStats.count > 0 ? (collStats.avgObjSize / 1024).toFixed(2) : 0} KB`);
        console.log('');
      } catch (err) {
        console.log(`${collection.name}: Unable to get stats (${err.message})`);
      }
    }
    
    console.log('\n=== OPTIMIZATION OPPORTUNITIES ===');
    
    // Check for optimization opportunities
    if (stats.storageSize > stats.dataSize * 2) {
      console.log('⚠️  High storage overhead detected - consider compacting database');
    }
    
    if (stats.indexSize > stats.dataSize) {
      console.log('⚠️  Index size larger than data - review index usage');
    }
    
    const totalSizeMB = (stats.storageSize + stats.indexSize) / (1024 * 1024);
    if (totalSizeMB < 100) {
      console.log('✅ Small database - well within free tier limits');
    } else if (totalSizeMB < 500) {
      console.log('⚠️  Medium database - monitor growth');
    } else {
      console.log('🔥 Large database - consider optimization strategies');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking database size:', error);
    process.exit(1);
  }
}

checkDatabaseSize();