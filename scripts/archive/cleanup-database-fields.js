const mongoose = require('mongoose');
const dotenv = require('dotenv');

// Load environment-specific .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile });

async function cleanupDatabaseFields() {
  try {
    // Determine database name based on environment
    const dbName = NODE_ENV === 'production' ? 'poemsindiadb' : 'poemsindiadb-dev';
    
    await mongoose.connect(process.env.ATLAS_URL, {
      dbName: dbName
    });

    console.log(`Connected to MongoDB: ${dbName}`);
    const db = mongoose.connection.db;
    
    console.log(`\n🧹 STARTING DATABASE CLEANUP FOR: ${dbName}`);
    console.log('================================================\n');

    let totalUpdated = 0;

    // === SUBMISSIONS COLLECTION CLEANUP ===
    console.log('🔧 CLEANING SUBMISSIONS COLLECTION:');
    console.log('-----------------------------------');

    // 1. Clean up HTML tags in excerpt field (convert <div> to line breaks)
    console.log('1. Cleaning HTML tags in excerpt fields...');
    const submissionsWithHtmlExcerpt = await db.collection('submissions').find({
      excerpt: { $regex: '<div>' }
    }).toArray();

    if (submissionsWithHtmlExcerpt.length > 0) {
      for (const submission of submissionsWithHtmlExcerpt) {
        const cleanExcerpt = submission.excerpt
          .replace(/<div>/g, '')
          .replace(/<\/div>/g, '\n')
          .replace(/\r\n/g, '\n')
          .replace(/\n+/g, ' ')
          .trim();
        
        await db.collection('submissions').updateOne(
          { _id: submission._id },
          { $set: { excerpt: cleanExcerpt } }
        );
        console.log(`   ✓ Cleaned excerpt for: "${submission.title}"`);
        totalUpdated++;
      }
    } else {
      console.log('   ✓ No HTML tags found in excerpts');
    }

    // 2. Remove empty or null description fields (they should default to empty string)
    console.log('2. Cleaning up description fields...');
    const descriptionCleanup = await db.collection('submissions').updateMany(
      { 
        $or: [
          { description: null },
          { description: { $exists: false } }
        ]
      },
      { $set: { description: '' } }
    );
    if (descriptionCleanup.modifiedCount > 0) {
      console.log(`   ✓ Fixed ${descriptionCleanup.modifiedCount} description fields`);
      totalUpdated += descriptionCleanup.modifiedCount;
    } else {
      console.log('   ✓ All description fields are properly set');
    }

    // 3. Add missing SEO structure for published submissions
    console.log('3. Adding missing SEO structure...');
    const publishedWithoutSEO = await db.collection('submissions').find({
      status: 'published',
      seo: { $exists: false }
    }).toArray();

    if (publishedWithoutSEO.length > 0) {
      for (const submission of publishedWithoutSEO) {
        // Generate slug from title
        const slug = submission.title
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim();

        const seoStructure = {
          slug: slug,
          metaTitle: submission.title.substring(0, 60),
          metaDescription: submission.excerpt ? submission.excerpt.substring(0, 160) : '',
          keywords: [],
          publishSettings: {
            allowComments: true,
            enableSocialSharing: true,
            featuredOnHomepage: false
          }
        };

        await db.collection('submissions').updateOne(
          { _id: submission._id },
          { $set: { seo: seoStructure } }
        );
        console.log(`   ✓ Added SEO structure for: "${submission.title}"`);
        totalUpdated++;
      }
    } else {
      console.log('   ✓ All published submissions have SEO structure');
    }

    // 4. Ensure all submissions have proper readingTime
    console.log('4. Fixing missing readingTime fields...');
    const missingReadingTime = await db.collection('submissions').updateMany(
      { 
        $or: [
          { readingTime: { $exists: false } },
          { readingTime: null },
          { readingTime: 0 }
        ]
      },
      { $set: { readingTime: 1 } }
    );
    if (missingReadingTime.modifiedCount > 0) {
      console.log(`   ✓ Fixed ${missingReadingTime.modifiedCount} readingTime fields`);
      totalUpdated += missingReadingTime.modifiedCount;
    } else {
      console.log('   ✓ All readingTime fields are properly set');
    }

    // === CONTENTS COLLECTION CLEANUP ===
    console.log('\n🔧 CLEANING CONTENTS COLLECTION:');
    console.log('--------------------------------');

    // 1. Clean up HTML tags in content body (convert <div> to proper line breaks)
    console.log('1. Cleaning HTML tags in content body...');
    const contentsWithHtml = await db.collection('contents').find({
      body: { $regex: '<div>' }
    }).toArray();

    if (contentsWithHtml.length > 0) {
      for (const content of contentsWithHtml) {
        const cleanBody = content.body
          .replace(/<div>/g, '')
          .replace(/<\/div>/g, '\n')
          .replace(/\r\n/g, '\n')
          .replace(/\n+/g, '\n')
          .trim();
        
        await db.collection('contents').updateOne(
          { _id: content._id },
          { $set: { body: cleanBody } }
        );
        console.log(`   ✓ Cleaned body for: "${content.title}"`);
        totalUpdated++;
      }
    } else {
      console.log('   ✓ No HTML tags found in content bodies');
    }

    // 2. Remove empty metadata objects
    console.log('2. Cleaning up metadata fields...');
    const metadataCleanup = await db.collection('contents').updateMany(
      { 
        $or: [
          { metadata: {} },
          { metadata: null },
          { metadata: { $exists: false } }
        ]
      },
      { $unset: { metadata: "" } }
    );
    if (metadataCleanup.modifiedCount > 0) {
      console.log(`   ✓ Removed empty metadata from ${metadataCleanup.modifiedCount} documents`);
      totalUpdated += metadataCleanup.modifiedCount;
    } else {
      console.log('   ✓ No empty metadata fields found');
    }

    // 3. Ensure tags array exists and is properly formatted
    console.log('3. Fixing tags arrays...');
    const tagsCleanup = await db.collection('contents').updateMany(
      { 
        $or: [
          { tags: { $exists: false } },
          { tags: null }
        ]
      },
      { $set: { tags: [] } }
    );
    if (tagsCleanup.modifiedCount > 0) {
      console.log(`   ✓ Fixed ${tagsCleanup.modifiedCount} tags arrays`);
      totalUpdated += tagsCleanup.modifiedCount;
    } else {
      console.log('   ✓ All tags arrays are properly set');
    }

    // 4. Ensure hasInlineImages is properly set
    console.log('4. Fixing hasInlineImages flags...');
    
    // Set to false where images array is empty
    const noImagesCleanup = await db.collection('contents').updateMany(
      { 
        $or: [
          { images: { $size: 0 }, hasInlineImages: true },
          { images: { $exists: false }, hasInlineImages: true }
        ]
      },
      { $set: { hasInlineImages: false } }
    );
    
    // Set to true where images array has items
    const hasImagesCleanup = await db.collection('contents').updateMany(
      { 
        images: { $not: { $size: 0 } },
        hasInlineImages: { $ne: true }
      },
      { $set: { hasInlineImages: true } }
    );

    const inlineImagesUpdated = noImagesCleanup.modifiedCount + hasImagesCleanup.modifiedCount;
    if (inlineImagesUpdated > 0) {
      console.log(`   ✓ Fixed ${inlineImagesUpdated} hasInlineImages flags`);
      totalUpdated += inlineImagesUpdated;
    } else {
      console.log('   ✓ All hasInlineImages flags are correct');
    }

    // === FINAL VERIFICATION ===
    console.log('\n📊 CLEANUP SUMMARY:');
    console.log('===================');
    
    const finalSubmissionCount = await db.collection('submissions').countDocuments();
    const finalContentCount = await db.collection('contents').countDocuments();
    
    console.log(`Total documents updated: ${totalUpdated}`);
    console.log(`Final submission count: ${finalSubmissionCount}`);
    console.log(`Final content count: ${finalContentCount}`);

    // Sample check - get one cleaned document from each collection
    const sampleSubmission = await db.collection('submissions').findOne({ status: 'published' });
    const sampleContent = await db.collection('contents').findOne({});

    if (sampleSubmission) {
      console.log('\n✅ Sample cleaned submission:');
      console.log(`Title: ${sampleSubmission.title}`);
      console.log(`Excerpt: ${sampleSubmission.excerpt?.substring(0, 100)}...`);
      console.log(`Has SEO: ${sampleSubmission.seo ? 'Yes' : 'No'}`);
    }

    if (sampleContent) {
      console.log('\n✅ Sample cleaned content:');
      console.log(`Title: ${sampleContent.title}`);
      console.log(`Body preview: ${sampleContent.body?.substring(0, 100)}...`);
      console.log(`Has inline images: ${sampleContent.hasInlineImages}`);
    }

    console.log('\n🎉 Database cleanup completed successfully!');
    console.log('All unnecessary fields have been cleaned up.');
    console.log('HTML tags have been properly converted to line breaks.');
    console.log('Missing required fields have been added with defaults.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during database cleanup:', error);
    process.exit(1);
  }
}

// Allow running with different environments
if (process.argv[2] === 'prod') {
  process.env.NODE_ENV = 'production';
  console.log('🚨 Running cleanup on PRODUCTION database!');
}

cleanupDatabaseFields();