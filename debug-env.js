#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

console.log('🔍 Environment Diagnostic Script');
console.log('================================');

// Check current working directory
console.log(`📁 Current directory: ${process.cwd()}`);
console.log(`📁 __dirname: ${__dirname}`);

// Check if .env.production exists
const envProdPath = path.join(process.cwd(), '.env.production');
console.log(`📄 Looking for: ${envProdPath}`);

if (fs.existsSync(envProdPath)) {
  console.log('✅ .env.production file exists');
  
  const stats = fs.statSync(envProdPath);
  console.log(`📊 File size: ${stats.size} bytes`);
  console.log(`🔐 File permissions: ${stats.mode.toString(8)}`);
  
  try {
    const content = fs.readFileSync(envProdPath, 'utf8');
    const lines = content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    console.log(`📝 Number of config lines: ${lines.length}`);
    
    // Show config lines (hide sensitive values)
    console.log('\n📋 Configuration found:');
    lines.forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        const hiddenValue = key.includes('SECRET') || key.includes('PASSWORD') || key.includes('KEY') 
          ? '*'.repeat(Math.min(value.length, 8))
          : value.substring(0, 50) + (value.length > 50 ? '...' : '');
        console.log(`   ${key}=${hiddenValue}`);
      }
    });
  } catch (error) {
    console.log('❌ Error reading file:', error.message);
  }
} else {
  console.log('❌ .env.production file NOT found');
  
  // Check for other env files
  console.log('\n🔍 Looking for other environment files:');
  const envFiles = ['.env', '.env.development', '.env.local'];
  envFiles.forEach(file => {
    if (fs.existsSync(file)) {
      console.log(`✅ Found: ${file}`);
    } else {
      console.log(`❌ Missing: ${file}`);
    }
  });
}

console.log('\n🧪 Testing dotenv loading...');

// Test loading .env.production
const result = dotenv.config({ path: '.env.production' });
if (result.error) {
  console.log('❌ Error loading .env.production:', result.error.message);
} else {
  console.log('✅ Successfully loaded .env.production');
}

// Show current environment variables
console.log('\n🌍 Current Environment Variables:');
const envVars = [
  'NODE_ENV',
  'STORAGE_TYPE', 
  'S3_BUCKET_NAME',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'ATLAS_URL'
];

envVars.forEach(varName => {
  const value = process.env[varName];
  if (value) {
    const hiddenValue = varName.includes('SECRET') || varName.includes('PASSWORD') || varName.includes('KEY')
      ? '*'.repeat(Math.min(value.length, 8))
      : value.substring(0, 50) + (value.length > 50 ? '...' : '');
    console.log(`✅ ${varName}=${hiddenValue}`);
  } else {
    console.log(`❌ ${varName}=<not set>`);
  }
});

console.log('\n🔧 Testing Storage Configuration:');
try {
  const { ImageService } = require('./config/imageService');
  console.log(`📦 Storage type detected: ${ImageService.getStorageType()}`);
  console.log(`🏭 Is production: ${ImageService.isProduction()}`);
  console.log(`🛠️ Is development: ${ImageService.isDevelopment()}`);
  
  const config = ImageService.getStorageConfig();
  console.log('⚙️ Storage config:', JSON.stringify(config, null, 2));
} catch (error) {
  console.log('❌ Error testing storage configuration:', error.message);
}

console.log('\n✅ Diagnostic complete!');