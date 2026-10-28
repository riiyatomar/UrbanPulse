/**
 * ComplaintContext — Centralised state for the Citizen App.
 *
 * Manages complaints list, active tab, selected complaint,
 * form draft, submission flow, history filtering, and validation.
 *
 * Persistence: complaints are saved to AsyncStorage on every
 * mutation and rehydrated on mount so data survives app restarts.
 */
import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { uploadComplaint, fetchComplaint } from '../services/complaintApi';
import { useAuth } from './AuthContext';

const STORAGE_KEY = '@urbanpulse_complaints';

export const SERVER_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isServerUuid = (id) =>
  typeof id === 'string' && SERVER_UUID_REGEX.test(id);

// ─── Default demo complaints (exported for test fixtures only — NOT injected in production) ─
export const SEED_COMPLAINTS = [
  {
    id: 'comp-101',
    issue_class: 'pothole',
    description: 'Large pothole near Connaught Place junction causing traffic issues.',
    lat: 28.6304,
    lng: 77.2177,
    location_source: 'device',
    location_accuracy: 12,
    location_address: 'Connaught Circus, New Delhi',
    status: 'assigned',
    imageUri: null,
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
  {
    id: 'comp-102',
    issue_class: 'waterlogging',
    description: 'Severe waterlogging blocking pedestrian path after rain.',
    lat: 28.6115,
    lng: 77.2130,
    location_source: 'manual',
    location_accuracy: null,
    location_address: 'Barakhamba Road, New Delhi',
    status: 'verified',
    imageUri: null,
    created_at: new Date(Date.now() - 3600000 * 72).toISOString(),
  },
];

const ComplaintContext = createContext(null);

export function ComplaintProvider({ children, initialComplaints }) {
  // ─── Auth context ─────────────────────────────────────────
  const { token, handleAuthExpired } = useAuth();

  // ─── Navigation ───────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('report');

  // ─── Complaints list ──────────────────────────────────────
  const [complaints, setComplaints] = useState(initialComplaints || []);
  const [loaded, setLoaded] = useState(Boolean(initialComplaints));
  const [refreshing, setRefreshing] = useState(false);

  // ─── History filter ───────────────────────────────────────
  const [historyFilter, setHistoryFilter] = useState('all');

  // ─── Selected complaint (detail modal) ────────────────────
  const [selectedComplaint, setSelectedComplaint] = useState(null);

  // ─── Draft form state ─────────────────────────────────────
  const [draft, setDraft] = useState({
    imageUri: null,
    lat: null,
    lng: null,
    location_source: null,
    location_accuracy: null,
    location_address: null,
    issueCategory: null,
    description: '',
  });

  // ─── Submission state ─────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // ─── Validation state ─────────────────────────────────────
  const [validationErrors, setValidationErrors] = useState({});

  // ─── Rehydrate from AsyncStorage on mount ─────────────────
  // Production: starts with empty array if no persisted data exists.
  // No demo/seed complaints are injected.
  useEffect(() => {
    if (initialComplaints) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          setComplaints(JSON.parse(raw));
        } else {
          // First launch — start with empty complaint history
          setComplaints([]);
        }
      } catch (e) {
        console.warn('AsyncStorage read failed, starting with empty history:', e);
        setComplaints([]);
      } finally {
        setLoaded(true);
      }
    })();
  }, [initialComplaints]);

  // ─── Persist helper ───────────────────────────────────────
  const persist = useCallback(async (next) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn('AsyncStorage write failed:', e);
    }
  }, []);

  // ─── Draft helpers ────────────────────────────────────────
  const updateDraft = useCallback((patch) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    // Clear submission error when citizen edits draft
    setSubmitError(null);
    // Clear validation errors for updated fields
    setValidationErrors((prev) => {
      const next = { ...prev };
      Object.keys(patch).forEach((k) => { delete next[k]; });
      return next;
    });
  }, []);

  const resetDraft = useCallback(() => {
    setDraft({
      imageUri: null,
      lat: null,
      lng: null,
      location_source: null,
      location_accuracy: null,
      location_address: null,
      issueCategory: null,
      description: '',
    });
    setValidationErrors({});
    setSubmitError(null);
  }, []);

  // ─── Validate draft ───────────────────────────────────────
  const validateDraft = useCallback(() => {
    const errors = {};
    if (!draft.imageUri) errors.imageUri = 'Please capture or select a photo.';
    if (!draft.lat || !draft.lng) errors.location = 'Location data is required.';
    if (!draft.issueCategory) errors.issueCategory = 'Please select an issue category.';
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }, [draft]);

  // ─── Submit complaint via HTTP multipart API ──────────────
  const submitComplaint = useCallback(async (options = {}) => {
    if (submitting) return false;
    if (!validateDraft()) return false;

    setSubmitting(true);
    setSubmitError(null);

    const result = await uploadComplaint(
      {
        ...draft,
        issue_class: draft.issueCategory,
      },
      { ...options, token }
    );

    if (result.success) {
      // Successful HTTP 201: obtain server UUID and record in local history
      const newComplaint = {
        id: result.complaintId,
        issue_class: draft.issueCategory,
        user_selected_category: draft.issueCategory || null,
        description: draft.description.trim() || null,
        lat: draft.lat,
        lng: draft.lng,
        location_source: draft.location_source || 'device',
        location_accuracy: draft.location_accuracy ?? null,
        location_address: draft.location_address || null,
        status: 'pending',
        imageUri: result.data?.image_url || draft.imageUri,
        created_at: result.data?.created_at || new Date().toISOString(),
      };

      const next = [newComplaint, ...complaints];
      setComplaints(next);
      await persist(next);

      resetDraft();
      setSubmitting(false);
      setActiveTab('history');
      return true;
    }

    // Submission failed: DO NOT clear the draft.
    // Check if network is unreachable / offline: save outbox copy with pending_upload status
    if (result.isNetworkError && options.queueIfOffline) {
      const offlineTempId = `pending-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`;
      const pendingComplaint = {
        id: offlineTempId,
        issue_class: draft.issueCategory,
        user_selected_category: draft.issueCategory || null,
        description: draft.description.trim() || null,
        lat: draft.lat,
        lng: draft.lng,
        location_source: draft.location_source || 'device',
        location_accuracy: draft.location_accuracy ?? null,
        location_address: draft.location_address || null,
        status: 'pending_upload',
        imageUri: draft.imageUri,
        created_at: new Date().toISOString(),
      };

      const next = [pendingComplaint, ...complaints];
      setComplaints(next);
      await persist(next);
      resetDraft();
      setSubmitting(false);
      setActiveTab('history');
      return true;
    }

    // Standard failure handling: preserve draft, expose error
    setSubmitError(result.error || 'Submission failed. Please try again.');
    setSubmitting(false);
    return false;
  }, [submitting, draft, complaints, validateDraft, resetDraft, persist, setActiveTab]);

  // ─── Retry pending upload from history ────────────────────
  const retryPendingComplaint = useCallback(async (pendingComplaintId) => {
    const item = complaints.find((c) => c.id === pendingComplaintId);
    if (!item || item.status !== 'pending_upload') return false;

    setSubmitting(true);
    const result = await uploadComplaint({
      imageUri: item.imageUri,
      lat: item.lat,
      lng: item.lng,
      location_source: item.location_source,
      location_accuracy: item.location_accuracy,
      location_address: item.location_address,
      issue_class: item.issue_class,
      description: item.description,
    });

    if (result.success) {
      // Replace pending_upload item with server-confirmed complaint ID without duplicating
      const next = complaints.map((c) =>
        c.id === pendingComplaintId
          ? {
              ...c,
              id: result.complaintId,
              status: 'pending',
              imageUri: result.data?.image_url || c.imageUri,
              created_at: result.data?.created_at || c.created_at,
            }
          : c
      );
      setComplaints(next);
      await persist(next);
      setSelectedComplaint((prev) =>
        prev && prev.id === pendingComplaintId
          ? {
              ...prev,
              id: result.complaintId,
              status: 'pending',
              imageUri: result.data?.image_url || prev.imageUri,
            }
          : prev
      );
      setSubmitting(false);
      return true;
    }

    setSubmitting(false);
    return false;
  }, [complaints, persist]);

  // ─── Refresh single complaint status from backend ──────────
  const refreshComplaintStatus = useCallback(
    async (complaintId, options = {}) => {
      if (!isServerUuid(complaintId)) {
        return { success: false, error: 'Not a server-backed complaint' };
      }

      const result = await fetchComplaint(complaintId, { token, ...options });
      if (result.success && result.data) {
        const backendData = result.data;
        const current = complaints.find((c) => c.id === complaintId);
        const updatedItem = {
          ...(current || {}),
          id: complaintId,
          status: backendData.status || current?.status || 'pending',
          issue_class: backendData.issue_class || current?.issue_class,
          user_selected_category:
            backendData.user_selected_category || current?.user_selected_category,
          confidence: backendData.confidence ?? current?.confidence,
          department: backendData.department ?? current?.department,
          department_name:
            backendData.department?.name ||
            backendData.department_name ||
            current?.department_name,
          sla_deadline: backendData.sla_deadline ?? current?.sla_deadline,
          updated_at: backendData.updated_at || current?.updated_at,
          closed_at: backendData.closed_at !== undefined ? backendData.closed_at : current?.closed_at,
          status_history: backendData.status_history || current?.status_history || [],
          imageUri:
            backendData.blurred_image_url ||
            backendData.image_url ||
            current?.imageUri,
        };

        setComplaints((prev) => {
          const next = prev.map((c) => (c.id === complaintId ? updatedItem : c));
          persist(next);
          return next;
        });

        setSelectedComplaint((prev) =>
          prev && prev.id === complaintId ? updatedItem : prev
        );
        return { success: true, data: backendData, complaint: updatedItem, updatedComplaint: updatedItem };
      }

      return { success: false, error: result.error, status: result.status };
    },
    [complaints, persist, token]
  );

  // ─── Refresh all server-backed complaints ──────────────────
  const refreshComplaints = useCallback(
    async (options = {}) => {
      if (refreshing) return { success: false, error: 'Refresh already in progress' };

      setRefreshing(true);
      try {
        const serverComplaints = complaints.filter(
          (c) => isServerUuid(c.id) && c.status !== 'pending_upload'
        );

        if (serverComplaints.length === 0) {
          setRefreshing(false);
          return { success: true, updatedCount: 0 };
        }

        const results = await Promise.allSettled(
          serverComplaints.map((c) => fetchComplaint(c.id, { token, ...options }))
        );

        const updatesMap = new Map();
        const notFoundIds = new Set();
        results.forEach((res, index) => {
          const compId = serverComplaints[index]?.id;
          if (res.status === 'fulfilled') {
            if (res.value?.success && res.value?.data) {
              updatesMap.set(res.value.complaintId || compId, res.value.data);
            } else if (res.value?.status === 404 && compId) {
              notFoundIds.add(compId);
            }
          }
        });

        if (notFoundIds.size > 0) {
          setComplaints((prev) => {
            const next = prev.filter((c) => !notFoundIds.has(c.id));
            persist(next);
            return next;
          });
        }

        if (updatesMap.size > 0) {
          setComplaints((prev) => {
            const next = prev.map((c) => {
              const update = updatesMap.get(c.id);
              if (!update) return c;
              return {
                ...c,
                status: update.status || c.status,
                issue_class: update.issue_class || c.issue_class,
                user_selected_category:
                  update.user_selected_category || c.user_selected_category,
                confidence: update.confidence ?? c.confidence,
                department: update.department ?? c.department,
                department_name:
                  update.department?.name ||
                  update.department_name ||
                  c.department_name,
                sla_deadline: update.sla_deadline ?? c.sla_deadline,
                updated_at: update.updated_at || c.updated_at,
                closed_at: update.closed_at !== undefined ? update.closed_at : c.closed_at,
                status_history: update.status_history || c.status_history || [],
                imageUri:
                  update.blurred_image_url || update.image_url || c.imageUri,
              };
            });
            persist(next);
            return next;
          });

          setSelectedComplaint((prev) => {
            if (!prev || !updatesMap.has(prev.id)) return prev;
            const update = updatesMap.get(prev.id);
            return {
              ...prev,
              status: update.status || prev.status,
              issue_class: update.issue_class || prev.issue_class,
              confidence: update.confidence ?? prev.confidence,
              department: update.department ?? prev.department,
              department_name:
                update.department?.name ||
                update.department_name ||
                prev.department_name,
              sla_deadline: update.sla_deadline ?? prev.sla_deadline,
              updated_at: update.updated_at || prev.updated_at,
              closed_at: update.closed_at !== undefined ? update.closed_at : prev.closed_at,
              status_history: update.status_history || prev.status_history || [],
              imageUri:
                update.blurred_image_url || update.image_url || prev.imageUri,
            };
          });
        }

        setRefreshing(false);
        return { success: true, updatedCount: updatesMap.size };
      } catch (err) {
        console.warn('refreshComplaints encountered an error:', err);
        setRefreshing(false);
        return { success: false, error: err.message };
      }
    },
    [complaints, refreshing, persist, token]
  );

  // ─── Filtered complaints ──────────────────────────────────
  const filteredComplaints = complaints.filter((c) => {
    if (historyFilter === 'all') return true;
    if (historyFilter === 'pending')
      return (
        c.status === 'pending' ||
        c.status === 'under_review' ||
        c.status === 'pending_upload'
      );
    if (historyFilter === 'assigned') return c.status === 'assigned';
    if (historyFilter === 'in_progress')
      return c.status === 'in_progress' || c.status === 'repaired';
    if (historyFilter === 'resolved')
      return c.status === 'verified' || c.status === 'closed';
    if (historyFilter === 'rejected')
      return c.status === 'rejected';
    return true;
  });

  const value = {
    // Nav
    activeTab,
    setActiveTab,
    // Data
    complaints,
    filteredComplaints,
    loaded,
    refreshing,
    refreshComplaints,
    refreshComplaintStatus,
    // Detail
    selectedComplaint,
    setSelectedComplaint,
    // Draft
    draft,
    updateDraft,
    resetDraft,
    // Submission
    submitting,
    submitError,
    submitComplaint,
    retryPendingComplaint,
    // Validation
    validationErrors,
    validateDraft,
    // Filter
    historyFilter,
    setHistoryFilter,
  };

  return (
    <ComplaintContext.Provider value={value}>
      {children}
    </ComplaintContext.Provider>
  );
}

export function useComplaints() {
  const ctx = useContext(ComplaintContext);
  return ctx || {};
}

export default ComplaintContext;
