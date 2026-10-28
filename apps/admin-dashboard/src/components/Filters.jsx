import React from 'react';
import {
  Filter,
  Eye,
  ShieldAlert,
  Building2,
  Activity,
  Layers,
  Clock,
  Search,
  RotateCcw,
} from 'lucide-react';

const CIVIC_ISSUE_CLASSES = [
  'pothole',
  'streetlight',
  'manhole',
  'dead_animal',
  'tree',
  'damaged_public_property',
  'waterlogging',
  'mud_road',
  'erosion',
  'footpath_damage',
  'encroachment',
];

const STATUS_LIST = [
  'pending',
  'under_review',
  'assigned',
  'in_progress',
  'repaired',
  'verified',
  'closed',
  'rejected',
];

export default function Filters({
  selectedDept,
  setSelectedDept,
  selectedStatus,
  setSelectedStatus,
  selectedIssueClass,
  setSelectedIssueClass,
  minSeverity,
  setMinSeverity,
  minPriority,
  setMinPriority,
  selectedSlaState,
  setSelectedSlaState,
  searchQuery,
  setSearchQuery,
  showHeatmap,
  setShowHeatmap,
  departments = [],
  activeFilterCount = 0,
  onResetFilters,
}) {
  return (
    <aside className="filters-sidebar glass">
      <div className="sidebar-header">
        <div className="sidebar-header-left">
          <Filter className="sidebar-icon" size={16} />
          <h2>Control Panel</h2>
          {activeFilterCount > 0 && (
            <span className="active-filter-count">{activeFilterCount}</span>
          )}
        </div>
        {activeFilterCount > 0 && onResetFilters && (
          <button className="reset-filters-btn" onClick={onResetFilters} title="Clear all filters">
            <RotateCcw size={12} /> Reset
          </button>
        )}
      </div>

      {/* Search Filter */}
      <div className="filter-group">
        <label htmlFor="search-input">
          <Search size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Search
        </label>
        <input
          id="search-input"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search ID, address, text..."
          className="form-control"
        />
      </div>

      {/* Status Filter */}
      <div className="filter-group">
        <label htmlFor="status-select">
          <Activity size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Lifecycle Status
        </label>
        <select
          id="status-select"
          value={selectedStatus}
          onChange={(e) => setSelectedStatus(e.target.value)}
          className="form-control"
        >
          <option value="All">All Statuses</option>
          {STATUS_LIST.map((status) => (
            <option key={status} value={status}>
              {status.replace(/_/g, ' ').toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Issue Class Filter */}
      <div className="filter-group">
        <label htmlFor="issue-class-select">
          <Layers size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Issue Class (11 Civic)
        </label>
        <select
          id="issue-class-select"
          value={selectedIssueClass}
          onChange={(e) => setSelectedIssueClass(e.target.value)}
          className="form-control"
        >
          <option value="All">All Issue Classes</option>
          {CIVIC_ISSUE_CLASSES.map((cls) => (
            <option key={cls} value={cls}>
              {cls.replace(/_/g, ' ').toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Department Filter */}
      <div className="filter-group">
        <label htmlFor="dept-select">
          <Building2 size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Municipal Department
        </label>
        <select
          id="dept-select"
          value={selectedDept}
          onChange={(e) => setSelectedDept(e.target.value)}
          className="form-control"
        >
          <option value="All">All Departments</option>
          {departments.map((dept) => (
            <option key={dept.id || dept.name} value={dept.name}>
              {dept.name}
            </option>
          ))}
        </select>
      </div>

      {/* SLA State Filter */}
      <div className="filter-group">
        <label htmlFor="sla-select">
          <Clock size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          SLA State
        </label>
        <select
          id="sla-select"
          value={selectedSlaState}
          onChange={(e) => setSelectedSlaState(e.target.value)}
          className="form-control"
        >
          <option value="All">All SLA States</option>
          <option value="overdue">⚠️ Overdue / Breached Only</option>
          <option value="active">Active SLA Only</option>
        </select>
      </div>

      {/* Min Severity Slider */}
      <div className="filter-group">
        <div className="slider-label">
          <label htmlFor="severity-slider">
            <ShieldAlert size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            Min Severity
          </label>
          <span className="slider-value">{minSeverity}</span>
        </div>
        <input
          id="severity-slider"
          type="range"
          min="0"
          max="100"
          value={minSeverity}
          onChange={(e) => setMinSeverity(Number(e.target.value))}
          className="range-slider"
        />
      </div>

      {/* Min Priority Slider */}
      <div className="filter-group">
        <div className="slider-label">
          <label htmlFor="priority-slider">
            <Activity size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
            Min Priority
          </label>
          <span className="slider-value">{minPriority}</span>
        </div>
        <input
          id="priority-slider"
          type="range"
          min="0"
          max="100"
          value={minPriority}
          onChange={(e) => setMinPriority(Number(e.target.value))}
          className="range-slider"
        />
      </div>

      <hr className="divider" />

      {/* Heatmap Overlay Toggle */}
      <div className="toggle-group">
        <div className="toggle-label-wrapper">
          <Eye size={16} className="toggle-icon" />
          <label htmlFor="heatmap-toggle">Complaint Density</label>
        </div>
        <div className="switch-wrapper">
          <input
            id="heatmap-toggle"
            type="checkbox"
            checked={showHeatmap}
            onChange={(e) => setShowHeatmap(e.target.checked)}
            className="switch-input"
          />
          <span className="switch-slider"></span>
        </div>
      </div>
    </aside>
  );
}
