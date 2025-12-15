/**
 * Async Server Startup with AWS Secrets Manager Integration
 *
 * This file initializes secrets from AWS before starting the Express app.
 * It replaces the synchronous server.js startup flow.
 */

const { initializeSecrets } = require('./config/initSecrets');
const { ImageService } = require('./config/imageService');
const emailService = require('./services/emailService');

// Async startup function
async function startServer() {
  try {
    console.log('🚀 Starting Poems India Backend Server');

    // Step 1: Initialize secrets from AWS (or fall back to .env)
    await initializeSecrets();

    // Step 2: Initialize email service with credentials from secrets
    emailService.initialize();

    // Step 3: Now load the app (it will use process.env values set by initializeSecrets)
    const app = require('./app');

    // Step 4: Start the HTTP server
    const PORT = process.env.PORT || 3000;
    const NODE_ENV = process.env.NODE_ENV || 'development';

    const server = app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT} (${NODE_ENV})`);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', () => {
      server.close(() => process.exit(0));
    });

    process.on('SIGINT', () => {
      server.close(() => process.exit(0));
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error.message);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason) => {
      console.error('Unhandled rejection:', reason);
    });

  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the server
startServer();
