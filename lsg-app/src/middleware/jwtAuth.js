/**
 * JWT Authentication Middleware
 * Validates JWT tokens in the Authorization header
 * @module middleware/jwtAuth
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { isTokenBlacklisted } = require('../controllers/auth.controller');

/**
 * JWT Authentication Middleware
 * Verifies the JWT token from the Authorization header
 * Checks token validity, expiration, and blacklist status
 * 
 * @param {Object} req - Express request object
 * @param {Object} req.headers - Request headers
 * @param {string} req.headers.authorization - Authorization header containing Bearer token
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 * 
 * @throws {401} - If no token provided
 * @throws {401} - If token is blacklisted
 * @throws {401} - If token is expired
 * @throws {401} - If token is invalid
 */
const jwtAuth = (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.split(' ')[1];

    // Check if token is blacklisted
    if (isTokenBlacklisted(token)) {
      return res.status(401).json({
        success: false,
        message: 'Token has been invalidated'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

module.exports = jwtAuth; 