/**
 * StepIndicator — Labelled 4-step progress bar.
 *
 *  Photo → Location → Category → Review
 *
 * Each step shows ✓ when completed, a highlighted number when
 * current, or a muted number when pending.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radii } from '../theme/colors';

const STEPS = ['Photo', 'Location', 'Category', 'Review'];

export default function StepIndicator({ currentStep = 0, completedSteps = [] }) {
  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentStep + 1} of ${STEPS.length}: ${STEPS[currentStep]}`}
    >
      {STEPS.map((label, idx) => {
        const isCompleted = completedSteps.includes(idx);
        const isCurrent = idx === currentStep;
        const isPending = !isCompleted && !isCurrent;

        return (
          <React.Fragment key={label}>
            {idx > 0 && (
              <View style={[styles.line, isCompleted || isCurrent ? styles.lineDone : styles.linePending]} />
            )}
            <View style={styles.stepCol}>
              <View
                style={[
                  styles.badge,
                  isCompleted && styles.badgeDone,
                  isCurrent && styles.badgeCurrent,
                  isPending && styles.badgePending,
                ]}
              >
                <Text style={styles.badgeText}>{isCompleted ? '✓' : idx + 1}</Text>
              </View>
              <Text
                style={[
                  styles.label,
                  isCompleted && styles.labelDone,
                  isCurrent && styles.labelCurrent,
                  isPending && styles.labelPending,
                ]}
              >
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  stepCol: {
    alignItems: 'center',
    width: 56,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginBottom: 4,
  },
  badgeDone: {
    backgroundColor: colors.resolved,
    borderColor: colors.resolved,
  },
  badgeCurrent: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.teal,
  },
  badgePending: {
    backgroundColor: colors.cardBg,
    borderColor: colors.border,
  },
  badgeText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  line: {
    flex: 1,
    height: 2,
    marginTop: 13, // vertically centre with badge
    borderRadius: 1,
  },
  lineDone: {
    backgroundColor: colors.resolved,
  },
  linePending: {
    backgroundColor: colors.border,
  },
  label: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  labelDone: { color: colors.resolved },
  labelCurrent: { color: colors.teal },
  labelPending: { color: colors.textMuted },
});
