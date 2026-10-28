/**
 * Timeline — Vertical 4-step resolution stepper.
 *
 * Maps backend DB statuses to visual lifecycle:
 *   Submitted → Assigned → In Progress → Resolved
 *
 * Supported statuses: pending, under_review, assigned,
 * in_progress, verified, closed, rejected.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme/colors';

const STEPS = [
  { key: 'submitted', label: 'Submitted', icon: '📤', desc: 'Report received' },
  { key: 'assigned', label: 'Assigned', icon: '👷', desc: 'Department notified' },
  { key: 'in_progress', label: 'In Progress', icon: '🔧', desc: 'Work underway' },
  { key: 'verified', label: 'Resolved', icon: '✅', desc: 'Issue resolved' },
];

/**
 * Convert a database status string to a 0-based step index.
 * Exported for testing.
 */
export function getStepIndex(status) {
  switch (status) {
    case 'pending_upload':
      return -1;
    case 'pending':
    case 'under_review':
      return 0;
    case 'assigned':
      return 1;
    case 'in_progress':
    case 'repaired':
      return 2;
    case 'verified':
    case 'closed':
      return 3;
    case 'rejected':
      return 0;
    default:
      return 0;
  }
}

function formatHistoryTimestamp(isoStr) {
  if (!isoStr) return null;
  try {
    const d = new Date(isoStr);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return null;
  }
}

export default function Timeline({ status, history = [] }) {
  const activeIndex = getStepIndex(status);

  // Derive authoritative timestamps from status history if present
  const getStepSubtitle = (step, isCurrent, isPassed) => {
    if (Array.isArray(history) && history.length > 0) {
      const match = history.find((h) => {
        if (step.key === 'submitted') return h.new_status === 'pending' || !h.previous_status;
        if (step.key === 'assigned') return h.new_status === 'assigned';
        if (step.key === 'in_progress') return h.new_status === 'in_progress' || h.new_status === 'repaired';
        if (step.key === 'verified') return h.new_status === 'verified' || h.new_status === 'closed';
        return false;
      });

      if (match && match.changed_at) {
        const timeFormatted = formatHistoryTimestamp(match.changed_at);
        if (timeFormatted) {
          return isCurrent
            ? `● ${step.desc} (${timeFormatted})`
            : isPassed
            ? `✓ ${step.desc} (${timeFormatted})`
            : `${step.desc} (${timeFormatted})`;
        }
      }
    }

    return isCurrent
      ? `● ${step.desc}`
      : isPassed
      ? `✓ ${step.desc}`
      : step.desc;
  };

  const isReopened = Array.isArray(history) && history.some((h) =>
    (h.previous_status === 'closed' || h.previous_status === 'rejected') &&
    (h.new_status === 'in_progress' || h.new_status === 'under_review' || h.new_status === 'assigned')
  );

  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={
        activeIndex === -1
          ? 'Resolution timeline: queued locally, awaiting upload'
          : status === 'rejected'
          ? 'Resolution timeline: report rejected'
          : `Resolution timeline: step ${activeIndex + 1} of ${STEPS.length}`
      }
    >
      {/* Explicit rejected notification */}
      {status === 'rejected' && (
        <View style={styles.rejectedBanner}>
          <Text style={styles.rejectedTitle}>✕ Complaint Rejected / Duplicate</Text>
          <Text style={styles.rejectedDesc}>
            This report was reviewed and marked as rejected or a duplicate by municipal operations.
          </Text>
        </View>
      )}

      {/* Explicit reopened notification */}
      {isReopened && status !== 'closed' && status !== 'rejected' && (
        <View style={styles.reopenedBanner}>
          <Text style={styles.reopenedTitle}>↺ Complaint Reopened</Text>
          <Text style={styles.reopenedDesc}>
            This case was reopened by municipal authorities and is actively under review or in progress.
          </Text>
        </View>
      )}

      {STEPS.map((step, idx) => {
        const isCompleted = idx <= activeIndex && status !== 'rejected';
        const isActive = idx === activeIndex && status !== 'rejected';
        const isLast = idx === STEPS.length - 1;

        return (
          <View key={step.key} style={styles.stepWrapper}>
            {/* Node column */}
            <View style={styles.nodeCol}>
              <View
                style={[
                  styles.circle,
                  isCompleted ? styles.circleCompleted : styles.circlePending,
                  isActive && styles.circleActive,
                ]}
              >
                {isCompleted ? (
                  <Text style={styles.stepIcon}>{step.icon}</Text>
                ) : (
                  <Text style={styles.stepNum}>{idx + 1}</Text>
                )}
              </View>
              {!isLast && (
                <View
                  style={[
                    styles.line,
                    idx < activeIndex && status !== 'rejected'
                      ? styles.lineCompleted
                      : styles.linePending,
                  ]}
                />
              )}
            </View>

            {/* Label column */}
            <View style={styles.labelCol}>
              <Text
                style={[
                  styles.label,
                  isCompleted ? styles.labelCompleted : styles.labelPending,
                  isActive && styles.labelActive,
                ]}
              >
                {step.label}
              </Text>
              <Text style={[styles.subtext, isActive && styles.subtextActive]}>
                {getStepSubtitle(step, isActive, idx < activeIndex)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  rejectedBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  rejectedTitle: {
    color: colors.coral || '#ef4444',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  rejectedDesc: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  reopenedBanner: {
    backgroundColor: 'rgba(255, 183, 3, 0.15)',
    borderColor: 'rgba(255, 183, 3, 0.4)',
    borderWidth: 1,
    borderRadius: 8,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  reopenedTitle: {
    color: colors.inProgress || '#ffb703',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  reopenedDesc: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  stepWrapper: {
    flexDirection: 'row',
    minHeight: 62,
  },
  nodeCol: {
    alignItems: 'center',
    marginRight: spacing.base,
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    borderWidth: 2,
  },
  circlePending: {
    backgroundColor: colors.cardBg,
    borderColor: colors.border,
  },
  circleCompleted: {
    backgroundColor: colors.resolved,
    borderColor: colors.resolved,
  },
  circleActive: {
    borderColor: colors.teal,
    borderWidth: 3,
    backgroundColor: colors.deepSlate,
  },
  stepIcon: {
    fontSize: 14,
  },
  stepNum: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  line: {
    width: 2,
    flex: 1,
    marginVertical: 4,
    borderRadius: 1,
  },
  linePending: {
    backgroundColor: colors.border,
  },
  lineCompleted: {
    backgroundColor: colors.resolved,
  },
  labelCol: {
    justifyContent: 'center',
    paddingBottom: spacing.base,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  labelPending: {
    color: colors.textMuted,
  },
  labelCompleted: {
    color: colors.textPrimary,
  },
  labelActive: {
    color: colors.teal,
  },
  subtext: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  subtextActive: {
    color: colors.teal,
    fontWeight: '500',
  },
});
