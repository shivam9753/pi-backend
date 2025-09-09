const express = require('express');
const User = require('../models/User');
const UserService = require('../services/userService');
const { validateLogin, validateUserRegistration } = require('../middleware/validation');

const router = express.Router();

// POST /api/auth/register - Register new user
router.post('/register', validateUserRegistration, async (req, res) => {
  try {
    const result = await UserService.registerUser(req.body);
    res.status(201).json({
      message: 'User registered successfully',
      user: result.user.toAuthJSON(),
      token: result.token
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(409).json({ 
        message: error.message,
        details: 'A user with this email or username already exists. Please try logging in instead.'
      });
    }
    if (error.message.includes('validation')) {
      return res.status(400).json({ 
        message: 'Invalid user data provided',
        details: error.message 
      });
    }
    res.status(500).json({ 
      message: 'Registration failed', 
      details: error.message 
    });
  }
});

// POST /api/auth/login - Login user
router.post('/login', validateLogin, async (req, res) => {
  try {
    const result = await UserService.loginUser(req.body.email, req.body.password);
    res.json({
      message: 'Login successful',
      user: result.user.toAuthJSON(),
      token: result.token
    });
  } catch (error) {
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ 
        message: error.message,
        details: 'Please check your email and password and try again.'
      });
    }
    res.status(500).json({ 
      message: 'Login failed', 
      details: error.message 
    });
  }
});

// POST /api/auth/google-login - Authenticate existing Google user or register new user
router.post('/google-login', async (req, res) => {
  const { email, name, picture } = req.body;

  if (!email || !name) {
    return res.status(400).json({ message: 'Email and name are required' });
  }

  try {
    // First, check if user already exists
    const existingUser = await User.findByEmail(email);
    
    if (existingUser) {
      // User exists - authenticate them
      const { generateToken } = require('../middleware/auth');
      const token = generateToken(existingUser._id);
      
      // Update user's name and picture if they've changed
      let updatedUser = existingUser;
      if (existingUser.name !== name || existingUser.profileImage !== picture) {
        updatedUser = await User.findByIdAndUpdate(
          existingUser._id,
          { 
            name: name,
            profileImage: picture || existingUser.profileImage
          },
          { new: true }
        );
      }
      
      res.json({
        message: 'Google user authenticated successfully',
        user: updatedUser.toAuthJSON(),
        token,
      });
    } else {
      // User doesn't exist - register them
      // Create a smart username that fits within 30 char limit
      const timestamp = Date.now();
      const baseName = name.replace(/\s+/g, '_').toLowerCase();
      const maxBaseLength = 30 - String(timestamp).length - 1; // -1 for underscore
      const smartUsername = baseName.substring(0, maxBaseLength) + '_' + timestamp;
      
      const userData = {
        email,
        name,
        username: smartUsername, // Smart username generation within 30 char limit
        password: 'GOOGLE_AUTH_' + Date.now(), // Temporary password
        bio: 'To be updated!', // Simple default bio
        profileImage: picture || ''
      };

      try {
        const result = await UserService.registerUser(userData);
        
        res.status(201).json({
          message: 'Google user registered successfully',
          user: result.user.toAuthJSON(),
          token: result.token,
        });
      } catch (registrationError) {
        // If registration fails due to user existing (race condition), try to login
        if (registrationError.message.includes('already exists')) {
          const existingUser = await User.findByEmail(email);
          if (existingUser) {
            const { generateToken } = require('../middleware/auth');
            const token = generateToken(existingUser._id);
            
            return res.json({
              message: 'Google user authenticated successfully',
              user: existingUser.toAuthJSON(),
              token,
            });
          }
        }
        throw registrationError; // Re-throw if it's a different error
      }
    }
  } catch (error) {
    console.error('Google authentication error:', error);
    
    // Return detailed error messages based on error type
    if (error.message.includes('already exists')) {
      return res.status(409).json({ 
        message: 'Account registration failed - user already exists', 
        details: error.message 
      });
    }
    
    if (error.message.includes('validation')) {
      return res.status(400).json({ 
        message: 'Invalid user data provided', 
        details: error.message 
      });
    }
    
    res.status(500).json({ 
      message: 'Google authentication failed', 
      details: error.message 
    });
  }
});


module.exports = router;