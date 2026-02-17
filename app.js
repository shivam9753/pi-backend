const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment-specific .env file
// Force production environment if running with PM2 or explicitly set
const NODE_ENV = process.env.NODE_ENV || (process.env.PM2_HOME ? 'production' : 'development');
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';

console.log(`Loading environment config: ${envFile}`);
console.log(`NODE_ENV detected as: ${NODE_ENV}`);

// Load environment variables
const envResult = dotenv.config({ path: envFile });

if (envResult.error) {
  console.warn(`Warning: Could not load ${envFile}:`, envResult.error.message);
  // Try loading default .env as fallback
  const fallbackResult = dotenv.config({ path: '.env' });
  if (fallbackResult.error) {
    console.error('Could not load any environment file');
  } else {
    console.log('Loaded fallback .env file');
  }
} else {
  console.log(`✅ Successfully loaded ${envFile}`);
}

// Log important environment variables for debugging
console.log(`- NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`- STORAGE_TYPE: ${process.env.STORAGE_TYPE}`);
console.log(`- Database: ${process.env.ATLAS_URL ? 'Configured' : 'Not configured'}`);

// Ensure NODE_ENV is set correctly after loading environment file
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = NODE_ENV;
  console.log(`Set NODE_ENV to: ${NODE_ENV}`);
}

// Initialize development validation
const DevValidation = require('./utils/devValidation');
DevValidation.initializeChecks();

// Import models first to ensure they are registered
require('./models/User');
require('./models/Submission');
require('./models/Content');
require('./models/Review');

// Import route modules
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const promptRoutes = require('./routes/prompts');
const imageRoutes = require('./routes/imageRoutes');
const purgeRoutes = require('./routes/purgeRoutes');
const contentRoutes = require('./routes/contentRoutes');
const tagRoutes = require('./routes/tagRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const publicRoutes = require('./routes/publicRoutes');
// const writingProgramRoutes = require('./routes/writingProgramRoutes'); // DEPRECATED - writing program routes unregistered
// const poetryAnalysis = require('./routes/poetry-analysis'); // DEPRECATED - moved to submissionRoutes

// Import security middleware
const { createSecurityMiddleware } = require('./middleware/security');

// Instantiate security middleware functions once (factory returns concrete middlewares)
const securityMiddleware = createSecurityMiddleware();
// Fallback to legacy named exports if the factory isn't available
const apiLimiter = securityMiddleware.api || require('./middleware/security').api;
const authLimiter = securityMiddleware.auth || require('./middleware/security').auth;
const uploadLimiter = securityMiddleware.upload || require('./middleware/security').upload;
const helmetMiddleware = securityMiddleware.helmet || require('./middleware/security').helmet;
const compressionMiddleware = securityMiddleware.compression || require('./middleware/security').compression;
const requestLogger = securityMiddleware.logger || require('./middleware/security').logger;

const app = express();

// Configure Express to trust proxy (required for Nginx reverse proxy)
// Trust only the first proxy (Nginx) for security
app.set('trust proxy', 1);

// Middleware
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Conditional parsing - exclude file upload routes from JSON and urlencoded parsing
app.use((req, res, next) => {
  // Skip all body parsing for file upload routes - let multer handle it
  if (req.url.includes('/upload-profile-image') || 
      req.url.includes('/api/images/upload') ||
      req.url.includes('/upload-image')) {
    console.log('🔧 Skipping body parsing for file upload route:', req.url);
    return next();
  }
  // Apply JSON parsing for all other routes
  express.json({ limit: '10mb' })(req, res, next);
});

app.use((req, res, next) => {
  // Skip urlencoded parsing for file upload routes
  if (req.url.includes('/upload-profile-image') || 
      req.url.includes('/api/images/upload') ||
      req.url.includes('/upload-image')) {
    return next();
  }
  // Apply urlencoded parsing for all other routes
  express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

app.use(cors({
  origin: process.env.FRONTEND_URLS ? process.env.FRONTEND_URLS.split(',') : [
    'http://localhost:4200',
    'http://127.0.0.1:4200'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'Expires', 'X-Build-Version'],
  credentials: true
}));

// Force HTML (SSR) responses to never be cached by browsers/proxies/CDNs
app.use((req, res, next) => {
  try {
    if (req.method === 'GET') {
      const accept = (req.headers.accept || '').toLowerCase();
      const wantsHtml = accept.includes('text/html') || req.path === '/' || req.path.endsWith('.html') || req.path === '/index.html';
      if (wantsHtml) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
      }
    }
  } catch (e) {
    // don't block request on header-setting errors
    console.warn('Failed to set no-cache headers:', e && e.message);
  }
  next();
});

// Expose a simple build/version endpoint that is never cached (helpful for health/debug)
app.get('/version.json', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ version: process.env.BUILD_VERSION || Date.now() });
});

// Serve long-cache headers for static assets (JS/CSS/images/fonts). This complements the no-cache HTML policy above.
app.use((req, res, next) => {
  try {
    if (req.method === 'GET') {
      const url = req.path || '';

      // Consider typical static asset locations and file extensions
      const isAssetPath = url.startsWith('/assets') || url.startsWith('/static') || url.includes('/dist/') || url.includes('/browser/');
      const isAssetExt = /\.(js|css|png|jpg|jpeg|svg|webp|gif|woff2?|ttf|eot|map)$/i.test(url);

      // Don't accidentally cache HTML
      const isHtml = /\.(html?)$/i.test(url) || url === '/' || url.endsWith('/index.html');

      if (!isHtml && (isAssetPath || isAssetExt)) {
        // Long cache for immutable hashed assets (one year)
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  } catch (e) {
    console.warn('Failed to set asset cache headers:', e && e.message);
  }
  next();
});

// Connect to MongoDB (both Mongoose and native client)
const { connectDB: connectMongooseDB } = require('./config/database');
const { connectDB: connectNativeDB } = require('./db');

Promise.all([
  connectMongooseDB(),
  connectNativeDB()
]).catch(error => {
  console.error('Error connecting to database:', error);
  process.exit(1);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Register the new sendEmailRoutes at /api/sendemail
app.use('/api/sendemail', require('./routes/sendEmailRoutes'));

// Apply API rate limiting to API routes
if (typeof apiLimiter === 'function') {
  app.use('/api', apiLimiter);
} else {
  console.warn('Warning: apiLimiter is not a function, skipping API rate limiter');
}

// Apply auth rate limiting to auth routes
if (typeof authLimiter === 'function') {
  app.use('/api/auth', authLimiter);
} else {
  console.warn('Warning: authLimiter is not a function, skipping auth rate limiter');
}

// Apply upload rate limiting to image routes
if (typeof uploadLimiter === 'function') {
  app.use('/api/images', uploadLimiter);
} else {
  console.warn('Warning: uploadLimiter is not a function, skipping upload rate limiter');
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/users', userRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/purge', purgeRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/analytics', analyticsRoutes);
// app.use('/api/writing-programs', writingProgramRoutes); // DEPRECATED - writing program routes unregistered
app.use('/api/admin', require('./routes/adminRoutes'));

// Sitemap route (public)
try {
  const sitemapRoute = require('./routes/sitemap');
  app.use('/', sitemapRoute);
  console.log('✅ Sitemap route registered at /sitemap.xml');
} catch (err) {
  console.warn('⚠️ Could not register sitemap route:', err.message);
}


// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Validation Error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }
  
  if (err.name === 'CastError') {
    return res.status(400).json({
      message: 'Invalid ID format'
    });
  }
  
  if (err.code === 11000) {
    return res.status(400).json({
      message: 'Duplicate key error',
      field: Object.keys(err.keyPattern)[0]
    });
  }
  
  res.status(500).json({
    message: 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    message: 'Route not found'
  });
});

module.exports = app;