# UrbanPulse Citizen App

A React Native mobile application built with Expo, allowing citizens to capture photos of infrastructure issues, auto-fill their coordinates via GPS, and track the progress of their reports.

## Key Screens

1. **Report Screen (New Submission)**:
   * **Photo Intake**: Displays a placeholder box prompting the user to take a photo. Uses a simulated camera selector to cycle through sample images of pothole, waterlogging, or streetlight issues.
   * **Auto-Fill Geolocation**: Instantly queries the device GPS coordinates upon photo select, displaying latitude and longitude values.
   * **Multipart Upload**: Transmits form data containing the photo and coordinates to the Ingestion API endpoint (`POST /api/v1/complaints`).
2. **History Screen (Submissions List)**:
   * Displays a summary of the citizen's reports.
   * Clicking a report expands a detailed **Horizontal Stepper Timeline**:
     `Submitted ➔ Assigned ➔ In Progress ➔ Resolved`

## Fallback Design Strategy

* **API Offline Fallback**: If the Ingestion API backend is down, the mobile app switches to local state caching, logging the complaint details in-memory, notifying the user that it registered offline, and adding it to the history list immediately so the UI remains interactive.
* **GPS & Location Strategy**: Uses real hardware GPS via `expo-location` and client-side EXIF GPS extraction for photos. If GPS is unavailable or permission denied, coordinates remain unresolved and the citizen can manually position the pin on the interactive OpenStreetMap map. Zero fake coordinates are ever fabricated.

## Quick Start

### 1. Install dependencies
```bash
cd apps/citizen-app
npm install
```

### 2. Launch Developer Server
```bash
npm run start
```

### 3. Previews
* **Web browser preview**: Press `w` in the terminal to view the app directly in your desktop browser.
* **Mobile preview**: Download the **Expo Go** application on your iOS or Android phone, and scan the QR code displayed in the terminal.

## Running Tests

To run the unit tests:
```bash
npm run test
```
