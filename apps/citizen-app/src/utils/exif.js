/**
 * Pure JavaScript EXIF GPS Parser
 *
 * Extracts GPS latitude and longitude directly from JPEG binary buffers
 * without third-party native or native-bridge dependencies.
 *
 * Adapted from UrbanPulse Admin Dashboard (SubmitComplaint.jsx).
 * Supports:
 *  - JPEG APP1 marker (0xFFE1)
 *  - TIFF endianness detection (Little Endian 'II' / Big Endian 'MM')
 *  - GPS IFD pointer (Tag 0x8825)
 *  - Degrees, Minutes, Seconds (DMS) rational conversion
 *  - N/S and E/W hemisphere sign adjustment
 *  - Coordinate range boundary validation [-90, 90], [-180, 180]
 */

/**
 * Extracts GPS coordinates from an image URI, ArrayBuffer, or Uint8Array.
 *
 * @param {string | ArrayBuffer | Uint8Array} input - Image URI or binary buffer
 * @returns {Promise<{ lat: number, lng: number } | null>} Decimal coordinates or null
 */
export async function extractExifCoordinates(input) {
  if (!input) return null;

  try {
    let buffer;

    if (input instanceof ArrayBuffer) {
      buffer = input;
    } else if (ArrayBuffer.isView(input)) {
      buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
    } else if (typeof input === 'string') {
      // In React Native / Browser, fetch can read local file://, blob:, and http URLs
      const response = await fetch(input);
      if (!response.ok && !input.startsWith('file://')) return null;
      buffer = await response.arrayBuffer();
    } else {
      return null;
    }

    if (!buffer || buffer.byteLength < 16) return null;

    const view = new DataView(buffer);

    // Verify JPEG SOI marker (0xFFD8)
    if (view.getUint16(0) !== 0xFFD8) {
      return null;
    }

    let offset = 2;
    const length = view.byteLength;

    while (offset < length - 1) {
      const marker = view.getUint16(offset);
      offset += 2;

      // APP1 marker (EXIF data)
      if (marker === 0xFFE1) {
        if (offset + 2 > length) return null;
        return parseExif(view, offset + 2);
      } else if ((marker & 0xFF00) !== 0xFF00) {
        // Not a valid marker prefix, abort
        break;
      } else {
        // Skip other markers (APP0, DQT, DHT, etc.)
        if (offset + 2 > length) return null;
        const segmentLength = view.getUint16(offset);
        offset += segmentLength;
      }
    }

    return null;
  } catch (err) {
    // Malformed input or out-of-bounds access returns null safely
    return null;
  }
}

/**
 * Parses the APP1 EXIF segment.
 */
function parseExif(view, start) {
  try {
    // Verify "Exif\0\0" header (6 bytes)
    if (start + 6 > view.byteLength) return null;

    const exifHeader = String.fromCharCode(
      view.getUint8(start),
      view.getUint8(start + 1),
      view.getUint8(start + 2),
      view.getUint8(start + 3)
    );
    if (exifHeader !== 'Exif') return null;

    const tiffStart = start + 6;
    if (tiffStart + 8 > view.byteLength) return null;

    // Determine Byte Order
    const byteOrder = view.getUint16(tiffStart);
    const littleEndian = byteOrder === 0x4949; // 'II' = Little Endian, 'MM' = Big Endian

    // Read 0th IFD offset (usually 8)
    const ifdOffset = view.getUint32(tiffStart + 4, littleEndian);
    if (tiffStart + ifdOffset > view.byteLength) return null;

    return findGPSInfo(view, tiffStart, tiffStart + ifdOffset, littleEndian);
  } catch {
    return null;
  }
}

/**
 * Traverses IFD0 to find the GPSInfo IFD (tag 0x8825), then parses GPS coordinates.
 */
function findGPSInfo(view, tiffStart, ifdStart, littleEndian) {
  try {
    if (ifdStart + 2 > view.byteLength) return null;
    const entries = view.getUint16(ifdStart, littleEndian);
    let gpsIFDPointer = null;

    for (let i = 0; i < entries; i++) {
      const entryStart = ifdStart + 2 + (i * 12);
      if (entryStart + 12 > view.byteLength) return null;

      const tag = view.getUint16(entryStart, littleEndian);
      if (tag === 0x8825) {
        // GPSInfo pointer is at offset + 8
        gpsIFDPointer = view.getUint32(entryStart + 8, littleEndian);
        break;
      }
    }

    if (gpsIFDPointer === null) return null;

    const gpsStart = tiffStart + gpsIFDPointer;
    if (gpsStart + 2 > view.byteLength) return null;

    const gpsEntries = view.getUint16(gpsStart, littleEndian);

    let latRef = 'N';
    let lngRef = 'E';
    let latValues = null;
    let lngValues = null;

    for (let i = 0; i < gpsEntries; i++) {
      const entryStart = gpsStart + 2 + (i * 12);
      if (entryStart + 12 > view.byteLength) return null;

      const tag = view.getUint16(entryStart, littleEndian);
      const valueOffset = view.getUint32(entryStart + 8, littleEndian);

      switch (tag) {
        case 1: // GPSLatitudeRef ('N' or 'S')
          latRef = String.fromCharCode(view.getUint8(entryStart + 8));
          break;
        case 2: // GPSLatitude (3 rationals: deg, min, sec)
          latValues = readRationals(view, tiffStart + valueOffset, 3, littleEndian);
          break;
        case 3: // GPSLongitudeRef ('E' or 'W')
          lngRef = String.fromCharCode(view.getUint8(entryStart + 8));
          break;
        case 4: // GPSLongitude (3 rationals: deg, min, sec)
          lngValues = readRationals(view, tiffStart + valueOffset, 3, littleEndian);
          break;
        default:
          break;
      }
    }

    if (latValues && lngValues) {
      let lat = latValues[0] + latValues[1] / 60 + latValues[2] / 3600;
      let lng = lngValues[0] + lngValues[1] / 60 + lngValues[2] / 3600;

      // Apply hemisphere signs
      if (latRef.toUpperCase() === 'S') lat = -lat;
      if (lngRef.toUpperCase() === 'W') lng = -lng;

      // Validate bounds [-90, 90] and [-180, 180]
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

      return { lat, lng };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Reads rational values (pairs of 32-bit unsigned numerator and denominator).
 */
function readRationals(view, offset, count, littleEndian) {
  const values = [];
  for (let i = 0; i < count; i++) {
    const entryOffset = offset + (i * 8);
    if (entryOffset + 8 > view.byteLength) return null;

    const num = view.getUint32(entryOffset, littleEndian);
    const den = view.getUint32(entryOffset + 4, littleEndian);
    values.push(den === 0 ? 0 : num / den);
  }
  return values;
}
