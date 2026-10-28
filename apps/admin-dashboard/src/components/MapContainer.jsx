import React, { useEffect, useMemo } from 'react';
import { MapContainer as LeafletMapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { Map, AlertTriangle, ExternalLink, Info, Clock, AlertCircle } from 'lucide-react';

// Status → color mapping
const getMarkerColor = (status) => {
  switch (status) {
    case 'pending': return '#d29922';
    case 'under_review': return '#f0883e';
    case 'assigned': return '#58a6ff';
    case 'in_progress': return '#1f6feb';
    case 'repaired':
    case 'verified':
    case 'closed': return '#3fb950';
    case 'rejected': return '#f85149';
    default: return '#8b949e';
  }
};

// Helper component to auto-fit map bounds to markers
function FitBounds({ complaints, selectedComplaint }) {
  const map = useMap();

  useEffect(() => {
    if (selectedComplaint && selectedComplaint.lat && selectedComplaint.lng) {
      map.setView([selectedComplaint.lat, selectedComplaint.lng], 16, { animate: true });
      return;
    }

    const validCoords = complaints
      .filter(c => typeof c.lat === 'number' && typeof c.lng === 'number' && !isNaN(c.lat) && !isNaN(c.lng))
      .map(c => [c.lat, c.lng]);

    if (validCoords.length > 0) {
      map.fitBounds(validCoords, { padding: [40, 40], maxZoom: 15 });
    }
  }, [complaints, selectedComplaint, map]);

  return null;
}

export default function MapContainer({
  complaints = [],
  showHeatmap = false,
  selectedComplaint = null,
  onOpenDetails,
}) {
  // Default center: Delhi
  const defaultCenter = [28.6139, 77.2090];
  const defaultZoom = 13;

  // Filter out any complaints with invalid or missing coordinates
  const validComplaints = useMemo(() => {
    return complaints.filter(
      (c) =>
        c &&
        typeof c.lat === 'number' &&
        typeof c.lng === 'number' &&
        !isNaN(c.lat) &&
        !isNaN(c.lng) &&
        c.lat >= -90 &&
        c.lat <= 90 &&
        c.lng >= -180 &&
        c.lng <= 180
    );
  }, [complaints]);

  // Determine center from valid complaints or use default
  const center = useMemo(() => {
    if (validComplaints.length === 0) return defaultCenter;
    const avgLat = validComplaints.reduce((sum, c) => sum + c.lat, 0) / validComplaints.length;
    const avgLng = validComplaints.reduce((sum, c) => sum + c.lng, 0) / validComplaints.length;
    return [avgLat, avgLng];
  }, [validComplaints]);

  return (
    <div className="map-container-section">
      <div className="map-section-header">
        <span className="map-section-title">
          <Map size={16} />
          GIS Incident Map (Canonical GPS Coordinates)
        </span>
        <span className="map-complaint-count">
          {validComplaints.length} incident{validComplaints.length !== 1 ? 's' : ''} mapped
        </span>
      </div>

      <div className="map-wrapper glass has-header">
        {validComplaints.length === 0 ? (
          <div className="map-empty-box">
            <AlertTriangle size={32} style={{ opacity: 0.3 }} />
            <span>No incidents with valid coordinates match current filters</span>
          </div>
        ) : (
          <LeafletMapContainer
            center={center}
            zoom={defaultZoom}
            style={{ height: '100%', width: '100%', borderRadius: '0 0 14px 14px' }}
            zoomControl={true}
            attributionControl={true}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Auto-fit bounds */}
            <FitBounds complaints={validComplaints} selectedComplaint={selectedComplaint} />

            {/* Heatmap overlay — density circles */}
            {showHeatmap &&
              validComplaints.map((c) => (
                <CircleMarker
                  key={`heat-${c.id}`}
                  center={[c.lat, c.lng]}
                  radius={35}
                  pathOptions={{
                    color: 'transparent',
                    fillColor: '#f85149',
                    fillOpacity: 0.22,
                  }}
                />
              ))}

            {/* Complaint markers */}
            {!showHeatmap &&
              validComplaints.map((c) => {
                const isSelected = selectedComplaint && selectedComplaint.id === c.id;
                const markerColor = getMarkerColor(c.status);
                const isOverdue =
                  c.sla_deadline &&
                  c.status !== 'closed' &&
                  c.status !== 'verified' &&
                  c.status !== 'rejected' &&
                  new Date(c.sla_deadline) < new Date();

                return (
                  <CircleMarker
                    key={c.id}
                    center={[c.lat, c.lng]}
                    radius={isSelected ? 12 : 8}
                    pathOptions={{
                      color: isOverdue ? '#f85149' : '#ffffff',
                      weight: isSelected ? 3 : isOverdue ? 2.5 : 2,
                      fillColor: markerColor,
                      fillOpacity: 0.92,
                    }}
                  >
                    <Popup>
                      <div className="map-popup-card">
                        <div className="popup-header-row">
                          <span className="popup-issue-title">
                            {c.issue_class.replace(/_/g, ' ').toUpperCase()}
                          </span>
                          <span
                            className="popup-status-badge"
                            style={{ backgroundColor: markerColor }}
                          >
                            {c.status.replace(/_/g, ' ')}
                          </span>
                        </div>

                        {(c.blurred_image_url || c.image_url) && (
                          <img
                            src={c.blurred_image_url || c.image_url}
                            alt={c.issue_class}
                            className="popup-thumbnail"
                            onError={(e) => {
                              e.target.style.display = 'none';
                            }}
                          />
                        )}

                        <div className="popup-details-list">
                          <div>
                            <span className="popup-label">Dept: </span>
                            <strong>{c.department_name || 'Awaiting Routing'}</strong>
                          </div>
                          <div>
                            <span className="popup-label">Severity: </span>
                            <strong>
                              {c.severity_score !== null && c.severity_score !== undefined
                                ? Number(c.severity_score).toFixed(0)
                                : 'N/A'}{' '}
                              / 100
                            </strong>
                          </div>
                          {c.user_selected_category && (
                            <div>
                              <span className="popup-label">Citizen: </span>
                              <span>{c.user_selected_category}</span>
                            </div>
                          )}
                          {isOverdue && (
                            <div className="popup-alert-overdue">
                              <Clock size={11} /> SLA Deadline Overdue
                            </div>
                          )}
                          <div className="popup-coords-row">
                            📍 {Number(c.lat).toFixed(5)}, {Number(c.lng).toFixed(5)}
                          </div>
                        </div>

                        {onOpenDetails && (
                          <button
                            type="button"
                            className="popup-inspect-btn"
                            onClick={() => onOpenDetails(c)}
                          >
                            <Info size={12} /> Inspect Full Details
                          </button>
                        )}
                      </div>
                    </Popup>
                  </CircleMarker>
                );
              })}
          </LeafletMapContainer>
        )}

        {/* Legend overlay */}
        <div className="map-legend glass" style={{ zIndex: 1000 }}>
          <h4>Incident Status</h4>
          <div className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: '#d29922' }} />
            <span>Pending</span>
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: '#f0883e' }} />
            <span>Under Review</span>
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: '#58a6ff' }} />
            <span>Assigned</span>
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: '#1f6feb' }} />
            <span>In Progress</span>
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: '#3fb950' }} />
            <span>Closed / Resolved</span>
          </div>
          <div className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: '#f85149' }} />
            <span>Rejected / Duplicate</span>
          </div>
        </div>
      </div>
    </div>
  );
}
