const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

/**
 * AWS Secrets Manager Service
 * Fetches application secrets from AWS Secrets Manager
 * Caches secrets for 1 hour to reduce API calls
 */

class AWSSecretsService {
  constructor() {
    this.client = null;
    this.cachedSecrets = null;
    this.cacheExpiry = null;
    this.CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Initialize AWS Secrets Manager client
   */
  initializeClient() {
    if (this.client) return;

    const region = process.env.AWS_REGION || 'ap-south-1';

    // AWS SDK will automatically use credentials from:
    // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
    // 2. IAM role (if running on EC2/Lightsail with attached role)
    // 3. AWS credentials file (~/.aws/credentials)

    this.client = new SecretsManagerClient({
      region,
      // Optionally specify credentials explicitly:
      // credentials: {
      //   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      //   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      // }
    });

    console.log(`🔐 AWS Secrets Manager client initialized (Region: ${region})`);
  }

  /**
   * Get secret name based on environment
   */
  getSecretName() {
    const env = process.env.NODE_ENV || 'development';

    if (env === 'production') {
      return 'poemsindia/production/app-config';
    } else {
      return 'poemsindia/development/app-config';
    }
  }

  /**
   * Check if cached secrets are still valid
   */
  isCacheValid() {
    if (!this.cachedSecrets || !this.cacheExpiry) {
      return false;
    }

    return Date.now() < this.cacheExpiry;
  }

  /**
   * Fetch secrets from AWS Secrets Manager
   * Returns: { mongodbUrl, jwtSecret, emailUser, emailPassword }
   */
  async getSecrets() {
    // Return cached secrets if still valid
    if (this.isCacheValid()) {
      console.log('✅ Using cached secrets');
      return this.cachedSecrets;
    }

    this.initializeClient();

    const secretName = this.getSecretName();
    console.log(`🔍 Fetching secrets from AWS: ${secretName}`);

    try {
      const command = new GetSecretValueCommand({
        SecretId: secretName
      });

      const response = await this.client.send(command);

      if (!response.SecretString) {
        throw new Error('Secret value is empty');
      }

      // Parse the JSON secret
      const secrets = JSON.parse(response.SecretString);

      // Validate required fields
      const requiredFields = ['mongodbUrl', 'jwtSecret', 'emailUser', 'emailPassword'];
      const missingFields = requiredFields.filter(field => !secrets[field]);

      if (missingFields.length > 0) {
        throw new Error(`Missing required secret fields: ${missingFields.join(', ')}`);
      }

      // Cache the secrets
      this.cachedSecrets = secrets;
      this.cacheExpiry = Date.now() + this.CACHE_DURATION;

      console.log('✅ Secrets fetched and cached successfully');
      console.log(`   - MongoDB: ${secrets.mongodbUrl.substring(0, 30)}...`);
      console.log(`   - JWT Secret: ${secrets.jwtSecret.substring(0, 10)}...`);
      console.log(`   - Email User: ${secrets.emailUser}`);
      console.log(`   - Cache expires in: ${this.CACHE_DURATION / 1000 / 60} minutes`);

      return secrets;

    } catch (error) {
      console.error('❌ Error fetching secrets from AWS:', error.message);

      // If we have cached secrets (even expired), use them as fallback
      if (this.cachedSecrets) {
        console.warn('⚠️  Using expired cached secrets as fallback');
        return this.cachedSecrets;
      }

      // If no cache and error, check if we should fall back to .env
      if (process.env.FALLBACK_TO_ENV === 'true') {
        console.warn('⚠️  Falling back to .env file');
        return this.getFallbackSecrets();
      }

      throw new Error(`Failed to fetch secrets: ${error.message}`);
    }
  }

  /**
   * Fallback to .env file if AWS Secrets Manager is unavailable
   * Only used in development or emergency situations
   */
  getFallbackSecrets() {
    return {
      mongodbUrl: process.env.ATLAS_URL,
      jwtSecret: process.env.JWT_SECRET,
      emailUser: process.env.EMAIL_USER,
      emailPassword: process.env.EMAIL_PASSWORD
    };
  }

  /**
   * Clear cached secrets (useful for forcing refresh)
   */
  clearCache() {
    this.cachedSecrets = null;
    this.cacheExpiry = null;
    console.log('🗑️  Secret cache cleared');
  }

  /**
   * Get specific secret value
   */
  async getSecret(key) {
    const secrets = await this.getSecrets();
    return secrets[key];
  }
}

// Export singleton instance
const awsSecretsService = new AWSSecretsService();
module.exports = awsSecretsService;
