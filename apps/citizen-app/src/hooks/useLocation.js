import { useState, useCallback } from 'react';
import * as Location from 'expo-location';

/**
 * Hook for acquiring device geolocation using expo-location.
 *
 * Supports:
 * - Foreground permission inspection & request
 * - On-demand GPS position acquisition (no continuous background tracking)
 * - Honest accuracy reporting
 * - Graceful handling of denial, timeout, or location service unavailability
 */
export function useLocation() {
  const [loading, setLoading] = useState(false);
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [accuracy, setAccuracy] = useState(null);
  const [error, setError] = useState(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  const requestLocation = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPermissionDenied(false);

    try {
      // 1. Check / request foreground permission
      let { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }

      if (status !== 'granted') {
        setPermissionDenied(true);
        setError('Location permission was denied. You can place a pin manually on the map.');
        setLoading(false);
        return null;
      }

      // 2. Acquire current GPS position
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      if (position && position.coords) {
        const { latitude, longitude, accuracy: acc } = position.coords;
        const result = {
          lat: latitude,
          lng: longitude,
          accuracy: acc != null ? Math.round(acc) : null,
        };
        setCoords({ lat: result.lat, lng: result.lng });
        setAccuracy(result.accuracy);
        setLoading(false);
        return result;
      } else {
        throw new Error('Location services did not return coordinates.');
      }
    } catch (err) {
      setError(err.message || 'Failed to acquire device location.');
      setLoading(false);
      return null;
    }
  }, []);

  return {
    coords,
    accuracy,
    loading,
    error,
    permissionDenied,
    requestLocation,
  };
}
