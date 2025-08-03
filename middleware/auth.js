const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Access token required' });
    }

    const token = authHeader.substring(7);
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
    const userId = decoded.userId;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ message: 'Invalid token or user not found' });
    }

    req.user = {
      _id: user._id,
      userId: user._id, // Add userId for consistency
      username: user.username,
      email: user.email,
      role: user.role
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired' });
    }
    
    console.error('Authentication error:', error);
    res.status(401).json({ message: 'Authentication failed' });
  }
};

const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Insufficient permissions. Required roles: ' + allowedRoles.join(', ') 
      });
    }

    next();
  };
};

const requireReviewer = requireRole(['admin', 'reviewer']);
const requireAdmin = requireRole(['admin']);

const generateToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'fallback-secret-key',
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key');
};

module.exports = {
  authenticateUser,
  requireRole,
  requireReviewer,
  requireAdmin,
  generateToken,
  verifyToken
};