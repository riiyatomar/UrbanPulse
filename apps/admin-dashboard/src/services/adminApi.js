/**
 * UrbanPulse Admin Dashboard API Service
 * =====================================
 * Centralized API client for all administrative and municipal operations.
 * All requests include JWT Bearer authentication.
 *
 * Security:
 * - Authorization header added to every request
 * - 401 responses trigger automatic logout
 * - Actor on status updates is server-derived (not client-supplied)
 * - Tokens never logged or exposed in URLs
 */

import { getToken, handle401, logout } from './authService';

const BASE_URL = (import.meta.env?.VITE_API_URL || 'http://localhost:8006/api/v1').replace(/\/+$/, '');

// Callback for triggering UI logout on 401
let onAuthExpired = null;
export function setAuthExpiredCallback(cb) {
  onAuthExpired = cb;
}

/**
 * Helper to execute fetch with timeout, auth, and standard error formatting.
 */
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 10000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Add auth header
  const token = getToken();
  const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders,
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    // Handle 401 — session expired
    if (response.status === 401) {
      logout();
      if (onAuthExpired) onAuthExpired();
      const error = new Error('Session expired. Please log in again.');
      error.status = 401;
      throw error;
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.detail) {
          errorMessage = typeof errorData.detail === 'string'
            ? errorData.detail
            : JSON.stringify(errorData.detail);
        }
      } catch {
        // Ignore json parse error on non-json error responses
      }
      const error = new Error(errorMessage);
      error.status = response.status;
      throw error;
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      const timeoutError = new Error('Network request timed out. Please check backend connection.');
      timeoutError.status = 408;
      throw timeoutError;
    }
    throw err;
  }
}

/**
 * Fetch complaints with optional server-side filtering and pagination.
 */
export async function fetchComplaints(filters = {}) {
  const query = new URLSearchParams();

  if (filters.status && filters.status !== 'All') {
    query.append('status', filters.status);
  }
  if (filters.department_id && filters.department_id !== 'All') {
    query.append('department_id', filters.department_id);
  }
  if (filters.issue_class && filters.issue_class !== 'All') {
    query.append('issue_class', filters.issue_class);
  }
  if (filters.user_selected_category && filters.user_selected_category !== 'All') {
    query.append('user_selected_category', filters.user_selected_category);
  }
  if (filters.min_severity && Number(filters.min_severity) > 0) {
    query.append('min_severity', filters.min_severity);
  }
  if (filters.min_priority && Number(filters.min_priority) > 0) {
    query.append('min_priority', filters.min_priority);
  }
  if (filters.sla_state && filters.sla_state !== 'All') {
    query.append('sla_state', filters.sla_state);
  }
  if (filters.search && filters.search.trim()) {
    query.append('search', filters.search.trim());
  }
  if (filters.limit) {
    query.append('limit', filters.limit);
  }
  if (filters.offset) {
    query.append('offset', filters.offset);
  }

  const qs = query.toString();
  const endpoint = `/complaints${qs ? `?${qs}` : ''}`;
  return await request(endpoint);
}

/**
 * Fetch live KPI summary statistics from PostgreSQL.
 */
export async function fetchComplaintStats() {
  return await request('/complaints/stats');
}

/**
 * Fetch a single complaint by UUID.
 */
export async function fetchComplaintById(id) {
  return await request(`/complaints/${encodeURIComponent(id)}`);
}

/**
 * Update complaint lifecycle status.
 * Actor is server-derived from the authenticated user — NOT sent by client.
 */
export async function updateComplaintStatus(id, status, notes = null) {
  return await request(`/complaints/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status, notes }),
  });
}

/**
 * Fetch chronological status lifecycle history for a complaint.
 */
export async function fetchStatusHistory(id) {
  return await request(`/complaints/${encodeURIComponent(id)}/history`);
}

/**
 * Assign or reassign a complaint to a municipal department.
 */
export async function assignDepartment(id, departmentId) {
  return await request(`/complaints/${encodeURIComponent(id)}/assign`, {
    method: 'PATCH',
    body: JSON.stringify({ department_id: departmentId }),
  });
}

/**
 * Fetch all registered municipal departments.
 */
export async function fetchDepartments() {
  return await request('/departments');
}

/**
 * Fetch operational workload summary and recent activity across all departments.
 */
export async function fetchDepartmentOperations() {
  return await request('/departments/operations');
}

/**
 * Fetch work queue tasks for a specific department.
 */
export async function fetchDepartmentTasks(departmentId, status = null) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return await request(`/departments/${encodeURIComponent(departmentId)}/tasks${qs}`);
}

/**
 * Fetch recent notifications for a specific department.
 */
export async function fetchDepartmentNotifications(departmentId, limit = 20) {
  return await request(`/departments/${encodeURIComponent(departmentId)}/notifications?limit=${limit}`);
}

/**
 * Acknowledge and mark a department notification as read.
 */
export async function markNotificationRead(notificationId, departmentId = null) {
  const qs = departmentId ? `?department_id=${encodeURIComponent(departmentId)}` : '';
  return await request(`/notifications/${encodeURIComponent(notificationId)}/read${qs}`, {
    method: 'PATCH',
  });
}
