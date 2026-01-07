const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');

// S3 Client Configuration with validation
let s3Client;
let credentialsValid = false;

try {
  // Validate required AWS credentials
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || 'us-east-1';
  
  if (!accessKeyId || !secretAccessKey) {
    console.warn('⚠️  AWS credentials not found in environment variables');
    console.warn('🔧 Required: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
    throw new Error('Missing AWS credentials');
  }
  
  if (accessKeyId === 'your-aws-access-key' || secretAccessKey === 'your-aws-secret-key') {
    console.warn('⚠️  AWS credentials appear to be placeholder values');
    throw new Error('AWS credentials contain placeholder values');
  }
  
  s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
  
  credentialsValid = true;
  console.log('✅ AWS S3 Client initialized successfully');
  console.log(`🔧 Region: ${region}`);
  console.log(`🔧 Access Key: ${accessKeyId.substring(0, 4)}***`);
  
} catch (error) {
  console.warn('❌ Failed to initialize AWS S3 Client:', error.message);
  console.warn('🔧 S3 upload functionality will be unavailable');
  s3Client = null;
}

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'poems-india-images';
const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN; // Optional CDN domain

class S3ImageService {
  /**
   * Check if S3 service is available and properly configured
   */
  static isAvailable() {
    return s3Client !== null && credentialsValid;
  }

  /**
   * Compress image with specific quality
   * @param {Object} sharpInstance - Sharp instance
   * @param {number} quality - Quality level (0-100)
   * @param {string} format - Image format
   * @returns {Promise<Object>} Compressed buffer and quality used
   */
  static async compressWithQuality(sharpInstance, quality, format) {
    let optimizedBuffer;

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

    return { optimizedBuffer, qualityUsed: quality };
  }

  /**
   * Compress image with minimum file size requirement
   * @param {Buffer} originalBuffer - Original image buffer
   * @param {number} minimumFileSize - Minimum file size in bytes
   * @param {string} format - Image format
   * @returns {Promise<Object>} Optimized buffer and quality used
   */
  static async compressWithMinimumSize(originalBuffer, minimumFileSize, format) {
    // If original < 100KB, return as-is without compression
    if (originalBuffer.length < minimumFileSize) {
      return {
        optimizedBuffer: originalBuffer,
        qualityUsed: 100
      };
    }

    // Try quality levels: 80%, 85%, 90%, 95%
    const qualityLevels = [80, 85, 90, 95];
    let lastBuffer = null;
    let lastQuality = 80;

    for (const quality of qualityLevels) {
      const sharpCopy = sharp(originalBuffer);
      const result = await this.compressWithQuality(sharpCopy, quality, format);

      // Found quality that meets minimum size
      if (result.optimizedBuffer.length >= minimumFileSize) {
        return result;
      }

      lastBuffer = result.optimizedBuffer;
      lastQuality = quality;
    }

    // Even 95% is < 100KB, return best effort
    return { optimizedBuffer: lastBuffer, qualityUsed: lastQuality };
  }

  /**
   * Upload image to S3 with optimization
   * @param {Buffer} imageBuffer - Image buffer
   * @param {string} originalName - Original filename
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result with URL
   */
  static async uploadImage(imageBuffer, originalName, options = {}) {
    // Check if S3 service is available before attempting upload
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'AWS S3 service is not available - credentials not properly configured'
      };
    }

    try {
      const {
        quality = 80,
        maxWidth = 1200,
        maxHeight = 800,
        format = 'jpeg',
        folder = 'articles', // articles, essays, etc.
        minimumFileSize = null
      } = options;

      // Generate unique filename
      const fileExtension = format === 'jpeg' ? 'jpg' : format;
      const fileName = `${folder}/${Date.now()}-${uuidv4()}.${fileExtension}`;

      // Optimize image with Sharp
      const sharpInstance = sharp(imageBuffer);

      // Get image metadata
      const metadata = await sharpInstance.metadata();

      // Resize if needed
      let processedBuffer = imageBuffer;
      if (metadata.width > maxWidth || metadata.height > maxHeight) {
        sharpInstance.resize(maxWidth, maxHeight, {
          fit: 'inside',
          withoutEnlargement: true
        });
        // Get resized buffer for minimum size compression
        processedBuffer = await sharpInstance.toBuffer();
      }

      // Convert and compress with minimum size support
      const compressionResult = minimumFileSize
        ? await this.compressWithMinimumSize(processedBuffer, minimumFileSize, format)
        : await this.compressWithQuality(sharp(processedBuffer), quality, format);

      const optimizedBuffer = compressionResult.optimizedBuffer;
      const qualityUsed = compressionResult.qualityUsed;

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
        },
        qualityUsed,
        appliedMinimumSize: !!minimumFileSize
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