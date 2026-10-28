import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';

/**
 * Interactive OpenStreetMap component with Leaflet.
 *
 * Supports:
 * - Native (Android/iOS) via react-native-webview
 * - Web via iframe with window.postMessage bridge
 * - Tap to reposition marker
 * - Drag marker to reposition
 * - Clean onLocationChange callback
 */
export default function LocationMap({ lat, lng, onLocationChange, height = 220, style }) {
  const webViewRef = useRef(null);
  const iframeRef = useRef(null);

  // Sync external coordinate updates into the map without reloading the entire page
  useEffect(() => {
    if (lat != null && lng != null) {
      const code = `if (window.updateMapPosition) { window.updateMapPosition(${lat}, ${lng}); }`;
      if (Platform.OS === 'web' && iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'set_position', lat, lng }, '*');
      } else if (webViewRef.current && webViewRef.current.injectJavaScript) {
        webViewRef.current.injectJavaScript(`${code}; true;`);
      }
    }
  }, [lat, lng]);

  // Handle messages on Web platform
  useEffect(() => {
    if (Platform.OS === 'web') {
      const handleWebMessage = (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data && data.type === 'location_change' && onLocationChange) {
            onLocationChange({ lat: data.lat, lng: data.lng });
          }
        } catch {
          // Ignore non-json messages from other browser extensions
        }
      };
      window.addEventListener('message', handleWebMessage);
      return () => window.removeEventListener('message', handleWebMessage);
    }
  }, [onLocationChange]);

  const initialLat = lat != null ? lat : 20.5937; // Center of India
  const initialLng = lng != null ? lng : 78.9629;
  const initialZoom = lat != null && lng != null ? 16 : 5;
  const hasMarker = lat != null && lng != null;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #0c121e; }
    .leaflet-control-attribution { font-size: 9px; background: rgba(12, 18, 30, 0.75) !important; color: #94a3b8 !important; padding: 0 4px; border-radius: 3px; }
    .leaflet-control-attribution a { color: #38bdf8 !important; text-decoration: none; }
    .custom-marker {
      background: transparent;
      border: none;
    }
    .custom-pin {
      width: 30px;
      height: 40px;
      transform: translate(-15px, -40px);
      cursor: pointer;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: true }).setView([${initialLat}, ${initialLng}], ${initialZoom});
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    var pinHtml = '<svg class="custom-pin" viewBox="0 0 30 40" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M15 0C6.716 0 0 6.716 0 15c0 10.5 15 25 15 25s15-14.5 15-25c0-8.284-6.716-15-15-15z" fill="#3b82f6"/>' +
      '<circle cx="15" cy="15" r="5.5" fill="#ffffff"/>' +
      '</svg>';

    var customIcon = L.divIcon({
      className: 'custom-marker',
      html: pinHtml,
      iconSize: [30, 40],
      iconAnchor: [15, 40]
    });

    var marker = null;

    function notifyPosition(lat, lng) {
      var payload = JSON.stringify({
        type: 'location_change',
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6))
      });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      }
      if (window.parent && window.parent.postMessage) {
        window.parent.postMessage(payload, '*');
      }
    }

    function createOrUpdateMarker(lat, lng) {
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { icon: customIcon, draggable: true }).addTo(map);
        marker.on('dragend', function(e) {
          var p = marker.getLatLng();
          notifyPosition(p.lat, p.lng);
        });
      }
    }

    ${hasMarker ? `createOrUpdateMarker(${initialLat}, ${initialLng});` : ''}

    map.on('click', function(e) {
      createOrUpdateMarker(e.latlng.lat, e.latlng.lng);
      notifyPosition(e.latlng.lat, e.latlng.lng);
    });

    window.updateMapPosition = function(newLat, newLng) {
      if (!map) return;
      map.setView([newLat, newLng], 16);
      createOrUpdateMarker(newLat, newLng);
    };

    window.addEventListener('message', function(e) {
      try {
        var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d && d.type === 'set_position') {
          window.updateMapPosition(d.lat, d.lng);
        }
      } catch (err) {}
    });
  </script>
</body>
</html>
  `;

  return (
    <View style={[styles.container, { height }, style]} testID="location-map">
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef}
          title="Location Map"
          srcDoc={htmlContent}
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            borderRadius: 10,
          }}
        />
      ) : (
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: htmlContent }}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.type === 'location_change' && onLocationChange) {
                onLocationChange({ lat: data.lat, lng: data.lng });
              }
            } catch {}
          }}
          style={styles.webview}
          scrollEnabled={false}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
