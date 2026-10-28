/**
 * OpenStreetMap Nominatim Reverse Geocoding Utility
 *
 * Resolves latitude and longitude coordinates into a human-readable civic address
 * using OpenStreetMap's public Nominatim service.
 *
 * Compliance Rules (https://operations.osmfoundation.org/policies/nominatim/):
 * - Pure client-side OpenStreetMap integration (zero Google Maps / proprietary keys).
 * - Max 1 request/second policy strictly enforced via minimum interval throttling (1100ms).
 * - In-memory cache prevents redundant requests for repeated or nearby coordinates.
 * - Descriptive only: NEVER replaces or mutates numeric lat/lng.
 * - Graceful timeout (5s) and failure recovery: returns null on error.
 * - Zero fabricated addresses.
 */

// In-memory cache for recent reverse geocode results (rounded to 4 decimal places ~11m)
// Strictly follows Nominatim policy: "Cache results: If your application repeatedly
// requests the same coordinate or location, cache results client-side."
const geocodeCache = new Map();
const MAX_CACHE_SIZE = 100;

// Rate limiting: enforce minimum spacing of 1100ms between consecutive outgoing HTTP requests
// Strictly follows Nominatim policy: "An absolute maximum of 1 request/second".
let nextAvailableSlotTime = 0;
const MIN_REQUEST_INTERVAL_MS = 1100;

/** Clear in-memory cache (primarily for tests) */
export function _clearGeocodeCache() {
  geocodeCache.clear();
}

/** Reset rate-limiter timestamp (primarily for tests) */
export function _resetRateLimiter() {
  nextAvailableSlotTime = 0;
}

/**
 * Schedules an asynchronous task on a shared timeline where consecutive dispatches
 * are guaranteed to be spaced by at least MIN_REQUEST_INTERVAL_MS.
 *
 * Concurrency-safe: atomically reserves a unique future time slot for each caller.
 */
function scheduleSerializedRequest(taskFn, externalSignal) {
  const now = Date.now();
  // Atomically reserve the next dispatch time slot
  const dispatchTime = Math.max(now, nextAvailableSlotTime);
  nextAvailableSlotTime = dispatchTime + MIN_REQUEST_INTERVAL_MS;
  const delay = Math.max(0, dispatchTime - now);

  return new Promise((resolve, reject) => {
    let timerId = null;

    const onAbort = () => {
      if (timerId) clearTimeout(timerId);
      resolve(null);
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        return resolve(null);
      }
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    timerId = setTimeout(async () => {
      if (externalSignal && externalSignal.aborted) {
        return resolve(null);
      }
      try {
        const result = await taskFn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }, delay);
  });
}

/**
 * Reverse geocodes a coordinate pair using OpenStreetMap Nominatim.
 *
 * @param {number} lat - Latitude in decimal degrees [-90, 90]
 * @param {number} lng - Longitude in decimal degrees [-180, 180]
 * @param {AbortSignal} [externalSignal] - Optional abort signal
 * @returns {Promise<string | null>} Formatted address or null
 */
export async function reverseGeocodeCoords(lat, lng, externalSignal) {
  if (lat == null || lng == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  // Step 1: Check in-memory cache first (~11m resolution key)
  const cacheKey = `${Number(lat).toFixed(4)},${Number(lng).toFixed(4)}`;
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  // Step 2: Enforce Nominatim policy rate-limit via serialized scheduling (max 1 req/sec)
  return scheduleSerializedRequest(async () => {
    // Re-check cache in case a previous serialized request resolved the same coordinates
    if (geocodeCache.has(cacheKey)) {
      return geocodeCache.get(cacheKey);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    // Combine external abort signal if provided
    if (externalSignal) {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'UrbanPulse-CitizenApp/1.0 (https://github.com/riiyatomar/UrbanPulse)',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();

      if (!data) return null;

      let formattedAddress = null;

      // Construct concise civic address from OSM address tokens
      if (data.address && typeof data.address === 'object') {
        const addr = data.address;
        const parts = [];

        // Primary road or building
        const primary = addr.road || addr.pedestrian || addr.street || addr.building;
        if (primary) parts.push(primary);

        // Locality / Neighborhood / Suburb
        const locality = addr.neighbourhood || addr.suburb || addr.residential || addr.city_district || addr.quarter;
        if (locality && !parts.includes(locality)) parts.push(locality);

        // City / Town / Village
        const city = addr.city || addr.town || addr.village || addr.municipality || addr.county;
        if (city && !parts.includes(city)) parts.push(city);

        // State / Region
        const state = addr.state || addr.state_district;
        if (state && !parts.includes(state)) parts.push(state);

        if (parts.length > 0) {
          formattedAddress = parts.join(', ');
        }
      }

      // Fallback to display_name if structured address tokens are unavailable
      if (!formattedAddress && typeof data.display_name === 'string' && data.display_name.trim()) {
        // Return the first 3 segments of display_name for concise civic UI
        const segments = data.display_name.split(',').map((s) => s.trim()).filter(Boolean);
        formattedAddress = segments.slice(0, 3).join(', ');
      }

      // Cache successful address (maintain LRU size limit)
      if (formattedAddress) {
        if (geocodeCache.size >= MAX_CACHE_SIZE) {
          const firstKey = geocodeCache.keys().next().value;
          geocodeCache.delete(firstKey);
        }
        geocodeCache.set(cacheKey, formattedAddress);
      }

      return formattedAddress;
    } catch (err) {
      clearTimeout(timeoutId);
      // Network failure, timeout, or abort returns null safely without throwing
      return null;
    }
  }, externalSignal);
}
