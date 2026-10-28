/**
 * MockCamera — Image capture/selection component.
 *
 * Preserves all original functionality:
 *  • expo-image-picker camera launch (system dialog)
 *  • expo-image-picker gallery selection
 *  • Bundled sample-photo quick-picks
 *  • Permission-denied fallback chain
 *
 * Updated to use civic design tokens and improved layout.
 */
import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radii } from '../theme/colors';
import CameraModal from './CameraModal';
import { extractExifCoordinates } from '../utils/exif';

// Local sample photos — actual civic issue images
const potholeImg = require('../../assets/pothole.png');
const streetlightImg = require('../../assets/streetlight.png');
const waterloggingImg = require('../../assets/waterlogging.png');

export default function MockCamera({ imageUri, onSelectPhoto, onRemovePhoto }) {
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);

  const samplePhotos = [
    { source: potholeImg, label: 'Pothole', desc: 'Road damage & cracks' },
    { source: streetlightImg, label: 'Street Light', desc: 'Broken or dark pole' },
    { source: waterloggingImg, label: 'Waterlogging', desc: 'Drainage & puddle' },
  ];

  // ─── Open real device camera via CameraModal ───
  const handleOpenCamera = () => {
    setIsCameraModalOpen(true);
  };

  // ─── Open photo gallery ───
  const handleOpenGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        exif: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uri = result.assets[0].uri;
        let exifCoords = null;
        try {
          exifCoords = await extractExifCoordinates(uri);
        } catch (e) {
          console.warn('EXIF extraction error:', e);
        }
        onSelectPhoto(uri, { source: 'gallery', exifCoords });
      }
    } catch (err) {
      console.warn('Gallery not available:', err);
    }
  };

  // ─── Select a sample photo ───
  const handleSelectSample = (photo) => {
    let uri = null;
    try {
      if (typeof Image.resolveAssetSource === 'function') {
        const asset = Image.resolveAssetSource(photo.source);
        uri = asset?.uri;
      }
    } catch {}
    if (!uri) {
      uri = photo.source?.uri || (typeof photo.source === 'string' ? photo.source : null);
    }
    if (uri) {
      onSelectPhoto(uri, { source: 'sample' });
    }
  };

  // ──────────────────────────────────────────────────────────
  //  PREVIEW STATE
  // ──────────────────────────────────────────────────────────
  if (imageUri) {
    return (
      <View style={styles.container}>
        <View style={styles.previewContainer}>
          <Image source={{ uri: imageUri }} style={styles.previewImage} />
          {/* Success overlay */}
          <View style={styles.successBadge}>
            <Text style={styles.successIcon}>✓</Text>
            <Text style={styles.successText}>Photo captured</Text>
          </View>
          {/* Action buttons */}
          <View style={styles.previewActions}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleOpenCamera}
              accessibilityRole="button"
              accessibilityLabel="Retake photo with camera"
            >
              <Text style={styles.actionIcon}>📷</Text>
              <Text style={styles.actionText}>Retake</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleOpenGallery}
              accessibilityRole="button"
              accessibilityLabel="Choose different photo from gallery"
            >
              <Text style={styles.actionIcon}>🖼️</Text>
              <Text style={styles.actionText}>Gallery</Text>
            </TouchableOpacity>
            {onRemovePhoto && (
              <TouchableOpacity
                style={[styles.actionBtn, styles.removeBtn]}
                onPress={onRemovePhoto}
                accessibilityRole="button"
                accessibilityLabel="Remove selected photo"
              >
                <Text style={styles.actionIcon}>✕</Text>
                <Text style={[styles.actionText, styles.removeText]}>Remove</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Camera Modal */}
        <CameraModal
          visible={isCameraModalOpen}
          onClose={() => setIsCameraModalOpen(false)}
          onAcceptPhoto={(uri) => {
            setIsCameraModalOpen(false);
            onSelectPhoto(uri, { source: 'camera' });
          }}
        />
      </View>
    );
  }

  // ──────────────────────────────────────────────────────────
  //  EMPTY / CAPTURE STATE
  // ──────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <View style={styles.captureContainer}>
        {/* Camera + Gallery buttons */}
        <View style={styles.captureRow}>
          <TouchableOpacity
            style={styles.captureMainBtn}
            onPress={handleOpenCamera}
            accessibilityRole="button"
            accessibilityLabel="Open camera to take a photo of a civic issue"
          >
            <View style={styles.captureIconOuter}>
              <View style={styles.captureIconInner}>
                <Text style={styles.captureIconSymbol}>📷</Text>
              </View>
            </View>
            <Text style={styles.captureBtnTitle}>Take Photo</Text>
            <Text style={styles.captureBtnSubtitle}>Use your camera</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.captureSecondaryBtn}
            onPress={handleOpenGallery}
            accessibilityRole="button"
            accessibilityLabel="Choose a photo from your gallery"
          >
            <View style={styles.galleryIconOuter}>
              <Text style={styles.galleryIconSymbol}>🖼️</Text>
            </View>
            <Text style={styles.captureBtnTitle}>Gallery</Text>
            <Text style={styles.captureBtnSubtitle}>Choose existing</Text>
          </TouchableOpacity>
        </View>

        {/* Description */}
        <View style={styles.captureDescRow}>
          <Text style={styles.captureDesc}>
            Capture potholes, waterlogging, broken streetlights, or damaged infrastructure
          </Text>
        </View>

        {/* Informational Example Issues (Non-clickable guidance) */}
        <View style={styles.samplesSection}>
          <Text style={styles.samplesLabel}>Common Civic Issues (Examples)</Text>
          <View style={styles.samplesRow}>
            {samplePhotos.map((photo, idx) => (
              <View
                key={idx}
                style={styles.sampleThumb}
                accessibilityRole="none"
                accessible={true}
                accessibilityLabel={`Example civic issue: ${photo.label}. ${photo.desc}`}
              >
                <Image source={photo.source} style={styles.sampleImage} />
                <View style={styles.sampleInfoCol}>
                  <Text style={styles.sampleLabel}>{photo.label}</Text>
                  <Text style={styles.sampleDesc} numberOfLines={2}>{photo.desc}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* Camera Modal */}
      <CameraModal
        visible={isCameraModalOpen}
        onClose={() => setIsCameraModalOpen(false)}
        onAcceptPhoto={(uri) => {
          setIsCameraModalOpen(false);
          onSelectPhoto(uri, { source: 'camera' });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginBottom: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },

  /* ─── Capture State ─── */
  captureContainer: {
    backgroundColor: colors.cardBg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    overflow: 'hidden',
  },
  captureRow: {
    flexDirection: 'row',
    padding: spacing.base,
    gap: spacing.md,
  },
  captureMainBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    backgroundColor: colors.tealMuted,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.tealBorder,
    borderStyle: 'dashed',
    minHeight: 48,
  },
  captureSecondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    backgroundColor: colors.whiteAlpha04,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
  },
  captureIconOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.tealMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 2,
    borderColor: colors.tealBorder,
  },
  captureIconInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(72, 202, 228, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureIconSymbol: { fontSize: 20 },
  galleryIconOuter: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.whiteAlpha04,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  galleryIconSymbol: { fontSize: 22 },
  captureBtnTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  captureBtnSubtitle: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  captureDescRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 14,
  },
  captureDesc: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  /* ─── Sample Photos ─── */
  samplesSection: {
    paddingHorizontal: spacing.base,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  samplesLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  samplesRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  sampleThumb: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.whiteAlpha04,
    borderRadius: radii.sm,
    paddingBottom: spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  sampleImage: {
    width: '100%',
    height: 64,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    resizeMode: 'cover',
  },
  sampleInfoCol: {
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 2,
  },
  sampleLabel: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  sampleDesc: {
    color: colors.textMuted,
    fontSize: 9,
    textAlign: 'center',
    lineHeight: 12,
  },

  /* ─── Preview State ─── */
  previewContainer: {
    width: '100%',
    height: 260,
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  successBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(46, 196, 182, 0.9)',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
  },
  successIcon: {
    color: colors.white,
    fontSize: 12,
    fontWeight: 'bold',
  },
  successText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  previewActions: {
    position: 'absolute',
    bottom: 14,
    right: 14,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(11, 19, 43, 0.9)',
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    minHeight: 44,
  },
  removeBtn: {
    borderColor: 'rgba(230, 57, 70, 0.4)',
  },
  actionIcon: { fontSize: 13 },
  actionText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '700',
  },
  removeText: {
    color: colors.critical,
  },
});
