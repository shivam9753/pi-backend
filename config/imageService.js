// Load services conditionally based on environment
let S3ImageService;
try {
  S3ImageService = require('./s3').S3ImageService;
  console.log('🔧 DEBUG: S3ImageService loaded successfully');
} catch (error) {
  console.log('🔧 DEBUG: S3 service not available (AWS SDK not installed) - using local storage');
  console.log('🔧 DEBUG: S3 import error:', error.message);
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
    
    // When production intends to use S3, we should NOT silently fall back to local storage.
    if (storageType === 's3') {
      console.log('🔧 DEBUG: Attempting S3 upload...');
      console.log('🔧 DEBUG: S3ImageService available:', !!S3ImageService);
      
      if (!S3ImageService) {
        const errMsg = 'S3ImageService unavailable: AWS SDK or S3 module not loaded. Aborting upload to avoid using local storage in production.';
        console.error('❌', errMsg);
        return {
          success: false,
          error: errMsg
        };
      }

      if (typeof S3ImageService.isAvailable === 'function' && !S3ImageService.isAvailable()) {
        const errMsg = 'S3ImageService is not properly configured. Aborting upload to avoid using local storage in production.';
        console.error('❌', errMsg);
        return {
          success: false,
          error: errMsg
        };
      }

      try {
        console.log('🔧 DEBUG: Calling S3ImageService.uploadImage...');
        const result = await S3ImageService.uploadImage(imageBuffer, originalName, options);
        console.log('🔧 DEBUG: S3 upload result:', result && result.success ? 'SUCCESS' : 'FAILED');
        if (result && result.success) {
          console.log(`✅ Image uploaded successfully to S3: ${result.url}`);
          return result;
        }
        // If S3 returned failure, bubble it up rather than falling back
        console.error('❌ S3 upload failed:', result && result.error ? result.error : 'unknown error');
        return {
          success: false,
          error: result && result.error ? result.error : 'S3 upload failed'
        };
      } catch (s3Error) {
        console.error('🔧 DEBUG: S3 upload threw error:', s3Error.message || s3Error);
        return {
          success: false,
          error: s3Error.message || String(s3Error)
        };
      }
    } else {
      // Use local storage directly (development/local config)
      try {
        await LocalImageService.initializeUploadDir();
        const result = await LocalImageService.uploadImage(imageBuffer, originalName, options);
        
        if (result.success) {
          console.log(`✅ Image uploaded successfully to local storage: ${result.url}`);
        } else {
          console.error(`❌ Image upload failed: ${result.error}`);
        }
        
        return result;
      } catch (error) {
        console.error('ImageService Local Upload Error:', error);
        return {
          success: false,
          error: error.message
        };
      }
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
          const errMsg = 'S3ImageService unavailable: cannot delete from S3 in this environment.';
          console.error('❌', errMsg);
          return { success: false, error: errMsg };
        }
        result = await S3ImageService.deleteImage(fileName);
      } else {
        result = await LocalImageService.deleteImage(fileName);
      }

      if (result && result.success) {
        console.log(`✅ Image deleted successfully: ${fileName}`);
      } else {
        console.error(`❌ Image deletion failed: ${result && result.error ? result.error : 'unknown error'}`);
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
        if (!S3ImageService || (typeof S3ImageService.isAvailable === 'function' && !S3ImageService.isAvailable())) {
          return { success: false, storageType: 's3', error: 'S3ImageService not available or not configured' };
        }
        // Optionally call a lightweight S3 connectivity check if implemented
        if (typeof S3ImageService.healthCheck === 'function') {
          return await S3ImageService.healthCheck();
        }
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