/**
 * UrbanPulse Citizen App — HTTP Ingestion API Client (Phase 2.5)
 *
 * Connects the Citizen App submission flow to the Ingestion API endpoint
 * (POST /api/v1/complaints) via multipart/form-data.
 *
 * Requirements:
 * - Build standard multipart/form-data payload using FormData.
 * - Attach image correctly for native (file://) and web (blob/file object) environments.
 * - Transmit canonical lat and lng as authoritative coordinates.
 * - Map citizen draft category (draft.issue_class) to user_selected_category so
 *   downstream ML YOLO issue_class pipeline is preserved.
 * - Send location_source, location_accuracy, location_address, and description.
 * - DO NOT manually set Content-Type header with a boundary; allow fetch/runtime to construct it.
 * - Handle HTTP 201, 400, 422, 500, network failures, and timeouts gracefully.
 * - Return normalized result object:
 *     Success: { success: true, complaintId: string, data: object }
 *     Failure: { success: false, error: string, status: number|null, isNetworkError: boolean }
 */
import { Platform } from 'react-native';

const DEFAULT_TIMEOUT_MS = 25000;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:8006';

/**
 * Creates an image payload compatible with FormData on both React Native and web.
 *
 * @param {string|object} imageUri - Local file URI (file://...) or web blob URI (blob:...)
 * @returns {Promise<any>}
 */
export async function buildImageFormField(imageUri) {
  if (!imageUri) {
    throw new Error('Image URI is required for complaint submission.');
  }

  // Web environment handling
  if (Platform.OS === 'web') {
    if (typeof imageUri === 'object' && imageUri instanceof Blob) {
      return imageUri;
    }
    // If it's a blob: or data: URI on web, fetch the blob
    if (typeof imageUri === 'string' && (imageUri.startsWith('blob:') || imageUri.startsWith('data:'))) {
      const resp = await fetch(imageUri);
      const blob = await resp.blob();
      return blob;
    }
    // Web fallback for normal file path/string
    return {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'complaint.jpg',
    };
  }

  // React Native Native environment handling (Android / iOS)
  // React Native's FormData implementation expects an object with uri, type, and name
  let filename = 'complaint.jpg';
  let mimeType = 'image/jpeg';

  if (typeof imageUri === 'string') {
    const cleanUri = imageUri.split('?')[0];
    const extension = cleanUri.split('.').pop()?.toLowerCase();
    if (extension === 'png') {
      mimeType = 'image/png';
      filename = 'complaint.png';
    } else if (extension === 'webp') {
      mimeType = 'image/webp';
      filename = 'complaint.webp';
    }
  }

  return {
    uri: imageUri,
    type: mimeType,
    name: filename,
  };
}

/**
 * Uploads a citizen complaint draft to the UrbanPulse Ingestion API.
 *
 * @param {object} draft - Complaint draft object
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Custom base URL
 * @param {number} [options.timeoutMs] - Request timeout in milliseconds
 * @returns {Promise<{success: boolean, complaintId?: string, data?: any, error?: string, status?: number, isNetworkError?: boolean}>}
 */
export async function uploadComplaint(draft, options = {}) {
  const baseUrl = options.baseUrl || API_BASE_URL;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const token = options.token || null;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/complaints`;

  // Validate draft contains minimal required fields
  if (!draft) {
    return {
      success: false,
      error: 'Draft data is required.',
      status: 400,
      isNetworkError: false,
    };
  }

  if (draft.lat == null || draft.lng == null) {
    return {
      success: false,
      error: 'Valid GPS coordinates (lat, lng) are required.',
      status: 422,
      isNetworkError: false,
    };
  }

  if (!draft.imageUri) {
    return {
      success: false,
      error: 'Complaint image is required.',
      status: 422,
      isNetworkError: false,
    };
  }

  // Build multipart FormData
  const formData = new FormData();

  try {
    const imageFormField = await buildImageFormField(draft.imageUri);
    // Append image as 'image' field expected by FastAPI create_complaint
    formData.append('image', imageFormField);
  } catch (err) {
    return {
      success: false,
      error: `Failed to prepare image file: ${err.message}`,
      status: null,
      isNetworkError: false,
    };
  }

  // Canonical coordinates (strictly preserve numeric floating points as strings)
  formData.append('lat', String(draft.lat));
  formData.append('lng', String(draft.lng));

  // Source semantics
  formData.append('source', 'mobile_app');

  // Location provenance
  if (draft.location_source) {
    formData.append('location_source', String(draft.location_source));
  }

  // Map user-selected category to user_selected_category (distinct from ML issue_class)
  const userCat = draft.user_selected_category || draft.issue_class || draft.issueCategory;
  if (userCat) {
    formData.append('user_selected_category', String(userCat));
  }

  // Citizen description
  if (draft.description && draft.description.trim()) {
    formData.append('description', draft.description.trim());
  }

  // Location accuracy radius
  if (draft.location_accuracy != null && !isNaN(draft.location_accuracy)) {
    formData.append('location_accuracy', String(draft.location_accuracy));
  }

  // OSM reverse-geocoded descriptive address metadata
  if (draft.location_address && draft.location_address.trim()) {
    formData.append('location_address', draft.location_address.trim());
  }

  // Set up timeout via AbortController
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Note: Do NOT set Content-Type header manually; fetch sets boundary automatically.
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    clearTimeout(timerId);

    // Read response body safely
    let responseData = null;
    try {
      responseData = await response.json();
    } catch (_) {
      responseData = null;
    }

    if (response.status === 201) {
      if (!responseData || !responseData.id) {
        return {
          success: false,
          error: 'Malformed server response: missing complaint ID.',
          status: 201,
          isNetworkError: false,
        };
      }
      return {
        success: true,
        complaintId: responseData.id,
        data: responseData,
      };
    }

    // Handle HTTP errors with appropriate user-facing messages
    let errorMessage = 'Failed to submit complaint.';
    if (responseData && responseData.detail) {
      if (Array.isArray(responseData.detail)) {
        errorMessage = responseData.detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
      } else if (typeof responseData.detail === 'string') {
        errorMessage = responseData.detail;
      }
    } else if (response.status === 400) {
      errorMessage = 'Invalid complaint submission data.';
    } else if (response.status === 413) {
      errorMessage = 'Uploaded photo exceeds the maximum size limit (20MB).';
    } else if (response.status === 422) {
      errorMessage = 'Invalid location or photo format provided.';
    } else if (response.status >= 500) {
      errorMessage = 'UrbanPulse server is temporarily unavailable. Please try again later.';
    }

    return {
      success: false,
      error: errorMessage,
      status: response.status,
      data: responseData,
      isNetworkError: false,
    };
  } catch (err) {
    clearTimeout(timerId);

    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Submission timed out. Please check your network connection and try again.',
        status: null,
        isNetworkError: true,
      };
    }

    return {
      success: false,
      error: 'Network connection unavailable. Please check your internet connection.',
      status: null,
      isNetworkError: true,
    };
  }
}

/**
 * Fetches the current status and details of a single complaint from the backend.
 *
 * @param {string} complaintId - Server UUID of the complaint
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Custom base URL
 * @param {number} [options.timeoutMs] - Request timeout in milliseconds
 * @returns {Promise<{success: boolean, complaintId?: string, data?: any, error?: string, status?: number, isNetworkError?: boolean}>}
 */
export async function fetchComplaint(complaintId, options = {}) {
  const baseUrl = options.baseUrl || API_BASE_URL;
  const timeoutMs = options.timeoutMs || 15000;
  const token = options.token || null;

  if (!complaintId || typeof complaintId !== 'string') {
    return {
      success: false,
      error: 'A valid complaint ID is required.',
      status: 400,
      isNetworkError: false,
    };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/complaints/${encodeURIComponent(complaintId)}`;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    clearTimeout(timerId);

    let responseData = null;
    try {
      responseData = await response.json();
    } catch (_) {
      responseData = null;
    }

    if (response.status === 200) {
      if (!responseData || !responseData.id) {
        return {
          success: false,
          error: 'Malformed server response: missing complaint ID.',
          status: 200,
          isNetworkError: false,
        };
      }
      return {
        success: true,
        complaintId: responseData.id,
        data: responseData,
      };
    }

    if (response.status === 404) {
      return {
        success: false,
        error: 'Complaint not found.',
        status: 404,
        data: responseData,
        isNetworkError: false,
      };
    }

    let errorMessage = 'Failed to fetch complaint status.';
    if (responseData && responseData.detail) {
      if (Array.isArray(responseData.detail)) {
        errorMessage = responseData.detail.map((d) => d.msg || JSON.stringify(d)).join('; ');
      } else if (typeof responseData.detail === 'string') {
        errorMessage = responseData.detail;
      }
    } else if (response.status === 422) {
      errorMessage = 'Invalid complaint ID format.';
    } else if (response.status >= 500) {
      errorMessage = 'UrbanPulse server is temporarily unavailable. Please try again later.';
    }

    return {
      success: false,
      error: errorMessage,
      status: response.status,
      data: responseData,
      isNetworkError: false,
    };
  } catch (err) {
    clearTimeout(timerId);

    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Request timed out while checking complaint status.',
        status: null,
        isNetworkError: true,
      };
    }

    return {
      success: false,
      error: 'Network connection unavailable. Please check your internet connection.',
      status: null,
      isNetworkError: true,
    };
  }
}

/**
 * Fetches the status transition audit history of a single complaint.
 *
 * @param {string} complaintId - Server UUID of the complaint
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Custom base URL
 * @param {number} [options.timeoutMs] - Request timeout in milliseconds
 * @returns {Promise<{success: boolean, complaintId?: string, history?: Array, error?: string, status?: number, isNetworkError?: boolean}>}
 */
export async function fetchComplaintHistory(complaintId, options = {}) {
  const baseUrl = options.baseUrl || API_BASE_URL;
  const timeoutMs = options.timeoutMs || 15000;
  const token = options.token || null;

  if (!complaintId || typeof complaintId !== 'string') {
    return {
      success: false,
      error: 'A valid complaint ID is required.',
      status: 400,
      isNetworkError: false,
    };
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/complaints/${encodeURIComponent(complaintId)}/history`;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    clearTimeout(timerId);

    let responseData = null;
    try {
      responseData = await response.json();
    } catch (_) {
      responseData = null;
    }

    if (response.status === 200) {
      return {
        success: true,
        complaintId: responseData?.complaint_id || complaintId,
        history: responseData?.history || [],
      };
    }

    return {
      success: false,
      error: responseData?.detail || 'Failed to fetch status history.',
      status: response.status,
      history: [],
      isNetworkError: false,
    };
  } catch (err) {
    clearTimeout(timerId);
    return {
      success: false,
      error: err.name === 'AbortError' ? 'Request timed out.' : 'Network error.',
      status: null,
      history: [],
      isNetworkError: true,
    };
  }
}

/**
 * Fetch the authenticated citizen's own complaint by ID.
 *
 * @param {string} complaintId - UUID of the complaint
 * @param {string} token - JWT bearer token
 * @param {object} [options]
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
export async function fetchMyComplaintById(complaintId, token, options = {}) {
  const baseUrl = options.baseUrl || API_BASE_URL;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/complaints/${encodeURIComponent(complaintId)}`;

  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    clearTimeout(timerId);

    if (response.ok) {
      const data = await response.json();
      return { success: true, data };
    }

    if (response.status === 401) {
      return { success: false, error: 'Session expired', status: 401, isAuthError: true };
    }

    return { success: false, error: 'Failed to fetch complaint details', status: response.status };
  } catch (err) {
    clearTimeout(timerId);
    return { success: false, error: 'Network error', isNetworkError: true };
  }
}

