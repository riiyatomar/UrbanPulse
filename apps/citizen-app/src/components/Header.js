/**
 * Header — UrbanPulse civic branding header with user info and logout.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radii } from '../theme/colors';

export default function Header({ userName, onLogout }) {
  return (
    <View style={styles.header} accessibilityRole="header">
      <View style={styles.row}>
        {/* Logo mark */}
        <View style={styles.logo}>
          <Text style={styles.logoText}>UP</Text>
        </View>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>UrbanPulse</Text>
          <Text style={styles.subtitle}>Report Civic Issues</Text>
        </View>
      </View>

      <View style={styles.rightSection}>
        {/* User name */}
        {userName ? (
          <Text style={styles.userName} numberOfLines={1}>{userName}</Text>
        ) : null}

        {/* Citizen badge */}
        <View style={styles.badge}>
          <View style={styles.dot} />
          <Text style={styles.badgeText}>Citizen</Text>
        </View>

        {/* Logout button */}
        {onLogout && (
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={onLogout}
            accessibilityLabel="Sign out"
          >
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.civicNavy,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '800',
  },
  titleBlock: {},
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userName: {
    color: colors.textSecondary,
    fontSize: 11,
    maxWidth: 80,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: colors.tealMuted,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.teal,
  },
  badgeText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '700',
  },
  logoutBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248, 81, 73, 0.25)',
  },
  logoutText: {
    color: '#f85149',
    fontSize: 10,
    fontWeight: '600',
  },
});
