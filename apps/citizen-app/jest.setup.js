// jest.setup.js — Mock modules that don't work in the test environment

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn((key) => Promise.resolve(store[key] || null)),
      setItem: jest.fn((key, value) => {
        store[key] = value;
        return Promise.resolve();
      }),
      removeItem: jest.fn((key) => {
        delete store[key];
        return Promise.resolve();
      }),
      clear: jest.fn(() => {
        store = {};
        return Promise.resolve();
      }),
    },
  };
});

// Mock expo-image-picker
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' })
  ),
  requestMediaLibraryPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' })
  ),
  launchCameraAsync: jest.fn(() =>
    Promise.resolve({ canceled: true, assets: [] })
  ),
  launchImageLibraryAsync: jest.fn(() =>
    Promise.resolve({ canceled: true, assets: [] })
  ),
}));

// Mock expo-camera
jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');

  const CameraView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      takePictureAsync: jest.fn(() =>
        Promise.resolve({
          uri: 'file://mock-camera-captured-issue.jpg',
          width: 1920,
          height: 1080,
        })
      ),
      pausePreview: jest.fn(),
      resumePreview: jest.fn(),
    }));

    return React.createElement(View, {
      testID: 'camera-view',
      ...props,
    }, props.children);
  });

  return {
    __esModule: true,
    CameraView,
    useCameraPermissions: jest.fn(() => [
      { granted: true, status: 'granted', canAskAgain: true },
      jest.fn(() => Promise.resolve({ granted: true, status: 'granted', canAskAgain: true })),
    ]),
    CameraType: {
      back: 'back',
      front: 'front',
    },
  };
});

// Mock expo-location
jest.mock('expo-location', () => ({
  Accuracy: {
    Lowest: 1,
    Low: 2,
    Balanced: 3,
    High: 4,
    Highest: 5,
    BestForNavigation: 6,
  },
  getForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' })
  ),
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' })
  ),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({
      coords: {
        latitude: 19.0760,
        longitude: 72.8777,
        accuracy: 15,
        altitude: 10,
        heading: 0,
        speed: 0,
      },
      timestamp: Date.now(),
    })
  ),
  getLastKnownPositionAsync: jest.fn(() =>
    Promise.resolve(null)
  ),
}));

// Mock react-native-webview
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');

  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: jest.fn(),
      reload: jest.fn(),
    }));

    return React.createElement(View, {
      testID: 'location-map-webview',
      ...props,
    }, props.children);
  });

  return {
    __esModule: true,
    WebView,
    default: WebView,
  };
});
