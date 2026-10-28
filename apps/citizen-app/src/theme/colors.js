/**
 * UrbanPulse Citizen App — Design System Tokens
 *
 * Civic-grade palette, spacing scale, typography, and status
 * configuration used across all screens and components.
 */

// ─── Civic Colour Palette ────────────────────────────────────
export const colors = {
  // Backgrounds
  deepSlate: '#0B132B',
  civicNavy: '#1C2541',
  cardBg: '#162032',
  inputBg: '#0F1A2E',
  overlay: 'rgba(11, 19, 43, 0.85)',

  // Accent
  teal: '#48CAE4',
  tealMuted: 'rgba(72, 202, 228, 0.12)',
  tealBorder: 'rgba(72, 202, 228, 0.25)',

  // Semantic
  resolved: '#2EC4B6',
  resolvedBg: 'rgba(46, 196, 182, 0.10)',
  inProgress: '#FFB703',
  inProgressBg: 'rgba(255, 183, 3, 0.10)',
  critical: '#E63946',
  criticalBg: 'rgba(230, 57, 70, 0.10)',
  assigned: '#48CAE4',
  assignedBg: 'rgba(72, 202, 228, 0.10)',
  pending: '#FFB703',
  pendingBg: 'rgba(255, 183, 3, 0.10)',

  // Text
  textPrimary: '#E8ECF1',
  textSecondary: '#8B99AE',
  textMuted: '#556178',
  textInverse: '#0B132B',

  // Border
  border: 'rgba(255, 255, 255, 0.08)',
  borderFocus: 'rgba(72, 202, 228, 0.40)',

  // White helpers
  white: '#FFFFFF',
  whiteAlpha04: 'rgba(255, 255, 255, 0.04)',
  whiteAlpha08: 'rgba(255, 255, 255, 0.08)',
};

// ─── Spacing Scale ───────────────────────────────────────────
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

// ─── Typography ──────────────────────────────────────────────
export const typography = {
  h1: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  h2: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  h3: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  body: { fontSize: 14, fontWeight: '400', color: colors.textPrimary },
  caption: { fontSize: 12, fontWeight: '500', color: colors.textSecondary },
  label: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.8, textTransform: 'uppercase' },
  badge: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
};

// ─── Border Radius ───────────────────────────────────────────
export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 100,
};

// ─── Card Elevation (iOS shadows + Android elevation) ────────
export const cardShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.25,
  shadowOffset: { width: 0, height: 2 },
  shadowRadius: 8,
  elevation: 4,
};

// ─── Status Configuration Map ────────────────────────────────
export const statusConfig = {
  pending: { color: colors.pending, bg: colors.pendingBg, label: 'PENDING' },
  pending_upload: { color: colors.inProgress, bg: colors.inProgressBg, label: 'QUEUED UPLOAD' },
  under_review: { color: colors.inProgress, bg: colors.inProgressBg, label: 'REVIEWING' },
  assigned: { color: colors.assigned, bg: colors.assignedBg, label: 'ASSIGNED' },
  in_progress: { color: colors.inProgress, bg: colors.inProgressBg, label: 'IN PROGRESS' },
  repaired: { color: colors.resolved, bg: colors.resolvedBg, label: 'REPAIRED' },
  verified: { color: colors.resolved, bg: colors.resolvedBg, label: 'RESOLVED' },
  closed: { color: colors.resolved, bg: colors.resolvedBg, label: 'CLOSED' },
  rejected: { color: colors.critical, bg: colors.criticalBg, label: 'REJECTED' },
};

export const getStatusConfig = (status) => {
  return statusConfig[status] || { color: colors.textMuted, bg: colors.whiteAlpha04, label: (status || 'UNKNOWN').toUpperCase() };
};

// ─── Issue Categories ────────────────────────────────────────
export const issueCategories = [
  { key: 'pothole', label: 'Pothole', icon: '🕳️' },
  { key: 'manhole', label: 'Manhole', icon: '⚠️' },
  { key: 'streetlight', label: 'Streetlight', icon: '💡' },
  { key: 'waterlogging', label: 'Waterlogging', icon: '🌊' },
  { key: 'footpath', label: 'Footpath', icon: '🚶' },
  { key: 'other', label: 'Other', icon: '📝' },
];
