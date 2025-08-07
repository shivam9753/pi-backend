const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = process.env.LOCAL_STORAGE_PATH || 'public/uploads';
const BASE_URL = process.env.LOCAL_STORAGE_URL || 'http://localhost:3000/uploads';

class LocalImageService {
  /**
   * Initialize upload directory
   */
  static async initializeUploadDir() {
    try {
      // Create main upload directory
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      
      // Create subdirectories for different content types
      const subdirs = ['articles', 'essays', 'stories', 'poems', 'general', 'submissions'];
      for (const subdir of subdirs) {
        await fs.mkdir(path.join(UPLOAD_DIR, subdir), { recursive: true });
      }
      
      console.log('Upload directories initialized successfully');
    } catch (error) {
      console.error('Error initializing upload directories:', error);
    }
  }

  /**
   * Upload image to local file system with optimization
   * @param {Buffer} imageBuffer - Image buffer
   * @param {string} originalName - Original filename
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with URL
   */
  static async uploadImage(imageBuffer, originalName, options = {}) {
    try {
      const {
        quality = 80,
        maxWidth = 1200,
        maxHeight = 800,
        format = 'jpeg',
        folder = 'articles'
      } = options;

      // Generate unique filename
      const fileExtension = format === 'jpeg' ? 'jpg' : format;
      const fileName = `${Date.now()}-${uuidv4()}.${fileExtension}`;
      const relativePath = `${folder}/${fileName}`;
      const fullPath = path.join(UPLOAD_DIR, relativePath);

      // Optimize image with Sharp
      let optimizedBuffer;
      const sharpInstance = sharp(imageBuffer);
      
      // Get image metadata
      const metadata = await sharpInstance.metadata();
      
      // Resize if needed
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        sharpInstance.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });
      }

      // Convert and compress
      if (format === 'jpeg') {
        optimizedBuffer = await sharpInstance
          .jpeg({ quality, progressive: true })
          .toBuffer();
      } else if (format === 'png') {
        optimizedBuffer = await sharpInstance
          .png({ compressionLevel: 8 })
          .toBuffer();
      } else {
        optimizedBuffer = await sharpInstance.toBuffer();
      }

      // Write file to disk
      await fs.writeFile(fullPath, optimizedBuffer);

      // Generate URL
      const url = `${BASE_URL}/${relativePath.replace(/\\/g, '/')}`;

      return {
        success: true,
        fileName: relativePath,
        url,
        localPath: fullPath,
        size: optimizedBuffer.length,
        originalSize: imageBuffer.length,
        compressionRatio: Math.round(((imageBuffer.length - optimizedBuffer.length) / imageBuffer.length) * 100),
        dimensions: {
          width: metadata.width,
          height: metadata.height
        }
      };

    } catch (error) {
      console.error('Local Upload Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete image from local file system
   * @param {string} fileName - Relative file path
   * @returns {Promise<Object>} Delete result
   */
  static async deleteImage(fileName) {
    try {
      const fullPath = path.join(UPLOAD_DIR, fileName);
      
      // Check if file exists
      try {
        await fs.access(fullPath);
      } catch {
        return {
          success: false,
          error: 'File not found'
        };
      }

      // Delete file
      await fs.unlink(fullPath);
      
      return {
        success: true,
        message: 'Image deleted successfully'
      };
    } catch (error) {
      console.error('Local Delete Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get image information
   * @param {string} fileName - Relative file path
   * @returns {Promise<Object>} Image info
   */
  static async getImageInfo(fileName) {
    try {
      const fullPath = path.join(UPLOAD_DIR, fileName);
      const stats = await fs.stat(fullPath);
      const url = `${BASE_URL}/${fileName.replace(/\\/g, '/')}`;

      return {
        success: true,
        fileName,
        url,
        localPath: fullPath,
        size: stats.size,
        lastModified: stats.mtime,
        exists: true
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        exists: false
      };
    }
  }

  /**
   * List all images in a folder
   * @param {string} folder - Folder name
   * @returns {Promise<Array>} List of images
   */
  static async listImages(folder = '') {
    try {
      const folderPath = path.join(UPLOAD_DIR, folder);
      const files = await fs.readdir(folderPath);
      
      const images = [];
      for (const file of files) {
        const filePath = path.join(folderPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isFile() && /\.(jpg|jpeg|png|webp)$/i.test(file)) {
          const relativePath = folder ? `${folder}/${file}` : file;
          images.push({
            fileName: relativePath,
            url: `${BASE_URL}/${relativePath.replace(/\\/g, '/')}`,
            size: stats.size,
            lastModified: stats.mtime
          });
        }
      }
      
      return {
        success: true,
        images: images.sort((a, b) => b.lastModified - a.lastModified)
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        images: []
      };
    }
  }

  /**
   * Clean up old images (older than specified days)
   * @param {number} daysOld - Number of days
   * @returns {Promise<Object>} Cleanup result
   */
  static async cleanupOldImages(daysOld = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      let deletedCount = 0;
      const subdirs = ['articles', 'essays', 'stories', 'poems', 'general', 'submissions'];

      for (const subdir of subdirs) {
        const folderPath = path.join(UPLOAD_DIR, subdir);
        
        try {
          const files = await fs.readdir(folderPath);
          
          for (const file of files) {
            const filePath = path.join(folderPath, file);
            const stats = await fs.stat(filePath);
            
            if (stats.isFile() && stats.mtime < cutoffDate) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          }
        } catch (error) {
          console.error(`Error cleaning up ${subdir}:`, error);
        }
      }

      return {
        success: true,
        deletedCount,
        message: `Cleaned up ${deletedCount} old images`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        deletedCount: 0
      };
    }
  }
}

module.exports = {
  LocalImageService,
  UPLOAD_DIR,
  BASE_URL
};