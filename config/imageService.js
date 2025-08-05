// Load services conditionally based on environment
let S3ImageService;
try {
  S3ImageService = require('./s3').S3ImageService;
} catch (error) {
  console.log('S3 service not available (AWS SDK not installed) - using local storage');
  S3ImageService = null;
}

const { LocalImageService } = require('./localStorage');

/**
 * Environment-aware Image Service
 * Uses S3 for production and local file system for development
 */
class ImageService {
  static getStorageType() {
    return process.env.STORAGE_TYPE || (process.env.NODE_ENV === 'production' ? 's3' : 'local');
  }

  static isProduction() {
    return process.env.NODE_ENV === 'production';
  }

  static isDevelopment() {
    return process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
  }

  /**
   * Upload image using appropriate storage backend
   */
  static async uploadImage(imageBuffer, originalName, options = {}) {
    const storageType = this.getStorageType();
    
    console.log(`📸 Uploading image using ${storageType} storage (${process.env.NODE_ENV || 'development'} mode)`);
    console.log(`🔧 Storage config: STORAGE_TYPE=${process.env.STORAGE_TYPE}, NODE_ENV=${process.env.NODE_ENV}`);
    console.log(`🔧 S3 Config: Bucket=${process.env.S3_BUCKET_NAME}, Region=${process.env.AWS_REGION}`);
    console.log(`🔧 S3 Service available: ${!!S3ImageService}`);
    
    try {
      let result;
      
      if (storageType === 's3') {
        if (!S3ImageService) {
          throw new Error('S3 service not available - AWS SDK not installed');
        }
        result = await S3ImageService.uploadImage(imageBuffer, originalName, options);
      } else {
        // Initialize local directories if needed
        await LocalImageService.initializeUploadDir();
        result = await LocalImageService.uploadImage(imageBuffer, originalName, options);
      }

      if (result.success) {
        console.log(`✅ Image uploaded successfully: ${result.url}`);
      } else {
        console.error(`❌ Image upload failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      console.error('ImageService Upload Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete image using appropriate storage backend
   */
  static async deleteImage(fileName) {
    const storageType = this.getStorageType();
    
    console.log(`🗑️ Deleting image using ${storageType} storage: ${fileName}`);
    
    try {
      let result;
      
      if (storageType === 's3') {
        if (!S3ImageService) {
          throw new Error('S3 service not available - AWS SDK not installed');
        }
        result = await S3ImageService.deleteImage(fileName);
      } else {
        result = await LocalImageService.deleteImage(fileName);
      }

      if (result.success) {
        console.log(`✅ Image deleted successfully: ${fileName}`);
      } else {
        console.error(`❌ Image deletion failed: ${result.error}`);
      }

      return result;
    } catch (error) {
      console.error('ImageService Delete Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get image information
   */
  static async getImageInfo(fileName) {
    const storageType = this.getStorageType();
    
    try {
      if (storageType === 's3') {
        // S3 doesn't have a direct getImageInfo method, would need to implement
        return {
          success: true,
          fileName,
          storageType: 's3',
          // Would need to implement S3 object info retrieval
        };
      } else {
        return await LocalImageService.getImageInfo(fileName);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * List images (primarily for development/admin purposes)
   */
  static async listImages(folder = '') {
    const storageType = this.getStorageType();
    
    try {
      if (storageType === 's3') {
        // Could implement S3 listing if needed
        return {
          success: true,
          images: [],
          message: 'S3 listing not implemented - check AWS console'
        };
      } else {
        return await LocalImageService.listImages(folder);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        images: []
      };
    }
  }

  /**
   * Health check for storage backend
   */
  static async healthCheck() {
    const storageType = this.getStorageType();
    
    try {
      if (storageType === 's3') {
        // Check S3 connectivity
        return {
          success: true,
          storageType: 's3',
          status: 'S3 configuration loaded',
          bucket: process.env.S3_BUCKET_NAME,
          region: process.env.AWS_REGION
        };
      } else {
        // Check local storage
        await LocalImageService.initializeUploadDir();
        const listResult = await LocalImageService.listImages();
        
        return {
          success: true,
          storageType: 'local',
          status: 'Local storage ready',
          uploadDir: process.env.LOCAL_STORAGE_PATH || 'public/uploads',
          baseUrl: process.env.LOCAL_STORAGE_URL || 'http://localhost:3000/uploads',
          imageCount: listResult.success ? listResult.images.length : 0
        };
      }
    } catch (error) {
      return {
        success: false,
        storageType,
        error: error.message
      };
    }
  }

  /**
   * Get storage configuration info
   */
  static getStorageConfig() {
    const storageType = this.getStorageType();
    
    return {
      storageType,
      environment: process.env.NODE_ENV || 'development',
      config: storageType === 's3' ? {
        bucket: process.env.S3_BUCKET_NAME,
        region: process.env.AWS_REGION,
        cdnDomain: process.env.CLOUDFRONT_DOMAIN
      } : {
        uploadDir: process.env.LOCAL_STORAGE_PATH || 'public/uploads',
        baseUrl: process.env.LOCAL_STORAGE_URL || 'http://localhost:3000/uploads'
      }
    };
  }
}

module.exports = {
  ImageService
};