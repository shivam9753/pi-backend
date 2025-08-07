const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

// Use the provided connection string directly
const ATLAS_URL = 'mongodb+srv://poemsindiaadmin:aFmD4hDDbveBw7KV@pi-cluster.kicado1.mongodb.net/?retryWrites=true&w=majority&appName=pi-cluster';

async function syncDatabases() {
  let client;
  
  try {
    console.log('🔗 Connecting to MongoDB...');
    client = new MongoClient(ATLAS_URL);
    await client.connect();
    
    const devDb = client.db('poemsindiadb-dev');
    const prodDb = client.db('poemsindiadb');
    
    console.log('\n📊 Checking Development Database (poemsindiadb-dev)...');
    const devCollections = await devDb.listCollections().toArray();
    console.log('Dev Collections:', devCollections.map(c => c.name));
    
    console.log('\n📊 Checking Production Database (poemsindiadb)...');
    const prodCollections = await prodDb.listCollections().toArray();
    console.log('Prod Collections:', prodCollections.map(c => c.name));
    
    // Expected collections based on models
    const expectedCollections = ['users', 'submissions', 'contents', 'reviews'];
    
    console.log('\n🔍 Comparing collections...');
    const devCollectionNames = devCollections.map(c => c.name);
    const prodCollectionNames = prodCollections.map(c => c.name);
    
    // Find missing collections in production
    const missingInProd = expectedCollections.filter(name => !prodCollectionNames.includes(name));
    const missingInDev = expectedCollections.filter(name => !devCollectionNames.includes(name));
    
    if (missingInProd.length > 0) {
      console.log('❌ Missing in Production:', missingInProd);
    } else {
      console.log('✅ All expected collections exist in Production');
    }
    
    if (missingInDev.length > 0) {
      console.log('❌ Missing in Development:', missingInDev);
    } else {
      console.log('✅ All expected collections exist in Development');
    }
    
    // Create missing collections and indexes
    console.log('\n🏗️  Creating missing collections and indexes...');
    
    for (const collectionName of expectedCollections) {
      if (!prodCollectionNames.includes(collectionName)) {
        console.log(`Creating collection: ${collectionName}`);
        await prodDb.createCollection(collectionName);
      }
      
      // Create indexes based on our models
      await createIndexes(prodDb, collectionName);
    }
    
    // Check document counts
    console.log('\n📈 Document counts:');
    for (const collectionName of expectedCollections) {
      if (devCollectionNames.includes(collectionName)) {
        const devCount = await devDb.collection(collectionName).countDocuments();
        console.log(`${collectionName} (dev): ${devCount} documents`);
      }
      
      if (prodCollectionNames.includes(collectionName)) {
        const prodCount = await prodDb.collection(collectionName).countDocuments();
        console.log(`${collectionName} (prod): ${prodCount} documents`);
      }
    }
    
    console.log('\n✅ Database sync completed!');
    
  } catch (error) {
    console.error('❌ Error syncing databases:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

async function createIndexes(db, collectionName) {
  const collection = db.collection(collectionName);
  
  try {
    switch (collectionName) {
      case 'users':
        await collection.createIndex({ email: 1 }, { unique: true });
        await collection.createIndex({ username: 1 }, { unique: true });
        console.log(`✅ Created indexes for ${collectionName}`);
        break;
        
      case 'submissions':
        await collection.createIndex({ userId: 1 });
        await collection.createIndex({ status: 1 });
        await collection.createIndex({ submissionType: 1 });
        await collection.createIndex({ createdAt: -1 });
        await collection.createIndex({ reviewedAt: -1 });
        await collection.createIndex({ isFeatured: 1 });
        await collection.createIndex({ status: 1, submissionType: 1 });
        await collection.createIndex({ status: 1, isFeatured: 1 });
        await collection.createIndex({ status: 1, reviewedAt: -1 });
        await collection.createIndex({ 'seo.slug': 1 }, { unique: true, sparse: true });
        console.log(`✅ Created indexes for ${collectionName}`);
        break;
        
      case 'contents':
        await collection.createIndex({ userId: 1 });
        await collection.createIndex({ type: 1 });
        await collection.createIndex({ tags: 1 });
        await collection.createIndex({ createdAt: -1 });
        console.log(`✅ Created indexes for ${collectionName}`);
        break;
        
      case 'reviews':
        await collection.createIndex({ submissionId: 1 });
        await collection.createIndex({ reviewerId: 1 });
        await collection.createIndex({ createdAt: -1 });
        console.log(`✅ Created indexes for ${collectionName}`);
        break;
        
      default:
        console.log(`⚠️  No specific indexes defined for ${collectionName}`);
    }
  } catch (error) {
    console.log(`⚠️  Error creating indexes for ${collectionName}:`, error.message);
  }
}

// Run the sync
syncDatabases().catch(console.error);