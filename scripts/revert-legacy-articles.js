#!/usr/bin/env node

/**
 * Legacy Articles Revert Script
 * Reverts migrated legacy articles by removing Submissions and Content created by the migration
 */

require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
const readline = require('readline');

// Import models
const Submission = require('../models/Submission');
const Content = require('../models/Content');
const User = require('../models/User');

// Revert configuration
const REVERT_CONFIG = {
  legacyFilePath: '/Users/shivamsinghtomar/Documents/projects/poems.json',
  batchSize: 50,
  dryRun: false, // Set to true for preview mode
};

class LegacyArticleReverter {
  constructor() {
    this.stats = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      submissionsDeleted: 0,
      contentsDeleted: 0,
      errors: []
    };
  }

  async promptDatabaseSelection() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      console.log('\n🗄️  Database Selection:');
      console.log('1. Production (poemsindiadb)');
      console.log('2. Development (poemsindiadb-dev)');
      
      rl.question('\nWhich database do you want to revert from? (1 for production, 2 for development): ', (answer) => {
        rl.close();
        
        const choice = answer.trim();
        if (choice === '1') {
          resolve('poemsindiadb');
        } else if (choice === '2') {
          resolve('poemsindiadb-dev');
        } else {
          console.log('❌ Invalid selection. Please run the script again and choose 1 or 2.');
          process.exit(1);
        }
      });
    });
  }

  async promptConfirmation() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      console.log('\n⚠️  WARNING: This will permanently delete migrated submissions and content!');
      console.log('This action cannot be undone unless you have a backup.');
      console.log('\nRecommendation: Run with --dry-run first to preview what will be deleted.');
      
      rl.question('\nAre you absolutely sure you want to proceed? (type "YES" to confirm): ', (answer) => {
        rl.close();
        
        if (answer.trim() === 'YES') {
          resolve(true);
        } else {
          console.log('❌ Revert cancelled. Use --dry-run to preview what would be deleted.');
          process.exit(0);
        }
      });
    });
  }

  async connectDatabase(databaseName) {
    try {
      const connectionString = `mongodb+srv://reviewer:noPFQMiHQqzyt0V1@pi-cluster.kicado1.mongodb.net/${databaseName}?retryWrites=true&w=majority&appName=pi-cluster`;
      await mongoose.connect(connectionString);
      console.log(`✅ Connected to MongoDB Atlas - ${databaseName}`);
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      process.exit(1);
    }
  }

  async loadLegacyArticles() {
    try {
      console.log('📖 Loading legacy articles to identify what to revert...');
      const data = await fs.readFile(REVERT_CONFIG.legacyFilePath, 'utf8');
      const articles = JSON.parse(data);
      
      this.stats.total = articles.length;
      console.log(`📊 Found ${articles.length} legacy articles to check for revert`);
      return articles;
    } catch (error) {
      console.error('❌ Failed to load legacy articles:', error.message);
      throw error;
    }
  }

  generateSlug(title, fallbackId) {
    if (!title) return `article-${fallbackId}`;
    
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 60)
      .replace(/^-+|-+$/g, '')
      || `article-${fallbackId}`;
  }

  async revertArticle(legacyArticle) {
    try {
      const title = legacyArticle.Title || 'Untitled Article';
      const slug = legacyArticle.Slug || this.generateSlug(title, legacyArticle.ID);
      
      if (REVERT_CONFIG.dryRun) {
        // In dry run mode, just check what would be deleted
        const submission = await Submission.findOne({ 'seo.slug': slug });
        if (submission) {
          const contents = await Content.find({ submissionId: submission._id });
          console.log(`[DRY RUN] Would delete submission: "${title}" with ${contents.length} content pieces`);
          this.stats.submissionsDeleted++;
          this.stats.contentsDeleted += contents.length;
        } else {
          console.log(`[DRY RUN] No submission found for: "${title}" (slug: ${slug})`);
        }
        this.stats.successful++;
        return { success: true, dryRun: true };
      }

      // Find the submission by slug (as created by the migration script)
      const submission = await Submission.findOne({ 'seo.slug': slug });
      
      if (!submission) {
        console.log(`⚠️  No submission found for: "${title}" (slug: ${slug})`);
        this.stats.successful++; // Count as successful since there's nothing to revert
        return { success: true, notFound: true };
      }

      // Check if this was created by migration (has migration notes in history)
      const hasMigrationHistory = submission.history && 
        submission.history.some(h => h.notes && h.notes.includes('Migrated from legacy system'));
      
      if (!hasMigrationHistory) {
        console.log(`⚠️  Skipping "${title}" - doesn't appear to be migrated content`);
        this.stats.successful++;
        return { success: true, skipped: true };
      }

      // Delete all related content first
      const contentResult = await Content.deleteMany({ submissionId: submission._id });
      this.stats.contentsDeleted += contentResult.deletedCount;

      // Delete the submission
      await Submission.deleteOne({ _id: submission._id });
      this.stats.submissionsDeleted++;
      
      this.stats.successful++;
      console.log(`✅ Reverted: "${title}" (deleted 1 submission + ${contentResult.deletedCount} content pieces)`);
      
      return { 
        success: true, 
        submissionId: submission._id, 
        contentsDeleted: contentResult.deletedCount 
      };
      
    } catch (error) {
      this.stats.failed++;
      this.stats.errors.push({
        article: legacyArticle.Title || legacyArticle.ID,
        error: error.message
      });
      
      console.error(`❌ Failed to revert "${legacyArticle.Title}":`, error.message);
      return { success: false, error: error.message };
    }
  }

  async runRevert() {
    try {
      console.log('🔄 Starting legacy article revert...');
      
      const databaseName = await this.promptDatabaseSelection();
      
      if (!REVERT_CONFIG.dryRun) {
        await this.promptConfirmation();
      }
      
      await this.connectDatabase(databaseName);
      const legacyArticles = await this.loadLegacyArticles();
      
      console.log(`📊 Revert Mode: ${REVERT_CONFIG.dryRun ? 'DRY RUN' : 'LIVE DELETION'}`);
      
      for (let i = 0; i < legacyArticles.length; i += REVERT_CONFIG.batchSize) {
        const batch = legacyArticles.slice(i, i + REVERT_CONFIG.batchSize);
        console.log(`\n📦 Processing batch ${Math.floor(i/REVERT_CONFIG.batchSize) + 1}/${Math.ceil(legacyArticles.length/REVERT_CONFIG.batchSize)}...`);
        
        for (const article of batch) {
          await this.revertArticle(article);
          this.stats.processed++;
          
          if (this.stats.processed % 10 === 0) {
            console.log(`📈 Progress: ${this.stats.processed}/${this.stats.total} (${Math.round(this.stats.processed/this.stats.total*100)}%)`);
          }
        }
      }
      
      await this.printSummary();
      
    } catch (error) {
      console.error('💥 Revert failed:', error);
      throw error;
    } finally {
      await mongoose.connection.close();
      console.log('🔐 Database connection closed');
    }
  }

  async printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 REVERT SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total articles checked: ${this.stats.total}`);
    console.log(`Processed: ${this.stats.processed}`);
    console.log(`✅ Successful: ${this.stats.successful}`);
    console.log(`❌ Failed: ${this.stats.failed}`);
    console.log(`🗑️  Submissions deleted: ${this.stats.submissionsDeleted}`);
    console.log(`🗑️  Content pieces deleted: ${this.stats.contentsDeleted}`);
    console.log(`Success rate: ${Math.round(this.stats.successful/this.stats.total*100)}%`);
    
    if (this.stats.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.stats.errors.forEach(err => {
        console.log(`  - ${err.article}: ${err.error}`);
      });
    }
    
    if (!REVERT_CONFIG.dryRun && this.stats.submissionsDeleted > 0) {
      console.log('\n🎉 Revert completed successfully!');
      console.log('\n📝 What was reverted:');
      console.log(`- Removed ${this.stats.submissionsDeleted} migrated submissions`);
      console.log(`- Removed ${this.stats.contentsDeleted} migrated content pieces`);
      console.log('- Only items with migration history were deleted');
      console.log('\n⚠️  Note: This action cannot be undone. Re-run the migration script if needed.');
    } else if (REVERT_CONFIG.dryRun) {
      console.log('\n🔍 Dry run completed! Set dryRun: false to execute revert.');
      console.log(`Would delete: ${this.stats.submissionsDeleted} submissions, ${this.stats.contentsDeleted} content pieces`);
    } else {
      console.log('\n✨ No migrated content found to revert.');
    }
    
    console.log('='.repeat(60));
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--dry-run')) {
    REVERT_CONFIG.dryRun = true;
  }
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Legacy Articles Revert Tool

Usage:
  node revert-legacy-articles.js [options]

Options:
  --dry-run    Preview revert without making changes (RECOMMENDED FIRST)
  --help, -h   Show this help message

⚠️  WARNING: This permanently deletes migrated content!
   Always run with --dry-run first to preview changes.
   Only submissions with migration history will be deleted.
    `);
    process.exit(0);
  }
  
  const reverter = new LegacyArticleReverter();
  
  try {
    await reverter.runRevert();
    process.exit(0);
  } catch (error) {
    console.error('💥 Revert script failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = LegacyArticleReverter;