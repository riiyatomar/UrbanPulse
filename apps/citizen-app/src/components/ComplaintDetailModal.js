/**
 * ComplaintDetailModal — Full-screen overlay showing complaint
 * details with Timeline stepper.
 *
 * Dismissible via top-right close button or overlay tap.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, radii, getStatusConfig } from '../theme/colors';
import { useComplaints, isServerUuid } from '../context/ComplaintContext';
import Timeline from './Timeline';

export default function ComplaintDetailModal({ complaint, visible, onClose }) {
  if (!complaint) return null;

  const { refreshComplaintStatus, retryPendingComplaint } = useComplaints();
  const [refreshingStatus, setRefreshingStatus] = useState(false);
  const [refreshError, setRefreshError] = useState(null);
  const [retrying, setRetrying] = useState(false);

  const status = getStatusConfig(complaint.status);
  const isServer = isServerUuid(complaint.id);

  const handleRefresh = async () => {
    if (refreshingStatus || !complaint?.id) return;
    if (typeof refreshComplaintStatus !== 'function') return;
    setRefreshingStatus(true);
    setRefreshError(null);
    try {
      const res = await refreshComplaintStatus(complaint.id);
      if (!res.success) {
        setRefreshError(res.error || 'Failed to refresh status');
      }
    } catch (e) {
      setRefreshError('Network error while refreshing status');
    } finally {
      setRefreshingStatus(false);
    }
  };

  const handleRetry = async () => {
    if (retrying || !complaint?.id) return;
    if (typeof retryPendingComplaint !== 'function') return;
    setRetrying(true);
    try {
      await retryPendingComplaint(complaint.id);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header bar */}
          <View style={styles.handleRow}>
            <View style={styles.handle} />
          </View>

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Close button */}
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close complaint details"
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>

            {/* Image */}
            {complaint.imageUri ? (
              <Image source={{ uri: complaint.imageUri }} style={styles.image} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderIcon}>📷</Text>
                <Text style={styles.imagePlaceholderText}>No photo attached</Text>
              </View>
            )}

            {/* Title row */}
            <View style={styles.titleRow}>
              <Text style={[styles.category, { color: status.color }]}>
                {(complaint.issue_class || complaint.user_selected_category || '').toUpperCase()}
              </Text>
              <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
              </View>
            </View>

            {/* ID and Refresh Row */}
            <View style={styles.actionRow}>
              <Text style={styles.id}>#{complaint.id}</Text>
              {isServer ? (
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={handleRefresh}
                  disabled={refreshingStatus}
                  accessibilityRole="button"
                  accessibilityLabel="Refresh status"
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {refreshingStatus && (
                    <ActivityIndicator size="small" color={colors.teal} style={{ marginRight: 6 }} />
                  )}
                  <Text style={styles.refreshBtnText}>↻ Refresh Status</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Refresh error notice */}
            {refreshError ? (
              <View style={styles.errorNotice}>
                <Text style={styles.errorNoticeText}>⚠️ {refreshError}</Text>
              </View>
            ) : null}

            {/* Pending Upload Retry Banner */}
            {complaint.status === 'pending_upload' ? (
              <View style={styles.retryBanner}>
                <View style={styles.retryTextCol}>
                  <Text style={styles.retryTitle}>Pending Upload</Text>
                  <Text style={styles.retryDesc}>
                    This report is saved locally. Tap to upload it to UrbanPulse servers.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={handleRetry}
                  disabled={retrying}
                  accessibilityRole="button"
                  accessibilityLabel="Retry Upload"
                  activeOpacity={0.8}
                >
                  {retrying ? (
                    <ActivityIndicator size="small" color={colors.textInverse} />
                  ) : (
                    <Text style={styles.retryBtnText}>Retry Upload</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Description */}
            {complaint.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>DESCRIPTION</Text>
                <Text style={styles.descText}>{complaint.description}</Text>
              </View>
            ) : null}

            {/* Meta info */}
            <View style={styles.metaGrid}>
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>DATE</Text>
                <Text style={styles.metaValue}>
                  {new Date(complaint.created_at).toLocaleDateString('en-US', {
                    month: 'long', day: 'numeric', year: 'numeric',
                  })}
                </Text>
              </View>
              {complaint.lat != null && complaint.lng != null && (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>COORDINATES</Text>
                  <Text style={styles.metaValue}>
                    {complaint.lat.toFixed(6)}, {complaint.lng.toFixed(6)}
                  </Text>
                </View>
              )}
              {complaint.location_source && (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>LOCATION SOURCE</Text>
                  <Text style={styles.metaValue}>
                    {complaint.location_source === 'image_exif'
                      ? '📷 Photo Location'
                      : complaint.location_source === 'manual'
                      ? '📌 Manual'
                      : `📍 GPS${complaint.location_accuracy ? ` ±${complaint.location_accuracy}m` : ''}`}
                  </Text>
                </View>
              )}
              {/* Citizen Selected Category */}
              {complaint.user_selected_category ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>CITIZEN CATEGORY</Text>
                  <Text style={styles.metaValue}>
                    {complaint.user_selected_category.toUpperCase()}
                  </Text>
                </View>
              ) : null}
              {/* Department */}
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>DEPARTMENT</Text>
                <Text style={styles.metaValue}>
                  {complaint.department?.name || complaint.department_name || 'Not assigned'}
                </Text>
              </View>
              {/* SLA Deadline */}
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>SLA DEADLINE</Text>
                <Text style={styles.metaValue}>
                  {complaint.sla_deadline
                    ? new Date(complaint.sla_deadline).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })
                    : 'Not available'}
                </Text>
              </View>
              {complaint.closed_at ? (
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>CLOSED AT</Text>
                  <Text style={styles.metaValue}>
                    {new Date(complaint.closed_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
              ) : null}
              {complaint.location_address ? (
                <View style={[styles.metaItem, styles.metaItemFull]}>
                  <Text style={styles.metaLabel}>VERIFIED ADDRESS (OSM)</Text>
                  <Text style={styles.metaValue}>{complaint.location_address}</Text>
                </View>
              ) : null}
            </View>

            {/* Timeline */}
            <View style={styles.timelineSection}>
              <Text style={styles.timelineTitle}>Resolution Timeline</Text>
              {complaint.status === 'pending_upload' && (
                <Text style={styles.pendingUploadNote}>
                  ⏳ Awaiting upload to server. Timeline tracking begins once uploaded.
                </Text>
              )}
              <Timeline status={complaint.status} history={complaint.status_history || []} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.deepSlate,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomWidth: 0,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingTop: 0,
    paddingBottom: spacing.xxl,
  },
  closeBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 10,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteAlpha08,
    borderRadius: 22,
  },
  closeText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: radii.lg,
    marginBottom: spacing.base,
    backgroundColor: colors.cardBg,
  },
  imagePlaceholder: {
    width: '100%',
    height: 140,
    borderRadius: radii.lg,
    backgroundColor: colors.cardBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
  },
  imagePlaceholderIcon: { fontSize: 32, marginBottom: 6 },
  imagePlaceholderText: { color: colors.textMuted, fontSize: 13 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  category: {
    fontSize: 16,
    fontWeight: '700',
  },
  statusPill: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  id: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: spacing.base,
  },
  section: {
    marginBottom: spacing.base,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  descText: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.base,
    marginBottom: spacing.lg,
  },
  metaItem: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.cardBg,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  metaItemFull: {
    minWidth: '100%',
  },
  metaLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  metaValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  timelineSection: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timelineTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.base,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.whiteAlpha08,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    minHeight: 36,
  },
  refreshBtnText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '700',
  },
  errorNotice: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.base,
  },
  errorNoticeText: {
    color: colors.coral,
    fontSize: 12,
    fontWeight: '600',
  },
  retryBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  retryTextCol: {
    flex: 1,
  },
  retryTitle: {
    color: colors.amber,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  retryDesc: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  retryBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
  pendingUploadNote: {
    color: colors.inProgress,
    fontSize: 12,
    marginBottom: spacing.xs,
    fontStyle: 'italic',
  },
});

