const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

// S3 Client Configuration
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'poems-india-images';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN; // Optional CDN domain

class S3ImageService {
  /**
   * Upload image to S3 with optimization
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
        folder = 'articles' // articles, essays, etc.
      } = options;

      // Generate unique filename
      const fileExtension = format === 'jpeg' ? 'jpg' : format;
      const fileName = `${folder}/${Date.now()}-${uuidv4()}.${fileExtension}`;

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

      // Upload to S3
      const upload = new Upload({
        client: s3Client,
        params: {
          Bucket: BUCKET_NAME,
          Key: fileName,
          Body: optimizedBuffer,
          ContentType: `image/${format}`,
          CacheControl: 'max-age=31536000', // 1 year cache
          Metadata: {
            'original-name': originalName,
            'upload-date': new Date().toISOString(),
            'optimized': 'true'
          }
        },
      });

      const result = await upload.done();
      
      // Generate URLs
      const s3Url = result.Location;
      const cdnUrl = CLOUDFRONT_DOMAIN 
        ? `https://${CLOUDFRONT_DOMAIN}/${fileName}`
        : s3Url;

      return {
        success: true,
        fileName,
        s3Url,
        cdnUrl,
        url: cdnUrl || s3Url, // Prefer CDN URL
        size: optimizedBuffer.length,
        originalSize: imageBuffer.length,
        compressionRatio: Math.round(((imageBuffer.length - optimizedBuffer.length) / imageBuffer.length) * 100),
        dimensions: {
          width: metadata.width,
          height: metadata.height
        }
      };

    } catch (error) {
      console.error('S3 Upload Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete image from S3
   * @param {string} fileName - S3 object key
   * @returns {Promise<Object>} Delete result
   */
  static async deleteImage(fileName) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
      });

      await s3Client.send(command);
      
      return {
        success: true,
        message: 'Image deleted successfully'
      };
    } catch (error) {
      console.error('S3 Delete Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate presigned URL for direct upload (optional)
   * @param {string} fileName - Desired filename
   * @param {number} expiresIn - URL expiry in seconds
   * @returns {Promise<string>} Presigned URL
   */
  static async generatePresignedUrl(fileName, expiresIn = 3600) {
    try {
      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
      });

      const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
      return signedUrl;
    } catch (error) {
      console.error('Presigned URL Error:', error);
      throw error;
    }
  }

  /**
   * Move image from temporary to permanent storage
   * @param {string} tempKey - Temporary S3 key (temp/folder/filename)
   * @param {string} permanentKey - Permanent S3 key (folder/filename)
   * @returns {Promise<Object>} Move result with new URL
   */
  static async moveFromTemp(tempKey, permanentKey) {
    try {
      // Copy object to new location
      const copyCommand = new CopyObjectCommand({
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${tempKey}`,
        Key: permanentKey,
        MetadataDirective: 'COPY'
      });

      await s3Client.send(copyCommand);

      // Delete original temp file
      const deleteResult = await this.deleteImage(tempKey);
      if (!deleteResult.success) {
        console.warn(`Failed to delete temp file after copy: ${tempKey}`);
      }

      // Generate new URLs
      const s3Url = `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${permanentKey}`;
      const cdnUrl = CLOUDFRONT_DOMAIN 
        ? `https://${CLOUDFRONT_DOMAIN}/${permanentKey}`
        : s3Url;

      return {
        success: true,
        url: cdnUrl || s3Url,
        s3Url,
        cdnUrl,
        permanentKey
      };

    } catch (error) {
      console.error('S3 Move Error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get optimized image sizes for responsive display
   * @param {string} baseFileName - Original filename without extension
   * @param {string} format - Image format
   * @returns {Object} Different sized URLs
   */
  static getResponsiveUrls(baseFileName, format = 'jpg') {
    const baseUrl = CLOUDFRONT_DOMAIN 
      ? `https://${CLOUDFRONT_DOMAIN}/` 
      : `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/`;

    return {
      original: `${baseUrl}${baseFileName}.${format}`,
      large: `${baseUrl}${baseFileName}-lg.${format}`,
      medium: `${baseUrl}${baseFileName}-md.${format}`,
      small: `${baseUrl}${baseFileName}-sm.${format}`,
      thumbnail: `${baseUrl}${baseFileName}-thumb.${format}`
    };
  }
}

module.exports = {
  S3ImageService,
  s3Client,
  BUCKET_NAME
};