/**
 * UrbanPulse Admin Dashboard — Authentication Service
 * =====================================================
 * Handles login, logout, token management, and session state.
 *
 * Security:
 * - Token stored in sessionStorage (cleared on browser close)
 * - Auto-redirect to login on 401 responses
 * - Never log tokens or passwords
 * - Token not exposed in URLs or query params
 */

const BASE_URL = (import.meta.env?.VITE_API_URL || 'http://localhost:8006/api/v1').replace(/\/+$/, '');

const TOKEN_KEY = 'urbanpulse_admin_token';
const USER_KEY = 'urbanpulse_admin_user';

/**
 * Store auth data in sessionStorage.
 */
function setAuth(token, user) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Clear stored auth data.
 */
function clearAuth() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
}

/**
 * Get the stored JWT token.
 */
export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

/**
 * Get the stored user object.
 */
export function getUser() {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Check if the user is currently authenticated.
 */
export function isAuthenticated() {
  const token = getToken();
  if (!token) return false;
  // Basic JWT expiry check (decode payload without verification)
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      clearAuth();
      return false;
    }
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

/**
 * Check if the token has expired.
 */
export function isTokenExpired() {
  const token = getToken();
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

/**
 * Login with email and password. Returns { token, user } on success.
 * Throws on failure.
 */
export async function login(email, password) {
  let response;
  try {
    response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
    });
  } catch (netErr) {
    const error = new Error('Unable to connect to the UrbanPulse server. Please verify the backend service is running.');
    error.isNetworkError = true;
    throw error;
  }

  if (!response.ok) {
    let message = 'Invalid email or password.';
    if (response.status === 401) {
      message = 'Invalid email or password.';
    } else if (response.status === 403) {
      try {
        const data = await response.json();
        message = data.detail || 'Access forbidden: your account may be deactivated.';
      } catch {
        message = 'Access forbidden: your account may be deactivated.';
      }
    } else if (response.status === 429) {
      message = 'Too many login attempts. Please wait a minute before trying again.';
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
  const { access_token, user } = data;

  // Only admin and department officers can access the dashboard
  if (user.role !== 'administrator' && user.role !== 'department_officer') {
    throw new Error('Access denied: this dashboard is for administrators and department officers only.');
  }

  setAuth(access_token, user);
  return { token: access_token, user };
}

/**
 * Logout — clear stored session.
 */
export function logout() {
  clearAuth();
}

/**
 * Handle 401 responses: clear auth and trigger re-render.
 * Returns true if the response was a 401 (caller should abort).
 */
export function handle401(response) {
  if (response.status === 401) {
    clearAuth();
    return true;
  }
  return false;
}
