const bcrypt = require('bcryptjs');

/**
 * Password utility functions for secure password handling
 */
class PasswordUtils {
    /**
     * Hash a plain text password
     * @param {string} plainPassword - The plain text password to hash
     * @returns {Promise<string>} - The hashed password
     */
    static async hashPassword(plainPassword) {
        try {
            const saltRounds = 12; // Higher salt rounds for better security
            return await bcrypt.hash(plainPassword, saltRounds);
        } catch (error) {
            throw new Error(`Failed to hash password: ${error.message}`);
        }
    }

    /**
     * Verify a plain text password against a hash
     * @param {string} plainPassword - The plain text password to verify
     * @param {string} hashedPassword - The hashed password to compare against
     * @returns {Promise<boolean>} - True if password matches, false otherwise
     */
    static async verifyPassword(plainPassword, hashedPassword) {
        try {
            return await bcrypt.compare(plainPassword, hashedPassword);
        } catch (error) {
            throw new Error(`Failed to verify password: ${error.message}`);
        }
    }

    /**
     * Generate a secure random password
     * @param {number} length - Length of the password (default: 16)
     * @returns {string} - Generated password
     */
    static generateSecurePassword(length = 16) {
        const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
        let password = '';
        for (let i = 0; i < length; i++) {
            password += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        return password;
    }
}

module.exports = PasswordUtils; 