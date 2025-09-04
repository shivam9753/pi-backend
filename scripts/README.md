# Database Management Scripts

This directory contains utility scripts for database maintenance and specific operations.

**Note:** For comprehensive database migrations, use the consolidated `/production-migration-script.js` in the project root.

## Scripts Overview

### 1. backup-database.js
Creates a complete JSON backup of all collections before performing any destructive operations.

**Usage:**
```bash
node scripts/backup-database.js
```

**What it does:**
- Connects to your configured database
- Exports all collections (submissions, contents, users, reviews) to JSON files
- Creates timestamped backup directory under `backups/`
- Generates backup metadata file

### 2. clean-database.js
Removes irrelevant fields from existing database documents according to the new model specifications.

**Usage:**
```bash
node scripts/clean-database.js
```

**What it removes:**

**From Submissions:**
- `hasImages` field
- `imageStorage` field  
- `tags` field
- `viewCount` field
- `likeCount` field
- `__v` version key

**From Contents:**
- `language` field
- `wordCount` field
- `createdAt` field (timestamps now only at Submission level)
- `updatedAt` field
- `__v` version key

**From All Collections:**
- `__v` version keys

**Safety features:**
- Interactive confirmation prompt
- Detailed progress reporting
- Data integrity validation
- Orphaned content detection
- Statistics and summaries

### 3. restore-database.js
Restores database from a backup created by backup-database.js.

**Usage:**
```bash
node scripts/restore-database.js <backup-directory-path>
```

**Example:**
```bash
node scripts/restore-database.js backups/backup-2025-01-04T12-30-00-000Z
```

## Recommended Workflow

### 1. First, create a backup:
```bash
cd pi-backend
node scripts/backup-database.js
```

### 2. Then run the cleanup:
```bash
node scripts/clean-database.js
```

### 3. If something goes wrong, restore from backup:
```bash
node scripts/restore-database.js backups/backup-[timestamp]
```

## Safety Considerations

⚠️ **IMPORTANT WARNINGS:**

1. **Always backup first** - These scripts modify your database permanently
2. **Test on development** - Run on dev environment before production  
3. **Verify environment** - Check that you're connected to the right database
4. **Read the output** - Scripts provide detailed feedback about what they're doing

## Environment Setup

The scripts automatically load the correct environment configuration:
- Development: uses `.env` file
- Production: uses `.env.production` file

Make sure your `ATLAS_URL` is correctly configured in the appropriate `.env` file.

## File Structure After Running

```
pi-backend/
├── scripts/
│   ├── backup-database.js
│   ├── clean-database.js
│   ├── restore-database.js
│   └── README.md
└── backups/
    └── backup-2025-01-04T12-30-00-000Z/
        ├── backup-info.json
        ├── submissions.json
        ├── contents.json
        ├── users.json
        └── reviews.json
```

## Troubleshooting

### Common Issues:

1. **Connection Failed**
   - Check your `ATLAS_URL` in `.env` file
   - Verify network connectivity
   - Ensure MongoDB cluster is running

2. **Permission Errors**
   - Make sure your database user has read/write permissions
   - Check if collections exist

3. **Large Database**
   - Scripts handle large datasets but may take time
   - Monitor memory usage for very large collections

4. **Backup Directory**
   - Scripts create `backups/` directory automatically
   - Ensure you have write permissions in the project directory

### Getting Help:

If you encounter issues:
1. Check the detailed error messages in the script output
2. Verify your database connection string
3. Ensure all dependencies are installed (`npm install`)
4. Test on a small development database first

## Post-Cleanup Verification

After running the cleanup script, verify your application still works:

1. Start your backend server
2. Test key API endpoints
3. Verify submissions display correctly
4. Check that content is properly associated
5. Test submission creation flow

The cleanup script includes built-in validation, but manual testing is always recommended.