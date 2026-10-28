import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Calendar,
  MapPin,
  Building2,
  ShieldAlert,
  AlertTriangle,
  Clock,
  Layers,
  CheckCircle,
  Copy,
  ExternalLink,
  Shield,
  Eye,
  EyeOff,
  User,
  Sparkles,
  ArrowRight,
  History,
  AlertCircle,
} from 'lucide-react';
import { updateComplaintStatus, assignDepartment, fetchStatusHistory } from '../services/adminApi';

const VALID_STATUS_TRANSITIONS = {
  pending: ['under_review', 'assigned', 'rejected'],
  under_review: ['assigned', 'in_progress', 'rejected'],
  assigned: ['in_progress', 'under_review', 'rejected'],
  in_progress: ['repaired', 'under_review'],
  repaired: ['verified', 'in_progress'],
  verified: ['closed', 'in_progress'],
  closed: ['in_progress', 'under_review'],
  rejected: ['under_review'],
};

export default function ComplaintDetailModal({
  complaint,
  isOpen,
  onClose,
  onComplaintUpdated,
  departments = [],
  onSelectDuplicateOf,
}) {
  const [activeStatus, setActiveStatus] = useState(complaint?.status || 'pending');
  const [selectedDeptId, setSelectedDeptId] = useState(complaint?.department_id || '');
  const [statusNotes, setStatusNotes] = useState('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [deptUpdating, setDeptUpdating] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [showOriginalImage, setShowOriginalImage] = useState(false);
  const [copied, setCopied] = useState(false);

  // Status history state
  const [statusHistory, setStatusHistory] = useState(complaint?.status_history || []);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Confirmation modal state for consequential changes
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingTargetStatus, setPendingTargetStatus] = useState(null);

  const loadHistory = useCallback(async (complaintId) => {
    if (!complaintId) return;
    try {
      setHistoryLoading(true);
      const history = await fetchStatusHistory(complaintId);
      if (Array.isArray(history)) {
        setStatusHistory(history);
      }
    } catch (err) {
      console.warn('Could not fetch status history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (complaint) {
      setActiveStatus(complaint.status);
      setSelectedDeptId(complaint.department_id || '');
      setStatusNotes('');
      setActionError(null);
      setActionSuccess(null);
      setShowOriginalImage(false);
      setShowConfirm(false);
      setPendingTargetStatus(null);

      if (complaint.status_history && complaint.status_history.length > 0) {
        setStatusHistory(complaint.status_history);
      } else {
        loadHistory(complaint.id);
      }
    }
  }, [complaint, loadHistory]);

  if (!isOpen || !complaint) return null;

  const handleCopyId = () => {
    if (complaint?.id) {
      navigator.clipboard.writeText(complaint.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Valid next status options according to municipal state machine
  const validNextOptions = VALID_STATUS_TRANSITIONS[complaint.status] || [];
  const selectableStatuses = Array.from(new Set([complaint.status, ...validNextOptions]));

  const isConsequentialChange = (fromStatus, toStatus) => {
    if (toStatus === 'closed' || toStatus === 'rejected') return true;
    if ((fromStatus === 'closed' || fromStatus === 'rejected') && toStatus !== fromStatus) return true;
    return false;
  };

  const handleInitiateStatusChange = () => {
    if (activeStatus === complaint.status) return;

    if (isConsequentialChange(complaint.status, activeStatus)) {
      setPendingTargetStatus(activeStatus);
      setShowConfirm(true);
    } else {
      executeStatusChange(activeStatus);
    }
  };

  const executeStatusChange = async (targetStatus) => {
    setStatusUpdating(true);
    setActionError(null);
    setActionSuccess(null);
    setShowConfirm(false);
    try {
      const updated = await updateComplaintStatus(
        complaint.id,
        targetStatus,
        statusNotes.trim() || null,
        'admin_operator'
      );
      setActionSuccess(`Status successfully transitioned to "${targetStatus.replace('_', ' ').toUpperCase()}"`);
      setStatusNotes('');
      if (updated?.status_history) {
        setStatusHistory(updated.status_history);
      } else {
        loadHistory(complaint.id);
      }
      if (onComplaintUpdated) onComplaintUpdated(updated);
    } catch (err) {
      setActionError(err.message || 'Failed to update complaint status');
    } finally {
      setStatusUpdating(false);
      setPendingTargetStatus(null);
    }
  };

  const handleDepartmentAssign = async () => {
    if (!selectedDeptId || selectedDeptId === complaint.department_id) return;
    setDeptUpdating(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const updated = await assignDepartment(complaint.id, selectedDeptId);
      setActionSuccess('Department assigned successfully');
      if (updated?.status_history) {
        setStatusHistory(updated.status_history);
      } else {
        loadHistory(complaint.id);
      }
      if (onComplaintUpdated) onComplaintUpdated(updated);
    } catch (err) {
      setActionError(err.message || 'Failed to assign department');
    } finally {
      setDeptUpdating(false);
    }
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return 'Not available';
    return new Date(isoStr).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isSlaBreached = () => {
    if (!complaint.sla_deadline) return false;
    if (complaint.status === 'closed' || complaint.status === 'verified' || complaint.status === 'rejected') {
      return false;
    }
    return new Date(complaint.sla_deadline) < new Date();
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'pending': return 'badge-yellow';
      case 'under_review': return 'badge-orange';
      case 'assigned': return 'badge-blue';
      case 'in_progress': return 'badge-blue-dark';
      case 'repaired': return 'badge-cyan';
      case 'verified':
      case 'closed': return 'badge-green';
      case 'rejected': return 'badge-red';
      default: return 'badge-gray';
    }
  };

  const activeImageSrc = showOriginalImage
    ? (complaint.image_url || complaint.blurred_image_url)
    : (complaint.blurred_image_url || complaint.image_url);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog glass-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title-group">
            <div className="modal-badge-row">
              <span className={`status-badge ${getStatusBadgeClass(complaint.status)}`}>
                {complaint.status.replace(/_/g, ' ').toUpperCase()}
              </span>
              {complaint.status === 'under_review' && (
                <span className="badge-warning-chip">
                  <AlertTriangle size={12} /> Under Review (Confidence &lt; 40%)
                </span>
              )}
              {complaint.status === 'rejected' && (
                <span className="badge-danger-chip">
                  <ShieldAlert size={12} /> Duplicate / Rejected
                </span>
              )}
              {isSlaBreached() && (
                <span className="badge-breached-chip">
                  <Clock size={12} /> SLA Overdue
                </span>
              )}
            </div>
            <h2 className="modal-title">
              {complaint.issue_class.replace(/_/g, ' ').toUpperCase()}
            </h2>
            <div className="modal-id-row">
              <span className="modal-id-text">ID: {complaint.id}</span>
              <button
                className="copy-btn"
                onClick={handleCopyId}
                title="Copy Complaint ID"
              >
                <Copy size={13} />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>

        {/* Action feedback banners */}
        {actionSuccess && (
          <div className="modal-alert alert-success">
            <CheckCircle size={16} />
            <span>{actionSuccess}</span>
          </div>
        )}
        {actionError && (
          <div className="modal-alert alert-error">
            <AlertTriangle size={16} />
            <span>{actionError}</span>
          </div>
        )}

        {/* Consequential action confirmation banner */}
        {showConfirm && (
          <div className="modal-alert alert-warning-confirm">
            <AlertCircle size={18} />
            <div className="confirm-text">
              <strong>Confirm Consequential Status Change:</strong>
              <span>
                {' '}Transitioning complaint from <strong>{complaint.status.toUpperCase()}</strong> to{' '}
                <strong>{pendingTargetStatus?.toUpperCase()}</strong>.
                {pendingTargetStatus === 'closed' && ' This will mark the complaint closed and set closed_at.'}
                {pendingTargetStatus === 'rejected' && ' This will reject the complaint.'}
                {(complaint.status === 'closed' || complaint.status === 'rejected') &&
                  ' This will REOPEN the complaint and reset closed_at to null.'}
              </span>
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="btn-confirm-yes"
                onClick={() => executeStatusChange(pendingTargetStatus)}
                disabled={statusUpdating}
              >
                {statusUpdating ? 'Applying...' : 'Yes, Confirm'}
              </button>
              <button
                type="button"
                className="btn-confirm-cancel"
                onClick={() => setShowConfirm(false)}
                disabled={statusUpdating}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="modal-body-grid">
          {/* Left Column: Image, Privacy & Deduplication */}
          <div className="modal-media-col">
            <div className="image-viewer-box">
              <img
                src={activeImageSrc}
                alt={complaint.issue_class}
                className="modal-complaint-img"
                onError={(e) => {
                  e.target.src = 'https://placehold.co/400x300/161b22/8b949e?text=Image+Unavailable';
                }}
              />
              <div className="image-privacy-tag">
                {showOriginalImage ? (
                  <span className="privacy-badge raw">
                    <Eye size={12} /> Raw Image (Operator Verification)
                  </span>
                ) : (
                  <span className="privacy-badge safe">
                    <Shield size={12} /> Privacy Safe (Faces & Plates Blurred)
                  </span>
                )}
              </div>
            </div>

            {/* Privacy toggle */}
            {complaint.blurred_image_url && complaint.image_url && (
              <div className="image-toggle-row">
                <button
                  type="button"
                  className={`image-toggle-btn ${!showOriginalImage ? 'active' : ''}`}
                  onClick={() => setShowOriginalImage(false)}
                >
                  <EyeOff size={14} /> Anonymized View
                </button>
                <button
                  type="button"
                  className={`image-toggle-btn ${showOriginalImage ? 'active' : ''}`}
                  onClick={() => setShowOriginalImage(true)}
                >
                  <Eye size={14} /> Raw Original
                </button>
              </div>
            )}

            {/* Deduplication Context */}
            {complaint.duplicate_of_id && (
              <div className="dedup-info-card glass">
                <div className="dedup-header">
                  <Layers size={14} className="accent-red" />
                  <strong>Semantic Duplicate Detected</strong>
                </div>
                <p className="dedup-desc">
                  This incident was identified as a duplicate via pgvector embedding similarity.
                </p>
                <div className="duplicate-ref">
                  <span>Parent Issue: </span>
                  <code className="uuid-code">{complaint.duplicate_of_id}</code>
                  {onSelectDuplicateOf && (
                    <button
                      className="view-parent-btn"
                      onClick={() => onSelectDuplicateOf(complaint.duplicate_of_id)}
                      title="Inspect original parent complaint"
                    >
                      <ExternalLink size={12} /> View Parent
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Status History & Audit Timeline */}
            <div className="status-history-container glass">
              <div className="status-history-header">
                <History size={14} />
                <strong>Lifecycle Status Timeline ({statusHistory.length})</strong>
              </div>
              {historyLoading && statusHistory.length === 0 ? (
                <div className="history-loading">Loading timeline...</div>
              ) : statusHistory.length === 0 ? (
                <div className="history-empty">No status changes recorded yet.</div>
              ) : (
                <div className="history-timeline-list">
                  {statusHistory.map((item, idx) => (
                    <div key={item.id || idx} className="history-timeline-item">
                      <div className="history-node-col">
                        <div className={`history-dot ${getStatusBadgeClass(item.new_status)}`} />
                        {idx < statusHistory.length - 1 && <div className="history-line" />}
                      </div>
                      <div className="history-content-col">
                        <div className="history-status-row">
                          <span className={`status-badge-compact ${getStatusBadgeClass(item.new_status)}`}>
                            {item.new_status.replace(/_/g, ' ').toUpperCase()}
                          </span>
                          <span className="history-time">{formatDate(item.changed_at)}</span>
                        </div>
                        <div className="history-actor">
                          <span>Initiated by: {item.actor ? item.actor.replace(/_/g, ' ') : 'system'}</span>
                        </div>
                        {item.notes && <div className="history-notes">"{item.notes}"</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Metadata & Operations */}
          <div className="modal-details-col">
            {/* Classification & Authority Section */}
            <section className="detail-section">
              <h3 className="section-title">
                <Sparkles size={14} /> Classification & Authority
              </h3>
              <div className="detail-grid-2">
                <div className="detail-cell">
                  <span className="detail-label">ML Issue Class (Authoritative)</span>
                  <span className="detail-value highlight">
                    {complaint.issue_class.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">Detection Confidence</span>
                  <span className="detail-value">
                    {complaint.confidence !== null && complaint.confidence !== undefined
                      ? `${(complaint.confidence * 100).toFixed(1)}%`
                      : 'N/A'}
                  </span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">Citizen Selected Category</span>
                  <span className="detail-value">
                    {complaint.user_selected_category || 'None provided'}
                  </span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">Source</span>
                  <span className="detail-value capitalize">{complaint.source || 'mobile_app'}</span>
                </div>
              </div>

              {complaint.description && (
                <div className="citizen-description-box">
                  <span className="detail-label">Citizen Description:</span>
                  <p className="description-text">"{complaint.description}"</p>
                </div>
              )}
            </section>

            {/* Geolocation Section */}
            <section className="detail-section">
              <h3 className="section-title">
                <MapPin size={14} /> Geolocation & Positioning
              </h3>
              <div className="detail-grid-2">
                <div className="detail-cell">
                  <span className="detail-label">Canonical Coordinates</span>
                  <span className="detail-value mono">
                    {Number(complaint.lat).toFixed(6)}, {Number(complaint.lng).toFixed(6)}
                  </span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">Location Source</span>
                  <span className="detail-value capitalize">
                    {complaint.location_source?.replace(/_/g, ' ') || 'device'}
                  </span>
                </div>
                <div className="detail-cell full-span">
                  <span className="detail-label">Location Address (Nominatim OSM)</span>
                  <span className="detail-value">
                    {complaint.location_address || 'Address unlisted (raw GPS canonical)'}
                  </span>
                </div>
                {complaint.location_accuracy !== null && complaint.location_accuracy !== undefined && (
                  <div className="detail-cell">
                    <span className="detail-label">Sensor Accuracy</span>
                    <span className="detail-value">±{Number(complaint.location_accuracy).toFixed(1)} m</span>
                  </div>
                )}
              </div>
            </section>

            {/* Operations & Scoring Section */}
            <section className="detail-section">
              <h3 className="section-title">
                <ShieldAlert size={14} /> Severity, Priority & SLA
              </h3>
              <div className="detail-grid-3">
                <div className="detail-cell">
                  <span className="detail-label">Severity Score</span>
                  <span className={`score-pill ${complaint.severity_score >= 70 ? 'high' : complaint.severity_score >= 40 ? 'med' : 'low'}`}>
                    {complaint.severity_score !== null ? Number(complaint.severity_score).toFixed(0) : 'N/A'} / 100
                  </span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">Priority Score</span>
                  <span className={`score-pill ${complaint.priority_score >= 70 ? 'high' : complaint.priority_score >= 40 ? 'med' : 'low'}`}>
                    {complaint.priority_score !== null ? Number(complaint.priority_score).toFixed(0) : 'N/A'} / 100
                  </span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">SLA Status</span>
                  <span className={`detail-value ${isSlaBreached() ? 'accent-red' : ''}`}>
                    {isSlaBreached() ? '⚠️ Overdue' : 'Active'}
                  </span>
                </div>
              </div>
              <div className="detail-grid-2" style={{ marginTop: 8 }}>
                <div className="detail-cell">
                  <span className="detail-label">SLA Deadline</span>
                  <span className="detail-value">{formatDate(complaint.sla_deadline)}</span>
                </div>
                <div className="detail-cell">
                  <span className="detail-label">Assigned Department</span>
                  <span className="detail-value highlight">
                    {complaint.department_name || 'Awaiting Routing'}
                  </span>
                </div>
              </div>
            </section>

            {/* Operational Management Actions */}
            <section className="detail-section action-box glass">
              <h3 className="section-title">
                <Building2 size={14} /> Municipal Operations & Status Control
              </h3>

              {/* Status transition control */}
              <div className="management-control-row">
                <div className="control-field">
                  <label htmlFor="modal-status-select" className="control-label">
                    Update Lifecycle Status:
                  </label>
                  <select
                    id="modal-status-select"
                    value={activeStatus}
                    onChange={(e) => setActiveStatus(e.target.value)}
                    className="form-control select-dark"
                  >
                    {selectableStatuses.map((st) => (
                      <option key={st} value={st}>
                        {st === complaint.status
                          ? `● Current: ${st.replace(/_/g, ' ').toUpperCase()}`
                          : `→ ${st.replace(/_/g, ' ').toUpperCase()}`}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-primary update-btn"
                  onClick={handleInitiateStatusChange}
                  disabled={statusUpdating || activeStatus === complaint.status}
                >
                  {statusUpdating ? 'Saving...' : 'Apply Status'}
                </button>
              </div>

              {/* Optional operator notes input */}
              {activeStatus !== complaint.status && (
                <div className="status-notes-field" style={{ marginTop: 8 }}>
                  <label className="control-label" htmlFor="modal-notes-input">
                    Transition Notes / Rationale (Optional):
                  </label>
                  <input
                    id="modal-notes-input"
                    type="text"
                    className="form-control"
                    placeholder="e.g. Work crew dispatched to site"
                    value={statusNotes}
                    onChange={(e) => setStatusNotes(e.target.value)}
                    maxLength={300}
                  />
                </div>
              )}

              {/* Department assignment control */}
              <div className="management-control-row" style={{ marginTop: 14 }}>
                <div className="control-field">
                  <label htmlFor="modal-dept-select" className="control-label">
                    Reassign Municipal Department:
                  </label>
                  <select
                    id="modal-dept-select"
                    value={selectedDeptId}
                    onChange={(e) => setSelectedDeptId(e.target.value)}
                    className="form-control select-dark"
                  >
                    <option value="">Select Department</option>
                    {departments.map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn-secondary assign-btn"
                  onClick={handleDepartmentAssign}
                  disabled={deptUpdating || !selectedDeptId || selectedDeptId === complaint.department_id}
                >
                  {deptUpdating ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </section>

            {/* Timestamps */}
            <div className="modal-timestamps-footer">
              <span>Created: {formatDate(complaint.created_at)}</span>
              {complaint.updated_at && (
                <span>Updated: {formatDate(complaint.updated_at)}</span>
              )}
              {complaint.closed_at && (
                <span>Closed: {formatDate(complaint.closed_at)}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
