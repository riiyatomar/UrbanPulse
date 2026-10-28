/**
 * UrbanPulse Citizen App — Authentication Context
 * ================================================
 * Manages citizen login, registration, logout, and token persistence.
 *
 * Token storage:
 * - Uses AsyncStorage (React Native) for token persistence
 * - Token is included in all API requests via complaintApi
 *
 * Security:
 * - Never stores plaintext passwords
 * - Clears token on logout/expiry
 * - Role is read from server response, never client-set
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const TOKEN_KEY = '@urbanpulse_citizen_token';
const USER_KEY = '@urbanpulse_citizen_user';

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8006';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  // Restore session on mount
  useEffect(() => {
    (async () => {
      try {
        const savedToken = await AsyncStorage.getItem(TOKEN_KEY);
        const savedUser = await AsyncStorage.getItem(USER_KEY);
        if (savedToken && savedUser) {
          // Basic expiry check
          try {
            const payload = JSON.parse(atob(savedToken.split('.')[1]));
            if (payload.exp && payload.exp * 1000 > Date.now()) {
              setToken(savedToken);
              setUser(JSON.parse(savedUser));
            } else {
              // Expired — clear
              await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
            }
          } catch {
            await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
          }
        }
      } catch (err) {
        console.error('Failed to restore auth session:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const saveSession = async (tokenValue, userValue) => {
    try {
      await AsyncStorage.setItem(TOKEN_KEY, tokenValue);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(userValue));
    } catch (err) {
      console.error('Failed to persist auth session:', err);
    }
  };

  const login = useCallback(async (email, password) => {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
    } catch (netErr) {
      throw new Error('Unable to connect to the UrbanPulse server. Please check your network connection.');
    }

    if (!response.ok) {
      let message = 'Invalid email or password.';
      if (response.status === 401) {
        message = 'Invalid email or password.';
      } else if (response.status === 403) {
        message = 'Account has been deactivated. Please contact support.';
      } else if (response.status === 429) {
        message = 'Too many login attempts. Please try again in a minute.';
      } else if (response.status >= 500) {
        message = 'UrbanPulse server error. Please try again later.';
      } else {
        try {
          const data = await response.json();
          if (data.detail) message = data.detail;
        } catch { /* ignore */ }
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    setToken(data.access_token);
    setUser(data.user);
    await saveSession(data.access_token, data.user);
    return data.user;
  }, []);

  const register = useCallback(async (name, email, password) => {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });
    } catch (netErr) {
      throw new Error('Unable to connect to the UrbanPulse server. Please check your network connection.');
    }

    if (!response.ok) {
      let message = 'Registration failed.';
      if (response.status === 409) {
        message = 'A user with this email already exists.';
      } else if (response.status === 422) {
        try {
          const data = await response.json();
          message = data.detail || 'Please verify your information and password requirements.';
        } catch {
          message = 'Please verify your information and password requirements.';
        }
      } else if (response.status >= 500) {
        message = 'UrbanPulse server error. Please try again later.';
      } else {
        try {
          const data = await response.json();
          if (data.detail) message = data.detail;
        } catch { /* ignore */ }
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    setToken(data.access_token);
    setUser(data.user);
    await saveSession(data.access_token, data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    setToken(null);
    setUser(null);
    try {
      await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY]);
    } catch (err) {
      console.error('Failed to clear auth session:', err);
    }
  }, []);

  // Called by API client on 401 responses
  const handleAuthExpired = useCallback(async () => {
    await logout();
  }, [logout]);

  const value = {
    user,
    token,
    loading,
    isAuthenticated: !!token && !!user,
    login,
    register,
    logout,
    handleAuthExpired,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

const defaultAuthContext = {
  user: null,
  token: null,
  loading: false,
  isAuthenticated: false,
  login: async () => {},
  register: async () => {},
  logout: async () => {},
  handleAuthExpired: async () => {},
};

export function useAuth() {
  const context = useContext(AuthContext);
  return context || defaultAuthContext;
}

