import React, { createContext, useContext, useState, useEffect } from 'react';
import { getApiEndpoint } from '../config/api';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => {
    const storedToken = localStorage.getItem('token');
    console.log('AuthProvider: Initial token from localStorage:', storedToken ? 'Present' : 'Not found');
    return storedToken;
  });
  const [loading, setLoading] = useState(true);

  const logout = () => {
    console.log('AuthProvider: logout() called');
    console.trace('Logout call stack');
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
  };

  // Track state changes
  useEffect(() => {
    console.log('AuthProvider: User state changed:', user ? 'Logged in' : 'Logged out');
  }, [user]);

  useEffect(() => {
    console.log('AuthProvider: Token state changed:', token ? 'Present' : 'Null');
  }, [token]);

  useEffect(() => {
    console.log('AuthProvider: Loading state changed:', loading);
  }, [loading]);

  const validateToken = async () => {
    if (!token) {
      console.log('AuthProvider: No token found, staying logged out');
      setLoading(false);
      return;
    }

    // Check local expiry before making a network call
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) {
        console.log('AuthProvider: Token is locally expired, logging out');
        logout();
        setLoading(false);
        return;
      }
    } catch {
      console.log('AuthProvider: Token is malformed, logging out');
      logout();
      setLoading(false);
      return;
    }

    console.log('AuthProvider: Validating token with backend...');
    try {
      // Make a lightweight API call to validate token
      const response = await fetch(getApiEndpoint('SYSTEM.OVERVIEW'), {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      console.log('AuthProvider: Token validation response status:', response.status);

      if (response.ok) {
        // Token is valid, set user data
        console.log('AuthProvider: Token is valid, setting user');
        setUser({ username: 'admin' }); // Mock user data
      } else if (response.status === 401) {
        // Token is invalid or expired
        console.log('AuthProvider: Token validation failed: Unauthorized');
        logout();
      } else {
        // Other error, but keep the user logged in
        console.warn('AuthProvider: Token validation request failed, but keeping user logged in:', response.status);
        setUser({ username: 'admin' });
      }
    } catch (error) {
      console.error('AuthProvider: Token validation failed:', error);
      // Network error - keep user logged in to avoid logout on network issues
      setUser({ username: 'admin' });
    } finally {
      setLoading(false);
    }
  };

  // Global fetch interceptor to handle 401 responses
  useEffect(() => {
    const originalFetch = window.fetch;
    
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      
      // Check if this is an API call with authorization
      const url = args[0];
      const options = args[1] || {};
      
      // Better detection of Authorization header
      let hasAuth = false;
      if (options.headers) {
        // Handle plain object headers
        if (options.headers.Authorization) {
          hasAuth = true;
        }
        // Handle Headers object
        else if (typeof options.headers.get === 'function') {
          hasAuth = !!options.headers.get('Authorization');
        }
        // Handle case-insensitive header names
        else if (typeof options.headers === 'object') {
          const headerKeys = Object.keys(options.headers);
          hasAuth = headerKeys.some(key => key.toLowerCase() === 'authorization');
        }
      }
      
      // Only handle 401s for authenticated API calls
      if (response.status === 401 && hasAuth && typeof url === 'string' && url.includes('/api/')) {
        console.log('Received 401 response on authenticated API call, logging out user');
        console.log('URL:', url);
        console.log('Headers:', options.headers);
        logout();
      }
      
      return response;
    };

    // Cleanup function to restore original fetch
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  useEffect(() => {
    console.log('AuthProvider: Validating token on mount...');
    validateToken();
  }, []); // Only run once on mount

  const login = async (username, password) => {
    try {
      const response = await fetch(getApiEndpoint('AUTH.LOGIN'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Return the specific error message from the API
        return { 
          success: false, 
          error: data.message || 'Login failed' 
        };
      }

      const authToken = data.token;
      
      setToken(authToken);
      setUser(data.user || { username });
      localStorage.setItem('token', authToken);
      
      return { success: true };
    } catch (error) {
      console.error('Login error:', error);
      return { 
        success: false, 
        error: 'Network error. Please check your connection and try again.' 
      };
    }
  };

  const getAuthHeaders = () => {
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    };
  };

  const value = {
    user,
    token,
    login,
    logout,
    getAuthHeaders,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}; 