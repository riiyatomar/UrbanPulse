import React, { useState, useEffect, useCallback, useMemo } from 'react';
import MetricCards from './components/MetricCards';
import Filters from './components/Filters';
import MapContainer from './components/MapContainer';
import ComplaintTable from './components/ComplaintTable';
import ComplaintDetailModal from './components/ComplaintDetailModal';
import DepartmentOperations from './components/DepartmentOperations';
import LoginScreen from './components/LoginScreen';
import {
  fetchComplaints,
  fetchComplaintStats,
  fetchDepartments,
  fetchComplaintById,
  fetchDepartmentOperations,
  setAuthExpiredCallback,
} from './services/adminApi';
import {
  login as authLogin,
  logout as authLogout,
  isAuthenticated,
  getUser,
} from './services/authService';
import {
  AlertCircle,
  RefreshCw,
  Clock,
  Building2,
  List,
  ShieldCheck,
  LogOut,
  User,
} from 'lucide-react';
import './App.css';

export default function App() {
  // Auth state
  const [authed, setAuthed] = useState(isAuthenticated());
  const [currentUser, setCurrentUser] = useState(getUser());

  const [complaints, setComplaints] = useState([]);
  const [stats, setStats] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState(null);

  // Filter States
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedStatus, setSelectedStatus] = useState('All');
  const [selectedIssueClass, setSelectedIssueClass] = useState('All');
  const [minSeverity, setMinSeverity] = useState(0);
  const [minPriority, setMinPriority] = useState(0);
  const [selectedSlaState, setSelectedSlaState] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [showHeatmap, setShowHeatmap] = useState(false);

  // Selection & Modal States
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [detailComplaint, setDetailComplaint] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [deptOperations, setDeptOperations] = useState([]);

  // Current date/time for header
  const [currentTime, setCurrentTime] = useState(new Date());

  // Role helpers
  const isAdmin = currentUser?.role === 'administrator';
  const isOfficer = currentUser?.role === 'department_officer';

  // Register 401 callback for auto-logout
  useEffect(() => {
    setAuthExpiredCallback(() => {
      setAuthed(false);
      setCurrentUser(null);
    });
  }, []);

  // Update clock every minute
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Login handler
  const handleLogin = async (email, password) => {
    const { token, user } = await authLogin(email, password);
    setCurrentUser(user);
    setAuthed(true);
  };

  // Logout handler
  const handleLogout = () => {
    authLogout();
    setAuthed(false);
    setCurrentUser(null);
    setComplaints([]);
    setStats(null);
    setDeptOperations([]);
  };

  // Authoritative Backend Data Fetch
  const loadData = useCallback(async () => {
    if (!authed) return;
    try {
      setLoading(true);
      setApiError(null);

      const promises = [
        fetchComplaints(),
        fetchComplaintStats().catch((err) => {
          console.warn('Failed to fetch stats, deriving locally:', err);
          return null;
        }),
        fetchDepartments().catch((err) => {
          console.warn('Failed to fetch departments:', err);
          return [];
        }),
      ];

      // Only admins can fetch department operations
      if (isAdmin) {
        promises.push(
          fetchDepartmentOperations().catch((err) => {
            console.warn('Failed to fetch department operations:', err);
            return [];
          })
        );
      } else {
        promises.push(Promise.resolve([]));
      }

      const [complaintsData, statsData, deptsData, opsData] = await Promise.all(promises);

      setComplaints(Array.isArray(complaintsData) ? complaintsData : []);
      if (statsData) setStats(statsData);
      if (Array.isArray(deptsData)) setDepartments(deptsData);
      if (Array.isArray(opsData)) setDeptOperations(opsData);
    } catch (err) {
      console.error('Backend connection error:', err);
      if (err.status === 401) return; // Auto-logout already handled
      setApiError(err.message || 'Unable to connect to UrbanPulse Ingestion backend');
      setComplaints([]);
    } finally {
      setLoading(false);
    }
  }, [authed, isAdmin]);

  useEffect(() => {
    if (authed) loadData();
  }, [authed, loadData]);

  // Client-side dynamic filtering over the authoritative list
  const filteredComplaints = useMemo(() => {
    return complaints.filter((c) => {
      // 1. Department
      if (selectedDept !== 'All') {
        if (c.department_name !== selectedDept) return false;
      }

      // 2. Status
      if (selectedStatus !== 'All') {
        if (c.status !== selectedStatus) return false;
      }

      // 3. Issue Class
      if (selectedIssueClass !== 'All') {
        if (c.issue_class !== selectedIssueClass) return false;
      }

      // 4. Min Severity
      if (minSeverity > 0) {
        if (c.severity_score === null || c.severity_score < minSeverity) return false;
      }

      // 5. Min Priority
      if (minPriority > 0) {
        if (c.priority_score === null || c.priority_score < minPriority) return false;
      }

      // 6. SLA State
      if (selectedSlaState === 'overdue') {
        if (
          !c.sla_deadline ||
          c.status === 'closed' ||
          c.status === 'verified' ||
          c.status === 'rejected' ||
          new Date(c.sla_deadline) >= new Date()
        ) {
          return false;
        }
      } else if (selectedSlaState === 'active') {
        if (
          c.status !== 'assigned' &&
          c.status !== 'in_progress'
        ) {
          return false;
        }
      }

      // 7. Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches =
          c.id.toLowerCase().includes(q) ||
          c.issue_class.toLowerCase().includes(q) ||
          (c.department_name && c.department_name.toLowerCase().includes(q)) ||
          (c.user_selected_category && c.user_selected_category.toLowerCase().includes(q)) ||
          (c.description && c.description.toLowerCase().includes(q)) ||
          (c.location_address && c.location_address.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [
    complaints,
    selectedDept,
    selectedStatus,
    selectedIssueClass,
    minSeverity,
    minPriority,
    selectedSlaState,
    searchQuery,
  ]);

  // Active filter count
  const activeFilterCount = useMemo(() => {
    return [
      selectedDept !== 'All',
      selectedStatus !== 'All',
      selectedIssueClass !== 'All',
      minSeverity > 0,
      minPriority > 0,
      selectedSlaState !== 'All',
      Boolean(searchQuery.trim()),
    ].filter(Boolean).length;
  }, [
    selectedDept,
    selectedStatus,
    selectedIssueClass,
    minSeverity,
    minPriority,
    selectedSlaState,
    searchQuery,
  ]);

  const resetFilters = () => {
    setSelectedDept('All');
    setSelectedStatus('All');
    setSelectedIssueClass('All');
    setMinSeverity(0);
    setMinPriority(0);
    setSelectedSlaState('All');
    setSearchQuery('');
  };

  // Card filter shortcut
  const handleFilterClick = (filterOverrides) => {
    if (filterOverrides.status !== undefined) {
      setSelectedStatus(filterOverrides.status);
    }
    if (filterOverrides.sla_state !== undefined) {
      setSelectedSlaState(filterOverrides.sla_state);
    }
    if (filterOverrides.min_priority !== undefined) {
      setMinPriority(filterOverrides.min_priority);
    }
  };

  // Map locate handler
  const handleSelectComplaint = (complaint) => {
    setSelectedComplaint(complaint);
    setShowHeatmap(false);
    const mapElement = document.querySelector('.map-wrapper');
    if (mapElement) {
      mapElement.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Modal open handler — always fetches full complaint data from API
  const handleOpenDetails = async (complaint) => {
    if (!complaint?.id) return;
    setIsDetailOpen(true);
    // Show what we have immediately, then enrich with full API data
    setDetailComplaint(complaint);
    try {
      const full = await fetchComplaintById(complaint.id);
      if (full) {
        setDetailComplaint(full);
      }
    } catch (err) {
      console.error('Failed to fetch full complaint details:', err);
      // Keep the partial data already set above
    }
  };

  // Handler when a complaint is updated in modal (status or assignment)
  const handleComplaintUpdated = (updated) => {
    setComplaints((prev) =>
      prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c))
    );
    setDetailComplaint((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
    // Refetch live stats
    fetchComplaintStats().then((st) => st && setStats(st)).catch(() => {});
  };

  // Inspect duplicate parent complaint
  const handleSelectDuplicateOf = async (parentId) => {
    try {
      const parent = await fetchComplaintById(parentId);
      if (parent) {
        setDetailComplaint(parent);
      }
    } catch (err) {
      console.error('Failed to load parent duplicate complaint:', err);
    }
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ── If not authenticated, show login screen ──
  if (!authed) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app-container">
      {/* Top Navigation Bar */}
      <header className="dashboard-header">
        <div className="header-left">
          <div className="header-logo">UP</div>
          <div className="header-text">
            <h1>UrbanPulse Municipal Operations</h1>
            <span className="header-subtitle">
              Civic Infrastructure Monitoring & Triage Dashboard
            </span>
          </div>
        </div>

        <div className="header-right">
          <div className="header-date">
            <span className="date-value">{formatDate(currentTime)}</span>
            <span>{formatTime(currentTime)}</span>
          </div>

          <div className="header-status">
            <button
              className="refresh-data-btn"
              onClick={loadData}
              title="Reload live database complaints"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'spinning' : ''} />
              <span>Refresh</span>
            </button>

            <span className="live-indicator"></span>
            <span className="live-text">Live DB</span>
          </div>

          {/* User info & logout */}
          <div className="header-user-info">
            <User size={14} />
            <span className="user-name" title={currentUser?.email}>
              {currentUser?.name || currentUser?.email || 'User'}
            </span>
            <span className="user-role-badge">
              {isAdmin ? 'Admin' : 'Officer'}
            </span>
            <button
              className="logout-btn"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </header>

      {/* API Error Notification */}
      {apiError && (
        <div className="error-banner glass">
          <AlertCircle size={20} className="accent-red" />
          <div className="error-banner-content">
            <strong>Backend Connection Notice:</strong>
            <span> {apiError}</span>
          </div>
          <button className="retry-btn" onClick={loadData}>
            Retry
          </button>
        </div>
      )}

      {/* Main Content */}
      {loading && complaints.length === 0 ? (
        <div className="loading-container">
          <div className="skeleton-metrics">
            <div className="skeleton-card"></div>
            <div className="skeleton-card"></div>
            <div className="skeleton-card"></div>
            <div className="skeleton-card"></div>
          </div>
          <div className="skeleton-body">
            <div className="skeleton-sidebar"></div>
            <div className="skeleton-main">
              <div className="skeleton-map"></div>
              <div className="skeleton-table"></div>
            </div>
          </div>
          <div className="loading-text">
            <div className="loading-spinner"></div>
            Querying UrbanPulse live database feed...
          </div>
        </div>
      ) : (
        <>
          {/* Real Authoritative KPI Cards */}
          <MetricCards
            complaints={complaints}
            stats={stats}
            onFilterClick={handleFilterClick}
          />

          <div className="dashboard-content">
            {/* Control Panel / Sidebar Filters */}
            <Filters
              selectedDept={selectedDept}
              setSelectedDept={setSelectedDept}
              selectedStatus={selectedStatus}
              setSelectedStatus={setSelectedStatus}
              selectedIssueClass={selectedIssueClass}
              setSelectedIssueClass={setSelectedIssueClass}
              minSeverity={minSeverity}
              setMinSeverity={setMinSeverity}
              minPriority={minPriority}
              setMinPriority={setMinPriority}
              selectedSlaState={selectedSlaState}
              setSelectedSlaState={setSelectedSlaState}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              showHeatmap={showHeatmap}
              setShowHeatmap={setShowHeatmap}
              departments={departments}
              activeFilterCount={activeFilterCount}
              onResetFilters={resetFilters}
            />

            {/* Map and Registry Section */}
            <main className="main-section">
              <MapContainer
                complaints={filteredComplaints}
                showHeatmap={showHeatmap}
                selectedComplaint={selectedComplaint}
                onOpenDetails={handleOpenDetails}
              />

              {/* Department Operations — admin only */}
              {isAdmin && (
                <DepartmentOperations
                  operations={deptOperations}
                  departments={departments}
                  onOpenDetails={handleOpenDetails}
                  onRefresh={loadData}
                  loading={loading}
                />
              )}

              <ComplaintTable
                complaints={filteredComplaints}
                onSelectComplaint={handleSelectComplaint}
                onOpenDetails={handleOpenDetails}
                loading={loading}
              />
            </main>
          </div>
        </>
      )}

      {/* Complaint Details & Operational Management Modal */}
      <ComplaintDetailModal
        complaint={detailComplaint}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        onComplaintUpdated={handleComplaintUpdated}
        departments={departments}
        onSelectDuplicateOf={handleSelectDuplicateOf}
        userRole={currentUser?.role}
      />
    </div>
  );
}
