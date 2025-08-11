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
      token: result.token,
      needsProfileCompletion: result.user.needsProfileCompletion || false
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      return res.status(409).json({ message: error.message });
    }
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

// POST /api/auth/login - Login user
router.post('/login', validateLogin, async (req, res) => {
  try {
    const result = await UserService.loginUser(req.body.email, req.body.password);
    res.json({
      message: 'Login successful',
      user: result.user.toAuthJSON(),
      token: result.token,
      needsProfileCompletion: result.user.needsProfileCompletion || false
    });
  } catch (error) {
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

// POST /api/auth/google-login - Authenticate existing Google user or register new user
router.post('/google-login', async (req, res) => {
  const { email, name, picture, given_name, family_name } = req.body;

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
        needsProfileCompletion: updatedUser.needsProfileCompletion || false
      });
    } else {
      // User doesn't exist - register them
      const userData = {
        email,
        name,
        username: name.replace(/\s+/g, '_').toLowerCase() + '_' + Date.now(), // Ensure unique username
        password: 'GOOGLE_AUTH_' + Date.now(), // Temporary password
        bio: 'Google authenticated user',
        profileImage: picture || ''
      };

      const result = await UserService.registerUser(userData);
      
      res.status(201).json({
        message: 'Google user registered successfully',
        user: result.user.toAuthJSON(),
        token: result.token,
        needsProfileCompletion: result.user.needsProfileCompletion || false
      });
    }
  } catch (error) {
    console.error('Google authentication error:', error);
    res.status(500).json({ 
      message: 'Google authentication failed', 
      error: error.message 
    });
  }
});


module.exports = router;