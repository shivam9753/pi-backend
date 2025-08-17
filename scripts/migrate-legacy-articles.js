#!/usr/bin/env node

/**
 * Legacy Articles Migration Script
 * Converts legacy articles from articles.json to current Submission and Content models
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

// Migration configuration
const MIGRATION_CONFIG = {
  legacyFilePath: '/Users/shivamsinghtomar/Documents/projects/prose.json',
  defaultUserId: null, // Will be set to admin user
  batchSize: 50,
  dryRun: false, // Set to true for preview mode
};

// Field mapping configuration
const FIELD_MAPPING = {
  // Legacy -> Current mapping
  submissionType: {
    default: 'prose',
    // Map any specific legacy categories if needed
  },
  status: 'published', // All legacy articles are published
};

class LegacyArticleMigrator {
  constructor() {
    this.stats = {
      total: 0,
      processed: 0,
      successful: 0,
      failed: 0,
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
      
      rl.question('\nWhich database do you want to migrate to? (1 for production, 2 for development): ', (answer) => {
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
      console.log('📖 Loading legacy articles...');
      const data = await fs.readFile(MIGRATION_CONFIG.legacyFilePath, 'utf8');
      const articles = JSON.parse(data);
      
      this.stats.total = articles.length;
      console.log(`📊 Found ${articles.length} legacy articles`);
      return articles;
    } catch (error) {
      console.error('❌ Failed to load legacy articles:', error.message);
      throw error;
    }
  }

  async findOrCreateDefaultUser() {
    try {
      let user = await User.findOne({ role: 'admin' });
      
      if (!user) {
        user = await User.findOne({});
      }
      
      if (!user) {
        console.log('⚠️ No users found. Creating migration user...');
        user = await User.create({
          email: 'migration@poemsindia.com',
          username: 'migration-user',
          name: 'Migration User',
          password: 'temp-password-123',
          role: 'admin',
          needsProfileCompletion: false
        });
        console.log('✅ Created migration user:', user._id);
      }
      
      MIGRATION_CONFIG.defaultUserId = user._id;
      console.log('👤 Using user for migration:', user.username, user._id);
      return user;
    } catch (error) {
      console.error('❌ Failed to setup default user:', error.message);
      throw error;
    }
  }

removeImagesAndCaptions(html) {
  if (!html) return '';

  return html
    // 1. Remove all <img> tags
    .replace(/<img[^>]*>/gi, '')
    
    // 2. Remove only captions that contain "Caption:" or "Image:"
    .replace(/<p>\s*(?:<em>|<strong>).*?(Caption:|Image:)[\s\S]*?<\/(?:em|strong)>\s*<\/p>/gi, '')
    
    // 3. Remove empty paragraphs that might be left after image/caption removal
    .replace(/<p>(?:\s|&nbsp;)*<\/p>/gi, '')
    
    // 4. Handle paragraph conversion while preserving stanza breaks
    // First mark double empty paragraphs as stanza breaks
    .replace(/(<p><\/p>\s*){2,}/gi, '***STANZA_BREAK***')
    // Convert remaining paragraphs to divs
    .replace(/<\/p>\s*<p>/gi, '</div><div>')
    .replace(/<p>/gi, '<div>')
    .replace(/<\/p>/gi, '</div>')
    // Restore stanza breaks as double line breaks
    .replace(/\*\*\*STANZA_BREAK\*\*\*/gi, '<br><br>')
    
    // 5. Clean up excessive breaks while preserving paragraph spacing
    .replace(/(<br\s*\/?>\s*){3,}/gi, '<br><br>')
    
    // 6. Ensure paragraphs have spacing but not at start/end
    .replace(/^<br\s*\/?>/gi, '')
    .replace(/<br\s*\/?>$/gi, '')
    
    .trim();
}

  extractContentFromBody(html, title, contentType = 'poem') {
    if (!html) return [{ title, content: '', order: 1 }];
    
    // For single-content types (prose, book_review, interview), return single content
    if (['prose', 'book_review', 'interview'].includes(contentType)) {
      return this.extractSingleContent(html, title);
    }
    
    // For poems and hindi, use existing multi-content extraction
    return this.extractPoemsFromBody(html, title);
  }

  extractSingleContent(html, title) {
    // Clean the content and return as single piece
    const cleanContent = this.removeImagesAndCaptions(html);
    return [{ title, content: cleanContent, order: 1 }];
  }

  extractPoemsFromBody(html, title) {
    if (!html) return [{ title, content: '', order: 1 }];
    
    // Check if content has poem title markers from json-converter
    if (html.includes('<!--POEM_TITLE_START-->')) {
      return this.extractPoemsUsingTitleMarkers(html, title);
    }
    
    // Fallback to original logic for content without markers
    // Split on 2+ consecutive empty paragraphs BEFORE cleaning HTML
    const sections = html.split(/(<p><\/p>\s*){2,}/gi)
      .filter(section => section && section.trim() && section.length > 20 && !section.match(/^(<p><\/p>\s*)+$/));
    
    // Remove author bio sections and clean each section
    const poemSections = sections
      .filter(section => 
        !section.toLowerCase().includes('about the poet:') && 
        !section.toLowerCase().includes('about the author:') &&
        !section.toLowerCase().includes('about the writer:')
      )
      .map(section => this.removeImagesAndCaptions(section))
      .filter(section => section && section.trim().length > 20);
    
    if (poemSections.length <= 1) {
      return [{ title, content: this.removeImagesAndCaptions(html), order: 1 }];
    }
    
    const poems = [];
    
    poemSections.forEach((section, index) => {
      const content = section.trim();
      if (content) {
        const poemTitle = this.generatePoemTitle(title, content, index + 1);
        
        poems.push({
          title: poemTitle,
          content: content,
          order: index + 1
        });
      }
    });
    
    return poems.length > 0 ? poems : [{ title, content: this.removeImagesAndCaptions(html), order: 1 }];
  }

  extractPoemsUsingTitleMarkers(html, title) {
    // Find all poem title markers with their positions
    const titleMatches = html.match(/<!--POEM_TITLE_START--><h\d+>(.*?)<\/h\d+><!--POEM_TITLE_END-->/gi);
    
    if (!titleMatches || titleMatches.length === 0) {
      return [{ title, content: this.removeImagesAndCaptions(html), order: 1 }];
    }
    
    console.log(`🔍 Found ${titleMatches.length} poem titles in "${title}"`);
    
    const poems = [];
    let lastEndIndex = 0;
    
    for (let i = 0; i < titleMatches.length; i++) {
      const titleMatch = titleMatches[i];
      const nextTitleMatch = titleMatches[i + 1];
      
      // Extract title from the marker
      const extractedTitle = titleMatch.match(/<h\d+>(.*?)<\/h\d+>/);
      let poemTitle = title;
      
      if (extractedTitle && extractedTitle[1]) {
        poemTitle = extractedTitle[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
      }
      
      // Find where this title marker ends in the HTML
      const titleStartIndex = html.indexOf(titleMatch, lastEndIndex);
      const titleEndIndex = titleStartIndex + titleMatch.length;
      
      // Find where the next title starts (or end of content)
      let contentEndIndex = html.length;
      if (nextTitleMatch) {
        contentEndIndex = html.indexOf(nextTitleMatch, titleEndIndex);
      }
      
      // Extract content between this title and the next (or end)
      let poemContent = html.substring(titleEndIndex, contentEndIndex).trim();
      
      // Check for author bio sections and remove them instead of skipping the poem
      const authorBioRegex = /<p>\s*About the (?:poet|author|writer):\s*<\/p>[\s\S]*/i;
      if (authorBioRegex.test(poemContent)) {
        poemContent = poemContent.replace(authorBioRegex, '').trim();
      }
      
      // Clean the content
      const cleanContent = this.removeImagesAndCaptions(poemContent);
      
      if (cleanContent && cleanContent.trim().length > 20) {
        poems.push({
          title: poemTitle,
          content: cleanContent,
          order: poems.length + 1
        });
      }
      
      lastEndIndex = contentEndIndex;
    }
    
    console.log(`✅ Extracted ${poems.length} poems from "${title}"`);
    
    return poems.length > 0 ? poems : [{ title, content: this.removeImagesAndCaptions(html), order: 1 }];
  }

  generatePoemTitle(mainTitle, content, index) {
    // First priority: Extract first meaningful line as potential title
    const firstLine = this.extractFirstMeaningfulLine(content);
    if (firstLine && firstLine.length > 3 && firstLine.length < 60) {
      return firstLine;
    }
    
    // Handle numbered collections (Two Poems, Three Poems, Four Poems, etc.)
    const numMatch = mainTitle.match(/(Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten)\s+Poems/i);
    if (numMatch) {
      const baseTitle = mainTitle.replace(/\s*—.*$/, '').replace(/\s*-.*$/, ''); // Remove author part
      return `${baseTitle.replace(numMatch[0], 'Poem')} - Part ${index}`;
    }
    
    // Check if title contains "poems" (case insensitive)
    if (mainTitle.toLowerCase().includes('poems')) {
      const baseTitle = mainTitle.replace(/\s*—.*$/, '').replace(/\s*-.*$/, '');
      return `${baseTitle.replace(/poems/gi, 'Poem')} - Part ${index}`;
    }
    
    // Fallback to numbered parts
    return `${mainTitle} - Part ${index}`;
  }

  extractFirstMeaningfulLine(content) {
    if (!content) return null;
    
    // Remove HTML tags and get plain text
    const text = content.replace(/<[^>]*>/g, '').trim();
    
    // Split into lines and find first meaningful line
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    for (const line of lines) {
      // Skip very short lines or lines that look like formatting
      if (line.length > 3 && line.length < 80 && !line.match(/^[\s\-_=]+$/)) {
        return line;
      }
    }
    
    return null;
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

  transformLegacyArticle(legacyArticle) {
    const title = legacyArticle.Title || 'Untitled Article';
    const excerpt = legacyArticle.Excerpt || this.generateExcerpt(legacyArticle.body);
    const readingTime = legacyArticle['Time To Read'] || this.calculateReadingTime(legacyArticle.body);
    
    // Get submission type from config
    const submissionType = FIELD_MAPPING.submissionType.default;
    
    // Extract content based on type
    const contents = this.extractContentFromBody(legacyArticle.body, title, submissionType);
    
    const submissionData = {
      userId: MIGRATION_CONFIG.defaultUserId,
      title: title,
      description: excerpt,
      submissionType: submissionType,
      status: 'published',
      imageUrl: this.extractImageUrl(legacyArticle['Cover Image']),
      excerpt: excerpt.substring(0, 200),
      readingTime: readingTime,
      isFeatured: legacyArticle.Featured || false,
      reviewedAt: new Date(legacyArticle['Published Date'] || legacyArticle['Last Published Date']),
      reviewedBy: MIGRATION_CONFIG.defaultUserId,
      seo: {
        slug: legacyArticle.Slug || this.generateSlug(title, legacyArticle.ID),
        metaTitle: title.substring(0, 60),
        metaDescription: excerpt.substring(0, 160),
        keywords: this.extractKeywords(legacyArticle),
        publishSettings: {
          allowComments: true,
          enableSocialSharing: true,
          featuredOnHomepage: legacyArticle.Featured || false
        }
      },
      history: [{
        action: 'published',
        status: 'published',
        timestamp: new Date(legacyArticle['Published Date'] || legacyArticle['Last Published Date']),
        user: MIGRATION_CONFIG.defaultUserId,
        notes: 'Migrated from legacy system'
      }]
    };

    // Create content data
    const contentDataArray = contents.map((content, index) => {
      // For single content types, use main slug. For multiple, add suffix
      const contentSlug = contents.length === 1 
        ? legacyArticle.Slug || this.generateSlug(title, legacyArticle.ID)
        : `${legacyArticle.Slug || this.generateSlug(title, legacyArticle.ID)}-part-${content.order}`;

      return {
        userId: MIGRATION_CONFIG.defaultUserId,
        title: content.title,
        body: content.content,
        type: submissionType,
        tags: this.extractTags(legacyArticle),
        metadata: {
          legacy: {
            originalId: legacyArticle.ID,
            uuid: legacyArticle.UUID,
            viewCount: legacyArticle['View Count'] || 0,
            likeCount: legacyArticle['Like Count'] || 0,
            commentCount: legacyArticle['Comment Count'] || 0,
            language: legacyArticle.Language || 'en',
            originalPublishDate: legacyArticle['Published Date'],
            lastPublishDate: legacyArticle['Last Published Date'],
            contentOrder: content.order,
            totalContents: contents.length
          }
        },
        isPublished: true,
        publishedAt: new Date(legacyArticle['Published Date'] || legacyArticle['Last Published Date']),
        seo: {
          slug: contentSlug,
          metaTitle: content.title.substring(0, 60),
          metaDescription: this.generateExcerpt(content.content, 160)
        }
      };
    });

    return { submissionData, contentDataArray, contentsCount: contents.length };
  }

  extractImageUrl(coverImage) {
    if (!coverImage || typeof coverImage !== 'string') return '';
    if (coverImage.startsWith('wix:image://')) {
      return '';
    }
    return coverImage;
  }

  extractKeywords(legacyArticle) {
    const keywords = [];
    if (legacyArticle.Hashtags && Array.isArray(legacyArticle.Hashtags)) {
      keywords.push(...legacyArticle.Hashtags);
    }
    if (legacyArticle.Tags && Array.isArray(legacyArticle.Tags)) {
      keywords.push(...legacyArticle.Tags);
    }
    return keywords.filter(Boolean).slice(0, 10);
  }

  extractTags(legacyArticle) {
    const tags = [];
    if (legacyArticle.Hashtags && Array.isArray(legacyArticle.Hashtags)) {
      tags.push(...legacyArticle.Hashtags.map(tag => tag.toLowerCase().trim()));
    }
    if (legacyArticle.Tags && Array.isArray(legacyArticle.Tags)) {
      tags.push(...legacyArticle.Tags.map(tag => tag.toLowerCase().trim()));
    }
    return [...new Set(tags.filter(Boolean))];
  }

  generateExcerpt(text, maxLength = 150) {
    if (!text) return '';
    
    // Remove HTML tags and normalize whitespace
    const cleanText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    
    if (cleanText.length <= maxLength) return cleanText;
    
    // Truncate and add ellipsis, ensuring we don't exceed maxLength
    const truncated = cleanText.substring(0, maxLength - 3) + '...';
    return truncated.length > maxLength ? cleanText.substring(0, maxLength) : truncated;
  }

  calculateReadingTime(text) {
    if (!text) return 1;
    const wordCount = text.trim().split(/\s+/).filter(word => word.length > 0).length;
    return Math.max(1, Math.ceil(wordCount / 200));
  }

  async migrateArticle(legacyArticle) {
    try {
      const { submissionData, contentDataArray, contentsCount } = this.transformLegacyArticle(legacyArticle);
      
      if (MIGRATION_CONFIG.dryRun) {
        console.log(`[DRY RUN] Would create submission: ${submissionData.title} (${contentsCount} content${contentsCount > 1 ? 's' : ''})`);
        this.stats.successful++;
        return { success: true, dryRun: true };
      }

      const existingSubmission = await Submission.findOne({ 'seo.slug': submissionData.seo.slug });
      if (existingSubmission) {
        // Delete existing submission and its content for re-migration
        await Content.deleteMany({ submissionId: existingSubmission._id });
        await Submission.deleteOne({ _id: existingSubmission._id });
        console.log(`🔄 Re-migrating: ${submissionData.title} (deleted existing)`);
      }

      // Create submission first
      const submission = await Submission.create(submissionData);
      
      // Create all content pieces and link them to the submission
      const contentIds = [];
      const createdContents = [];
      
      for (const contentData of contentDataArray) {
        contentData.submissionId = submission._id;
        const content = await Content.create(contentData);
        contentIds.push(content._id);
        createdContents.push(content);
      }
      
      // Update submission with all content IDs
      submission.contentIds = contentIds;
      await submission.save();
      
      this.stats.successful++;
      console.log(`✅ Migrated: ${submission.title} (${contentsCount} content${contentsCount > 1 ? 's' : ''}) - ${submission._id}`);
      
      return { success: true, submission, contents: createdContents, contentsCount };
      
    } catch (error) {
      this.stats.failed++;
      this.stats.errors.push({
        article: legacyArticle.Title || legacyArticle.ID,
        error: error.message
      });
      
      console.error(`❌ Failed to migrate "${legacyArticle.Title}":`, error.message);
      return { success: false, error: error.message };
    }
  }

  async runMigration() {
    try {
      console.log('🚀 Starting legacy article migration...');
      
      const databaseName = await this.promptDatabaseSelection();
      await this.connectDatabase(databaseName);
      await this.findOrCreateDefaultUser();
      const legacyArticles = await this.loadLegacyArticles();
      
      console.log(`📊 Migration Mode: ${MIGRATION_CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
      
      for (let i = 0; i < legacyArticles.length; i += MIGRATION_CONFIG.batchSize) {
        const batch = legacyArticles.slice(i, i + MIGRATION_CONFIG.batchSize);
        console.log(`\n📦 Processing batch ${Math.floor(i/MIGRATION_CONFIG.batchSize) + 1}/${Math.ceil(legacyArticles.length/MIGRATION_CONFIG.batchSize)}...`);
        
        for (const article of batch) {
          await this.migrateArticle(article);
          this.stats.processed++;
          
          if (this.stats.processed % 10 === 0) {
            console.log(`📈 Progress: ${this.stats.processed}/${this.stats.total} (${Math.round(this.stats.processed/this.stats.total*100)}%)`);
          }
        }
      }
      
      await this.printSummary();
      
    } catch (error) {
      console.error('💥 Migration failed:', error);
      throw error;
    } finally {
      await mongoose.connection.close();
      console.log('🔐 Database connection closed');
    }
  }

  async printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total articles: ${this.stats.total}`);
    console.log(`Processed: ${this.stats.processed}`);
    console.log(`✅ Successful: ${this.stats.successful}`);
    console.log(`❌ Failed: ${this.stats.failed}`);
    console.log(`Success rate: ${Math.round(this.stats.successful/this.stats.total*100)}%`);
    
    if (this.stats.errors.length > 0) {
      console.log('\n❌ ERRORS:');
      this.stats.errors.forEach(err => {
        console.log(`  - ${err.article}: ${err.error}`);
      });
    }
    
    if (!MIGRATION_CONFIG.dryRun && this.stats.successful > 0) {
      console.log('\n🎉 Migration completed successfully!');
      console.log('\n📝 Next steps:');
      console.log('1. Verify migrated data in your admin dashboard');
      console.log('2. Check published articles on explore page');
      console.log('3. Update any missing images manually');
      console.log('4. Review and update the migration user password');
    } else if (MIGRATION_CONFIG.dryRun) {
      console.log('\n🔍 Dry run completed! Set dryRun: false to execute migration.');
    }
    
    console.log('='.repeat(60));
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--dry-run')) {
    MIGRATION_CONFIG.dryRun = true;
  }
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Legacy Articles Migration Tool

Usage:
  node migrate-legacy-articles.js [options]

Options:
  --dry-run    Preview migration without making changes
  --help, -h   Show this help message
    `);
    process.exit(0);
  }
  
  const migrator = new LegacyArticleMigrator();
  
  try {
    await migrator.runMigration();
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration script failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = LegacyArticleMigrator;