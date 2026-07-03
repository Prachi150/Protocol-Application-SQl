/**
 * Wraps an async route handler to catch and forward errors to Express error middleware
 * @param {Function} fn The async route handler function
 * @returns {Function} Wrapped route handler that forwards errors to next()
 */
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Creates a standardized error response
 * @param {string} message Error message
 * @param {number} statusCode HTTP status code
 * @returns {Error} Error object with status code
 */
const createError = (message, statusCode = 500) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

module.exports = {
    asyncHandler,
    createError
}; 