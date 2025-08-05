const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment-specific .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile });

async function analyzeCollectionFields() {
  try {
    // Determine database name based on environment
    const dbName = NODE_ENV === 'production' ? 'poemsindiadb' : 'poemsindiadb-dev';
    
    await mongoose.connect(process.env.ATLAS_URL, {
      dbName: dbName
    });

    console.log(`Connected to MongoDB: ${dbName}`);
    const db = mongoose.connection.db;
    
    console.log(`\n=== ANALYZING DATABASE: ${dbName} ===\n`);

    // Analyze Submissions collection
    console.log('🔍 SUBMISSIONS COLLECTION FIELD ANALYSIS:');
    console.log('==========================================');
    
    const submissions = await db.collection('submissions').find({}).limit(5).toArray();
    if (submissions.length > 0) {
      console.log(`Sample count: ${submissions.length} documents`);
      
      // Get all unique field names across documents
      const allSubmissionFields = new Set();
      submissions.forEach(doc => {
        function getFields(obj, prefix = '') {
          Object.keys(obj).forEach(key => {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            allSubmissionFields.add(fullPath);
            
            if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)) {
              getFields(obj[key], fullPath);
            }
          });
        }
        getFields(doc);
      });

      console.log('\nAll fields found in submissions:');
      Array.from(allSubmissionFields).sort().forEach((field, index) => {
        console.log(`${index + 1}. ${field}`);
      });
      
      // Show sample document structure
      console.log('\nSample submission document:');
      console.log(JSON.stringify(submissions[0], null, 2));
    } else {
      console.log('No submissions found');
    }

    console.log('\n\n🔍 CONTENTS COLLECTION FIELD ANALYSIS:');
    console.log('======================================');
    
    const contents = await db.collection('contents').find({}).limit(5).toArray();
    if (contents.length > 0) {
      console.log(`Sample count: ${contents.length} documents`);
      
      // Get all unique field names across documents
      const allContentFields = new Set();
      contents.forEach(doc => {
        function getFields(obj, prefix = '') {
          Object.keys(obj).forEach(key => {
            const fullPath = prefix ? `${prefix}.${key}` : key;
            allContentFields.add(fullPath);
            
            if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !(obj[key] instanceof Date)) {
              getFields(obj[key], fullPath);
            }
          });
        }
        getFields(doc);
      });

      console.log('\nAll fields found in contents:');
      Array.from(allContentFields).sort().forEach((field, index) => {
        console.log(`${index + 1}. ${field}`);
      });
      
      // Show sample document structure
      console.log('\nSample content document:');
      console.log(JSON.stringify(contents[0], null, 2));
    } else {
      console.log('No contents found');
    }

    // Collection statistics
    console.log('\n\n📊 COLLECTION STATISTICS:');
    console.log('=========================');
    
    const submissionCount = await db.collection('submissions').countDocuments();
    const contentCount = await db.collection('contents').countDocuments();
    
    console.log(`Submissions: ${submissionCount} documents`);
    console.log(`Contents: ${contentCount} documents`);

    console.log('\n✅ Analysis complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error analyzing database:', error);
    process.exit(1);
  }
}

analyzeCollectionFields();