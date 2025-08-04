# AWS CloudFront CDN Setup Guide

This guide will help you set up Amazon CloudFront CDN to serve your S3-stored images efficiently and cost-effectively.

## Prerequisites

- AWS S3 bucket set up with your images
- AWS CLI configured with proper permissions
- S3 bucket with public read access for images

## Step 1: Create CloudFront Distribution

### Using AWS Console:

1. **Navigate to CloudFront Console**
   ```
   https://console.aws.amazon.com/cloudfront/
   ```

2. **Create Distribution**
   - Click "Create Distribution"
   - Choose "Web" distribution

3. **Origin Settings**
   ```
   Origin Domain Name: your-bucket-name.s3.amazonaws.com
   Origin Path: (leave empty)
   Origin ID: S3-poems-india-images
   ```

4. **Cache Behavior Settings**
   ```
   Viewer Protocol Policy: Redirect HTTP to HTTPS
   Allowed HTTP Methods: GET, HEAD
   Cache Based on Selected Request Headers: None
   Object Caching: Use Origin Cache Headers
   ```

5. **Distribution Settings**
   ```
   Price Class: Use All Edge Locations (Best Performance)
   AWS WAF Web ACL: None
   Alternate Domain Names (CNAMEs): your-domain.com (optional)
   SSL Certificate: Default CloudFront Certificate
   ```

### Using AWS CLI:

```bash
# Create distribution configuration
aws cloudfront create-distribution --distribution-config file://cloudfront-config.json
```

**cloudfront-config.json:**
```json
{
  "CallerReference": "poems-india-images-$(date +%s)",
  "Comment": "CDN for Poems India images",
  "DefaultRootObject": "",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3-poems-india-images",
        "DomainName": "poems-india-images.s3.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-poems-india-images",
    "ViewerProtocolPolicy": "redirect-to-https",
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    },
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      }
    },
    "MinTTL": 86400
  },
  "Enabled": true,
  "PriceClass": "PriceClass_All"
}
```

## Step 2: Configure S3 Bucket Policy

Allow CloudFront to access your S3 bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontAccess",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity EXXXXXXXXXXXXX"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::poems-india-images/*"
    }
  ]
}
```

## Step 3: Update Environment Variables

Add your CloudFront domain to your `.env` file:

```bash
# AWS S3 Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here
S3_BUCKET_NAME=poems-india-images
CLOUDFRONT_DOMAIN=d1234567890.cloudfront.net
```

## Step 4: Update S3 Service Configuration

The S3 service is already configured to use CloudFront if the domain is provided:

```javascript
// In config/s3.js - already implemented
const cdnUrl = CLOUDFRONT_DOMAIN 
  ? \`https://\${CLOUDFRONT_DOMAIN}/\${fileName}\`
  : s3Url;

return {
  url: cdnUrl || s3Url, // Prefer CDN URL
  // ... other properties
};
```

## Step 5: Test the Setup

1. **Upload a test image**:
   ```bash
   curl -X POST http://localhost:3000/api/images/upload \\
     -F "image=@test-image.jpg" \\
     -F "submissionType=article"
   ```

2. **Verify CDN delivery**:
   - Check the returned URL uses your CloudFront domain
   - Test image loading speed from different locations

## Step 6: Performance Optimization

### Cache Headers
Update your S3 upload to include cache headers:

```javascript
// In S3ImageService.uploadImage()
CacheControl: 'max-age=31536000', // 1 year cache
Expires: new Date(Date.now() + 31536000000), // 1 year from now
```

### Image Optimization
Consider adding image optimization at the edge:

```javascript
// Optional: Use CloudFront Functions for automatic WebP conversion
const cloudfrontFunction = `
function handler(event) {
    var request = event.request;
    var headers = request.headers;
    
    if (headers.accept && headers.accept.value.includes('image/webp')) {
        // Modify request to get WebP version
        request.uri = request.uri.replace(/\\.(jpg|jpeg|png)$/, '.webp');
    }
    
    return request;
}
`;
```

## Cost Optimization Tips

1. **Use appropriate price class**:
   - `PriceClass_100`: US, Canada, Europe
   - `PriceClass_200`: US, Canada, Europe, Asia, Middle East, Africa
   - `PriceClass_All`: All edge locations (highest cost)

2. **Set up proper cache headers**:
   - Long cache times for images (1 year)
   - Proper ETags for cache validation

3. **Monitor usage**:
   ```bash
   # Check CloudFront metrics
   aws cloudwatch get-metric-statistics \\
     --namespace AWS/CloudFront \\
     --metric-name Requests \\
     --dimensions Name=DistributionId,Value=EXXXXXXXXXXXXX \\
     --start-time 2023-01-01T00:00:00Z \\
     --end-time 2023-01-02T00:00:00Z \\
     --period 3600 \\
     --statistics Sum
   ```

## Security Considerations

1. **Origin Access Identity (OAI)**:
   - Create OAI to restrict direct S3 access
   - Only allow CloudFront to access S3 objects

2. **Signed URLs** (if needed for private content):
   ```javascript
   const AWS = require('aws-sdk');
   const cloudfront = new AWS.CloudFront.Signer(keyPairId, privateKey);
   
   const signedUrl = cloudfront.getSignedUrl({
     url: 'https://d1234567890.cloudfront.net/private-image.jpg',
     expires: Math.floor(Date.now() / 1000) + 3600 // 1 hour
   });
   ```

## Troubleshooting

### Common Issues:

1. **403 Forbidden Errors**:
   - Check S3 bucket policy
   - Verify OAI configuration
   - Ensure objects are publicly readable

2. **Slow Cache Invalidation**:
   ```bash
   # Invalidate cache for specific files
   aws cloudfront create-invalidation \\
     --distribution-id EXXXXXXXXXXXXX \\
     --paths "/images/*"
   ```

3. **CORS Issues**:
   ```xml
   <!-- S3 Bucket CORS Configuration -->
   <CORSConfiguration>
     <CORSRule>
       <AllowedOrigin>*</AllowedOrigin>
       <AllowedMethod>GET</AllowedMethod>
       <AllowedHeader>*</AllowedHeader>
     </CORSRule>
   </CORSConfiguration>
   ```

## Monitoring and Analytics

Set up CloudWatch alarms for:
- High error rates (4xx, 5xx)
- Unusual traffic spikes
- Cache hit ratio below 80%

```bash
# Create CloudWatch alarm for high error rate
aws cloudwatch put-metric-alarm \\
  --alarm-name "CloudFront-High-Error-Rate" \\
  --alarm-description "CloudFront 4xx error rate > 5%" \\
  --metric-name 4xxErrorRate \\
  --namespace AWS/CloudFront \\
  --statistic Average \\
  --period 300 \\
  --threshold 5 \\
  --comparison-operator GreaterThanThreshold
```

Your CloudFront CDN is now configured to serve your Poems India images efficiently and cost-effectively!