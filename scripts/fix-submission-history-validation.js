#!/usr/bin/env node

/**
 * Script to fix submission history validation issues after ID migration
 * 
 * This script:
 * 1. Finds submissions with history entries that have missing or invalid user references
 * 2. Validates user references exist in the database
 * 3. Fixes missing userRole values based on action type
 * 4. Reports on data inconsistencies
 * 
 * Usage:
 * node scripts/fix-submission-history-validation.js [--dry-run] [--verbose]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Submission = require('../models/Submission');
const User = require('../models/User');

const isDryRun = process.argv.includes('--dry-run');
const isVerbose = process.argv.includes('--verbose');

async function connectDB() {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI environment variable is required');
    }
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ Connected to MongoDB');
    console.log(`📊 Database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

async function findProblematicSubmissions() {
  console.log('🔍 Finding submissions with history validation issues...');
  
  const submissions = await Submission.find({
    'history.0': { $exists: true } // Has at least one history entry
  }).select('_id title status history userId createdAt');
  
  console.log(`📊 Found ${submissions.length} submissions with history entries`);
  
  const problematicSubmissions = [];
  const userCache = new Map();
  
  for (const submission of submissions) {
    let hasIssues = false;
    const issues = [];
    
    for (let i = 0; i < submission.history.length; i++) {
      const historyEntry = submission.history[i];
      
      // Check if user field is missing or empty
      if (!historyEntry.user || historyEntry.user.toString().trim().length === 0) {
        hasIssues = true;
        issues.push(`History entry ${i}: Missing user field`);
        continue;
      }
      
      // Check if userRole is missing
      if (!historyEntry.userRole) {
        hasIssues = true;
        issues.push(`History entry ${i}: Missing userRole field`);
      }
      
      // Check if user exists in database
      const userId = historyEntry.user.toString();
      if (!userCache.has(userId)) {
        try {
          const user = await User.findById(userId).select('_id role');
          userCache.set(userId, user);
        } catch (error) {
          userCache.set(userId, null);
        }
      }
      
      const user = userCache.get(userId);
      if (!user) {
        hasIssues = true;
        issues.push(`History entry ${i}: User ${userId} not found in database`);
      } else if (!historyEntry.userRole && user.role) {
        // User exists but history entry is missing role
        hasIssues = true;
        issues.push(`History entry ${i}: Missing userRole, user has role "${user.role}"`);
      }
    }
    
    if (hasIssues) {
      problematicSubmissions.push({
        submission,
        issues
      });
    }
  }
  
  console.log(`❌ Found ${problematicSubmissions.length} submissions with history issues`);
  return { problematicSubmissions, userCache };
}

async function fixSubmissionHistory(submission, issues, userCache) {
  if (isVerbose) {
    console.log(`\n🔧 Fixing submission: ${submission._id} - "${submission.title}"`);
    issues.forEach(issue => console.log(`   - ${issue}`));
  }
  
  let fixedCount = 0;
  
  for (let i = 0; i < submission.history.length; i++) {
    const historyEntry = submission.history[i];
    let needsUpdate = false;
    
    // Fix missing userRole if user exists
    if (!historyEntry.userRole && historyEntry.user) {
      const userId = historyEntry.user.toString();
      const user = userCache.get(userId);
      
      if (user && user.role) {
        historyEntry.userRole = user.role;
        needsUpdate = true;
        fixedCount++;
        
        if (isVerbose) {
          console.log(`     ✅ Fixed userRole for history entry ${i}: ${user.role}`);
        }
      } else {
        // User not found, use fallback role based on action
        const action = historyEntry.action;
        const fallbackRole = ['approved', 'rejected', 'needs_changes', 'shortlisted', 'published'].includes(action) 
          ? 'reviewer' 
          : 'user';
        
        historyEntry.userRole = fallbackRole;
        needsUpdate = true;
        fixedCount++;
        
        if (isVerbose) {
          console.log(`     ⚠️ Used fallback userRole for history entry ${i}: ${fallbackRole} (action: ${action})`);
        }
      }
    }
    
    // Fix missing user field (this is more serious)
    if (!historyEntry.user || historyEntry.user.toString().trim().length === 0) {
      // Try to use submission owner as fallback
      if (submission.userId) {
        historyEntry.user = submission.userId;
        historyEntry.userRole = historyEntry.userRole || 'user';
        needsUpdate = true;
        fixedCount++;
        
        if (isVerbose) {
          console.log(`     ⚠️ Used submission owner as fallback user for history entry ${i}`);
        }
      }
    }
  }
  
  if (fixedCount > 0 && !isDryRun) {
    try {
      // Save with validation disabled to avoid triggering the validation we're trying to fix
      await submission.save({ validateBeforeSave: false });
      
      if (isVerbose) {
        console.log(`     ✅ Saved ${fixedCount} fixes for submission ${submission._id}`);
      }
    } catch (error) {
      console.error(`     ❌ Failed to save fixes for submission ${submission._id}:`, error.message);
      return 0;
    }
  }
  
  return fixedCount;
}

async function generateReport(problematicSubmissions) {
  console.log('\n📊 SUMMARY REPORT');
  console.log('================');
  console.log(`Total submissions with history issues: ${problematicSubmissions.length}`);
  
  const issueTypes = {};
  
  problematicSubmissions.forEach(({ issues }) => {
    issues.forEach(issue => {
      const issueType = issue.split(':')[1].trim().split(' ')[0] + ' ' + issue.split(':')[1].trim().split(' ')[1];
      issueTypes[issueType] = (issueTypes[issueType] || 0) + 1;
    });
  });
  
  console.log('\nIssue breakdown:');
  Object.entries(issueTypes).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  
  if (isDryRun) {
    console.log('\n⚠️ DRY RUN MODE - No changes were made');
    console.log('Run without --dry-run to apply fixes');
  }
}

async function main() {
  console.log('🚀 Starting submission history validation fix...');
  console.log(`Mode: ${isDryRun ? 'DRY RUN' : 'LIVE RUN'}`);
  
  await connectDB();
  
  const { problematicSubmissions, userCache } = await findProblematicSubmissions();
  
  if (problematicSubmissions.length === 0) {
    console.log('✅ No submission history issues found!');
    process.exit(0);
  }
  
  let totalFixed = 0;
  
  console.log(`\n🔧 ${isDryRun ? 'Analyzing' : 'Fixing'} ${problematicSubmissions.length} problematic submissions...`);
  
  for (const { submission, issues } of problematicSubmissions) {
    const fixedCount = await fixSubmissionHistory(submission, issues, userCache);
    totalFixed += fixedCount;
  }
  
  console.log(`\n✅ ${isDryRun ? 'Would fix' : 'Fixed'} ${totalFixed} history entries across ${problematicSubmissions.length} submissions`);
  
  await generateReport(problematicSubmissions);
  
  await mongoose.connection.close();
  console.log('\n🏁 Script completed successfully');
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  process.exit(1);
});

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});