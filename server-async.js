/**
 * Async Server Startup with AWS Secrets Manager Integration
 *
 * This file initializes secrets from AWS before starting the Express app.
 * It replaces the synchronous server.js startup flow.
 */

const { initializeSecrets } = require('./config/initSecrets');
const { ImageService } = require('./config/imageService');

// Async startup function
async function startServer() {
  try {
    console.log('='.repeat(60));
    console.log('🚀 Starting Poems India Backend Server');
    console.log('='.repeat(60));

    // Step 1: Initialize secrets from AWS (or fall back to .env)
    await initializeSecrets();

    // Step 2: Now load the app (it will use process.env values set by initializeSecrets)
    const app = require('./app');

    // Step 3: Start the HTTP server
    const PORT = process.env.PORT || 3000;
    const NODE_ENV = process.env.NODE_ENV || 'development';

    const server = app.listen(PORT, () => {
      console.log('='.repeat(60));
      console.log(`✅ Server Started Successfully`);
      console.log('='.repeat(60));
      console.log(`📍 Environment: ${NODE_ENV.toUpperCase()}`);
      console.log(`🌐 Port: ${PORT}`);
      console.log(`📖 Health check: http://localhost:${PORT}/health`);
      console.log(`🔗 API base URL: http://localhost:${PORT}/api`);

      // Show storage configuration
      const storageConfig = ImageService.getStorageConfig();
      console.log(`💾 Storage: ${storageConfig.storageType.toUpperCase()}`);

      if (storageConfig.storageType === 'local') {
        console.log(`📁 Upload directory: ${storageConfig.config.uploadDir}`);
        console.log(`🔗 Images served at: ${storageConfig.config.baseUrl}`);
      } else {
        console.log(`☁️  S3 Bucket: ${storageConfig.config.bucket}`);
        if (storageConfig.config.cdnDomain) {
          console.log(`🚀 CDN: ${storageConfig.config.cdnDomain}`);
        }
      }

      // Show database info
      console.log(`📊 Database: ${getDbNameFromUrl()}`);
      console.log('='.repeat(60));
      console.log('✨ Ready to accept requests!');
      console.log('='.repeat(60));
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      console.log('\n🛑 SIGTERM received, shutting down gracefully...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 SIGINT received, shutting down gracefully...');
      server.close(() => {
        console.log('✅ Server closed');
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('\n💥 UNCAUGHT EXCEPTION! Server will not crash:', error);
      console.error('Stack trace:', error.stack);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        cause: error.cause || 'unknown'
      });
      console.error('⚠️  Server continuing despite uncaught exception...');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('\n💥 UNHANDLED PROMISE REJECTION! Server will not crash:', reason);
      console.error('Promise:', promise);

      if (reason instanceof Error) {
        console.error('Error stack:', reason.stack);
      }

      console.error('⚠️  Server continuing despite unhandled rejection...');
    });

    // Handle warnings
    process.on('warning', (warning) => {
      console.warn('⚠️  Process warning:', warning.name);
      console.warn('Message:', warning.message);
      if (warning.stack) {
        console.warn('Stack:', warning.stack);
      }
    });

  } catch (error) {
    console.error('\n❌ FATAL ERROR: Failed to start server');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('\nPlease check:');
    console.error('1. AWS Secrets Manager configuration');
    console.error('2. AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
    console.error('3. .env file exists with fallback values');
    console.error('4. MongoDB connection string is valid');
    process.exit(1);
  }
}

/**
 * Extract database name from MongoDB URL for logging
 */
function getDbNameFromUrl() {
  try {
    const url = new URL(process.env.ATLAS_URL);
    return url.pathname.substring(1).split('?')[0];
  } catch {
    return 'Unknown';
  }
}

// Start the server
startServer();
