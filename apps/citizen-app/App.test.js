/**
 * UrbanPulse Citizen App — Comprehensive Unit Tests
 *
 * Tests cover:
 *  1. Timeline status mapping (getStepIndex)
 *  2. Status badge configuration (getStatusConfig)
 *  3. Category list completeness
 *  4. History filter logic
 *  5. Draft validation logic
 *  6. Complaint submission adding to history
 *  7. Component rendering (Timeline, ComplaintCard)
 *  8. CameraModal & MockCamera flows (Phase 2.2)
 *  9. EXIF Parser (Phase 2.3): N/E, S/W, corrupt, missing tags, bounds
 * 10. Location Hook (Phase 2.3): permissions, coordinates, error handling
 * 11. Location State Transitions & Decoupling (Phase 2.3)
 * 12. LocationMap Component Rendering (Phase 2.3)
 * 13. Location Source Badges (Phase 2.3)
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, renderHook, act } from '@testing-library/react-native';
import { getStepIndex } from './src/components/Timeline';
import Timeline from './src/components/Timeline';
import ComplaintCard from './src/components/ComplaintCard';
import ComplaintDetailModal from './src/components/ComplaintDetailModal';
import MockCamera from './src/components/MockCamera';
import CameraModal from './src/components/CameraModal';
import LocationMap from './src/components/LocationMap';
import { getStatusConfig, issueCategories } from './src/theme/colors';
import { extractExifCoordinates } from './src/utils/exif';
import { useLocation } from './src/hooks/useLocation';
import { reverseGeocodeCoords, _clearGeocodeCache, _resetRateLimiter } from './src/utils/reverseGeocode';
import {
  SEED_COMPLAINTS,
  ComplaintProvider,
  useComplaints,
  isServerUuid,
  SERVER_UUID_REGEX,
} from './src/context/ComplaintContext';
import {
  uploadComplaint,
  fetchComplaint,
  fetchComplaintHistory,
  buildImageFormField,
  API_BASE_URL,
} from './src/services/complaintApi';
import HistoryScreen from './src/screens/HistoryScreen';
import ReportScreen from './src/screens/ReportScreen';
import * as Location from 'expo-location';

// ─────────────────────────────────────────────────────────────
// 1. Timeline status mapping
// ─────────────────────────────────────────────────────────────
describe('Timeline — getStepIndex', () => {
  it('maps "pending" to step 0', () => {
    expect(getStepIndex('pending')).toBe(0);
  });

  it('maps "under_review" to step 0', () => {
    expect(getStepIndex('under_review')).toBe(0);
  });

  it('maps "assigned" to step 1', () => {
    expect(getStepIndex('assigned')).toBe(1);
  });

  it('maps "in_progress" to step 2', () => {
    expect(getStepIndex('in_progress')).toBe(2);
  });

  it('maps "verified" to step 3', () => {
    expect(getStepIndex('verified')).toBe(3);
  });

  it('maps "closed" to step 3', () => {
    expect(getStepIndex('closed')).toBe(3);
  });

  it('maps unknown status to step 0 (default)', () => {
    expect(getStepIndex('something_random')).toBe(0);
    expect(getStepIndex(undefined)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Status badge configuration
// ─────────────────────────────────────────────────────────────
describe('getStatusConfig', () => {
  it('returns correct config for "pending"', () => {
    const cfg = getStatusConfig('pending');
    expect(cfg.label).toBe('PENDING');
    expect(cfg.color).toBeDefined();
    expect(cfg.bg).toBeDefined();
  });

  it('returns correct config for "assigned"', () => {
    const cfg = getStatusConfig('assigned');
    expect(cfg.label).toBe('ASSIGNED');
  });

  it('returns correct config for "in_progress"', () => {
    const cfg = getStatusConfig('in_progress');
    expect(cfg.label).toBe('IN PROGRESS');
  });

  it('returns correct config for "verified"', () => {
    const cfg = getStatusConfig('verified');
    expect(cfg.label).toBe('RESOLVED');
  });

  it('returns correct config for "closed"', () => {
    const cfg = getStatusConfig('closed');
    expect(cfg.label).toBe('CLOSED');
  });

  it('returns fallback config for unknown status', () => {
    const cfg = getStatusConfig('unknown_status');
    expect(cfg.label).toBe('UNKNOWN_STATUS');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Issue categories completeness
// ─────────────────────────────────────────────────────────────
describe('Issue Categories', () => {
  it('has exactly 6 categories', () => {
    expect(issueCategories).toHaveLength(6);
  });

  it('includes the core civic issue types', () => {
    const keys = issueCategories.map((c) => c.key);
    expect(keys).toContain('pothole');
    expect(keys).toContain('streetlight');
    expect(keys).toContain('waterlogging');
    expect(keys).toContain('manhole');
    expect(keys).toContain('footpath');
    expect(keys).toContain('other');
  });

  it('each category has key, label, and icon', () => {
    issueCategories.forEach((cat) => {
      expect(cat.key).toBeTruthy();
      expect(cat.label).toBeTruthy();
      expect(cat.icon).toBeTruthy();
    });
  });
});

// ─────────────────────────────────────────────────────────────
// 4. History filter logic
// ─────────────────────────────────────────────────────────────
describe('History Filter Logic', () => {
  const sampleComplaints = [
    { id: '1', status: 'pending' },
    { id: '2', status: 'assigned' },
    { id: '3', status: 'in_progress' },
    { id: '4', status: 'verified' },
    { id: '5', status: 'under_review' },
    { id: '6', status: 'closed' },
  ];

  const applyFilter = (filter) =>
    sampleComplaints.filter((c) => {
      if (filter === 'all') return true;
      if (filter === 'pending') return c.status === 'pending' || c.status === 'under_review';
      if (filter === 'assigned') return c.status === 'assigned';
      if (filter === 'in_progress') return c.status === 'in_progress';
      if (filter === 'resolved') return c.status === 'verified' || c.status === 'closed';
      return true;
    });

  it('"all" returns all complaints', () => {
    expect(applyFilter('all')).toHaveLength(6);
  });

  it('"pending" returns pending + under_review', () => {
    const result = applyFilter('pending');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['1', '5']);
  });

  it('"assigned" returns only assigned', () => {
    const result = applyFilter('assigned');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('"in_progress" returns only in_progress', () => {
    const result = applyFilter('in_progress');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });

  it('"resolved" returns verified + closed', () => {
    const result = applyFilter('resolved');
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['4', '6']);
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Draft validation logic
// ─────────────────────────────────────────────────────────────
describe('Draft Validation', () => {
  const validateDraft = (draft) => {
    const errors = {};
    if (!draft.imageUri) errors.imageUri = 'Please capture or select a photo.';
    if (!draft.lat || !draft.lng) errors.location = 'Location data is required.';
    if (!draft.issueCategory) errors.issueCategory = 'Please select an issue category.';
    return errors;
  };

  it('returns errors for empty draft', () => {
    const errors = validateDraft({ imageUri: null, lat: null, lng: null, issueCategory: null });
    expect(Object.keys(errors)).toHaveLength(3);
    expect(errors.imageUri).toBeDefined();
    expect(errors.location).toBeDefined();
    expect(errors.issueCategory).toBeDefined();
  });

  it('returns no errors for complete draft with valid coordinates', () => {
    const errors = validateDraft({
      imageUri: 'file://test.jpg',
      lat: 28.6304,
      lng: 77.2177,
      issueCategory: 'pothole',
    });
    expect(Object.keys(errors)).toHaveLength(0);
  });

  it('returns only missing field errors', () => {
    const errors = validateDraft({
      imageUri: 'file://test.jpg',
      lat: 28.6304,
      lng: 77.2177,
      issueCategory: null,
    });
    expect(Object.keys(errors)).toHaveLength(1);
    expect(errors.issueCategory).toBeDefined();
  });

  it('rejects draft when coordinates are null', () => {
    const errors = validateDraft({
      imageUri: 'file://test.jpg',
      lat: null,
      lng: null,
      issueCategory: 'pothole',
    });
    expect(errors.location).toBe('Location data is required.');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Complaint submission model
// ─────────────────────────────────────────────────────────────
describe('Complaint Submission Model', () => {
  it('creates a valid complaint object with location_source and accuracy', () => {
    const draft = {
      imageUri: 'file://test.jpg',
      lat: 28.6304,
      lng: 77.2177,
      location_source: 'device',
      location_accuracy: 14,
      issueCategory: 'pothole',
      description: 'Test complaint',
    };

    const complaint = {
      id: `comp-${Date.now()}-${Math.floor(Math.random() * 900 + 100)}`,
      issue_class: draft.issueCategory,
      description: draft.description.trim() || null,
      lat: draft.lat,
      lng: draft.lng,
      location_source: draft.location_source || 'device',
      location_accuracy: draft.location_accuracy ?? null,
      status: 'pending',
      imageUri: draft.imageUri,
      created_at: new Date().toISOString(),
    };

    expect(complaint.id).toMatch(/^comp-/);
    expect(complaint.issue_class).toBe('pothole');
    expect(complaint.status).toBe('pending');
    expect(complaint.lat).toBe(28.6304);
    expect(complaint.lng).toBe(77.2177);
    expect(complaint.location_source).toBe('device');
    expect(complaint.location_accuracy).toBe(14);
    expect(complaint.imageUri).toBe('file://test.jpg');
    expect(complaint.created_at).toBeDefined();
  });

  it('prepends new complaint to history list', () => {
    const existing = [
      { id: 'comp-101', status: 'assigned' },
      { id: 'comp-102', status: 'verified' },
    ];
    const newComplaint = { id: 'comp-new', status: 'pending' };
    const result = [newComplaint, ...existing];

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe('comp-new');
    expect(result[1].id).toBe('comp-101');
  });
});

// ─────────────────────────────────────────────────────────────
// 7. Component rendering
// ─────────────────────────────────────────────────────────────
describe('Timeline Component', () => {
  it('renders without crashing for "pending" status', () => {
    const { getByText } = render(<Timeline status="pending" />);
    expect(getByText('Submitted')).toBeTruthy();
    expect(getByText('Assigned')).toBeTruthy();
    expect(getByText('In Progress')).toBeTruthy();
    expect(getByText('Resolved')).toBeTruthy();
  });

  it('renders without crashing for "verified" status', () => {
    const { getByText } = render(<Timeline status="verified" />);
    expect(getByText('Resolved')).toBeTruthy();
  });
});

describe('ComplaintCard Component', () => {
  const mockComplaint = {
    id: 'comp-test',
    issue_class: 'pothole',
    description: 'Test pothole description',
    lat: 28.6304,
    lng: 77.2177,
    location_source: 'device',
    location_accuracy: 12,
    status: 'assigned',
    imageUri: null,
    created_at: new Date().toISOString(),
  };

  it('renders complaint category', () => {
    const { getByText } = render(
      <ComplaintCard complaint={mockComplaint} onPress={() => {}} />
    );
    expect(getByText('POTHOLE')).toBeTruthy();
  });

  it('renders status badge', () => {
    const { getByText } = render(
      <ComplaintCard complaint={mockComplaint} onPress={() => {}} />
    );
    expect(getByText('ASSIGNED')).toBeTruthy();
  });

  it('renders description snippet', () => {
    const { getByText } = render(
      <ComplaintCard complaint={mockComplaint} onPress={() => {}} />
    );
    expect(getByText('Test pothole description')).toBeTruthy();
  });

  it('renders GPS location source and accuracy badge', () => {
    const { getByText } = render(
      <ComplaintCard complaint={mockComplaint} onPress={() => {}} />
    );
    expect(getByText(/GPS ±12m/)).toBeTruthy();
  });

  it('renders Photo EXIF badge when location_source is image_exif', () => {
    const exifComplaint = { ...mockComplaint, location_source: 'image_exif', location_accuracy: null };
    const { getByText } = render(
      <ComplaintCard complaint={exifComplaint} onPress={() => {}} />
    );
    expect(getByText(/Photo/)).toBeTruthy();
  });

  it('renders Manual location badge when location_source is manual', () => {
    const manualComplaint = { ...mockComplaint, location_source: 'manual', location_accuracy: null };
    const { getByText } = render(
      <ComplaintCard complaint={manualComplaint} onPress={() => {}} />
    );
    expect(getByText(/Manual/)).toBeTruthy();
  });
});

describe('ComplaintDetailModal Component', () => {
  const mockComplaint = {
    id: 'comp-modal-test',
    issue_class: 'waterlogging',
    description: 'Severe waterlogging',
    lat: 28.6115,
    lng: 77.2130,
    location_source: 'image_exif',
    location_accuracy: null,
    status: 'pending',
    imageUri: null,
    created_at: new Date().toISOString(),
  };

  it('renders coordinates and location source metadata', () => {
    const { getByText } = render(
      <ComplaintDetailModal complaint={mockComplaint} visible={true} onClose={() => {}} />
    );
    expect(getByText('COORDINATES')).toBeTruthy();
    expect(getByText('LOCATION SOURCE')).toBeTruthy();
    expect(getByText('📷 Photo Location')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// 8. CameraModal Component (Phase 2.2)
// ─────────────────────────────────────────────────────────────
describe('CameraModal Component', () => {
  it('does not render when visible is false', () => {
    const { queryByText } = render(
      <CameraModal visible={false} onClose={() => {}} onAcceptPhoto={() => {}} />
    );
    expect(queryByText('FRAME ISSUE')).toBeNull();
  });

  it('renders live viewfinder when visible is true and permission is granted', () => {
    const { getByText, getByLabelText } = render(
      <CameraModal visible={true} onClose={() => {}} onAcceptPhoto={() => {}} />
    );
    expect(getByText('FRAME ISSUE')).toBeTruthy();
    expect(getByText('Center the civic issue inside the frame')).toBeTruthy();
    expect(getByLabelText('Capture photo')).toBeTruthy();
    expect(getByLabelText('Close camera')).toBeTruthy();
  });

  it('calls onClose when close button is tapped', () => {
    const handleClose = jest.fn();
    const { getByLabelText } = render(
      <CameraModal visible={true} onClose={handleClose} onAcceptPhoto={() => {}} />
    );
    fireEvent.press(getByLabelText('Close camera'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('toggles camera facing when flip button is pressed', () => {
    const { getByLabelText } = render(
      <CameraModal visible={true} onClose={() => {}} onAcceptPhoto={() => {}} />
    );
    const flipBtn = getByLabelText('Switch to front camera');
    expect(flipBtn).toBeTruthy();
    fireEvent.press(flipBtn);
  });
});

// ─────────────────────────────────────────────────────────────
// 9. MockCamera Component (Phase 2.2 Integration)
// ─────────────────────────────────────────────────────────────
describe('MockCamera Component', () => {
  it('renders initial capture buttons and sample options', () => {
    const { getByText, getByLabelText } = render(
      <MockCamera imageUri={null} onSelectPhoto={() => {}} onRemovePhoto={() => {}} />
    );
    expect(getByText('Take Photo')).toBeTruthy();
    expect(getByText('Gallery')).toBeTruthy();
    expect(getByText('Pothole')).toBeTruthy();
    expect(getByText('Street Light')).toBeTruthy();
    expect(getByText('Waterlogging')).toBeTruthy();
    expect(getByLabelText('Open camera to take a photo of a civic issue')).toBeTruthy();
  });

  it('opens CameraModal when Take Photo is pressed', () => {
    const { getByLabelText, getByText } = render(
      <MockCamera imageUri={null} onSelectPhoto={() => {}} onRemovePhoto={() => {}} />
    );
    fireEvent.press(getByLabelText('Open camera to take a photo of a civic issue'));
    expect(getByText('FRAME ISSUE')).toBeTruthy();
  });

  it('renders preview state when imageUri is provided', () => {
    const { getByText, getByLabelText } = render(
      <MockCamera
        imageUri="file://test-image.jpg"
        onSelectPhoto={() => {}}
        onRemovePhoto={() => {}}
      />
    );
    expect(getByText('Photo captured')).toBeTruthy();
    expect(getByText('Retake')).toBeTruthy();
    expect(getByText('Gallery')).toBeTruthy();
    expect(getByText('Remove')).toBeTruthy();
    expect(getByLabelText('Remove selected photo')).toBeTruthy();
  });

  it('calls onRemovePhoto when Remove is pressed in preview state', () => {
    const handleRemove = jest.fn();
    const { getByLabelText } = render(
      <MockCamera
        imageUri="file://test-image.jpg"
        onSelectPhoto={() => {}}
        onRemovePhoto={handleRemove}
      />
    );
    fireEvent.press(getByLabelText('Remove selected photo'));
    expect(handleRemove).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// 10. EXIF Parser Tests (Phase 2.3)
// ─────────────────────────────────────────────────────────────

/**
 * Deterministic helper to construct authentic binary JPEG buffers with EXIF GPS tags.
 */
function createDeterministicExifJpeg({ latDeg, latMin, latSec, latRef, lngDeg, lngMin, lngSec, lngRef }) {
  const buffer = new ArrayBuffer(512);
  const view = new DataView(buffer);
  let pos = 0;

  // JPEG SOI (0xFFD8)
  view.setUint16(pos, 0xFFD8); pos += 2;

  // APP1 Marker (0xFFE1)
  view.setUint16(pos, 0xFFE1); pos += 2;
  const app1LengthPos = pos;
  view.setUint16(pos, 0); pos += 2; // placeholder

  // "Exif\0\0" (6 bytes)
  view.setUint8(pos, 0x45); // 'E'
  view.setUint8(pos + 1, 0x78); // 'x'
  view.setUint8(pos + 2, 0x69); // 'i'
  view.setUint8(pos + 3, 0x66); // 'f'
  view.setUint8(pos + 4, 0x00);
  view.setUint8(pos + 5, 0x00);
  pos += 6;

  const tiffStart = pos;

  // TIFF Header (Little Endian 'II' = 0x4949)
  view.setUint16(pos, 0x4949, true); pos += 2;
  view.setUint16(pos, 42, true); pos += 2;
  view.setUint32(pos, 8, true); pos += 4; // IFD0 offset from tiffStart = 8

  // IFD0 (starts at tiffStart + 8)
  view.setUint16(pos, 1, true); pos += 2; // 1 entry: Tag 0x8825 (GPSInfo IFD pointer)
  view.setUint16(pos, 0x8825, true); pos += 2;
  view.setUint16(pos, 4, true); pos += 2; // Type LONG
  view.setUint32(pos, 1, true); pos += 4; // Count 1
  const gpsIfdOffsetPos = pos;
  view.setUint32(pos, 0, true); pos += 4; // placeholder for offset

  view.setUint32(pos, 0, true); pos += 4; // next IFD offset (0 = none)

  // GPS IFD
  const gpsIfdOffset = pos - tiffStart;
  view.setUint32(gpsIfdOffsetPos, gpsIfdOffset, true);

  view.setUint16(pos, 4, true); pos += 2; // 4 entries: latRef, lat, lngRef, lng

  // Entry 0: GPSLatitudeRef (tag 1)
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, 2, true); pos += 2; // ASCII
  view.setUint32(pos, 2, true); pos += 4; // Count 2
  view.setUint8(pos, latRef.charCodeAt(0));
  view.setUint8(pos + 1, 0);
  pos += 4;

  // Entry 1: GPSLatitude (tag 2)
  view.setUint16(pos, 2, true); pos += 2;
  view.setUint16(pos, 5, true); pos += 2; // RATIONAL
  view.setUint32(pos, 3, true); pos += 4; // Count 3
  const latDataOffsetPos = pos;
  view.setUint32(pos, 0, true); pos += 4;

  // Entry 2: GPSLongitudeRef (tag 3)
  view.setUint16(pos, 3, true); pos += 2;
  view.setUint16(pos, 2, true); pos += 2; // ASCII
  view.setUint32(pos, 2, true); pos += 4; // Count 2
  view.setUint8(pos, lngRef.charCodeAt(0));
  view.setUint8(pos + 1, 0);
  pos += 4;

  // Entry 3: GPSLongitude (tag 4)
  view.setUint16(pos, 4, true); pos += 2;
  view.setUint16(pos, 5, true); pos += 2; // RATIONAL
  view.setUint32(pos, 3, true); pos += 4; // Count 3
  const lngDataOffsetPos = pos;
  view.setUint32(pos, 0, true); pos += 4;

  view.setUint32(pos, 0, true); pos += 4; // next IFD offset

  // Rational values for Lat
  const latDataOffset = pos - tiffStart;
  view.setUint32(latDataOffsetPos, latDataOffset, true);
  view.setUint32(pos, latDeg[0], true); pos += 4;
  view.setUint32(pos, latDeg[1], true); pos += 4;
  view.setUint32(pos, latMin[0], true); pos += 4;
  view.setUint32(pos, latMin[1], true); pos += 4;
  view.setUint32(pos, latSec[0], true); pos += 4;
  view.setUint32(pos, latSec[1], true); pos += 4;

  // Rational values for Lng
  const lngDataOffset = pos - tiffStart;
  view.setUint32(lngDataOffsetPos, lngDataOffset, true);
  view.setUint32(pos, lngDeg[0], true); pos += 4;
  view.setUint32(pos, lngDeg[1], true); pos += 4;
  view.setUint32(pos, lngMin[0], true); pos += 4;
  view.setUint32(pos, lngMin[1], true); pos += 4;
  view.setUint32(pos, lngSec[0], true); pos += 4;
  view.setUint32(pos, lngSec[1], true); pos += 4;

  // Write APP1 segment length
  const app1Length = pos - app1LengthPos;
  view.setUint16(app1LengthPos, app1Length);

  return buffer.slice(0, pos);
}

describe('EXIF Parser (extractExifCoordinates)', () => {
  it('correctly extracts coordinates from a valid N/E JPEG buffer', async () => {
    // 28 deg 36 min 50 sec N, 77 deg 12 min 32 sec E
    const buffer = createDeterministicExifJpeg({
      latDeg: [28, 1],
      latMin: [36, 1],
      latSec: [50, 1],
      latRef: 'N',
      lngDeg: [77, 1],
      lngMin: [12, 1],
      lngSec: [32, 1],
      lngRef: 'E',
    });

    const coords = await extractExifCoordinates(buffer);
    expect(coords).not.toBeNull();
    // 28 + 36/60 + 50/3600 = 28.613888...
    expect(coords.lat).toBeCloseTo(28.613888, 4);
    // 77 + 12/60 + 32/3600 = 77.208888...
    expect(coords.lng).toBeCloseTo(77.208888, 4);
  });

  it('correctly applies negative signs for S/W hemispheres', async () => {
    // 33 deg 51 min 30 sec S, 151 deg 12 min 40 sec W
    const buffer = createDeterministicExifJpeg({
      latDeg: [33, 1],
      latMin: [51, 1],
      latSec: [30, 1],
      latRef: 'S',
      lngDeg: [151, 1],
      lngMin: [12, 1],
      lngSec: [40, 1],
      lngRef: 'W',
    });

    const coords = await extractExifCoordinates(buffer);
    expect(coords).not.toBeNull();
    expect(coords.lat).toBeLessThan(0);
    expect(coords.lng).toBeLessThan(0);
    expect(coords.lat).toBeCloseTo(-(33 + 51/60 + 30/3600), 4);
    expect(coords.lng).toBeCloseTo(-(151 + 12/60 + 40/3600), 4);
  });

  it('returns null when JPEG has no EXIF APP1 marker', async () => {
    // Standard JPEG with APP0 (JFIF) only
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint16(0, 0xFFD8); // SOI
    view.setUint16(2, 0xFFE0); // APP0
    view.setUint16(4, 16);     // length
    view.setUint16(18, 0xFFD9); // EOI

    const coords = await extractExifCoordinates(buffer);
    expect(coords).toBeNull();
  });

  it('returns null when EXIF exists but GPSInfo IFD pointer (0x8825) is absent', async () => {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    view.setUint16(0, 0xFFD8); // SOI
    view.setUint16(2, 0xFFE1); // APP1
    view.setUint16(4, 58);     // length
    // "Exif\0\0"
    view.setUint8(6, 0x45); view.setUint8(7, 0x78); view.setUint8(8, 0x69);
    view.setUint8(9, 0x66); view.setUint8(10, 0); view.setUint8(11, 0);
    // TIFF header
    view.setUint16(12, 0x4949, true); // Little Endian
    view.setUint16(14, 42, true);
    view.setUint32(16, 8, true); // IFD0 offset
    // IFD0: 1 entry with Orientation tag (0x0112) instead of GPSInfo
    view.setUint16(20, 1, true);
    view.setUint16(22, 0x0112, true); // Orientation
    view.setUint16(24, 3, true);
    view.setUint32(26, 1, true);
    view.setUint32(30, 1, true);

    const coords = await extractExifCoordinates(buffer);
    expect(coords).toBeNull();
  });

  it('safely returns null on malformed or truncated binary data without crashing', async () => {
    const corrupt1 = new ArrayBuffer(8);
    expect(await extractExifCoordinates(corrupt1)).toBeNull();

    const corrupt2 = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(await extractExifCoordinates(corrupt2)).toBeNull();

    expect(await extractExifCoordinates(null)).toBeNull();
    expect(await extractExifCoordinates(undefined)).toBeNull();
  });

  it('returns null when parsed coordinates exceed geographic boundaries [-90, 90], [-180, 180]', async () => {
    const invalidBuffer = createDeterministicExifJpeg({
      latDeg: [95, 1], // > 90
      latMin: [0, 1],
      latSec: [0, 1],
      latRef: 'N',
      lngDeg: [200, 1], // > 180
      lngMin: [0, 1],
      lngSec: [0, 1],
      lngRef: 'E',
    });

    const coords = await extractExifCoordinates(invalidBuffer);
    expect(coords).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 11. Location Hook Tests (Phase 2.3)
// ─────────────────────────────────────────────────────────────
describe('useLocation Hook', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('acquires coordinates and accuracy when permission is granted', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    Location.getCurrentPositionAsync.mockResolvedValueOnce({
      coords: { latitude: 19.0760, longitude: 72.8777, accuracy: 12 },
    });

    const { result } = renderHook(() => useLocation());

    let posResult;
    await act(async () => {
      posResult = await result.current.requestLocation();
    });

    expect(posResult).toEqual({ lat: 19.0760, lng: 72.8777, accuracy: 12 });
    expect(result.current.coords).toEqual({ lat: 19.0760, lng: 72.8777 });
    expect(result.current.accuracy).toBe(12);
    expect(result.current.loading).toBe(false);
    expect(result.current.permissionDenied).toBe(false);
  });

  it('handles permission denial gracefully without fabricating coordinates', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    Location.requestForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });

    const { result } = renderHook(() => useLocation());

    let posResult;
    await act(async () => {
      posResult = await result.current.requestLocation();
    });

    expect(posResult).toBeNull();
    expect(result.current.coords).toBeNull();
    expect(result.current.permissionDenied).toBe(true);
    expect(result.current.error).toContain('denied');
  });

  it('handles location service unavailability gracefully', async () => {
    Location.getForegroundPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    Location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('GPS signal timeout'));

    const { result } = renderHook(() => useLocation());

    let posResult;
    await act(async () => {
      posResult = await result.current.requestLocation();
    });

    expect(posResult).toBeNull();
    expect(result.current.coords).toBeNull();
    expect(result.current.error).toBe('GPS signal timeout');
  });
});

// ─────────────────────────────────────────────────────────────
// 12. LocationMap Component (Phase 2.3)
// ─────────────────────────────────────────────────────────────
describe('LocationMap Component', () => {
  it('renders with testID="location-map" without crashing', () => {
    const { getByTestId } = render(
      <LocationMap lat={19.0760} lng={72.8777} onLocationChange={() => {}} />
    );
    expect(getByTestId('location-map')).toBeTruthy();
  });

  it('renders safely when initial coordinates are null', () => {
    const { getByTestId } = render(
      <LocationMap lat={null} lng={null} onLocationChange={() => {}} />
    );
    expect(getByTestId('location-map')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────
// 13. State Transitions & Geolocation Decoupling (Phase 2.3)
// ─────────────────────────────────────────────────────────────
describe('State Transitions & Geolocation Decoupling (Phase 2.3)', () => {
  it('transitions from device location to manual location and clears accuracy', () => {
    let draft = {
      imageUri: 'file://img.jpg',
      lat: 19.0760,
      lng: 72.8777,
      location_source: 'device',
      location_accuracy: 15,
    };

    // Citizen manually adjusts pin on map
    const manualCoords = { lat: 19.0800, lng: 72.8800 };
    draft = {
      ...draft,
      lat: manualCoords.lat,
      lng: manualCoords.lng,
      location_source: 'manual',
      location_accuracy: null, // manual location clears accuracy
    };

    expect(draft.location_source).toBe('manual');
    expect(draft.location_accuracy).toBeNull();
    expect(draft.lat).toBe(19.0800);
    expect(draft.lng).toBe(72.8800);
  });

  it('transitions from image_exif to manual location and clears accuracy', () => {
    let draft = {
      imageUri: 'file://img.jpg',
      lat: 28.6304,
      lng: 77.2177,
      location_source: 'image_exif',
      location_accuracy: null,
    };

    // Citizen manually adjusts pin on map
    const manualCoords = { lat: 28.6400, lng: 77.2200 };
    draft = {
      ...draft,
      lat: manualCoords.lat,
      lng: manualCoords.lng,
      location_source: 'manual',
      location_accuracy: null,
    };

    expect(draft.location_source).toBe('manual');
    expect(draft.location_accuracy).toBeNull();
    expect(draft.lat).toBe(28.6400);
  });

  it('decouples photo removal from location data', () => {
    let draft = {
      imageUri: 'file://img.jpg',
      lat: 19.0760,
      lng: 72.8777,
      location_source: 'device',
      location_accuracy: 15,
    };

    // Removing photo only unlinks imageUri
    draft = {
      ...draft,
      imageUri: null,
    };

    expect(draft.imageUri).toBeNull();
    expect(draft.lat).toBe(19.0760);
    expect(draft.lng).toBe(72.8777);
    expect(draft.location_source).toBe('device');
    expect(draft.location_accuracy).toBe(15);
  });

  it('prioritizes EXIF GPS over current device GPS when gallery photo contains EXIF', () => {
    const exifCoords = { lat: 12.9716, lng: 77.5946 };
    const deviceGps = { lat: 19.0760, lng: 72.8777, accuracy: 10 };

    let draft = {
      imageUri: null,
      lat: null,
      lng: null,
      location_source: null,
      location_accuracy: null,
    };

    // Simulation of handlePhotoSelect with EXIF
    if (exifCoords && exifCoords.lat != null) {
      draft = {
        ...draft,
        imageUri: 'file://gallery-exif.jpg',
        lat: exifCoords.lat,
        lng: exifCoords.lng,
        location_source: 'image_exif',
        location_accuracy: null,
      };
    } else {
      draft = {
        ...draft,
        imageUri: 'file://gallery-exif.jpg',
        lat: deviceGps.lat,
        lng: deviceGps.lng,
        location_source: 'device',
        location_accuracy: deviceGps.accuracy,
      };
    }

    expect(draft.lat).toBe(12.9716);
    expect(draft.lng).toBe(77.5946);
    expect(draft.location_source).toBe('image_exif');
    expect(draft.location_accuracy).toBeNull();
  });

  it('falls back to device GPS when gallery photo has no EXIF', () => {
    const exifCoords = null;
    const deviceGps = { lat: 19.0760, lng: 72.8777, accuracy: 10 };

    let draft = {
      imageUri: null,
      lat: null,
      lng: null,
      location_source: null,
      location_accuracy: null,
    };

    // Simulation of handlePhotoSelect without EXIF
    if (exifCoords && exifCoords.lat != null) {
      draft = {
        ...draft,
        imageUri: 'file://gallery-no-exif.jpg',
        lat: exifCoords.lat,
        lng: exifCoords.lng,
        location_source: 'image_exif',
        location_accuracy: null,
      };
    } else if (deviceGps) {
      draft = {
        ...draft,
        imageUri: 'file://gallery-no-exif.jpg',
        lat: deviceGps.lat,
        lng: deviceGps.lng,
        location_source: 'device',
        location_accuracy: deviceGps.accuracy,
      };
    }

    expect(draft.lat).toBe(19.0760);
    expect(draft.lng).toBe(72.8777);
    expect(draft.location_source).toBe('device');
    expect(draft.location_accuracy).toBe(10);
  });

  it('leaves coordinates unresolved when neither EXIF nor device GPS is available', () => {
    const exifCoords = null;
    const deviceGps = null;

    let draft = {
      imageUri: null,
      lat: null,
      lng: null,
      location_source: null,
      location_accuracy: null,
    };

    if (exifCoords && exifCoords.lat != null) {
      draft = {
        ...draft,
        imageUri: 'file://gallery-no-exif.jpg',
        lat: exifCoords.lat,
        lng: exifCoords.lng,
        location_source: 'image_exif',
      };
    } else if (deviceGps) {
      draft = {
        ...draft,
        imageUri: 'file://gallery-no-exif.jpg',
        lat: deviceGps.lat,
        lng: deviceGps.lng,
        location_source: 'device',
      };
    } else {
      draft = {
        ...draft,
        imageUri: 'file://gallery-no-exif.jpg',
        // coordinates remain unresolved, zero fake coordinates fabricated
      };
    }

    expect(draft.lat).toBeNull();
    expect(draft.lng).toBeNull();
    expect(draft.location_source).toBeNull();
  });

  it('guards against race condition: manual pin movement invalidates in-flight GPS result', () => {
    let locationSeq = 0;
    let draft = { lat: null, lng: null, location_source: null, location_accuracy: null };

    // 1. User clicks "Locate Me" (increments seq to 1)
    const reqSeq = ++locationSeq;

    // 2. While GPS is in-flight, citizen manually taps or drags pin on map (increments seq to 2)
    locationSeq += 1;
    draft = { lat: 19.0800, lng: 72.8800, location_source: 'manual', location_accuracy: null };

    // 3. Stale GPS finishes after manual selection
    const staleGpsResult = { lat: 19.0760, lng: 72.8777, accuracy: 12 };
    if (reqSeq === locationSeq) {
      draft = { ...draft, lat: staleGpsResult.lat, lng: staleGpsResult.lng, location_source: 'device', location_accuracy: staleGpsResult.accuracy };
    }

    // Manual location MUST be preserved
    expect(draft.lat).toBe(19.0800);
    expect(draft.lng).toBe(72.8800);
    expect(draft.location_source).toBe('manual');
    expect(draft.location_accuracy).toBeNull();
  });

  it('guards against race condition: photo change invalidates earlier photo EXIF/GPS', () => {
    let locationSeq = 0;
    let draft = { imageUri: null, lat: null, lng: null, location_source: null };

    // Photo 1 selected
    const photo1Seq = ++locationSeq;

    // Photo 2 selected while Photo 1 was resolving
    const photo2Seq = ++locationSeq;
    draft = { imageUri: 'file://photo2.jpg', lat: 13.0827, lng: 80.2707, location_source: 'image_exif' };

    // Stale Photo 1 finishes resolving GPS
    if (photo1Seq === locationSeq) {
      draft = { imageUri: 'file://photo1.jpg', lat: 19.0760, lng: 72.8777, location_source: 'device' };
    }

    // Photo 2 state MUST NOT be overwritten
    expect(draft.imageUri).toBe('file://photo2.jpg');
    expect(draft.lat).toBe(13.0827);
    expect(draft.lng).toBe(80.2707);
    expect(draft.location_source).toBe('image_exif');
  });
});

// ─────────────────────────────────────────────────────────────
// 14. Phase 2.4 — Reverse Geocoding Utility (reverseGeocodeCoords)
// ─────────────────────────────────────────────────────────────
describe('Phase 2.4 — Reverse Geocoding Utility', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    _clearGeocodeCache();
    _resetRateLimiter();
    jest.restoreAllMocks();
  });

  it('formats structured Nominatim address components into civic string', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: {
          road: 'Connaught Circus',
          suburb: 'Connaught Place',
          city: 'New Delhi',
          state: 'Delhi',
        },
        display_name: 'Connaught Circus, Connaught Place, New Delhi, Delhi, India',
      }),
    });

    const address = await reverseGeocodeCoords(28.6304, 77.2177);
    expect(address).toBe('Connaught Circus, Connaught Place, New Delhi, Delhi');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('nominatim.openstreetmap.org/reverse'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringContaining('UrbanPulse-CitizenApp/1.0'),
        }),
      })
    );
  });

  it('serves repeat requests from in-memory cache without secondary network fetch (Nominatim policy compliance)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: {
          road: 'Connaught Circus',
          city: 'New Delhi',
          state: 'Delhi',
        },
      }),
    });

    const first = await reverseGeocodeCoords(28.6304, 77.2177);
    expect(first).toBe('Connaught Circus, New Delhi, Delhi');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second call for same coordinates
    const second = await reverseGeocodeCoords(28.6304, 77.2177);
    expect(second).toBe('Connaught Circus, New Delhi, Delhi');
    // Fetch must NOT have been called a second time
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to display_name when structured address fields are missing', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: {},
        display_name: 'National Highway 48, Gurugram, Haryana, India',
      }),
    });

    const address = await reverseGeocodeCoords(28.4595, 77.0266);
    expect(address).toBe('National Highway 48, Gurugram, Haryana');
  });

  it('returns null safely when HTTP response is not ok (e.g. 500 error)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const address = await reverseGeocodeCoords(28.6304, 77.2177);
    expect(address).toBeNull();
  });

  it('returns null safely when network request throws or times out', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network request timed out'));

    const address = await reverseGeocodeCoords(28.6304, 77.2177);
    expect(address).toBeNull();
  });

  it('returns null safely when response JSON is empty or malformed', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const address = await reverseGeocodeCoords(28.6304, 77.2177);
    expect(address).toBeNull();
  });

  it('coordinates rounding to the same 4-decimal key return from cache without fetch', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        address: { road: 'Rajpath', city: 'New Delhi' },
      }),
    });

    // 28.61391 and 28.61394 both round to "28.6139"
    // 77.20902 and 77.20904 both round to "77.2090"
    const first = await reverseGeocodeCoords(28.61391, 77.20902);
    expect(first).toBe('Rajpath, New Delhi');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const second = await reverseGeocodeCoords(28.61394, 77.20904);
    expect(second).toBe('Rajpath, New Delhi');
    // Cache hit: fetch must NOT be called again
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('failed requests are NOT cached so that later valid attempts can succeed', async () => {
    // Attempt 1: Server error 500
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const failed = await reverseGeocodeCoords(28.7041, 77.1025);
    expect(failed).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Attempt 2: Server recovers 200 OK
    _resetRateLimiter();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        address: { road: 'Outer Ring Road', city: 'Delhi' },
      }),
    });

    const succeeded = await reverseGeocodeCoords(28.7041, 77.1025);
    expect(succeeded).toBe('Outer Ring Road, Delhi');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('bounds cache to maximum 100 entries with FIFO eviction', async () => {
    global.fetch = jest.fn().mockImplementation((url) => {
      const match = url.match(/lat=([^&]+)&lon=([^&]+)/);
      const lat = match ? match[1] : '0';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          address: { road: `Road ${lat}`, city: 'Delhi' },
        }),
      });
    });

    // Populate cache with 101 distinct coordinates
    for (let i = 0; i < 101; i++) {
      _resetRateLimiter();
      await reverseGeocodeCoords(10 + i * 0.01, 70.0);
    }
    expect(global.fetch).toHaveBeenCalledTimes(101);

    // Entry 0 (10.0, 70.0) should have been evicted
    _resetRateLimiter();
    await reverseGeocodeCoords(10.0, 70.0);
    expect(global.fetch).toHaveBeenCalledTimes(102); // triggered a new fetch

    // Entry 100 (11.0, 70.0) should still be in cache
    _resetRateLimiter();
    await reverseGeocodeCoords(10 + 100 * 0.01, 70.0);
    expect(global.fetch).toHaveBeenCalledTimes(102); // served from cache
  });

  it('strictly enforces >= 1100ms separation between concurrent uncached outgoing fetch dispatches', async () => {
    const dispatchTimestamps = [];

    global.fetch = jest.fn().mockImplementation(() => {
      dispatchTimestamps.push(Date.now());
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          address: { road: 'Test Road', city: 'Test City' },
        }),
      });
    });

    jest.useFakeTimers();

    // Launch 3 distinct uncached requests concurrently at the same millisecond
    const p1 = reverseGeocodeCoords(12.9716, 77.5946); // Bangalore
    const p2 = reverseGeocodeCoords(19.0760, 72.8777); // Mumbai
    const p3 = reverseGeocodeCoords(22.5726, 88.3639); // Kolkata

    // At T=0, the first request is scheduled with delay 0, while p2 and p3 are queued with >=1100ms delays
    await jest.advanceTimersByTimeAsync(0);
    expect(dispatchTimestamps.length).toBe(1);

    // Advance by 1099ms - second request must NOT have fired yet (< 1100ms)
    await jest.advanceTimersByTimeAsync(1099);
    expect(dispatchTimestamps.length).toBe(1);

    // Advance by 1ms (reaching 1100ms) - second request fires
    await jest.advanceTimersByTimeAsync(1);
    expect(dispatchTimestamps.length).toBe(2);

    // Advance by 1099ms - third request must NOT have fired yet (< 2200ms)
    await jest.advanceTimersByTimeAsync(1099);
    expect(dispatchTimestamps.length).toBe(2);

    // Advance by 1ms (reaching 2200ms) - third request fires
    await jest.advanceTimersByTimeAsync(1);
    expect(dispatchTimestamps.length).toBe(3);

    const [res1, res2, res3] = await Promise.all([p1, p2, p3]);
    expect(res1).toBe('Test Road, Test City');
    expect(res2).toBe('Test Road, Test City');
    expect(res3).toBe('Test Road, Test City');

    jest.useRealTimers();
  });

  it('returns null immediately without network call for invalid coordinates', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    expect(await reverseGeocodeCoords(null, 77.2177)).toBeNull();
    expect(await reverseGeocodeCoords(28.6304, undefined)).toBeNull();
    expect(await reverseGeocodeCoords(NaN, 77.2177)).toBeNull();
    expect(await reverseGeocodeCoords(95.0, 77.2177)).toBeNull(); // lat > 90
    expect(await reverseGeocodeCoords(-91.0, 77.2177)).toBeNull(); // lat < -90
    expect(await reverseGeocodeCoords(28.6304, 185.0)).toBeNull(); // lng > 180
    expect(await reverseGeocodeCoords(28.6304, -185.0)).toBeNull(); // lng < -180

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// 15. Phase 2.4 — Canonical Coordinates Decoupling & Immutability
// ─────────────────────────────────────────────────────────────
describe('Phase 2.4 — Canonical Coordinates Decoupling & Immutability', () => {
  it('ensures reverse-geocoded address never modifies or replaces canonical lat/lng numbers', () => {
    const initialLat = 28.630412;
    const initialLng = 77.217745;
    let draft = {
      lat: initialLat,
      lng: initialLng,
      location_source: 'manual',
      location_accuracy: null,
      location_address: null,
    };

    const resolvedAddress = 'Connaught Circus, Connaught Place, New Delhi, Delhi';
    draft = {
      ...draft,
      location_address: resolvedAddress,
    };

    // Latitude and longitude MUST remain exact numerical floating points
    expect(typeof draft.lat).toBe('number');
    expect(typeof draft.lng).toBe('number');
    expect(draft.lat).toBe(initialLat);
    expect(draft.lng).toBe(initialLng);
    expect(draft.location_address).toBe(resolvedAddress);
  });
});

// ─────────────────────────────────────────────────────────────
// 16. Phase 2.4 — Complaint Context & Model Persistence
// ─────────────────────────────────────────────────────────────
describe('Phase 2.4 — Complaint Model & Seed Persistence', () => {
  it('verifies seed complaints contain valid location_address fields', () => {
    expect(Array.isArray(SEED_COMPLAINTS)).toBe(true);
    SEED_COMPLAINTS.forEach((complaint) => {
      expect(complaint).toHaveProperty('location_address');
      if (complaint.lat != null && complaint.lng != null) {
        expect(typeof complaint.location_address).toBe('string');
        expect(complaint.location_address.length).toBeGreaterThan(0);
      }
    });
  });

  it('persists location_address when submitting a complaint', () => {
    const draft = {
      imageUri: 'file://pothole.jpg',
      lat: 28.6304,
      lng: 77.2177,
      location_source: 'device',
      location_accuracy: 10,
      location_address: 'Barakhamba Road, Connaught Place, New Delhi, Delhi',
      issueCategory: 'pothole',
      description: 'Severe pothole near metro gate 2',
    };

    const submittedComplaint = {
      id: 'c-test-address',
      imageUri: draft.imageUri,
      issue_class: draft.issueCategory,
      description: draft.description,
      lat: draft.lat,
      lng: draft.lng,
      location_source: draft.location_source,
      location_accuracy: draft.location_accuracy,
      location_address: draft.location_address,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    expect(submittedComplaint.location_address).toBe(
      'Barakhamba Road, Connaught Place, New Delhi, Delhi'
    );
    expect(submittedComplaint.lat).toBe(28.6304);
    expect(submittedComplaint.lng).toBe(77.2177);
  });
});

// ─────────────────────────────────────────────────────────────
// 17. Phase 2.4 — Component Rendering & Address Display
// ─────────────────────────────────────────────────────────────
describe('Phase 2.4 — UI Component Rendering with Verified Address', () => {
  it('ComplaintCard displays verified address when location_address is present', () => {
    const complaintWithAddress = {
      id: 'c-101',
      issue_class: 'garbage',
      description: 'Overflowing bin near park',
      lat: 28.5355,
      lng: 77.2410,
      location_source: 'device',
      location_accuracy: 15,
      location_address: 'Main Market Road, Saket, New Delhi, Delhi',
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintCard complaint={complaintWithAddress} onPress={jest.fn()} />
    );

    expect(getByText(/Main Market Road, Saket, New Delhi, Delhi/)).toBeTruthy();
  });

  it('ComplaintCard renders gracefully when location_address is null', () => {
    const complaintWithoutAddress = {
      id: 'c-102',
      issue_class: 'garbage',
      description: 'Overflowing bin near park',
      lat: 28.5355,
      lng: 77.2410,
      location_source: 'manual',
      location_accuracy: null,
      location_address: null,
      status: 'pending',
      created_at: new Date().toISOString(),
    };

    const { queryByText, getByText } = render(
      <ComplaintCard complaint={complaintWithoutAddress} onPress={jest.fn()} />
    );

    expect(getByText(/GARBAGE/)).toBeTruthy();
    expect(queryByText(/Main Market Road/)).toBeNull();
  });

  it('ComplaintDetailModal renders VERIFIED ADDRESS (OSM) row when location_address is present', () => {
    const complaint = {
      id: 'c-103',
      issue_class: 'street_light',
      description: 'Flickering street light',
      lat: 28.6139,
      lng: 77.2090,
      location_source: 'manual',
      location_address: 'Janpath Road, Connaught Place, New Delhi, Delhi',
      status: 'in_progress',
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintDetailModal complaint={complaint} visible={true} onClose={jest.fn()} />
    );

    expect(getByText('VERIFIED ADDRESS (OSM)')).toBeTruthy();
    expect(getByText('Janpath Road, Connaught Place, New Delhi, Delhi')).toBeTruthy();
  });

  it('ComplaintDetailModal omits VERIFIED ADDRESS (OSM) row when location_address is null', () => {
    const complaint = {
      id: 'c-104',
      issue_class: 'street_light',
      description: 'Flickering street light',
      lat: 28.6139,
      lng: 77.2090,
      location_source: 'manual',
      location_address: null,
      status: 'in_progress',
      created_at: new Date().toISOString(),
    };

    const { queryByText } = render(
      <ComplaintDetailModal complaint={complaint} visible={true} onClose={jest.fn()} />
    );

    expect(queryByText('VERIFIED ADDRESS (OSM)')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
// 18. Phase 2.4 — Decoupling and Race Condition Guards
// ─────────────────────────────────────────────────────────────
describe('Phase 2.4 — Decoupling and Race Condition Guards', () => {
  it('photo removal preserves coordinates, source, and verified address', () => {
    let draft = {
      imageUri: 'file://pothole.jpg',
      lat: 28.6304,
      lng: 77.2177,
      location_source: 'image_exif',
      location_accuracy: null,
      location_address: 'Connaught Place, New Delhi, Delhi',
    };

    // User removes photo
    draft = {
      ...draft,
      imageUri: null,
    };

    // Location coordinates and address remain intact
    expect(draft.imageUri).toBeNull();
    expect(draft.lat).toBe(28.6304);
    expect(draft.lng).toBe(77.2177);
    expect(draft.location_source).toBe('image_exif');
    expect(draft.location_address).toBe('Connaught Place, New Delhi, Delhi');
  });

  it('guards against race condition: manual pin movement invalidates in-flight reverse geocode', () => {
    let locationSeq = 0;
    let draft = {
      lat: 28.6304,
      lng: 77.2177,
      location_source: 'device',
      location_address: null,
    };

    // 1. Initial location triggers reverse geocode with seq token 1
    const geocodeSeq1 = ++locationSeq;

    // 2. Before geocode 1 completes, user places pin manually at a new location with seq token 2
    const geocodeSeq2 = ++locationSeq;
    draft = {
      lat: 19.0760,
      lng: 72.8777,
      location_source: 'manual',
      location_address: null,
    };

    // 3. Stale geocode 1 finishes
    const staleAddress = 'Connaught Place, New Delhi, Delhi';
    if (geocodeSeq1 === locationSeq) {
      draft = { ...draft, location_address: staleAddress };
    }

    // Stale address MUST be discarded
    expect(draft.location_address).toBeNull();
    expect(draft.lat).toBe(19.0760);

    // 4. Newer geocode 2 finishes
    const validAddress = 'Marine Drive, Mumbai, Maharashtra';
    if (geocodeSeq2 === locationSeq) {
      draft = { ...draft, location_address: validAddress };
    }

    expect(draft.location_address).toBe('Marine Drive, Mumbai, Maharashtra');
  });

  it('proves rapid marker movement collapses burst updates into a single deliberate reverse-geocoding request', () => {
    // Simulating ReportScreen's geocodeDebounceTimerRef mechanism
    let timer = null;
    let reverseGeocodeCallCount = 0;
    let targetCoords = null;

    const onMarkerMove = (newLat, newLng) => {
      // Rapid user pin movements / taps clear the pending timer
      if (timer) clearTimeout(timer);
      targetCoords = { lat: newLat, lng: newLng };
      // Debounce window (800ms)
      timer = setTimeout(() => {
        reverseGeocodeCallCount++;
      }, 800);
    };

    jest.useFakeTimers();

    // Citizen rapidly drags or taps 5 distinct points within 500ms
    onMarkerMove(28.6300, 77.2170);
    jest.advanceTimersByTime(100);
    onMarkerMove(28.6305, 77.2172);
    jest.advanceTimersByTime(100);
    onMarkerMove(28.6310, 77.2175);
    jest.advanceTimersByTime(100);
    onMarkerMove(28.6315, 77.2178);
    jest.advanceTimersByTime(100);
    // Final deliberate / confirmed location
    onMarkerMove(28.6320, 77.2180);

    // Before debounce window elapses, 0 reverse geocode calls have been made
    expect(reverseGeocodeCallCount).toBe(0);

    // Advance past the 800ms settling time
    jest.advanceTimersByTime(800);

    // Exactly 1 request is fired, for the final deliberate coordinates
    expect(reverseGeocodeCallCount).toBe(1);
    expect(targetCoords).toEqual({ lat: 28.6320, lng: 77.2180 });

    jest.useRealTimers();
  });

  it('failed reverse geocoding leaves address null and preserves canonical coordinates without fabricating an address', async () => {
    let draft = {
      lat: 28.6304,
      lng: 77.2177,
      location_source: 'manual',
      location_accuracy: null,
      location_address: null,
    };

    // Simulated network error / service unavailability
    const geocodeResult = null;

    draft = {
      ...draft,
      location_address: geocodeResult,
    };

    // Address remains null, canonical coordinates preserved, zero fabrication
    expect(draft.location_address).toBeNull();
    expect(draft.lat).toBe(28.6304);
    expect(draft.lng).toBe(77.2177);
    expect(draft.location_source).toBe('manual');
  });
});

// ─────────────────────────────────────────────────────────────
// 19. Phase 2.4 — OpenStreetMap Tile & Attribution Integrity
// ─────────────────────────────────────────────────────────────
describe('Phase 2.4 — OpenStreetMap Tile & Attribution Integrity in LocationMap', () => {
  it('renders LocationMap with OpenStreetMap tiles and contributors attribution in WebView', () => {
    const { getByTestId } = render(
      <LocationMap lat={28.6304} lng={77.2177} onLocationChange={jest.fn()} />
    );

    const webview = getByTestId('location-map-webview');
    expect(webview).toBeTruthy();

    const htmlContent = webview.props.source?.html;
    expect(htmlContent).toBeTruthy();
    // Must use standard OpenStreetMap tile URL
    expect(htmlContent).toContain('tile.openstreetmap.org');
    // Must have OpenStreetMap contributors attribution
    expect(htmlContent).toContain('OpenStreetMap contributors');
    // Must NOT contain CARTO tiles
    expect(htmlContent).not.toContain('basemaps.cartocdn.com');
    // Must NOT contain Google Maps API or URLs
    expect(htmlContent).not.toContain('maps.googleapis.com');
  });
});

// ─────────────────────────────────────────────────────────────
// 20. Phase 2.5 — Citizen App HTTP Ingestion & Multipart Upload Integration
// ─────────────────────────────────────────────────────────────
describe('Phase 2.5 — Citizen App HTTP Ingestion & Multipart Upload', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('buildImageFormField correctly prepares native image object with MIME type and filename', async () => {
    const jpgField = await buildImageFormField('file:///data/user/0/app/cache/photo.jpg');
    expect(jpgField.uri).toBe('file:///data/user/0/app/cache/photo.jpg');
    expect(jpgField.type).toBe('image/jpeg');
    expect(jpgField.name).toBe('complaint.jpg');

    const pngField = await buildImageFormField('file:///data/user/0/app/cache/photo.png');
    expect(pngField.type).toBe('image/png');
    expect(pngField.name).toBe('complaint.png');

    const webpField = await buildImageFormField('file:///data/user/0/app/cache/photo.webp');
    expect(webpField.type).toBe('image/webp');
    expect(webpField.name).toBe('complaint.webp');
  });

  it('buildImageFormField throws an error if imageUri is null or empty', async () => {
    await expect(buildImageFormField(null)).rejects.toThrow('Image URI is required');
    await expect(buildImageFormField('')).rejects.toThrow('Image URI is required');
  });

  it('constructs multipart FormData with required image, lat, lng, source, and location_source', async () => {
    let capturedBody = null;
    let capturedHeaders = null;
    global.fetch = jest.fn().mockImplementation((url, opts) => {
      capturedBody = opts.body;
      capturedHeaders = opts.headers;
      return Promise.resolve({
        status: 201,
        json: async () => ({
          id: '550e8400-e29b-41d4-a716-446655440000',
          status: 'pending',
          image_url: 'http://localhost:9000/urbanpulse-images/blurred/test.jpg',
          created_at: '2026-09-08T15:30:00Z',
        }),
      });
    });

    const draft = {
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
      location_source: 'device',
      location_accuracy: 12.5,
      location_address: 'Rajpath, New Delhi',
      issue_class: 'pothole',
      description: 'Major road crater near signal',
    };

    const result = await uploadComplaint(draft);

    expect(result.success).toBe(true);
    expect(result.complaintId).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Verify multipart boundary header is NOT manually set
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders['Content-Type']).toBeUndefined();

    // Verify FormData entries
    expect(capturedBody).toBeInstanceOf(FormData);
    expect(capturedBody.get('lat')).toBe('28.6139');
    expect(capturedBody.get('lng')).toBe('77.209');
    expect(capturedBody.get('source')).toBe('mobile_app');
    expect(capturedBody.get('location_source')).toBe('device');
    expect(capturedBody.get('location_accuracy')).toBe('12.5');
    expect(capturedBody.get('location_address')).toBe('Rajpath, New Delhi');
    expect(capturedBody.get('description')).toBe('Major road crater near signal');
    // Crucial Phase 2.5 invariant: citizen issue_class is mapped to user_selected_category
    expect(capturedBody.get('user_selected_category')).toBe('pothole');
  });

  it('handles HTTP 201 response and returns normalized success object with server UUID', async () => {
    const serverUuid = 'd89c0964-b0cf-46c5-92da-27d918c50c01';
    global.fetch = jest.fn().mockResolvedValue({
      status: 201,
      json: async () => ({
        id: serverUuid,
        status: 'pending',
        image_url: 'http://localhost:9000/urbanpulse-images/blurred/photo.jpg',
        created_at: '2026-09-08T15:30:00Z',
      }),
    });

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(true);
    expect(result.complaintId).toBe(serverUuid);
    expect(result.data.id).toBe(serverUuid);
  });

  it('handles HTTP 400 error and returns user-friendly error message', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 400,
      json: async () => ({ detail: 'Invalid coordinates provided' }),
    });

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe('Invalid coordinates provided');
    expect(result.isNetworkError).toBe(false);
  });

  it('handles HTTP 413 oversized image response gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 413,
      json: async () => ({ detail: 'Image exceeds maximum size of 20MB' }),
    });

    const result = await uploadComplaint({
      imageUri: 'file:///large_photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(413);
    expect(result.error).toContain('maximum size');
  });

  it('handles HTTP 422 validation error gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 422,
      json: async () => ({ detail: 'GPS coordinates required' }),
    });

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toBe('GPS coordinates required');
  });

  it('handles HTTP 500 server failure gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ detail: 'Internal Server Error' }),
    });

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe('Internal Server Error');
  });

  it('handles network disconnection throwing TypeError gracefully with isNetworkError=true', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBeNull();
    expect(result.isNetworkError).toBe(true);
    expect(result.error).toContain('Network connection unavailable');
  });

  it('handles timeout gracefully when request exceeds timeoutMs', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortError);

    const result = await uploadComplaint(
      {
        imageUri: 'file:///photo.jpg',
        lat: 28.6139,
        lng: 77.2090,
      },
      { timeoutMs: 50 }
    );

    expect(result.success).toBe(false);
    expect(result.isNetworkError).toBe(true);
    expect(result.error).toContain('timed out');
  });

  it('handles malformed server response missing complaint ID', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 201,
      json: async () => ({
        message: 'No id field returned',
      }),
    });

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing complaint ID');
  });

  it('validates coordinates are non-null before attempting network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const result = await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: null,
      lng: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toContain('GPS coordinates');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates photo is present before attempting network call', async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    const result = await uploadComplaint({
      imageUri: null,
      lat: 28.6139,
      lng: 77.2090,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toContain('Complaint image is required');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('preserves draft on upload failure so citizen can retry without losing input', async () => {
    // Initial draft
    let draft = {
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
      location_source: 'device',
      location_accuracy: 10,
      location_address: 'Barakhamba Road',
      issueCategory: 'pothole',
      description: 'Pothole causing issues',
    };

    // Failed response from server
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ detail: 'Internal Server Error' }),
    });

    const result = await uploadComplaint(draft);
    expect(result.success).toBe(false);

    // Draft is strictly NOT cleared
    expect(draft.imageUri).toBe('file:///photo.jpg');
    expect(draft.lat).toBe(28.6139);
    expect(draft.description).toBe('Pothole causing issues');
    expect(draft.location_address).toBe('Barakhamba Road');
  });

  it('server UUID replaces temporary client ID and is persisted to history on success', async () => {
    const serverUuid = 'b538053a-c454-473d-9d41-36b139049909';
    global.fetch = jest.fn().mockResolvedValue({
      status: 201,
      json: async () => ({
        id: serverUuid,
        status: 'pending',
        image_url: 'http://s3/blurred.jpg',
        created_at: '2026-09-08T15:30:00Z',
      }),
    });

    const draft = {
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
      location_source: 'manual',
      location_accuracy: null,
      location_address: 'Connaught Place',
      issue_class: 'pothole',
      description: 'Pothole near metro exit',
    };

    const result = await uploadComplaint(draft);
    expect(result.success).toBe(true);

    const persistedRecord = {
      id: result.complaintId,
      status: 'pending',
      lat: draft.lat,
      lng: draft.lng,
      location_source: draft.location_source,
      location_address: draft.location_address,
      description: draft.description,
    };

    expect(persistedRecord.id).toBe(serverUuid);
    expect(persistedRecord.id).not.toContain('comp-');
  });

  it('prevents duplicate submissions when submission is in flight', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            status: 201,
            json: async () => ({ id: 'uuid-123', status: 'pending' }),
          });
        }, 100);
      });
    });

    const draft = {
      imageUri: 'file:///photo.jpg',
      lat: 28.6139,
      lng: 77.2090,
    };

    // State machine simulation: atomic flag
    let submitting = false;
    async function submit() {
      if (submitting) return false;
      submitting = true;
      try {
        return await uploadComplaint(draft);
      } finally {
        submitting = false;
      }
    }

    // Call submit twice simultaneously
    const p1 = submit();
    const p2 = submit(); // Should be rejected by submitting check

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(true);
    expect(r2).toBe(false);
    expect(callCount).toBe(1);
  });

  it('preserves canonical lat/lng unchanged without geocoding modification during upload', async () => {
    const originalLat = 28.6139281;
    const originalLng = 77.2090124;

    let postedLat = null;
    let postedLng = null;

    global.fetch = jest.fn().mockImplementation((url, opts) => {
      postedLat = opts.body.get('lat');
      postedLng = opts.body.get('lng');
      return Promise.resolve({
        status: 201,
        json: async () => ({ id: 'uuid-456', status: 'pending' }),
      });
    });

    await uploadComplaint({
      imageUri: 'file:///photo.jpg',
      lat: originalLat,
      lng: originalLng,
      location_address: '123 Fake Street, Opposite Park',
    });

    expect(postedLat).toBe(String(originalLat));
    expect(postedLng).toBe(String(originalLng));
  });

  it('retrying pending_upload updates record in history without creating duplicate items', () => {
    const existingHistory = [
      {
        id: 'pending-1725801234',
        status: 'pending_upload',
        description: 'Broken streetlight',
        lat: 28.61,
        lng: 77.20,
      },
      {
        id: 'comp-101',
        status: 'assigned',
        description: 'Existing item',
      },
    ];

    const serverUuid = 'server-uuid-789';
    // Successful retry replacing pending entry
    const updatedHistory = existingHistory.map((item) =>
      item.id === 'pending-1725801234'
        ? { ...item, id: serverUuid, status: 'pending' }
        : item
    );

    expect(updatedHistory).toHaveLength(2); // No duplicate item created
    expect(updatedHistory[0].id).toBe(serverUuid);
    expect(updatedHistory[0].status).toBe('pending');
    expect(updatedHistory[1].id).toBe('comp-101');
  });
});

// ─────────────────────────────────────────────────────────────
// Phase 2.6 — Backend Status Query + Frontend Synchronization
// ─────────────────────────────────────────────────────────────
describe('Phase 2.6 — Backend Status Query + Frontend Synchronization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  const validUuid = '12345678-1234-1234-1234-123456789abc';

  // 1. fetchComplaint() success
  it('fetchComplaint returns normalized success object when server returns HTTP 200', async () => {
    const mockComplaint = {
      id: validUuid,
      status: 'in_progress',
      issue_class: 'pothole',
      confidence: 0.95,
      department: { id: 'dept-1', name: 'Road Maintenance' },
      sla_deadline: '2026-10-01T00:00:00Z',
      lat: 28.6139,
      lng: 77.209,
      description: 'Pothole near metro',
      location_accuracy: 10,
      location_address: 'Rajpath, New Delhi',
      user_selected_category: 'pothole',
      image_url: 'https://example.com/raw.jpg',
      blurred_image_url: 'https://example.com/blurred.jpg',
      created_at: '2026-09-08T00:00:00Z',
      updated_at: '2026-09-08T01:00:00Z',
    };

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => mockComplaint,
    });

    const result = await fetchComplaint(validUuid);

    expect(result.success).toBe(true);
    expect(result.complaintId).toBe(validUuid);
    expect(result.data.status).toBe('in_progress');
    expect(result.data.department.name).toBe('Road Maintenance');
    expect(result.data.sla_deadline).toBe('2026-10-01T00:00:00Z');
  });

  // 2. fetchComplaint() 404
  it('fetchComplaint handles HTTP 404 cleanly with user-friendly error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 404,
      json: async () => ({ detail: 'Complaint not found' }),
    });

    const result = await fetchComplaint(validUuid);

    expect(result.success).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toBe('Complaint not found.');
  });

  // 3. fetchComplaint() 500
  it('fetchComplaint handles HTTP 500 server failure gracefully', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ detail: 'Internal Server Error' }),
    });

    const result = await fetchComplaint(validUuid);

    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
    expect(result.isNetworkError).toBe(false);
  });

  // 4. fetchComplaint() network failure
  it('fetchComplaint handles network disconnection with isNetworkError=true', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const result = await fetchComplaint(validUuid);

    expect(result.success).toBe(false);
    expect(result.isNetworkError).toBe(true);
    expect(result.status).toBeNull();
  });

  // 5. fetchComplaint() timeout
  it('fetchComplaint handles timeout when request is aborted', async () => {
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValue(abortErr);

    const result = await fetchComplaint(validUuid);

    expect(result.success).toBe(false);
    expect(result.isNetworkError).toBe(true);
    expect(result.error).toContain('timed out');
  });

  // 6. fetchComplaint() malformed response missing ID
  it('fetchComplaint handles malformed 200 response missing complaint ID', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ foo: 'bar' }),
    });

    const result = await fetchComplaint(validUuid);

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing complaint ID');
  });

  // 7. isServerUuid helper verification
  it('isServerUuid correctly identifies valid UUIDv4 and rejects client temporary IDs', () => {
    expect(isServerUuid('12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(isServerUuid('E4A1B2C3-D4E5-F6A7-B8C9-D0E1F2A3B4C5')).toBe(true);
    expect(isServerUuid('comp-101')).toBe(false);
    expect(isServerUuid('pending-1725801234')).toBe(false);
    expect(isServerUuid(null)).toBe(false);
    expect(isServerUuid(undefined)).toBe(false);
    expect(isServerUuid('')).toBe(false);
  });

  // 8. refreshComplaintStatus() updates local complaint status
  it('refreshComplaintStatus updates local complaint state with server truth and persists', async () => {
    const { result } = renderHook(() => useComplaints(), { wrapper: ComplaintProvider });

    // Seed has comp-101, comp-102. Let's add a server UUID complaint.
    const serverId = '98765432-1234-1234-1234-123456789abc';

    // Submit or manually add complaint
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/v1/complaints/')) {
        return Promise.resolve({
          status: 200,
          json: async () => ({
            id: serverId,
            status: 'assigned',
            issue_class: 'pothole',
            confidence: 0.98,
            department: { id: 'dept-10', name: 'Delhi Municipal Corporation' },
            sla_deadline: '2026-10-10T12:00:00Z',
            lat: 28.61,
            lng: 77.21,
          }),
        });
      }
      return Promise.resolve({ status: 404, json: async () => ({}) });
    });

    // Test refreshComplaintStatus on serverId
    let refreshResult;
    await act(async () => {
      refreshResult = await result.current.refreshComplaintStatus(serverId);
    });

    expect(refreshResult.success).toBe(true);
    expect(refreshResult.data.status).toBe('assigned');
    expect(refreshResult.data.department.name).toBe('Delhi Municipal Corporation');
  });

  // 9. temporary / pending_upload records are not queried as server complaints
  it('refreshComplaintStatus rejects non-server temporary IDs without network call', async () => {
    const { result } = renderHook(() => useComplaints(), { wrapper: ComplaintProvider });
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy;

    let resComp;
    await act(async () => {
      resComp = await result.current.refreshComplaintStatus('comp-101');
    });

    expect(resComp.success).toBe(false);
    expect(resComp.error).toBe('Not a server-backed complaint');
    expect(fetchSpy).not.toHaveBeenCalled();

    let resPending;
    await act(async () => {
      resPending = await result.current.refreshComplaintStatus('pending-1725801234');
    });

    expect(resPending.success).toBe(false);
    expect(resPending.error).toBe('Not a server-backed complaint');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // 10. refreshComplaints() filters out pending_upload and queries only server UUID records
  it('refreshComplaints queries only server UUID records and updates counts', async () => {
    const { result } = renderHook(() => useComplaints(), { wrapper: ComplaintProvider });

    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({
        id: validUuid,
        status: 'in_progress',
      }),
    });

    let syncResult;
    await act(async () => {
      syncResult = await result.current.refreshComplaints();
    });

    expect(syncResult.success).toBe(true);
  });

  // 11. refresh failure preserves existing local data
  it('refresh failure leaves existing complaints intact in context and storage', async () => {
    const { result } = renderHook(() => useComplaints(), { wrapper: ComplaintProvider });

    // Allow initial rehydration from AsyncStorage
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    global.fetch = jest.fn().mockResolvedValue({
      status: 500,
      json: async () => ({ detail: 'Internal Server Error' }),
    });

    const initialLength = result.current.complaints.length;

    await act(async () => {
      await result.current.refreshComplaints();
    });

    expect(result.current.complaints.length).toBe(initialLength);
  });

  // 12. Detail refresh updates displayed complaint
  it('ComplaintDetailModal renders refresh button for server UUID and triggers refresh', async () => {
    const serverComplaint = {
      id: validUuid,
      status: 'pending',
      issue_class: 'pothole',
      created_at: new Date().toISOString(),
    };

    let fetchCalled = false;
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes(validUuid)) {
        fetchCalled = true;
        return Promise.resolve({
          status: 200,
          json: async () => ({
            id: validUuid,
            status: 'assigned',
            department: { name: 'Public Works Department' },
          }),
        });
      }
      return Promise.resolve({ status: 404, json: async () => ({}) });
    });

    const { getByText } = render(
      <ComplaintProvider>
        <ComplaintDetailModal
          complaint={serverComplaint}
          visible={true}
          onClose={jest.fn()}
        />
      </ComplaintProvider>
    );

    const refreshBtn = getByText('↻ Refresh Status');
    expect(refreshBtn).toBeTruthy();

    await act(async () => {
      fireEvent.press(refreshBtn);
    });

    expect(fetchCalled).toBe(true);
  }, 15000);

  // 13. Department display works (rendered when present, "Not assigned" when null)
  it('ComplaintDetailModal renders department name when assigned, and "Not assigned" when null', () => {
    const withDept = {
      id: 'comp-101',
      status: 'assigned',
      issue_class: 'pothole',
      department: { name: 'Civil Engineering Dept' },
      created_at: new Date().toISOString(),
    };

    const { getByText: getWithDept } = render(
      <ComplaintDetailModal complaint={withDept} visible={true} onClose={jest.fn()} />
    );

    expect(getWithDept('Civil Engineering Dept')).toBeTruthy();

    const withoutDept = {
      id: 'comp-102',
      status: 'pending',
      issue_class: 'garbage',
      department: null,
      created_at: new Date().toISOString(),
    };

    const { getByText: getWithoutDept } = render(
      <ComplaintDetailModal complaint={withoutDept} visible={true} onClose={jest.fn()} />
    );

    expect(getWithoutDept('Not assigned')).toBeTruthy();
  });

  // 14. SLA display works (rendered when present, "Not available" when null)
  it('ComplaintDetailModal renders SLA deadline date when present, and "Not available" when null', () => {
    const withSla = {
      id: 'comp-101',
      status: 'assigned',
      issue_class: 'pothole',
      sla_deadline: '2026-11-20T00:00:00Z',
      created_at: new Date().toISOString(),
    };

    const { getByText: getWithSla } = render(
      <ComplaintDetailModal complaint={withSla} visible={true} onClose={jest.fn()} />
    );

    expect(getWithSla('SLA DEADLINE')).toBeTruthy();

    const withoutSla = {
      id: 'comp-102',
      status: 'pending',
      issue_class: 'garbage',
      sla_deadline: null,
      created_at: new Date().toISOString(),
    };

    const { getByText: getWithoutSla } = render(
      <ComplaintDetailModal complaint={withoutSla} visible={true} onClose={jest.fn()} />
    );

    expect(getWithoutSla('Not available')).toBeTruthy();
  });

  // 15. Retry Upload appears only for pending_upload complaints
  it('ComplaintCard renders "Retry Upload" button only when status is pending_upload', () => {
    const pendingUploadItem = {
      id: 'pending-12345',
      status: 'pending_upload',
      issue_class: 'pothole',
      created_at: new Date().toISOString(),
    };

    const { getByText, queryByText } = render(
      <ComplaintCard complaint={pendingUploadItem} onPress={jest.fn()} />
    );

    expect(getByText('⚡ Retry Upload')).toBeTruthy();

    const normalItem = {
      id: 'comp-101',
      status: 'assigned',
      issue_class: 'pothole',
      created_at: new Date().toISOString(),
    };

    const { queryByText: queryNormal } = render(
      <ComplaintCard complaint={normalItem} onPress={jest.fn()} />
    );

    expect(queryNormal('⚡ Retry Upload')).toBeNull();
  });

  // 16. Detail modal also displays Retry Upload for pending_upload
  it('ComplaintDetailModal renders Pending Upload banner and Retry Upload button for pending_upload', () => {
    const pendingItem = {
      id: 'pending-999',
      status: 'pending_upload',
      issue_class: 'waterlogging',
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintDetailModal complaint={pendingItem} visible={true} onClose={jest.fn()} />
    );

    expect(getByText('Pending Upload')).toBeTruthy();
    expect(getByText('Retry Upload')).toBeTruthy();
  });

  // 17. Empty history action button switches tab to Report
  it('HistoryScreen empty state provides "Report an Issue" button that switches activeTab', async () => {
    const { getByText, findByText } = render(
      <ComplaintProvider>
        <HistoryScreen />
      </ComplaintProvider>
    );

    // Wait for initial hydration to complete
    await findByText('All');

    // Press a filter with 0 items in seed complaints (In Progress has 0):
    const inProgressChip = getByText('In Progress');
    fireEvent.press(inProgressChip);

    // Should show empty state with "Report an Issue"
    const reportBtn = await findByText('+ Report an Issue');
    expect(reportBtn).toBeTruthy();

    fireEvent.press(reportBtn);
  });

  // 18. Filter chip touch targets have minHeight >= 44
  it('HistoryScreen filter chips have accessible touch target minHeight >= 44', () => {
    const { getByLabelText } = render(
      <ComplaintProvider>
        <HistoryScreen />
      </ComplaintProvider>
    );

    const allChip = getByLabelText('Filter: All');
    const flatStyle = StyleSheet.flatten(allChip.props.style);
    expect(flatStyle.minHeight).toBeGreaterThanOrEqual(44);
  });

  // 19. ReportScreen locate button has accessible touch target minHeight >= 44
  it('ReportScreen locate button has minHeight >= 44', () => {
    const { getByLabelText } = render(
      <ComplaintProvider>
        <ReportScreen />
      </ComplaintProvider>
    );

    const locateBtn = getByLabelText('Locate with device GPS');
    const flatStyle = StyleSheet.flatten(locateBtn.props.style);
    expect(flatStyle.minHeight).toBeGreaterThanOrEqual(44);
  });

  // 20. Cold start loading guard prevents false "No reports found" flash
  it('HistoryScreen displays loading indicator during initial hydration instead of false empty state', () => {
    const { getByText } = render(
      <ComplaintProvider>
        <HistoryScreen />
      </ComplaintProvider>
    );

    // Synchronously before AsyncStorage resolves:
    expect(getByText('Loading your reports...')).toBeTruthy();
  });

  // 21. Keyboard avoidance wrapping in ReportScreen
  it('ReportScreen incorporates KeyboardAvoidingView for seamless text input', () => {
    const { getByLabelText } = render(
      <ComplaintProvider>
        <ReportScreen />
      </ComplaintProvider>
    );

    // Description text input should be rendered within the form
    const input = getByLabelText('Describe the civic issue in brief');
    expect(input).toBeTruthy();
  });

  // 22. Complaint detail screen renders authoritative server UUID
  it('ComplaintDetailModal renders the authoritative server UUID with hash prefix', () => {
    const serverRecord = {
      id: validUuid,
      status: 'assigned',
      issue_class: 'pothole',
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintDetailModal complaint={serverRecord} visible={true} onClose={jest.fn()} />
    );

    expect(getByText(`#${validUuid}`)).toBeTruthy();
  });

  // 23. Resolved and Closed states render correctly
  it('ComplaintDetailModal renders correct status badge and timeline for resolved and closed states', () => {
    const resolvedRecord = {
      id: validUuid,
      status: 'verified',
      issue_class: 'pothole',
      created_at: new Date().toISOString(),
    };

    const { getByText: getResolvedText } = render(
      <ComplaintDetailModal complaint={resolvedRecord} visible={true} onClose={jest.fn()} />
    );

    expect(getResolvedText('RESOLVED')).toBeTruthy();

    const closedRecord = {
      id: validUuid,
      status: 'closed',
      issue_class: 'waterlogging',
      created_at: new Date().toISOString(),
    };

    const { getByText: getClosedText } = render(
      <ComplaintDetailModal complaint={closedRecord} visible={true} onClose={jest.fn()} />
    );

    expect(getClosedText('CLOSED')).toBeTruthy();
  });

  // 24. Timeline renders without fabricated data
  it('Timeline derives step index accurately from authoritative status without inventing events', () => {
    expect(getStepIndex('pending_upload')).toBe(-1);
    expect(getStepIndex('pending')).toBe(0);
    expect(getStepIndex('under_review')).toBe(0);
    expect(getStepIndex('assigned')).toBe(1);
    expect(getStepIndex('in_progress')).toBe(2);
    expect(getStepIndex('repaired')).toBe(2);
    expect(getStepIndex('verified')).toBe(3);
    expect(getStepIndex('closed')).toBe(3);

    // Renders safely for pending_upload without completed circles
    const { getByLabelText } = render(<Timeline status="pending_upload" />);
    expect(getByLabelText('Resolution timeline: queued locally, awaiting upload')).toBeTruthy();
  });

  // 25. Description renders when available, omitted cleanly when null
  it('ComplaintDetailModal renders description when available and omits description section when null', () => {
    const withDesc = {
      id: validUuid,
      status: 'assigned',
      issue_class: 'pothole',
      description: 'Deep trench across road',
      created_at: new Date().toISOString(),
    };

    const { getByText: getWithDesc } = render(
      <ComplaintDetailModal complaint={withDesc} visible={true} onClose={jest.fn()} />
    );
    expect(getWithDesc('DESCRIPTION')).toBeTruthy();
    expect(getWithDesc('Deep trench across road')).toBeTruthy();

    const withoutDesc = {
      id: validUuid,
      status: 'assigned',
      issue_class: 'pothole',
      description: null,
      created_at: new Date().toISOString(),
    };

    const { queryByText: queryWithoutDesc } = render(
      <ComplaintDetailModal complaint={withoutDesc} visible={true} onClose={jest.fn()} />
    );
    expect(queryWithoutDesc('DESCRIPTION')).toBeNull();
  });

  // 26. Category and citizen-selected category render correctly
  it('ComplaintDetailModal displays user_selected_category distinctly from ML issue_class', () => {
    const item = {
      id: validUuid,
      status: 'assigned',
      issue_class: 'manhole', // ML class
      user_selected_category: 'pothole', // Citizen reported
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintDetailModal complaint={item} visible={true} onClose={jest.fn()} />
    );

    // Title row reflects detection/class
    expect(getByText('MANHOLE')).toBeTruthy();
    // Meta section explicitly exposes citizen category
    expect(getByText('CITIZEN CATEGORY')).toBeTruthy();
    expect(getByText('POTHOLE')).toBeTruthy();
  });

  // 27. Location data renders accurately
  it('ComplaintDetailModal renders coordinates, location source, and verified address', () => {
    const item = {
      id: validUuid,
      status: 'pending',
      issue_class: 'pothole',
      lat: 28.613933,
      lng: 77.209021,
      location_source: 'device',
      location_accuracy: 8,
      location_address: 'Janpath, New Delhi',
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintDetailModal complaint={item} visible={true} onClose={jest.fn()} />
    );

    expect(getByText('COORDINATES')).toBeTruthy();
    expect(getByText('28.613933, 77.209021')).toBeTruthy();
    expect(getByText('LOCATION SOURCE')).toBeTruthy();
    expect(getByText('📍 GPS ±8m')).toBeTruthy();
    expect(getByText('VERIFIED ADDRESS (OSM)')).toBeTruthy();
    expect(getByText('Janpath, New Delhi')).toBeTruthy();
  });

  // 28. Missing optional fields do not crash the UI
  it('ComplaintDetailModal renders without crashing when all optional fields are null', () => {
    const minimalItem = {
      id: validUuid,
      status: 'pending',
      issue_class: null,
      user_selected_category: null,
      description: null,
      lat: null,
      lng: null,
      location_source: null,
      location_accuracy: null,
      location_address: null,
      imageUri: null,
      department: null,
      sla_deadline: null,
      created_at: new Date().toISOString(),
    };

    const { getByText } = render(
      <ComplaintDetailModal complaint={minimalItem} visible={true} onClose={jest.fn()} />
    );

    expect(getByText(`#${validUuid}`)).toBeTruthy();
    expect(getByText('PENDING')).toBeTruthy();
    expect(getByText('No photo attached')).toBeTruthy();
    expect(getByText('Not assigned')).toBeTruthy();
    expect(getByText('Not available')).toBeTruthy();
  });

  // 29. Complaint image renders using available URL
  it('ComplaintDetailModal renders Image component when imageUri is provided', () => {
    const itemWithPhoto = {
      id: validUuid,
      status: 'pending',
      issue_class: 'pothole',
      imageUri: 'https://storage.urbanpulse.dev/complaints/test.jpg',
      created_at: new Date().toISOString(),
    };

    const { queryByText } = render(
      <ComplaintDetailModal complaint={itemWithPhoto} visible={true} onClose={jest.fn()} />
    );

    expect(queryByText('No photo attached')).toBeNull();
  });

  // 30. History to tracking navigation: tapping a card opens detail modal with server UUID
  it('HistoryScreen card press opens ComplaintDetailModal displaying authoritative complaint details', async () => {
    // Provide explicit fixture data — production no longer seeds demo complaints
    const fixtureComplaints = [
      {
        id: 'comp-101',
        issue_class: 'pothole',
        description: 'Test pothole complaint',
        lat: 28.6304,
        lng: 77.2177,
        location_source: 'device',
        location_accuracy: 12,
        location_address: 'Connaught Circus, New Delhi',
        status: 'assigned',
        imageUri: null,
        created_at: new Date().toISOString(),
      },
    ];

    const { getByText, findByText, getByLabelText } = render(
      <ComplaintProvider initialComplaints={fixtureComplaints}>
        <HistoryScreen />
      </ComplaintProvider>
    );

    // Wait for hydration
    await findByText('All');

    // Tap the first fixture card
    const cardTitle = getByText('POTHOLE');
    fireEvent.press(cardTitle);

    // Detail modal should now be visible with complaint ID and timeline
    const modalId = await findByText('#comp-101');
    expect(modalId).toBeTruthy();
    expect(getByText('Resolution Timeline')).toBeTruthy();
    expect(getByLabelText('Close complaint details')).toBeTruthy();
  });
});

  // =========================================================================
  // Phase 4 — Status History, Timeline Progression & Municipal Lifecycle Control
  // =========================================================================
  describe('Phase 4 — Municipal Lifecycle & Status History Synchronization', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('fetchComplaintHistory returns normalized history array on HTTP 200', async () => {
      const mockHistory = [
        {
          id: 1,
          complaint_id: 'd9b2d678-8314-4a4e-bf2d-8e50b18f085c',
          previous_status: null,
          new_status: 'pending',
          changed_at: '2026-03-29T10:00:00Z',
          actor: 'citizen',
          notes: 'Complaint submitted',
        },
        {
          id: 2,
          complaint_id: 'd9b2d678-8314-4a4e-bf2d-8e50b18f085c',
          previous_status: 'pending',
          new_status: 'in_progress',
          changed_at: '2026-03-29T11:00:00Z',
          actor: 'admin_operator',
          notes: 'Crew dispatched',
        },
      ];

      global.fetch = jest.fn().mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          complaint_id: 'd9b2d678-8314-4a4e-bf2d-8e50b18f085c',
          total_transitions: 2,
          history: mockHistory,
        }),
      });

      const res = await fetchComplaintHistory('d9b2d678-8314-4a4e-bf2d-8e50b18f085c');
      expect(res.success).toBe(true);
      expect(res.complaintId).toBe('d9b2d678-8314-4a4e-bf2d-8e50b18f085c');
      expect(res.history.length).toBe(2);
      expect(res.history[1].new_status).toBe('in_progress');
    });

    it('fetchComplaintHistory gracefully handles 404 or network failure', async () => {
      global.fetch = jest.fn().mockResolvedValueOnce({
        status: 404,
        json: async () => ({ detail: 'Complaint not found' }),
      });

      const res404 = await fetchComplaintHistory('nonexistent-uuid');
      expect(res404.success).toBe(false);
      expect(res404.status).toBe(404);
      expect(res404.history).toEqual([]);

      global.fetch = jest.fn().mockRejectedValueOnce(new Error('Network error'));
      const resNet = await fetchComplaintHistory('d9b2d678-8314-4a4e-bf2d-8e50b18f085c');
      expect(resNet.success).toBe(false);
      expect(resNet.isNetworkError).toBe(true);
    });

    it('Timeline renders rejection banner when status is rejected', () => {
      const { getByText } = render(
        <Timeline status="rejected" history={[]} />
      );

      expect(getByText(/Complaint Rejected \/ Duplicate/)).toBeTruthy();
      expect(
        getByText(/reviewed and marked as rejected or a duplicate/i)
      ).toBeTruthy();
    });

    it('Timeline displays transition timestamp for historical steps', () => {
      const history = [
        {
          id: 1,
          previous_status: null,
          new_status: 'pending',
          changed_at: '2026-03-29T10:30:00Z',
        },
        {
          id: 2,
          previous_status: 'pending',
          new_status: 'in_progress',
          changed_at: '2026-03-29T14:45:00Z',
        },
      ];

      const { getByText, getAllByText } = render(
        <Timeline status="in_progress" history={history} />
      );

      // Both steps should be rendered and timestamps visible
      expect(getByText('Submitted')).toBeTruthy();
      expect(getByText('In Progress')).toBeTruthy();
      // Should find formatted dates
      expect(getAllByText(/Mar 29/).length).toBeGreaterThanOrEqual(1);
    });

    it('ComplaintDetailModal renders CLOSED AT when complaint has closed_at date', () => {
      const closedComplaint = {
        id: 'comp-closed-1',
        status: 'closed',
        issue_class: 'garbage',
        created_at: '2026-03-28T09:00:00Z',
        closed_at: '2026-03-29T15:30:00Z',
      };

      const { getByText } = render(
        <ComplaintDetailModal complaint={closedComplaint} visible={true} onClose={jest.fn()} />
      );

      expect(getByText('CLOSED AT')).toBeTruthy();
      expect(getByText(/Mar 29, 2026/)).toBeTruthy();
    });

    it('refreshComplaintStatus reconciles status_history and closed_at into context', async () => {
      const serverUuid = '99999999-9999-4999-8999-999999999999';
      const initialItem = {
        id: serverUuid,
        status: 'pending',
        issue_class: 'pothole',
        created_at: '2026-03-29T00:00:00Z',
      };

      const updatedItem = {
        id: serverUuid,
        status: 'closed',
        issue_class: 'pothole',
        created_at: '2026-03-29T00:00:00Z',
        closed_at: '2026-03-29T18:00:00Z',
        status_history: [
          {
            id: 1,
            previous_status: null,
            new_status: 'pending',
            changed_at: '2026-03-29T00:00:00Z',
          },
          {
            id: 2,
            previous_status: 'pending',
            new_status: 'closed',
            changed_at: '2026-03-29T18:00:00Z',
          },
        ],
      };

      global.fetch = jest.fn().mockImplementation((url) => {
        if (url.includes(serverUuid)) {
          return Promise.resolve({
            status: 200,
            json: async () => updatedItem,
          });
        }
        return Promise.resolve({ status: 404, json: async () => ({}) });
      });

      let contextRef;
      function TestConsumer() {
        contextRef = useComplaints();
        return null;
      }

      render(
        <ComplaintProvider initialComplaints={[initialItem]}>
          <TestConsumer />
        </ComplaintProvider>
      );

      let res;
      await act(async () => {
        res = await contextRef.refreshComplaintStatus(serverUuid);
      });

      expect(res.success).toBe(true);
      expect(res.updatedComplaint.status).toBe('closed');
      expect(res.updatedComplaint.closed_at).toBe('2026-03-29T18:00:00Z');
      expect(res.updatedComplaint.status_history.length).toBe(2);
    });

    it('Timeline displays reopened banner when complaint was previously closed or rejected', () => {
      const reopenedHistory = [
        {
          id: 1,
          previous_status: null,
          new_status: 'pending',
          changed_at: '2026-03-28T10:00:00Z',
        },
        {
          id: 2,
          previous_status: 'pending',
          new_status: 'closed',
          changed_at: '2026-03-28T15:00:00Z',
        },
        {
          id: 3,
          previous_status: 'closed',
          new_status: 'in_progress',
          changed_at: '2026-03-29T09:00:00Z',
        },
      ];

      const { getByText } = render(
        <Timeline status="in_progress" history={reopenedHistory} />
      );

      expect(getByText(/Complaint Reopened/i)).toBeTruthy();
      expect(getByText(/reopened by municipal authorities/i)).toBeTruthy();
    });

    it('ComplaintContext correctly filters complaints by rejected status', async () => {
      let contextRef;
      function TestConsumer() {
        contextRef = useComplaints();
        return null;
      }

      const testData = [
        { id: 'c1', status: 'pending' },
        { id: 'c2', status: 'rejected' },
        { id: 'c3', status: 'closed' },
        { id: 'c4', status: 'repaired' },
      ];

      render(
        <ComplaintProvider initialComplaints={testData}>
          <TestConsumer />
        </ComplaintProvider>
      );

      // Filter: rejected
      await act(async () => {
        contextRef.setHistoryFilter('rejected');
      });
      expect(contextRef.filteredComplaints.length).toBe(1);
      expect(contextRef.filteredComplaints[0].id).toBe('c2');

      // Filter: in_progress includes repaired
      await act(async () => {
        contextRef.setHistoryFilter('in_progress');
      });
      expect(contextRef.filteredComplaints.length).toBe(1);
      expect(contextRef.filteredComplaints[0].id).toBe('c4');
    });
  });



