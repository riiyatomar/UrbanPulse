/**
 * ReportScreen — Civic issue reporting form with authentic geolocation & EXIF accuracy.
 *
 * Sections:
 *  1. Photo capture/selection (via MockCamera + EXIF extraction)
 *  2. Location Data (truthful GPS / EXIF / Manual pin on Leaflet OSM map)
 *  3. Category selector (6 civic issue chips)
 *  4. Description input (multiline, 300 char limit)
 *  5. Submit button with strict validation
 *
 * Zero fabricated or hardcoded coordinates.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, spacing, radii, issueCategories } from '../theme/colors';
import { useComplaints } from '../context/ComplaintContext';
import MockCamera from '../components/MockCamera';
import StepIndicator from '../components/StepIndicator';
import LocationMap from '../components/LocationMap';
import { useLocation } from '../hooks/useLocation';
import { extractExifCoordinates } from '../utils/exif';
import { reverseGeocodeCoords } from '../utils/reverseGeocode';

export default function ReportScreen() {
  const {
    draft,
    updateDraft,
    submitting,
    submitError,
    submitComplaint,
    validationErrors,
  } = useComplaints();

  const {
    imageUri,
    lat,
    lng,
    location_source,
    location_accuracy,
    location_address,
    issueCategory,
    description,
  } = draft;

  const {
    loading: locationLoading,
    requestLocation,
    error: locationError,
    permissionDenied,
  } = useLocation();

  const [resolvingAddress, setResolvingAddress] = useState(false);

  // Monotonically increasing sequence token to guard against asynchronous race conditions
  // (e.g. user manually moves pin while GPS pending, or photo changed/removed while GPS pending)
  const locationSeqRef = useRef(0);

  // Debounce timer ref to prevent burst reverse-geocoding requests from rapid map interactions
  // Complies with official Nominatim usage policy: max 1 req/sec
  const geocodeDebounceTimerRef = useRef(null);

  // Clean up any pending debounce timer on unmount
  useEffect(() => {
    return () => {
      if (geocodeDebounceTimerRef.current) {
        clearTimeout(geocodeDebounceTimerRef.current);
      }
    };
  }, []);

  // ─── Reverse geocoding helper guarded by sequence token ──
  const resolveAddressForCoords = useCallback(async (targetLat, targetLng, seq) => {
    setResolvingAddress(true);
    try {
      const addr = await reverseGeocodeCoords(targetLat, targetLng);
      // Guard: abort if user placed a newer pin, took photo, or requested locate me
      if (seq === locationSeqRef.current) {
        updateDraft({ location_address: addr });
      }
    } catch (e) {
      if (seq === locationSeqRef.current) {
        updateDraft({ location_address: null });
      }
    } finally {
      if (seq === locationSeqRef.current) {
        setResolvingAddress(false);
      }
    }
  }, [updateDraft]);

  // ─── Manual map location override ─────────────────────────
  const handleManualLocationChange = useCallback(({ lat: newLat, lng: newLng }) => {
    const currentSeq = ++locationSeqRef.current; // Invalidate any in-flight GPS/EXIF/reverse-geocode
    updateDraft({
      lat: newLat,
      lng: newLng,
      location_source: 'manual',
      location_accuracy: null, // manual placement clears GPS accuracy
      location_address: null, // reset address while resolving new location
    });

    // Clear any pending debounce timer from rapid pin movements/taps
    if (geocodeDebounceTimerRef.current) {
      clearTimeout(geocodeDebounceTimerRef.current);
    }
    setResolvingAddress(true);

    // Debounce by 800ms so only the deliberate / settled position triggers Nominatim
    geocodeDebounceTimerRef.current = setTimeout(() => {
      resolveAddressForCoords(newLat, newLng, currentSeq);
    }, 800);
  }, [updateDraft, resolveAddressForCoords]);

  // ─── Explicit "Locate Me" GPS action ──────────────────────
  const handleLocateMe = useCallback(async () => {
    const currentSeq = ++locationSeqRef.current;
    if (geocodeDebounceTimerRef.current) {
      clearTimeout(geocodeDebounceTimerRef.current);
    }
    const pos = await requestLocation();
    // Guard: ignore stale GPS result if citizen placed a manual pin or changed photo
    if (currentSeq !== locationSeqRef.current) return;

    if (pos && pos.lat != null && pos.lng != null) {
      updateDraft({
        lat: pos.lat,
        lng: pos.lng,
        location_source: 'device',
        location_accuracy: pos.accuracy ?? null,
        location_address: null,
      });
      resolveAddressForCoords(pos.lat, pos.lng, currentSeq);
    }
  }, [requestLocation, updateDraft, resolveAddressForCoords]);

  // ─── Photo selection flow (EXIF precedence -> Device GPS fallback) ─
  const handlePhotoSelect = useCallback(async (uri, meta = {}) => {
    const currentSeq = ++locationSeqRef.current;
    if (geocodeDebounceTimerRef.current) {
      clearTimeout(geocodeDebounceTimerRef.current);
    }
    updateDraft({ imageUri: uri });

    // Step 1: Attempt EXIF extraction for gallery / picked photos
    let exifCoords = meta.exifCoords;
    if (exifCoords === undefined && (meta.source === 'gallery' || !meta.source)) {
      try {
        exifCoords = await extractExifCoordinates(uri);
      } catch (err) {
        console.warn('EXIF parse error:', err);
      }
    }

    // Guard: abort if user selected another photo or pin during EXIF extraction
    if (currentSeq !== locationSeqRef.current) return;

    // Step 2: If valid EXIF GPS exists, it takes strict precedence
    if (exifCoords && exifCoords.lat != null && exifCoords.lng != null) {
      updateDraft({
        imageUri: uri,
        lat: exifCoords.lat,
        lng: exifCoords.lng,
        location_source: 'image_exif',
        location_accuracy: null,
        location_address: null,
      });
      resolveAddressForCoords(exifCoords.lat, exifCoords.lng, currentSeq);
      return;
    }

    // Step 3: If no EXIF GPS, attempt real device GPS
    const pos = await requestLocation();

    // Guard: abort if citizen placed a manual pin, changed photo, or removed photo
    if (currentSeq !== locationSeqRef.current) return;

    if (pos && pos.lat != null && pos.lng != null) {
      updateDraft({
        imageUri: uri,
        lat: pos.lat,
        lng: pos.lng,
        location_source: 'device',
        location_accuracy: pos.accuracy ?? null,
        location_address: null,
      });
      resolveAddressForCoords(pos.lat, pos.lng, currentSeq);
    }
    // Step 4: If device GPS is unavailable, leave coordinates unresolved (no fake fallback)
  }, [updateDraft, requestLocation, resolveAddressForCoords]);

  // ─── Decoupled photo removal (does not clear independently acquired location) ─
  const handleRemovePhoto = useCallback(() => {
    locationSeqRef.current += 1; // Invalidate any pending photo-linked GPS/EXIF resolution
    if (geocodeDebounceTimerRef.current) {
      clearTimeout(geocodeDebounceTimerRef.current);
    }
    updateDraft({ imageUri: null });
  }, [updateDraft]);

  // ─── Compute step indicator state ─────────────────────────
  const completedSteps = [];
  let currentStep = 0;
  if (imageUri) { completedSteps.push(0); currentStep = 1; }
  if (lat != null && lng != null) { completedSteps.push(1); currentStep = 2; }
  if (issueCategory) { completedSteps.push(2); currentStep = 3; }

  const hasCoords = lat != null && lng != null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.keyboardAvoid}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step indicator */}
        <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

        {/* ─── 1. Photo Section ─── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionIcon}>📷</Text>
            <Text style={styles.sectionLabel}>CAPTURE ISSUE</Text>
          </View>
          <MockCamera
            imageUri={imageUri}
            onSelectPhoto={handlePhotoSelect}
            onRemovePhoto={handleRemovePhoto}
          />
          {validationErrors.imageUri && (
            <Text style={styles.errorText}>{validationErrors.imageUri}</Text>
          )}
        </View>

        {/* ─── 2. Location Section ─── */}
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionIcon}>📍</Text>
              <Text style={styles.sectionLabel}>LOCATION DATA</Text>
            </View>
            <TouchableOpacity
              style={styles.locateBtn}
              onPress={handleLocateMe}
              disabled={locationLoading}
              accessibilityRole="button"
              accessibilityLabel="Locate with device GPS"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {locationLoading ? (
                <ActivityIndicator size="small" color={colors.teal} />
              ) : (
                <Text style={styles.locateBtnText}>
                  {hasCoords ? '↻ Locate Me' : '📍 Locate Me'}
                </Text>
              )}
            </TouchableOpacity>
          </View>

        {/* Truthful Location Status */}
        {locationLoading ? (
          <View style={styles.statusBox}>
            <ActivityIndicator size="small" color={colors.teal} />
            <Text style={styles.statusBoxText}>Getting your location…</Text>
          </View>
        ) : hasCoords ? (
          <View style={styles.locationDetailContainer}>
            {/* Header / Source badge */}
            <View style={styles.sourceRow}>
              {location_source === 'image_exif' ? (
                <View style={styles.sourceInfo}>
                  <Text style={styles.sourceTitle}>Photo Location</Text>
                  <Text style={styles.sourceSubtitle}>Found in Photo Metadata</Text>
                </View>
              ) : location_source === 'manual' ? (
                <View style={styles.sourceInfo}>
                  <Text style={styles.sourceTitle}>Custom Location</Text>
                  <Text style={styles.sourceSubtitle}>Selected on Map</Text>
                </View>
              ) : (
                <View style={styles.sourceInfo}>
                  <Text style={styles.sourceTitle}>GPS Location</Text>
                  <Text style={styles.sourceSubtitle}>
                    {location_accuracy != null ? `±${location_accuracy}m accuracy` : 'Device GPS'}
                  </Text>
                </View>
              )}

              <View style={[
                styles.badge,
                location_source === 'image_exif' && styles.badgeExif,
                location_source === 'manual' && styles.badgeManual,
              ]}>
                <Text style={styles.badgeText}>
                  {location_source === 'image_exif' ? '📷 EXIF' :
                   location_source === 'manual' ? '📌 Manual' :
                   `📍 GPS${location_accuracy != null ? ` ±${location_accuracy}m` : ''}`}
                </Text>
              </View>
            </View>

            {/* Coordinates display */}
            <View style={styles.coordsRow}>
              <View style={styles.coordCol}>
                <Text style={styles.coordLabel}>Latitude</Text>
                <Text style={styles.coordVal}>{lat.toFixed(6)}</Text>
              </View>
              <View style={styles.coordDivider} />
              <View style={styles.coordCol}>
                <Text style={styles.coordLabel}>Longitude</Text>
                <Text style={styles.coordVal}>{lng.toFixed(6)}</Text>
              </View>
            </View>

            {/* Verified Location / Reverse Geocoded Address Card */}
            <View style={styles.addressCard}>
              <View style={styles.addressHeaderRow}>
                <Text style={styles.addressSectionLabel}>VERIFIED LOCATION</Text>
                {resolvingAddress ? (
                  <View style={styles.resolvingBadge}>
                    <ActivityIndicator size="small" color={colors.teal} style={{ transform: [{ scale: 0.65 }] }} />
                    <Text style={styles.resolvingText}>Resolving address…</Text>
                  </View>
                ) : (
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedCheck}>✓</Text>
                    <Text style={styles.verifiedBadgeText}>OSM Verified</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.addressBody,
                  !location_address && !resolvingAddress && styles.addressBodyUnavailable,
                ]}
                numberOfLines={3}
              >
                {resolvingAddress
                  ? 'Querying OpenStreetMap Nominatim…'
                  : location_address || 'Address details unavailable for these coordinates'}
              </Text>
            </View>

            {/* Low accuracy warning */}
            {location_source === 'device' && location_accuracy != null && location_accuracy > 100 && (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>
                  ⚠️ Low GPS accuracy (±{location_accuracy}m). Please verify or adjust the pin on the map.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🛰️</Text>
            <View style={styles.emptyTextCol}>
              <Text style={styles.emptyTitle}>Location not acquired.</Text>
              <Text style={styles.emptySubtitle}>
                {permissionDenied
                  ? 'Permission denied. Tap the map below to place a pin manually.'
                  : "Tap 'Locate Me' or place a pin on the map."}
              </Text>
            </View>
          </View>
        )}

        {/* Interactive OpenStreetMap */}
        <View style={styles.mapWrapper}>
          <LocationMap
            lat={lat}
            lng={lng}
            onLocationChange={handleManualLocationChange}
            height={220}
          />
          <Text style={styles.mapHint}>
            {hasCoords
              ? 'Tap or drag pin to adjust location manually'
              : 'Tap anywhere on the map to set incident location'}
          </Text>
        </View>

        {locationError && !hasCoords && (
          <Text style={styles.errorText}>{locationError}</Text>
        )}

        {validationErrors.location && (
          <Text style={styles.errorText}>{validationErrors.location}</Text>
        )}
      </View>

      {/* ─── 3. Category Section ─── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>🏷️</Text>
          <Text style={styles.sectionLabel}>WHAT'S THE ISSUE?</Text>
        </View>
        <View style={styles.categoryGrid}>
          {issueCategories.map((cat) => {
            const isSelected = issueCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[styles.categoryChip, isSelected && styles.categoryChipActive]}
                onPress={() => updateDraft({ issueCategory: cat.key })}
                accessibilityRole="button"
                accessibilityLabel={`Select issue type: ${cat.label}`}
                accessibilityState={{ selected: isSelected }}
              >
                <Text style={styles.categoryChipIcon}>{cat.icon}</Text>
                <Text style={[styles.categoryChipText, isSelected && styles.categoryChipTextActive]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {validationErrors.issueCategory && (
          <Text style={styles.errorText}>{validationErrors.issueCategory}</Text>
        )}
      </View>

      {/* ─── 4. Description Section ─── */}
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionIcon}>✏️</Text>
          <Text style={styles.sectionLabel}>DESCRIBE THE PROBLEM</Text>
          <Text style={styles.optionalBadge}>Optional</Text>
        </View>
        <TextInput
          style={styles.descriptionInput}
          placeholder="e.g. Large pothole near main road junction, causing traffic issues..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          maxLength={300}
          value={description}
          onChangeText={(text) => updateDraft({ description: text })}
          accessibilityLabel="Describe the civic issue in brief"
        />
        <Text style={styles.charCount}>{description.length}/300</Text>
      </View>

      {/* ─── Submission Error Banner ─── */}
      {submitError && (
        <View style={styles.submitErrorCard}>
          <Text style={styles.submitErrorIcon}>⚠️</Text>
          <View style={styles.submitErrorContent}>
            <Text style={styles.submitErrorTitle}>Submission Failed</Text>
            <Text style={styles.submitErrorText}>{submitError}</Text>
          </View>
        </View>
      )}

      {/* ─── 5. Submit Button ─── */}
      <TouchableOpacity
        style={[
          styles.submitBtn,
          (!imageUri || !hasCoords || submitting) && styles.submitBtnDisabled,
        ]}
        disabled={submitting || !imageUri || !hasCoords}
        onPress={() => submitComplaint()}
        accessibilityRole="button"
        accessibilityLabel="Submit complaint report"
        accessibilityHint="Submits the complaint with the selected photo, location, and category"
      >
        {submitting ? (
          <View style={styles.submitRow}>
            <ActivityIndicator size="small" color={colors.white} />
            <Text style={styles.submitBtnText}>Uploading...</Text>
          </View>
        ) : (
          <View style={styles.submitRow}>
            <Text style={styles.submitIcon}>🚀</Text>
            <Text style={styles.submitBtnText}>
              {submitError ? 'Retry Submission' : 'Submit Complaint'}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Bottom padding */}
      <View style={{ height: spacing.xl }} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  /* ─── Section Cards ─── */
  sectionCard: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.lg,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.base,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.md,
  },
  sectionIcon: { fontSize: 14 },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  /* ─── Locate Button ─── */
  locateBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: 12,
    backgroundColor: colors.tealMuted,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  locateBtnText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '700',
  },

  /* ─── Location Status Box ─── */
  statusBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.whiteAlpha04,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
  },
  statusBoxText: {
    color: colors.teal,
    fontSize: 13,
    fontWeight: '600',
  },

  /* ─── Location Detail Container ─── */
  locationDetailContainer: {
    marginBottom: spacing.md,
  },
  sourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sourceInfo: {
    flex: 1,
  },
  sourceTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  sourceSubtitle: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  badge: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.tealBorder,
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radii.pill,
  },
  badgeExif: {
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  badgeManual: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  badgeText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: '700',
  },

  /* ─── Coordinates ─── */
  coordsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radii.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  coordCol: { flex: 1, paddingVertical: 2, paddingHorizontal: 6 },
  coordDivider: {
    width: 1,
    height: 26,
    backgroundColor: colors.border,
    marginHorizontal: spacing.xs,
  },
  coordLabel: {
    color: colors.textMuted,
    fontSize: 9,
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  coordVal: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  /* ─── Reverse Geocoded Address Card ─── */
  addressCard: {
    marginTop: spacing.sm,
    backgroundColor: colors.inputBg,
    borderRadius: radii.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addressHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  addressSectionLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  resolvingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  resolvingText: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: '500',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(20, 184, 166, 0.12)',
    paddingVertical: 1,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  verifiedCheck: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: '700',
  },
  verifiedBadgeText: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  addressBody: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  addressBodyUnavailable: {
    color: colors.textMuted,
    fontStyle: 'italic',
  },

  /* ─── Low Accuracy Warning ─── */
  warningBox: {
    marginTop: spacing.sm,
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    padding: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.3)',
  },
  warningText: {
    color: '#FBBF24',
    fontSize: 11,
    lineHeight: 16,
  },

  /* ─── Empty State ─── */
  emptyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.whiteAlpha04,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIcon: { fontSize: 24 },
  emptyTextCol: { flex: 1 },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  emptySubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },

  /* ─── Map Wrapper ─── */
  mapWrapper: {
    marginTop: spacing.xs,
  },
  mapHint: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 6,
    textAlign: 'center',
    fontStyle: 'italic',
  },

  /* ─── Categories ─── */
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radii.sm,
    backgroundColor: colors.whiteAlpha04,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
  },
  categoryChipActive: {
    backgroundColor: colors.tealMuted,
    borderColor: colors.teal,
  },
  categoryChipIcon: { fontSize: 16 },
  categoryChipText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: colors.teal,
  },

  /* ─── Description ─── */
  optionalBadge: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '600',
    backgroundColor: colors.whiteAlpha04,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    marginLeft: 'auto',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  descriptionInput: {
    backgroundColor: colors.inputBg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  charCount: {
    color: colors.textMuted,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 6,
  },

  /* ─── Submit ─── */
  submitBtn: {
    borderRadius: radii.lg,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
  },
  submitBtnDisabled: {
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  submitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  submitIcon: { fontSize: 16 },
  submitBtnText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
  },

  /* ─── Validation Error ─── */
  errorText: {
    color: colors.critical,
    fontSize: 12,
    marginTop: spacing.xs,
    paddingLeft: 2,
  },

  /* ─── Submission Error Banner ─── */
  submitErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.criticalBg,
    borderColor: colors.critical,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.base,
  },
  submitErrorIcon: {
    fontSize: 20,
  },
  submitErrorContent: {
    flex: 1,
  },
  submitErrorTitle: {
    color: colors.critical,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  submitErrorText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
});
