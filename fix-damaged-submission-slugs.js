#!/usr/bin/env node

/**
 * FIX DAMAGED SUBMISSION SLUGS
 * Restore submission slugs that were incorrectly modified during content migration
 * Remove suffixes like "-1", "-2" that were added by mistake
 */

const { MongoClient } = require('mongodb');
const fs = require('fs').promises;
const path = require('path');

require('dotenv').config();

const PRODUCTION_URI = process.env.ATLAS_URL || process.env.MONGODB_URI_PROD;
const DRY_RUN = process.argv.includes('--dry-run');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

async function fixDamagedSubmissionSlugs() {
  const client = new MongoClient(PRODUCTION_URI);
  
  try {
    await client.connect();
    const db = client.db('poemsindiadb');
    
    console.log(`🚀 Fixing damaged submission slugs${DRY_RUN ? ' (DRY RUN)' : ''}...`);
    
    // Find submissions with damaged slugs (ending with -1, -2, etc.)
    const damagedSubmissions = await db.collection('submissions').find({
      'seo.slug': { $regex: '-[0-9]+$' } // Ends with dash and number
    }).toArray();
    
    console.log(`Found ${damagedSubmissions.length} submissions with damaged slugs`);
    
    if (damagedSubmissions.length === 0) {
      console.log('✅ No damaged slugs found');
      return;
    }
    
    // Create backup
    const backupDir = path.join(__dirname, 'slug-fix-backups');
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `${TIMESTAMP}-damaged-submission-slugs.json`);
    await fs.writeFile(backupPath, JSON.stringify(damagedSubmissions, null, 2));
    console.log(`📦 Backup created: ${backupPath}`);
    
    let fixedCount = 0;
    let errorCount = 0;
    let skipCount = 0;
    
    for (const submission of damagedSubmissions) {
      try {
        const currentSlug = submission.seo.slug;
        
        // Extract the original slug by removing the numeric suffix
        const originalSlug = currentSlug.replace(/-[0-9]+$/, '');
        
        console.log(`\n📝 "${submission.title}"`);
        console.log(`   Current: ${currentSlug}`);
        console.log(`   Original: ${originalSlug}`);
        
        // Check if the original slug is already taken by another submission
        const existingSubmission = await db.collection('submissions').findOne({
          'seo.slug': originalSlug,
          _id: { $ne: submission._id }
        });
        
        if (existingSubmission) {
          console.log(`   ⚠️  Original slug taken by: "${existingSubmission.title}"`);
          skipCount++;
          continue;
        }
        
        if (DRY_RUN) {
          console.log('   🔍 DRY RUN: Would restore slug');
        } else {
          // Restore the original slug
          await db.collection('submissions').updateOne(
            { _id: submission._id },
            { $set: { 'seo.slug': originalSlug } }
          );
          console.log('   ✅ Slug restored');
          fixedCount++;
        }
        
      } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        errorCount++;
      }
    }
    
    console.log(`\n📊 Fix Summary:`);
    console.log(`   Damaged slugs found: ${damagedSubmissions.length}`);
    console.log(`   Successfully fixed: ${fixedCount}`);
    console.log(`   Skipped (conflict): ${skipCount}`);
    console.log(`   Errors: ${errorCount}`);
    
    if (!DRY_RUN && fixedCount > 0) {
      console.log('\n✅ Submission slug fix completed!');
      
      // Test some restored slugs
      console.log('\n🔍 Testing restored slugs...');
      const testSlugs = ['three-poems-by-fatima-hijas', 'night-of-the-scorpion', 'is-art-political'];
      
      for (const slug of testSlugs) {
        const found = await db.collection('submissions').findOne({ 'seo.slug': slug });
        if (found) {
          console.log(`   ✅ ${slug} -> "${found.title}"`);
        } else {
          console.log(`   ❓ ${slug} -> Not found`);
        }
      }
    }
    
    if (DRY_RUN) {
      console.log('\n🔍 DRY RUN completed - no changes made');
      
      // Show examples of what would be fixed
      console.log('\nExamples of damaged slugs:');
      damagedSubmissions.slice(0, 10).forEach(sub => {
        const originalSlug = sub.seo.slug.replace(/-[0-9]+$/, '');
        console.log(`   "${sub.title}": ${sub.seo.slug} -> ${originalSlug}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Fix failed:', error);
  } finally {
    await client.close();
  }
}

// Usage info
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
🔧 Submission Slug Fix Tool

This script fixes submission slugs that were incorrectly modified during migration,
removing numeric suffixes like "-1", "-2" to restore original slugs.

Usage:
  node fix-damaged-submission-slugs.js [options]

Options:
  --dry-run      Preview changes without executing
  --help         Show this help message

Examples:
  # Preview what will be fixed
  node fix-damaged-submission-slugs.js --dry-run
  
  # Execute the fix
  node fix-damaged-submission-slugs.js
`);
  process.exit(0);
}

fixDamagedSubmissionSlugs().catch(console.error);