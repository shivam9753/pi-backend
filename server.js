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

module.exports = server;