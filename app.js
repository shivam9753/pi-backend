const express = require('express');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

// Load environment-specific .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env';

console.log(`Loading environment config: ${envFile}`);
dotenv.config({ path: envFile });

// Import models first to ensure they are registered
require('./models/User');
require('./models/Submission');
require('./models/Content');
require('./models/Review');

// Import route modules
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const contentRoutes = require('./routes/contentRoutes');
const submissionRoutes = require('./routes/submissionRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const promptRoutes = require('./routes/prompts');
const imageRoutes = require('./routes/imageRoutes');

// Import security middleware
const security = require('./middleware/security');


const app = express();

// Middleware
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(cors({
  origin: process.env.FRONTEND_URLS ? process.env.FRONTEND_URLS.split(',') : [
    'http://localhost:4200', 
    'http://127.0.0.1:4200'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

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

// Apply API rate limiting to API routes
app.use('/api', security.api);

// Apply auth rate limiting to auth routes
app.use('/api/auth', security.auth);

// Apply upload rate limiting to image routes
app.use('/api/images', security.upload);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/submissions', submissionRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/images', imageRoutes);

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