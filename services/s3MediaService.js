const { ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('../config/s3');

class S3MediaService {
  static async listObjects(prefix = '', continuationToken = null, maxKeys = 100) {
    if (!s3Client) {
      return { success: false, error: 'S3 client not initialized' };
    }

    try {
      const params = {
        Bucket: BUCKET_NAME,
        Prefix: prefix || undefined,
        MaxKeys: Number(maxKeys) || 100
      };
      if (continuationToken) params.ContinuationToken = continuationToken;

      const command = new ListObjectsV2Command(params);
      const result = await s3Client.send(command);

      const region = process.env.AWS_REGION || 'us-east-1';
      const baseUrl = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/`;

      const objects = (result.Contents || []).map(obj => ({
        Key: obj.Key,
        Size: obj.Size,
        LastModified: obj.LastModified,
        Url: `${baseUrl}${encodeURI(obj.Key)}`
      }));

      return {
        success: true,
        objects,
        isTruncated: result.IsTruncated,
        nextContinuationToken: result.NextContinuationToken
      };
    } catch (err) {
      console.error('S3 list error:', err && err.message ? err.message : err);
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  }

  static async deleteObject(key) {
    if (!s3Client) {
      return { success: false, error: 'S3 client not initialized' };
    }

    try {
      const command = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key });
      await s3Client.send(command);
      return { success: true };
    } catch (err) {
      console.error('S3 delete error:', err && err.message ? err.message : err);
      return { success: false, error: err && err.message ? err.message : String(err) };
    }
  }
}

module.exports = S3MediaService;
