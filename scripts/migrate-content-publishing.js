const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const User = require('../models/User');

async function migrateContentPublishing() {
  try {
    console.log('🚀 Starting content publishing migration...');
    
    // Connect to database
    await mongoose.connect(process.env.ATLAS_URL, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('📊 Connected to database');

    // Step 1: Mark existing rejected/spam submissions as eligible for purge
    console.log('\n📋 Step 1: Marking existing rejected/spam submissions for purge...');
    
    const purgeableStatuses = ['rejected', 'spam'];
    const purgeResult = await Submission.updateMany(
      { 
        status: { $in: purgeableStatuses },
        eligibleForPurge: { $ne: true }
      },
      {
        $set: {
          eligibleForPurge: true,
          purgeEligibleSince: new Date()
        }
      }
    );
    
    console.log(`✅ Marked ${purgeResult.modifiedCount} submissions as eligible for purge`);

    // Step 2: Add submissionId to existing content that doesn't have it
    console.log('\n📝 Step 2: Adding submissionId to existing content...');
    
    const contentsWithoutSubmissionId = await Content.find({ 
      submissionId: { $exists: false } 
    });
    
    let contentUpdated = 0;
    
    for (const content of contentsWithoutSubmissionId) {
      // Find the submission that contains this content
      const submission = await Submission.findOne({
        contentIds: content._id
      });
      
      if (submission) {
        await Content.updateOne(
          { _id: content._id },
          { $set: { submissionId: submission._id } }
        );
        contentUpdated++;
      } else {
        console.warn(`⚠️ Could not find submission for content ${content._id}`);
      }
    }
    
    console.log(`✅ Updated ${contentUpdated} content pieces with submissionId`);

    // Step 3: Mark content from published submissions as published
    console.log('\n📰 Step 3: Marking content from published submissions as published...');
    
    const publishedSubmissions = await Submission.find({ 
      status: 'published' 
    }).populate('contentIds');
    
    let publishedContentCount = 0;
    
    for (const submission of publishedSubmissions) {
      if (submission.contentIds && submission.contentIds.length > 0) {
        // Mark all content in published submissions as published
        const contentIds = submission.contentIds.map(c => c._id);
        
        const publishResult = await Content.updateMany(
          { 
            _id: { $in: contentIds },
            isPublished: { $ne: true }
          },
          {
            $set: {
              isPublished: true,
              publishedAt: submission.reviewedAt || submission.createdAt,
              submissionId: submission._id
            }
          }
        );
        
        publishedContentCount += publishResult.modifiedCount;
      }
    }
    
    console.log(`✅ Marked ${publishedContentCount} content pieces as published`);

    // Step 4: Generate slugs for published content that doesn't have them
    console.log('\n🔗 Step 4: Generating slugs for published content...');
    
    const publishedContentWithoutSlugs = await Content.find({
      isPublished: true,
      'seo.slug': { $exists: false }
    }).populate('userId', 'username');
    
    let slugsGenerated = 0;
    
    for (const content of publishedContentWithoutSlugs) {
      // Generate slug from title
      let baseSlug = content.title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60);
      
      // Ensure uniqueness
      let uniqueSlug = baseSlug;
      let counter = 1;
      while (await Content.findOne({ 'seo.slug': uniqueSlug })) {
        uniqueSlug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      // Update content with SEO data
      await Content.updateOne(
        { _id: content._id },
        {
          $set: {
            seo: {
              slug: uniqueSlug,
              metaTitle: content.title,
              metaDescription: content.body ? content.body.substring(0, 160) : ''
            }
          }
        }
      );
      
      slugsGenerated++;
    }
    
    console.log(`✅ Generated ${slugsGenerated} SEO slugs for published content`);

    // Step 5: Statistics summary
    console.log('\n📊 Migration Summary:');
    
    const stats = {
      totalSubmissions: await Submission.countDocuments(),
      publishedSubmissions: await Submission.countDocuments({ status: 'published' }),
      eligibleForPurge: await Submission.countDocuments({ eligibleForPurge: true }),
      totalContent: await Content.countDocuments(),
      publishedContent: await Content.countDocuments({ isPublished: true }),
      contentWithSlugs: await Content.countDocuments({ 'seo.slug': { $exists: true } })
    };
    
    console.log(`📈 Total submissions: ${stats.totalSubmissions}`);
    console.log(`📰 Published submissions: ${stats.publishedSubmissions}`);
    console.log(`🗑️ Eligible for purge: ${stats.eligibleForPurge}`);
    console.log(`📝 Total content: ${stats.totalContent}`);
    console.log(`📰 Published content: ${stats.publishedContent}`);
    console.log(`🔗 Content with SEO slugs: ${stats.contentWithSlugs}`);
    
    console.log('\n✅ Migration completed successfully!');
    
    // Verify data integrity
    console.log('\n🔍 Verifying data integrity...');
    
    const contentWithoutSubmissionId = await Content.countDocuments({
      submissionId: { $exists: false }
    });
    
    const publishedContentMissingSlugs = await Content.countDocuments({
      isPublished: true,
      'seo.slug': { $exists: false }
    });
    
    if (contentWithoutSubmissionId > 0) {
      console.warn(`⚠️ Warning: ${contentWithoutSubmissionId} content pieces still missing submissionId`);
    }
    
    if (publishedContentMissingSlugs > 0) {
      console.warn(`⚠️ Warning: ${publishedContentMissingSlugs} published content pieces still missing slugs`);
    }
    
    if (contentWithoutSubmissionId === 0 && publishedContentMissingSlugs === 0) {
      console.log('✅ Data integrity check passed!');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('📊 Disconnected from database');
    process.exit(0);
  }
}

// Run migration if called directly
if (require.main === module) {
  // Load environment variables
  require('dotenv').config();
  
  if (!process.env.ATLAS_URL) {
    console.error('❌ ATLAS_URL environment variable is required');
    process.exit(1);
  }
  
  migrateContentPublishing();
}

module.exports = { migrateContentPublishing };