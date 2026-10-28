/**
 * CameraModal — Full-screen native camera viewfinder & review modal.
 *
 * Lifecycle:
 *  1. Permission Gate: Requests camera access with civic explanation.
 *  2. Live Viewfinder: CameraView with framing grid, flip, and shutter.
 *  3. Capture Review: Full preview of photo with Retake and Accept actions.
 *  4. Accept Photo: Passes accepted image URI to parent and dismisses modal.
 *
 * Adheres to the UrbanPulse civic design system tokens.
 */
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { colors, spacing, radii } from '../theme/colors';

export default function CameraModal({ visible, onClose, onAcceptPhoto }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState('back');
  const [capturedUri, setCapturedUri] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const cameraRef = useRef(null);

  // ─── Reset state on dismiss ───────────────────────────────
  const handleClose = useCallback(() => {
    setCapturedUri(null);
    setIsCapturing(false);
    setCameraError(null);
    onClose();
  }, [onClose]);

  // ─── Flip camera front/back ───────────────────────────────
  const toggleFacing = useCallback(() => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
  }, []);

  // ─── Take photo ───────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || isCapturing) return;

    try {
      setIsCapturing(true);
      setCameraError(null);

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        exif: true,
      });

      if (photo && photo.uri) {
        setCapturedUri(photo.uri);
      } else {
        setCameraError('Failed to capture photo. Please try again.');
      }
    } catch (err) {
      console.warn('Camera capture error:', err);
      setCameraError('Camera error occurred. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing]);

  // ─── Retake photo (discard current frame) ─────────────────
  const handleRetake = useCallback(() => {
    setCapturedUri(null);
    setCameraError(null);
  }, []);

  // ─── Accept photo (confirm and attach) ────────────────────
  const handleAccept = useCallback(() => {
    if (capturedUri) {
      const uri = capturedUri;
      setCapturedUri(null);
      setCameraError(null);
      onAcceptPhoto(uri);
    }
  }, [capturedUri, onAcceptPhoto]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        {/* ─── PERMISSION CHECK ─── */}
        {!permission || !permission.granted ? (
          <View style={styles.permissionCard}>
            <View style={styles.permissionIconOuter}>
              <Text style={styles.permissionIcon}>📷</Text>
            </View>
            <Text style={styles.permissionTitle}>Camera Permission Required</Text>
            <Text style={styles.permissionDesc}>
              UrbanPulse requires camera access to capture real-time, verified photos of civic issues
              (potholes, waterlogging, damaged streetlights, and public infrastructure).
            </Text>

            {permission && !permission.canAskAgain ? (
              <View style={styles.deniedNotice}>
                <Text style={styles.deniedNoticeText}>
                  Camera access is disabled. Please enable camera permission in your device settings to take photos.
                </Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.grantBtn}
                onPress={requestPermission}
                accessibilityRole="button"
                accessibilityLabel="Grant Camera Permission"
              >
                <Text style={styles.grantBtnText}>Enable Camera</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel and close camera"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : capturedUri ? (
          /* ─── CAPTURE REVIEW STATE ─── */
          <View style={styles.reviewContainer}>
            {/* Review Header */}
            <View style={styles.reviewHeader}>
              <Text style={styles.reviewTitle}>Preview Photo</Text>
              <Text style={styles.reviewSubtitle}>
                Ensure the issue is clearly visible before attaching
              </Text>
            </View>

            {/* Photo Preview */}
            <View style={styles.previewFrame}>
              <Image source={{ uri: capturedUri }} style={styles.previewImage} />
            </View>

            {/* Review Actions */}
            <View style={styles.reviewActions}>
              <TouchableOpacity
                style={styles.retakeBtn}
                onPress={handleRetake}
                accessibilityRole="button"
                accessibilityLabel="Retake photo"
              >
                <Text style={styles.retakeBtnIcon}>↺</Text>
                <Text style={styles.retakeBtnText}>Retake</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.acceptBtn}
                onPress={handleAccept}
                accessibilityRole="button"
                accessibilityLabel="Accept and use photo"
              >
                <Text style={styles.acceptBtnIcon}>✓</Text>
                <Text style={styles.acceptBtnText}>Use Photo</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* ─── LIVE VIEWFINDER STATE ─── */
          <View style={styles.viewfinderContainer}>
            {/* Viewfinder Header */}
            <View style={styles.viewfinderHeader}>
              <TouchableOpacity
                style={styles.headerBtn}
                onPress={handleClose}
                accessibilityRole="button"
                accessibilityLabel="Close camera"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.headerBtnIcon}>✕</Text>
              </TouchableOpacity>

              <Text style={styles.headerTitle}>FRAME ISSUE</Text>

              <TouchableOpacity
                style={styles.headerBtn}
                onPress={toggleFacing}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${facing === 'back' ? 'front' : 'back'} camera`}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Text style={styles.headerBtnIcon}>🔄</Text>
              </TouchableOpacity>
            </View>

            {/* Camera View */}
            <View style={styles.cameraWrapper}>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing={facing}
              >
                {/* Civic Framing Reticle */}
                <View style={styles.gridOverlay}>
                  <View style={styles.gridRow}>
                    <View style={[styles.gridCorner, styles.topLeft]} />
                    <View style={[styles.gridCorner, styles.topRight]} />
                  </View>
                  <View style={styles.gridRow}>
                    <View style={[styles.gridCorner, styles.bottomLeft]} />
                    <View style={[styles.gridCorner, styles.bottomRight]} />
                  </View>
                </View>

                {cameraError && (
                  <View style={styles.errorBanner}>
                    <Text style={styles.errorBannerText}>{cameraError}</Text>
                  </View>
                )}
              </CameraView>
            </View>

            {/* Viewfinder Controls Bar */}
            <View style={styles.controlsBar}>
              <Text style={styles.instructionText}>
                Center the civic issue inside the frame
              </Text>

              <View style={styles.shutterRow}>
                <TouchableOpacity
                  style={[styles.shutterBtn, isCapturing && styles.shutterBtnCapturing]}
                  onPress={handleCapture}
                  disabled={isCapturing}
                  accessibilityRole="button"
                  accessibilityLabel="Capture photo"
                >
                  {isCapturing ? (
                    <ActivityIndicator size="small" color={colors.white} />
                  ) : (
                    <View style={styles.shutterInner} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.deepSlate,
  },

  /* ─── Permission Card ─── */
  permissionCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.deepSlate,
  },
  permissionIconOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.tealMuted,
    borderWidth: 2,
    borderColor: colors.tealBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  permissionIcon: {
    fontSize: 36,
  },
  permissionTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  permissionDesc: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  grantBtn: {
    width: '100%',
    height: 50,
    backgroundColor: colors.teal,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    minHeight: 48,
  },
  grantBtnText: {
    color: colors.deepSlate,
    fontSize: 15,
    fontWeight: '700',
  },
  cancelBtn: {
    width: '100%',
    height: 48,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.whiteAlpha04,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  deniedNotice: {
    backgroundColor: colors.criticalBg,
    borderColor: colors.critical,
    borderWidth: 1,
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.lg,
    width: '100%',
  },
  deniedNoticeText: {
    color: colors.critical,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* ─── Live Viewfinder ─── */
  viewfinderContainer: {
    flex: 1,
    backgroundColor: '#000',
  },
  viewfinderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.deepSlate,
    zIndex: 10,
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.whiteAlpha08,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnIcon: {
    fontSize: 18,
    color: colors.textPrimary,
  },
  headerTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cameraWrapper: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  camera: {
    flex: 1,
  },

  /* ─── Civic Framing Reticle ─── */
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
    padding: spacing.xxl,
  },
  gridRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  gridCorner: {
    width: 28,
    height: 28,
    borderColor: 'rgba(72, 202, 228, 0.75)',
  },
  topLeft: {
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderTopLeftRadius: 4,
  },
  topRight: {
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderTopRightRadius: 4,
  },
  bottomLeft: {
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderBottomLeftRadius: 4,
  },
  bottomRight: {
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderBottomRightRadius: 4,
  },

  errorBanner: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(230, 57, 70, 0.9)',
    padding: spacing.sm,
    borderRadius: radii.sm,
    alignItems: 'center',
  },
  errorBannerText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },

  /* ─── Controls Bar ─── */
  controlsBar: {
    backgroundColor: colors.deepSlate,
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  instructionText: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing.md,
    fontWeight: '500',
  },
  shutterRow: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'transparent',
    borderWidth: 4,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  shutterBtnCapturing: {
    borderColor: colors.teal,
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.teal,
  },

  /* ─── Review State ─── */
  reviewContainer: {
    flex: 1,
    backgroundColor: colors.deepSlate,
    padding: spacing.base,
    justifyContent: 'space-between',
  },
  reviewHeader: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  reviewTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  reviewSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
  previewFrame: {
    flex: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.cardBg,
    marginVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
  },
  reviewActions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  retakeBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 50,
    borderRadius: radii.md,
    backgroundColor: colors.whiteAlpha04,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  retakeBtnIcon: {
    fontSize: 18,
    color: colors.textSecondary,
  },
  retakeBtnText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  acceptBtn: {
    flex: 1,
    flexDirection: 'row',
    height: 50,
    borderRadius: radii.md,
    backgroundColor: colors.teal,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
  },
  acceptBtnIcon: {
    fontSize: 18,
    color: colors.deepSlate,
    fontWeight: 'bold',
  },
  acceptBtnText: {
    color: colors.deepSlate,
    fontSize: 15,
    fontWeight: '700',
  },
});
