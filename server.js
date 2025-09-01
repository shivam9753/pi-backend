const app = require('./app');
const { ImageService } = require('./config/imageService');

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const server = app.listen(PORT, async () => {
  console.log('='.repeat(50));
  console.log(`🚀 Poems India Backend Server`);
  console.log('='.repeat(50));
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
  console.log('='.repeat(50));
});

function getDbNameFromUrl() {
  try {
    const url = new URL(process.env.ATLAS_URL);
    return url.pathname.substring(1).split('?')[0];
  } catch {
    return 'Unknown';
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Critical: Handle uncaught exceptions to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('💥 UNCAUGHT EXCEPTION! Server will not crash:', error);
  console.error('Stack trace:', error.stack);
  
  // Log additional debugging info
  console.error('Error details:', {
    name: error.name,
    message: error.message,
    cause: error.cause || 'unknown'
  });
  
  // Don't exit the process - keep server running
  // In production, you might want to restart gracefully
  console.error('⚠️  Server continuing despite uncaught exception...');
});

// Critical: Handle unhandled promise rejections to prevent server crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED PROMISE REJECTION! Server will not crash:', reason);
  console.error('Promise:', promise);
  
  // Log additional debugging info
  if (reason instanceof Error) {
    console.error('Error stack:', reason.stack);
  }
  
  // Don't exit the process - keep server running
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

// Memory monitoring (optional - helps identify memory leaks)
setInterval(() => {
  const memUsage = process.memoryUsage();
  const mbUsage = {
    rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100
  };
  
  // Only log if memory usage is concerning
  if (mbUsage.heapUsed > 500) { // Log if using more than 500MB
    console.log(`📊 Memory usage: RSS ${mbUsage.rss}MB, Heap ${mbUsage.heapUsed}/${mbUsage.heapTotal}MB`);
  }
}, 5 * 60 * 1000); // Check every 5 minutes

console.log('✅ Server crash prevention handlers installed');

module.exports = server;