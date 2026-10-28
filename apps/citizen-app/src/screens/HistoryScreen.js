/**
 * HistoryScreen — Complaint history feed with status filters.
 *
 * Features:
 *  • Filter chips (All / Pending / Assigned / In Progress / Resolved)
 *  • ComplaintCard list with thumbnails and status badges
 *  • Clean empty state when no complaints match
 *  • Opens ComplaintDetailModal on card tap
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, radii } from '../theme/colors';
import { useComplaints } from '../context/ComplaintContext';
import ComplaintCard from '../components/ComplaintCard';
import ComplaintDetailModal from '../components/ComplaintDetailModal';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'rejected', label: 'Rejected' },
];

export default function HistoryScreen() {
  const {
    complaints,
    filteredComplaints,
    historyFilter,
    setHistoryFilter,
    selectedComplaint,
    setSelectedComplaint,
    loaded,
    refreshing,
    refreshComplaints,
    setActiveTab,
  } = useComplaints();

  return (
    <View style={styles.container}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <Text style={styles.title}>My Reports</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{complaints.length}</Text>
        </View>
      </View>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => {
          const isActive = historyFilter === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterChip, isActive && styles.filterChipActive]}
              onPress={() => setHistoryFilter(f.key)}
              accessibilityRole="button"
              accessibilityLabel={`Filter: ${f.label}`}
              accessibilityState={{ selected: isActive }}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            >
              <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Complaint list */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshComplaints}
            tintColor={colors.teal}
            colors={[colors.teal]}
          />
        }
      >
        {!loaded ? (
          <View style={styles.emptyState}>
            <ActivityIndicator size="large" color={colors.teal} />
            <Text style={[styles.emptyDesc, { marginTop: spacing.base }]}>
              Loading your reports...
            </Text>
          </View>
        ) : filteredComplaints.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No reports found</Text>
            <Text style={styles.emptyDesc}>
              {historyFilter === 'all'
                ? 'Your submitted complaints will appear here.'
                : `No complaints with "${FILTERS.find((f) => f.key === historyFilter)?.label}" status.`}
            </Text>
            <TouchableOpacity
              style={styles.emptyActionBtn}
              onPress={() => setActiveTab('report')}
              accessibilityRole="button"
              accessibilityLabel="Report an Issue"
              activeOpacity={0.8}
            >
              <Text style={styles.emptyActionText}>+ Report an Issue</Text>
            </TouchableOpacity>
          </View>
        ) : (
          filteredComplaints.map((item) => (
            <ComplaintCard
              key={item.id}
              complaint={item}
              onPress={() => setSelectedComplaint(item)}
            />
          ))
        )}
      </ScrollView>

      {/* Detail modal */}
      <ComplaintDetailModal
        complaint={selectedComplaint}
        visible={!!selectedComplaint}
        onClose={() => setSelectedComplaint(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  countBadge: {
    backgroundColor: colors.tealMuted,
    paddingVertical: 2,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
  },
  countText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '700',
  },

  /* Filters */
  filterScroll: {
    flexGrow: 0,
    marginBottom: spacing.base,
  },
  filterRow: {
    gap: spacing.sm,
    paddingRight: spacing.base,
  },
  filterChip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderRadius: radii.pill,
    backgroundColor: colors.whiteAlpha04,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.teal,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.teal,
  },

  /* List */
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xxl,
  },

  /* Empty state */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 2,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.base,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  emptyDesc: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.xl,
  },
  emptyActionBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.teal,
    paddingVertical: 12,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyActionText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '700',
  },
});
