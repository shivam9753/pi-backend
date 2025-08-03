const express = require('express');
const UserService = require('../services/userService');
const { validateLogin, validateUserRegistration } = require('../middleware/validation');

const router = express.Router();

// POST /api/auth/register - Register new user
router.post('/register', validateUserRegistration, async (req, res) => {
  try {
    const result = await UserService.registerUser(req.body);
    res.status(201).json({
      message: 'User registered successfully',
      user: result.user,
      token: result.token
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
      user: result.user,
      token: result.token
    });
  } catch (error) {
    if (error.message === 'Invalid credentials') {
      return res.status(401).json({ message: error.message });
    }
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

// POST /api/auth/google-user - Google authentication (legacy support)
router.post('/google-user', async (req, res) => {
  const { email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ message: 'Email and name are required' });
  }

  try {
    // Try to register with Google auth
    const userData = {
      email,
      username: name.replace(/\s+/g, '_').toLowerCase(),
      password: 'GOOGLE_AUTH_TEMP_' + Date.now(), // Temporary password
      bio: `Google authenticated user`
    };

    const result = await UserService.registerUser(userData);
    
    res.status(201).json({
      message: 'Google user created successfully',
      user: result.user,
      token: result.token,
      isNewUser: true
    });
  } catch (error) {
    if (error.message.includes('already exists')) {
      // User exists, attempt login (this is simplified - in production you'd handle Google auth differently)
      try {
        const User = require('../models/User');
        const user = await User.findByEmail(email);
        const { generateToken } = require('../middleware/auth');
        const token = generateToken(user._id);
        
        res.json({
          message: 'Google user logged in successfully',
          user: user.toPublicJSON(),
          token,
          isNewUser: false
        });
      } catch (loginError) {
        res.status(500).json({ message: 'Google authentication failed', error: loginError.message });
      }
    } else {
      res.status(500).json({ message: 'Google authentication failed', error: error.message });
    }
  }
});

module.exports = router;