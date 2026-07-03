const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const PasswordUtils = require('../utils/passwordUtils');

// In-memory token blacklist (consider using Redis in production)
const tokenBlacklist = new Set();

const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }
    
    // Check username
    if (username !== config.admin.username) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    console.log('password ', config.admin.passwordHash);
    // Verify password using hash comparison
    const isPasswordValid = await PasswordUtils.verifyPassword(password, config.admin.passwordHash);
    
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { username, role: 'admin' },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    res.json({
      success: true,
      token,
      expiresIn: config.jwt.expiresIn
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const logout = (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      // Add token to blacklist
      tokenBlacklist.add(token);
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Utility function to check if a token is blacklisted
const isTokenBlacklisted = (token) => {
  return tokenBlacklist.has(token);
};

module.exports = {
  login,
  logout,
  isTokenBlacklisted
}; 