// MongoDB initialization script for Docker container
// This script runs when the MongoDB container starts for the first time

print('Starting MongoDB initialization...');

// Switch to the application database
db = db.getSiblingDB('poemsindiadb');

// Create application user with read/write permissions
db.createUser({
  user: 'piapp',
  pwd: 'piapp_password_change_in_production',
  roles: [
    {
      role: 'readWrite',
      db: 'poemsindiadb'
    }
  ]
});

// Create indexes for better performance
print('Creating indexes...');

// Users collection indexes
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "googleId": 1 }, { unique: true, sparse: true });
db.users.createIndex({ "role": 1 });

// Submissions collection indexes
db.submissions.createIndex({ "submitterId": 1 });
db.submissions.createIndex({ "status": 1 });
db.submissions.createIndex({ "type": 1 });
db.submissions.createIndex({ "submittedAt": -1 });
db.submissions.createIndex({ "slug": 1 }, { unique: true, sparse: true });

// Content collection indexes
db.contents.createIndex({ "submissionId": 1 });
db.contents.createIndex({ "type": 1 });

// Reviews collection indexes
db.reviews.createIndex({ "submissionId": 1 });
db.reviews.createIndex({ "reviewerId": 1 });
db.reviews.createIndex({ "status": 1 });
db.reviews.createIndex({ "reviewedAt": -1 });

print('MongoDB initialization completed successfully!');