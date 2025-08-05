#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

console.log('🔍 Image Upload Debug Script');
console.log('=============================');

// Load environment exactly like app.js does
const NODE_ENV = process.env.NODE_ENV || (process.env.PM2_HOME ? 'production' : 'development');
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';

console.log(`📁 Current directory: ${process.cwd()}`);
console.log(`🌍 NODE_ENV from process: ${process.env.NODE_ENV}`);
console.log(`🌍 NODE_ENV detected: ${NODE_ENV}`);
console.log(`📄 Loading: ${envFile}`);

const envResult = dotenv.config({ path: envFile });
if (envResult.error) {
  console.log('❌ Error loading env file:', envResult.error.message);
} else {
  console.log('✅ Environment file loaded successfully');
}

// Set NODE_ENV if not set
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = NODE_ENV;
  console.log(`🔧 Set NODE_ENV to: ${NODE_ENV}`);
}

console.log('\n🔧 Environment Variables:');
console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`- STORAGE_TYPE: ${process.env.STORAGE_TYPE}`);
console.log(`- S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME}`);
console.log(`- AWS_REGION: ${process.env.AWS_REGION}`);
console.log(`- AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET'}`);
console.log(`- AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET'}`);

console.log('\n🔍 Testing Service Imports:');

// Test S3 service import
let S3ImageService = null;
try {
  const s3Module = require('./config/s3');
  S3ImageService = s3Module.S3ImageService;
  console.log('✅ S3 service imported successfully');
  console.log(`🔧 S3ImageService methods: ${Object.getOwnPropertyNames(S3ImageService)}`);
} catch (error) {
  console.log('❌ S3 service import failed:', error.message);
  console.log('📝 Error stack:', error.stack);
}

// Test ImageService
try {
  const { ImageService } = require('./config/imageService');
  
  console.log('\n📦 ImageService Analysis:');
  console.log(`🔧 getStorageType(): ${ImageService.getStorageType()}`);
  console.log(`🔧 isProduction(): ${ImageService.isProduction()}`);
  console.log(`🔧 isDevelopment(): ${ImageService.isDevelopment()}`);
  
  const config = ImageService.getStorageConfig();
  console.log('⚙️ Storage config:', JSON.stringify(config, null, 2));
  
  // Test the exact logic from imageService.js
  console.log('\n🧪 Testing Storage Decision Logic:');
  const storageType = ImageService.getStorageType();
  console.log(`📊 Storage type determined: ${storageType}`);
  
  if (storageType === 's3') {
    if (!S3ImageService) {
      console.log('❌ PROBLEM FOUND: Storage type is s3 but S3ImageService is null');
      console.log('🔧 This means S3 service failed to import but storage type detection worked');
    } else {
      console.log('✅ Storage type is s3 AND S3ImageService is available');
    }
  } else {
    console.log(`❌ PROBLEM FOUND: Storage type is ${storageType}, not s3`);
    console.log('🔧 Check STORAGE_TYPE environment variable or NODE_ENV logic');
  }
  
} catch (error) {
  console.log('❌ ImageService test failed:', error.message);
  console.log('📝 Error stack:', error.stack);
}

console.log('\n🧪 Testing Manual Upload Simulation:');

// Simulate what happens during upload
try {
  const { ImageService } = require('./config/imageService');
  
  // Create a dummy buffer
  const dummyBuffer = Buffer.from('fake image data');
  
  console.log('🎯 Simulating image upload...');
  console.log('📸 About to call ImageService.uploadImage...');
  
  // This will trigger the same logic as real upload
  ImageService.uploadImage(dummyBuffer, 'test-image.jpg', {})
    .then(result => {
      console.log('✅ Upload simulation result:', JSON.stringify(result, null, 2));
    })
    .catch(error => {
      console.log('❌ Upload simulation error:', error.message);
      console.log('📝 Error details:', error);
    });
    
} catch (error) {
  console.log('❌ Upload simulation setup failed:', error.message);
}

console.log('\n🔍 File System Check:');
console.log('📁 Checking if local uploads directory exists...');
const uploadsDir = path.join(process.cwd(), 'public/uploads');
if (fs.existsSync(uploadsDir)) {
  console.log(`✅ Local uploads directory exists: ${uploadsDir}`);
} else {
  console.log(`❌ Local uploads directory missing: ${uploadsDir}`);
}

console.log('\n✅ Debug analysis complete!');