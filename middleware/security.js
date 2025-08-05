const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const compression = require('compression');

// Rate limiting configuration
const createRateLimit = (windowMs, max, message) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: 'Too many requests',
      details: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks
      return req.path === '/health' || req.path === '/api/health';
    }
  });
};

// Slow down configuration
const createSlowDown = (windowMs, delayAfter, delayMs) => {
  return slowDown({
    windowMs,
    delayAfter,
    delayMs: () => delayMs, // Fixed for express-slow-down v2
    maxDelayMs: delayMs * 10, // Maximum delay
    skip: (req) => {
      // Skip slow down for health checks
      return req.path === '/health' || req.path === '/api/health';
    },
    validate: { delayMs: false } // Disable warning
  });
};

// General rate limiter - 100 requests per 15 minutes
const generalLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100,
  'Too many requests from this IP, please try again later'
);

// Strict rate limiter for auth endpoints - 5 requests per 15 minutes
const authLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  5,
  'Too many authentication attempts, please try again later'
);

// API rate limiter - 200 requests per 15 minutes
const apiLimiter = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  200,
  'Too many API requests, please try again later'
);

// Upload rate limiter - 10 uploads per hour
const uploadLimiter = createRateLimit(
  60 * 60 * 1000, // 1 hour
  10,
  'Too many upload attempts, please try again later'
);

// Slow down for repeated requests
const speedLimiter = createSlowDown(
  15 * 60 * 1000, // 15 minutes
  50, // Start slowing down after 50 requests
  500 // Delay each request by 500ms after threshold
);

// Security headers configuration
const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http://localhost:3000"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      manifestSrc: ["'self'"]
    }
  },
  
  // Strict Transport Security
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  
  // X-Frame-Options
  frameguard: {
    action: 'deny'
  },
  
  // X-Content-Type-Options
  noSniff: true,
  
  // Referrer Policy
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  },
  
  // X-Permitted-Cross-Domain-Policies
  permittedCrossDomainPolicies: false,
  
  // Hide X-Powered-By header
  hidePoweredBy: true,
  
  // X-DNS-Prefetch-Control
  dnsPrefetchControl: {
    allow: false
  }
});

// Compression middleware
const compressionMiddleware = compression({
  // Only compress responses larger than 1kb
  threshold: 1024,
  // Compression level (1-9, 6 is default)
  level: 6,
  // Don't compress if client doesn't support it
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
});

// Environment-specific security configuration
const getSecurityConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  return {
    // Enable HTTPS redirect in production only
    forceHttps: isProduction,
    
    // Stricter CSP in production
    csp: isProduction ? {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "https:"],
      connectSrc: ["'self'"]
    } : null,
    
    // Enable secure cookies in production
    secureCookies: isProduction
  };
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, url, ip } = req;
    const { statusCode } = res;
    
    // Log suspicious activity
    if (statusCode === 429) {
      console.warn(`⚠️  Rate limit exceeded: ${ip} ${method} ${url}`);
    } else if (statusCode >= 400) {
      console.warn(`⚠️  Error request: ${ip} ${method} ${url} - ${statusCode} (${duration}ms)`);
    } else if (duration > 5000) {
      console.warn(`⚠️  Slow request: ${ip} ${method} ${url} - ${statusCode} (${duration}ms)`);
    }
  });
  
  next();
};

// Security middleware factory
const createSecurityMiddleware = () => {
  const config = getSecurityConfig();
  
  return {
    // Core security headers
    helmet: securityHeaders,
    
    // Compression
    compression: compressionMiddleware,
    
    // Rate limiting
    general: generalLimiter,
    auth: authLimiter,
    api: apiLimiter,
    upload: uploadLimiter,
    slowDown: speedLimiter,
    
    // Request logging
    logger: requestLogger,
    
    // Configuration
    config
  };
};

module.exports = {
  createSecurityMiddleware,
  general: generalLimiter,
  auth: authLimiter,
  api: apiLimiter,
  upload: uploadLimiter,
  slowDown: speedLimiter,
  helmet: securityHeaders,
  compression: compressionMiddleware,
  logger: requestLogger,
  // Legacy exports for backwards compatibility
  generalLimiter,
  authLimiter,
  apiLimiter,
  uploadLimiter,
  speedLimiter,
  securityHeaders,
  compressionMiddleware,
  requestLogger
};