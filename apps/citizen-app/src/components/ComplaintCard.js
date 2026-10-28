/**
 * ComplaintCard — Summary card for a single complaint in the history feed.
 *
 * Shows thumbnail (when available), category, status badge, date,
 * and coordinate text. Entire card is tappable to open the detail modal.
 */
import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, radii, cardShadow, getStatusConfig } from '../theme/colors';
import { useComplaints } from '../context/ComplaintContext';

export default function ComplaintCard({ complaint, onPress }) {
  const status = getStatusConfig(complaint.status);
  const hasImage = !!complaint.imageUri;
  const isPendingUpload = complaint.status === 'pending_upload';
  const { retryPendingComplaint } = useComplaints();
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async (e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (retrying) return;
    if (typeof retryPendingComplaint !== 'function') return;
    setRetrying(true);
    try {
      await retryPendingComplaint(complaint.id);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.card, { borderLeftColor: status.color }]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Complaint ${complaint.id}, ${complaint.issue_class}, status ${status.label}`}
      accessibilityHint="Tap to view details"
    >
      <View style={styles.row}>
        {/* Thumbnail */}
        {hasImage && (
          <Image source={{ uri: complaint.imageUri }} style={styles.thumb} />
        )}

        <View style={[styles.body, !hasImage && { flex: 1 }]}>
          {/* Top row: category + status */}
          <View style={styles.topRow}>
            <Text style={[styles.category, { color: status.color }]} numberOfLines={1}>
              {(complaint.issue_class || complaint.user_selected_category || '').toUpperCase()}
            </Text>
            <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
            </View>
          </View>

          {/* Description snippet */}
          {complaint.description ? (
            <Text style={styles.desc} numberOfLines={1}>{complaint.description}</Text>
          ) : null}

          {/* Verified Address */}
          {complaint.location_address ? (
            <Text style={styles.addressText} numberOfLines={1}>
              📍 {complaint.location_address}
            </Text>
          ) : null}

          {/* Meta row */}
          <View style={styles.metaRow}>
            <Text style={styles.meta}>
              📅 {new Date(complaint.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </Text>
            {complaint.lat != null && complaint.lng != null && (
              <Text style={styles.meta}>
                {complaint.location_source === 'image_exif'
                  ? '📷 Photo'
                  : complaint.location_source === 'manual'
                  ? '📌 Manual'
                  : `📍 GPS${complaint.location_accuracy ? ` ±${complaint.location_accuracy}m` : ''}`}
                {' '}{complaint.lat.toFixed(4)}, {complaint.lng.toFixed(4)}
              </Text>
            )}
          </View>
        </View>

        {/* Chevron */}
        <Text style={styles.chevron}>›</Text>
      </View>

      {/* Retry Upload row for pending_upload */}
      {isPendingUpload && (
        <View style={styles.retryRow}>
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
              <Text style={styles.retryBtnText}>⚡ Retry Upload</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    marginBottom: spacing.md,
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.sm,
    marginRight: spacing.md,
    backgroundColor: colors.whiteAlpha08,
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  category: {
    fontSize: 13,
    fontWeight: '700',
  },
  statusPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  desc: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  addressText: {
    color: colors.textSecondary,
    fontSize: 11,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.base,
  },
  meta: {
    color: colors.textMuted,
    fontSize: 11,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 22,
    fontWeight: '300',
    marginLeft: spacing.sm,
  },
  retryRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  retryBtn: {
    backgroundColor: colors.amber,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtnText: {
    color: colors.textInverse,
    fontSize: 12,
    fontWeight: '700',
  },
});
