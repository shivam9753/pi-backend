const dotenv = require('dotenv');
const awsSecretsService = require('../services/awsSecretsService');

/**
 * Initialize application secrets
 * Tries AWS Secrets Manager first, falls back to .env if needed
 */
async function initializeSecrets() {
  console.log('🔐 Initializing application secrets...');

  // First, load .env file for AWS credentials and basic config
  // (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, NODE_ENV, etc.)
  const NODE_ENV = process.env.NODE_ENV || (process.env.PM2_HOME ? 'production' : 'development');
  const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';

  console.log(`📄 Loading basic config from: ${envFile}`);
  const envResult = dotenv.config({ path: envFile });

  if (envResult.error) {
    console.warn(`⚠️  Could not load ${envFile}, trying .env...`);
    dotenv.config({ path: '.env' });
  }

  // Ensure NODE_ENV is set
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = NODE_ENV;
  }

  // Try to fetch secrets from AWS
  try {
    console.log(`🔍 Fetching secrets from AWS Secrets Manager...`);
    const secrets = await awsSecretsService.getSecrets();

    // Set secrets as environment variables
    process.env.ATLAS_URL = secrets.mongodbUrl;
    process.env.JWT_SECRET = secrets.jwtSecret;
    process.env.EMAIL_USER = secrets.emailUser;
    process.env.EMAIL_PASSWORD = secrets.emailPassword;

    console.log('✅ Secrets loaded from AWS Secrets Manager');
    console.log(`   Environment: ${process.env.NODE_ENV}`);
    console.log(`   Database: ${getDbNameFromUrl(secrets.mongodbUrl)}`);
    console.log(`   Email: ${secrets.emailUser}`);

    return { source: 'aws', success: true };

  } catch (error) {
    console.error('❌ Failed to fetch secrets from AWS:', error.message);

    // Check if we have secrets in .env as fallback
    if (process.env.ATLAS_URL && process.env.JWT_SECRET) {
      console.warn('⚠️  Using secrets from .env file (FALLBACK)');
      console.warn('   This is acceptable for development, but production should use AWS Secrets Manager');

      return { source: 'env', success: true };
    } else {
      console.error('❌ No secrets available in AWS or .env file!');
      console.error('   Please ensure either:');
      console.error('   1. AWS Secrets Manager is configured with proper credentials');
      console.error('   2. .env file contains ATLAS_URL and JWT_SECRET');

      throw new Error('Failed to initialize application secrets');
    }
  }
}

/**
 * Extract database name from MongoDB URL for logging
 */
function getDbNameFromUrl(url) {
  try {
    const mongoUrl = new URL(url);
    return mongoUrl.pathname.substring(1).split('?')[0] || 'default';
  } catch {
    return 'unknown';
  }
}

module.exports = { initializeSecrets };
