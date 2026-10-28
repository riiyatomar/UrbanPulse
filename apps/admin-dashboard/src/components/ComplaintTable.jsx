import React, { useState, useMemo } from 'react';
import {
  Calendar,
  ExternalLink,
  Search,
  List,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Clock,
  Layers,
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

export default function ComplaintTable({
  complaints = [],
  onSelectComplaint,
  onOpenDetails,
  loading = false,
}) {
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [localSearch, setLocalSearch] = useState('');
  const [sortField, setSortField] = useState('created_at');
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' or 'desc'

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

  const formatDate = (isoStr) => {
    if (!isoStr) return 'N/A';
    return new Date(isoStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOverdue = (slaDeadline, status) => {
    if (!slaDeadline) return false;
    if (status === 'closed' || status === 'verified' || status === 'rejected') return false;
    return new Date(slaDeadline) < new Date();
  };

  // Toggle or change sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Filter complaints by local quick search
  const filtered = useMemo(() => {
    if (!localSearch.trim()) return complaints;
    const q = localSearch.toLowerCase().trim();
    return complaints.filter((c) =>
      (c.issue_class && c.issue_class.toLowerCase().includes(q)) ||
      (c.department_name && c.department_name.toLowerCase().includes(q)) ||
      (c.status && c.status.toLowerCase().includes(q)) ||
      (c.id && c.id.toLowerCase().includes(q)) ||
      (c.user_selected_category && c.user_selected_category.toLowerCase().includes(q)) ||
      (c.location_address && c.location_address.toLowerCase().includes(q))
    );
  }, [complaints, localSearch]);

  // Sort complaints
  const sorted = useMemo(() => {
    const list = [...filtered];
    return list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'created_at' || sortField === 'sla_deadline') {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      } else if (sortField === 'severity_score' || sortField === 'priority_score') {
        valA = valA !== null && valA !== undefined ? Number(valA) : -1;
        valB = valB !== null && valB !== undefined ? Number(valB) : -1;
      } else if (typeof valA === 'string') {
        valA = valA.toLowerCase();
        valB = (valB || '').toLowerCase();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDirection]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageComplaints = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, currentPage, pageSize]);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const renderSortIndicator = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown size={12} style={{ opacity: 0.35, marginLeft: 4 }} />;
    }
    return sortDirection === 'asc'
      ? <ArrowUp size={12} style={{ color: 'var(--accent-blue)', marginLeft: 4 }} />
      : <ArrowDown size={12} style={{ color: 'var(--accent-blue)', marginLeft: 4 }} />;
  };

  return (
    <div className="table-container-section">
      <div className="table-section-header">
        <span className="table-section-title">
          <List size={16} />
          Complaint Registry — {sorted.length} record{sorted.length !== 1 ? 's' : ''}
        </span>
        <div className="table-header-controls">
          <div className="table-search-wrapper">
            <Search size={14} />
            <input
              type="text"
              className="table-search"
              placeholder="Search in table..."
              value={localSearch}
              onChange={(e) => {
                setLocalSearch(e.target.value);
                setCurrentPage(1);
              }}
            />
          </div>
          <div className="page-size-selector">
            <span>Show:</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setCurrentPage(1);
              }}
              className="form-control select-compact"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
            </select>
          </div>
        </div>
      </div>

      <div className="table-wrapper glass has-header">
        {loading ? (
          <div className="table-loading-box">
            <div className="loading-spinner"></div>
            <span>Loading complaints registry...</span>
          </div>
        ) : sorted.length === 0 ? (
          <div className="table-empty">
            <List size={32} style={{ opacity: 0.3 }} />
            <span>{complaints.length === 0 ? 'No complaints found' : 'No complaints match current filters or search criteria.'}</span>
          </div>
        ) : (
          <table className="complaint-table">
            <thead>
              <tr>
                <th>Thumbnail</th>
                <th
                  onClick={() => handleSort('issue_class')}
                  style={{ cursor: 'pointer' }}
                  title="Sort by Issue Class"
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Issue & Authority {renderSortIndicator('issue_class')}
                  </div>
                </th>
                <th>Department</th>
                <th
                  onClick={() => handleSort('severity_score')}
                  style={{ cursor: 'pointer' }}
                  title="Sort by Severity"
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Severity {renderSortIndicator('severity_score')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('priority_score')}
                  style={{ cursor: 'pointer' }}
                  title="Sort by Priority"
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Priority {renderSortIndicator('priority_score')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('status')}
                  style={{ cursor: 'pointer' }}
                  title="Sort by Status"
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                    Status {renderSortIndicator('status')}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('sla_deadline')}
                  style={{ cursor: 'pointer' }}
                  title="Sort by SLA Deadline"
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center' }}>
                    SLA Deadline {renderSortIndicator('sla_deadline')}
                  </div>
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageComplaints.map((c) => {
                const overdue = isOverdue(c.sla_deadline, c.status);
                return (
                  <tr key={c.id} className={overdue ? 'row-overdue' : ''}>
                    <td>
                      <img
                        src={c.blurred_image_url || c.image_url}
                        alt={c.issue_class}
                        className="table-thumbnail"
                        onError={(e) => {
                          e.target.src = 'https://placehold.co/60x60/161b22/484f58?text=No+Photo';
                        }}
                      />
                    </td>
                    <td>
                      <div className="issue-cell">
                        <div className="issue-title">
                          {c.issue_class.replace(/_/g, ' ').toUpperCase()}
                        </div>
                        {c.user_selected_category && (
                          <div className="citizen-category-tag">
                            Citizen reported: {c.user_selected_category}
                          </div>
                        )}
                        <div className="issue-meta">
                          <span>GPS: {Number(c.lat).toFixed(4)}, {Number(c.lng).toFixed(4)}</span>
                        </div>
                        {c.duplicate_of_id && (
                          <div
                            className="duplicate-tag clickable"
                            title={`Duplicate of parent: ${c.duplicate_of_id}. Click to view details.`}
                            onClick={() => onOpenDetails && onOpenDetails(c)}
                          >
                            <Layers size={10} /> Duplicate
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="dept-text">
                        {c.department_name || 'Awaiting Routing'}
                      </span>
                    </td>
                    <td>
                      <span className={`score-badge ${c.severity_score >= 70 ? 'high-score' : c.severity_score >= 40 ? 'med-score' : 'low-score'}`}>
                        {c.severity_score !== null && c.severity_score !== undefined ? Number(c.severity_score).toFixed(0) : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className={`score-badge ${c.priority_score >= 70 ? 'high-score' : c.priority_score >= 40 ? 'med-score' : 'low-score'}`}>
                        {c.priority_score !== null && c.priority_score !== undefined ? Number(c.priority_score).toFixed(0) : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <div className="status-cell-group">
                        <span className={`status-badge ${getStatusBadgeClass(c.status)}`}>
                          {c.status.replace(/_/g, ' ').toUpperCase()}
                        </span>
                        {c.status === 'under_review' && (
                          <span className="mini-review-tag" title="Awaiting human verification">
                            <AlertTriangle size={10} /> Under Review
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={`sla-cell ${overdue ? 'sla-overdue' : ''}`}>
                        <Calendar size={13} className="sla-icon" />
                        <span>{formatDate(c.sla_deadline)}</span>
                        {overdue && (
                          <span className="sla-breached-alert" title="Response deadline breached!">
                            <Clock size={11} /> Overdue
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="table-actions-row">
                        <button
                          onClick={() => onOpenDetails && onOpenDetails(c)}
                          className="action-btn btn-details"
                          title="View Full Complaint Details"
                        >
                          <Info size={13} />
                          <span>Details</span>
                        </button>
                        <button
                          onClick={() => onSelectComplaint && onSelectComplaint(c)}
                          className="action-btn btn-locate"
                          title="Locate on Map"
                        >
                          <ExternalLink size={13} />
                          <span>Locate</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination Footer */}
        {sorted.length > pageSize && (
          <div className="table-pagination glass">
            <span className="pagination-info">
              Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, sorted.length)} of {sorted.length} records
            </span>
            <div className="pagination-buttons">
              <button
                className="page-btn"
                disabled={currentPage === 1}
                onClick={() => handlePageChange(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} /> Prev
              </button>
              <span className="page-indicator">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="page-btn"
                disabled={currentPage === totalPages}
                onClick={() => handlePageChange(currentPage + 1)}
                aria-label="Next page"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
