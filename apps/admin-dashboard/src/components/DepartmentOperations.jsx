import React, { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Bell,
  Clock,
  CheckCircle2,
  AlertCircle,
  Play,
  RotateCw,
  Eye,
  Check,
  Briefcase,
  AlertTriangle,
  ListTodo,
  MapPin,
  Flame,
  Wrench,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchDepartmentTasks,
  fetchDepartmentNotifications,
  markNotificationRead,
  updateComplaintStatus,
} from '../services/adminApi';

export default function DepartmentOperations({
  operations = [],
  departments = [],
  onOpenDetails,
  onRefresh,
  loading = false,
}) {
  const [selectedDeptId, setSelectedDeptId] = useState(
    operations[0]?.id || departments[0]?.id || null
  );
  const [activeTab, setActiveTab] = useState('queue'); // 'queue' | 'notifications'
  const [taskFilter, setTaskFilter] = useState('all'); // 'all' | 'assigned' | 'in_progress' | 'repaired' | 'overdue'

  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState(null);

  const [notifications, setNotifications] = useState([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [notifsError, setNotifsError] = useState(null);

  const [actionLoadingId, setActionLoadingId] = useState(null);

  // Auto-select first department if none selected
  const activeDeptId = selectedDeptId || operations[0]?.id || departments[0]?.id;
  const currentDeptOp = operations.find((op) => op.id === activeDeptId);
  const currentDeptMeta = departments.find((d) => d.id === activeDeptId);
  const deptName = currentDeptOp?.name || currentDeptMeta?.name || 'Department Operations';

  // Fetch tasks for the currently selected department
  const loadTasks = useCallback(async () => {
    if (!activeDeptId) return;
    setTasksLoading(true);
    setTasksError(null);
    try {
      const data = await fetchDepartmentTasks(
        activeDeptId,
        taskFilter === 'all' ? null : taskFilter
      );
      setTasks(Array.isArray(data) ? data : []);
    } catch (err) {
      setTasksError('Unable to load department task queue. Please retry.');
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, [activeDeptId, taskFilter]);

  // Fetch notifications for the currently selected department
  const loadNotifications = useCallback(async () => {
    if (!activeDeptId) return;
    setNotifsLoading(true);
    setNotifsError(null);
    try {
      const data = await fetchDepartmentNotifications(activeDeptId, 25);
      setNotifications(Array.isArray(data) ? data : []);
    } catch (err) {
      setNotifsError('Unable to load department notifications.');
      setNotifications([]);
    } finally {
      setNotifsLoading(false);
    }
  }, [activeDeptId]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Handle Mark as Read for a notification (with department scope validation)
  const handleMarkRead = async (notifId) => {
    try {
      await markNotificationRead(notifId, activeDeptId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notifId ? { ...n, read: true } : n))
      );
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  // Operational Action: Start Work (assigned -> in_progress)
  const handleStartWork = async (taskId) => {
    if (actionLoadingId) return;
    setActionLoadingId(taskId);
    try {
      await updateComplaintStatus(
        taskId,
        'in_progress',
        'Department field crew initiated work'
      );
      await loadTasks();
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Action failed: ${err.message || 'Unable to update status'}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Operational Action: Mark Repaired (in_progress -> repaired)
  const handleMarkRepaired = async (taskId) => {
    if (actionLoadingId) return;
    setActionLoadingId(taskId);
    try {
      await updateComplaintStatus(
        taskId,
        'repaired',
        'Department field crew completed repairs'
      );
      await loadTasks();
      if (onRefresh) onRefresh();
    } catch (err) {
      alert(`Action failed: ${err.message || 'Unable to update status'}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const unreadNotifCount = notifications.filter((n) => !n.read).length;

  return (
    <section className="department-operations-section glass" aria-label="Department Operations Console">
      <div className="dept-section-header">
        <div className="dept-header-left">
          <Building2 size={18} className="dept-title-icon" />
          <div className="dept-title-group">
            <h2 className="dept-title">Municipal Department Operations</h2>
            <span className="dept-subtitle">Authoritative Dispatch & Work Queue Management</span>
          </div>
        </div>
        <div className="dept-header-actions">
          <button
            type="button"
            className="dept-refresh-btn"
            onClick={() => {
              loadTasks();
              loadNotifications();
              if (onRefresh) onRefresh();
            }}
            title="Refresh department queues"
            disabled={loading || tasksLoading || notifsLoading}
          >
            <RotateCw size={13} className={loading || tasksLoading ? 'spinning' : ''} />
            <span>Sync Workloads</span>
          </button>
        </div>
      </div>

      {/* Department Selector Rail */}
      <div className="dept-selector-rail" role="tablist" aria-label="Select Municipal Department">
        {departments.map((dept) => {
          const op = operations.find((o) => o.id === dept.id);
          const isSelected = dept.id === activeDeptId;
          const activeTasks = op?.active_tasks ?? 0;
          const overdueTasks = op?.overdue_tasks ?? 0;

          return (
            <button
              key={dept.id}
              role="tab"
              aria-selected={isSelected}
              className={`dept-rail-btn ${isSelected ? 'active' : ''}`}
              onClick={() => setSelectedDeptId(dept.id)}
            >
              <div className="dept-rail-top">
                <span className="dept-rail-name">{dept.name}</span>
                {overdueTasks > 0 && (
                  <span className="dept-rail-overdue-pill" title={`${overdueTasks} tasks overdue`}>
                    {overdueTasks} Overdue
                  </span>
                )}
              </div>
              <div className="dept-rail-bottom">
                <span className="dept-rail-task-count">
                  <strong>{activeTasks}</strong> active task{activeTasks !== 1 ? 's' : ''}
                </span>
                {op?.new_assignments > 0 && (
                  <span className="dept-rail-new-pill">+{op.new_assignments} New</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Active Department Workspace */}
      <div className="dept-workspace glass">
        {currentDeptOp ? (
          <>
            {/* KPI Banner for Selected Department */}
            <div className="dept-stats-row">
              <div className="dept-stat-card">
                <span className="dept-stat-label">Active Workload</span>
                <span className="dept-stat-val val-blue">{currentDeptOp.active_tasks}</span>
                <span className="dept-stat-hint">Assigned / In Progress</span>
              </div>
              <div className="dept-stat-card">
                <span className="dept-stat-label">New Assignments</span>
                <span className="dept-stat-val val-cyan">{currentDeptOp.new_assignments}</span>
                <span className="dept-stat-hint">Awaiting work crew start</span>
              </div>
              <div className="dept-stat-card">
                <span className="dept-stat-label">SLA Overdue</span>
                <span className={`dept-stat-val ${currentDeptOp.overdue_tasks > 0 ? 'val-red' : 'val-gray'}`}>
                  {currentDeptOp.overdue_tasks}
                </span>
                <span className="dept-stat-hint">Breached target response</span>
              </div>
              <div className="dept-stat-card">
                <span className="dept-stat-label">Dispatch Alerts</span>
                <span className="dept-stat-val val-orange">
                  {unreadNotifCount}
                </span>
                <span className="dept-stat-hint">Unacknowledged notifications</span>
              </div>
            </div>

            {/* Department Navigation Tabs */}
            <div className="dept-nav-tabs">
              <button
                type="button"
                className={`dept-tab-btn ${activeTab === 'queue' ? 'active' : ''}`}
                onClick={() => setActiveTab('queue')}
              >
                <ListTodo size={14} />
                <span>Department Work Queue ({tasks.length})</span>
              </button>
              <button
                type="button"
                className={`dept-tab-btn ${activeTab === 'notifications' ? 'active' : ''}`}
                onClick={() => setActiveTab('notifications')}
              >
                <Bell size={14} />
                <span>Dispatch Alerts ({notifications.length})</span>
                {unreadNotifCount > 0 && (
                  <span className="dept-unread-badge">{unreadNotifCount} New</span>
                )}
              </button>
            </div>

            {/* TAB 1: Department Work Queue */}
            {activeTab === 'queue' && (
              <div className="dept-queue-container">
                {/* Task Filter Chips */}
                <div className="dept-filter-chips">
                  {['all', 'assigned', 'in_progress', 'repaired', 'overdue'].map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`dept-chip ${taskFilter === f ? 'active' : ''}`}
                      onClick={() => setTaskFilter(f)}
                    >
                      {f === 'all' && 'All Assigned Tasks'}
                      {f === 'assigned' && 'New / Assigned'}
                      {f === 'in_progress' && 'In Progress'}
                      {f === 'repaired' && 'Awaiting Verification'}
                      {f === 'overdue' && '⚠️ Overdue SLA'}
                    </button>
                  ))}
                </div>

                {tasksLoading ? (
                  <div className="dept-loading-box">
                    <RotateCw size={20} className="spinning" />
                    <span>Loading {deptName} operational tasks...</span>
                  </div>
                ) : tasksError ? (
                  <div className="dept-error-box">
                    <AlertTriangle size={20} className="accent-red" />
                    <span>{tasksError}</span>
                    <button type="button" className="retry-btn" onClick={loadTasks}>
                      Retry
                    </button>
                  </div>
                ) : tasks.length === 0 ? (
                  <div className="dept-empty-box">
                    <CheckCircle2 size={28} style={{ opacity: 0.4 }} />
                    <span>No active tasks assigned to this department matching current filter.</span>
                  </div>
                ) : (
                  <div className="dept-tasks-grid">
                    {tasks.map((task) => {
                      const isOverdue =
                        task.sla_deadline &&
                        new Date(task.sla_deadline) < new Date() &&
                        ['assigned', 'in_progress'].includes(task.status);
                      const isActionLoading = actionLoadingId === task.id;

                      return (
                        <div
                          key={task.id}
                          className={`dept-task-card ${isOverdue ? 'task-overdue-border' : ''}`}
                        >
                          <div className="dept-task-top">
                            <div className="dept-task-id-group">
                              <span className="dept-task-id">#{task.id.slice(0, 8)}</span>
                              <span className={`status-badge status-${task.status}`}>
                                {task.status.replace(/_/g, ' ').toUpperCase()}
                              </span>
                            </div>
                            <div className="dept-task-badges">
                              {task.priority_score != null && (
                                <span className={`priority-pill priority-${task.priority_score >= 70 ? 'high' : task.priority_score >= 40 ? 'medium' : 'low'}`}>
                                  {task.priority_score >= 70 ? 'HIGH' : task.priority_score >= 40 ? 'MED' : 'LOW'} ({task.priority_score.toFixed(0)})
                                </span>
                              )}
                              {isOverdue && (
                                <span className="dept-task-overdue-tag">
                                  OVERDUE
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="dept-task-body">
                            <h4 className="dept-task-issue">
                              {task.issue_class.replace(/_/g, ' ').toUpperCase()}
                            </h4>
                            {task.description && (
                              <p className="dept-task-desc">{task.description}</p>
                            )}
                            <div className="dept-task-meta">
                              <span className="dept-meta-item" title="Incident Location">
                                <MapPin size={12} />
                                {task.location_address || `${task.lat.toFixed(4)}, ${task.lng.toFixed(4)}`}
                              </span>
                              {task.sla_deadline && (
                                <span className={`dept-meta-item ${isOverdue ? 'text-red' : ''}`} title="SLA Deadline">
                                  <Clock size={12} />
                                  Target: {new Date(task.sla_deadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(task.sla_deadline).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="dept-task-footer">
                            <button
                              type="button"
                              className="dept-task-inspect-btn"
                              onClick={() => onOpenDetails && onOpenDetails(task)}
                              title="Inspect full complaint details"
                            >
                              <Eye size={12} /> Inspect
                            </button>

                            {/* State Machine Transition Actions */}
                            {task.status === 'assigned' && (
                              <button
                                type="button"
                                className="dept-action-start-btn"
                                onClick={() => handleStartWork(task.id)}
                                disabled={isActionLoading}
                                title="Start work on this assigned complaint"
                              >
                                {isActionLoading ? (
                                  <RotateCw size={12} className="spinning" />
                                ) : (
                                  <Play size={12} />
                                )}
                                <span>Start Work</span>
                              </button>
                            )}

                            {task.status === 'in_progress' && (
                              <button
                                type="button"
                                className="dept-action-repair-btn"
                                onClick={() => handleMarkRepaired(task.id)}
                                disabled={isActionLoading}
                                title="Mark this complaint as physically repaired"
                              >
                                {isActionLoading ? (
                                  <RotateCw size={12} className="spinning" />
                                ) : (
                                  <Wrench size={12} />
                                )}
                                <span>Mark Repaired</span>
                              </button>
                            )}

                            {task.status === 'repaired' && (
                              <span className="dept-awaiting-badge">
                                <ShieldCheck size={12} /> Awaiting Verification
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: Dispatch Alerts & Activity */}
            {activeTab === 'notifications' && (
              <div className="dept-activity-block">
                {notifsLoading ? (
                  <div className="dept-loading-box">
                    <RotateCw size={20} className="spinning" />
                    <span>Loading dispatch alerts for {deptName}...</span>
                  </div>
                ) : notifsError ? (
                  <div className="dept-error-box">
                    <AlertTriangle size={20} className="accent-red" />
                    <span>{notifsError}</span>
                    <button type="button" className="retry-btn" onClick={loadNotifications}>
                      Retry
                    </button>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="dept-empty-box">
                    <CheckCircle2 size={24} style={{ opacity: 0.4 }} />
                    <span>You're all caught up. No unacknowledged alerts for this department.</span>
                  </div>
                ) : (
                  <div className="dept-notifications-list">
                    {notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`dept-notif-item ${!notif.read ? 'notif-unread' : 'notif-read'} ${notif.priority === 'high' ? 'notif-high' : ''}`}
                      >
                        <div className="notif-badge-col">
                          <span className={`notif-type-tag ${notif.type}`}>
                            {notif.type.toUpperCase()}
                          </span>
                          {!notif.read ? (
                            <span className="notif-unread-dot" title="Unread alert">● NEW</span>
                          ) : (
                            <span className="notif-read-check" title="Acknowledged">✓ Read</span>
                          )}
                          {notif.priority === 'high' && (
                            <span className="notif-priority-tag">CRITICAL</span>
                          )}
                        </div>
                        <div className="notif-content-col">
                          <div className="notif-title-row">
                            <span className="notif-title">{notif.title}</span>
                            <span className="notif-time">
                              {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(notif.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                            </span>
                          </div>
                          <p className="notif-message">{notif.message}</p>
                        </div>
                        <div className="notif-actions-col">
                          {!notif.read && (
                            <button
                              type="button"
                              className="notif-ack-btn"
                              onClick={() => handleMarkRead(notif.id)}
                              title="Acknowledge alert and mark as read"
                            >
                              <Check size={12} /> Mark Read
                            </button>
                          )}
                          {onOpenDetails && notif.complaint_id && (
                            <button
                              type="button"
                              className="notif-inspect-btn"
                              onClick={() => onOpenDetails({ id: notif.complaint_id })}
                              title="Inspect Complaint in Municipal Detail Modal"
                            >
                              <Eye size={12} /> Inspect Task
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="dept-empty-box">
            <Building2 size={32} style={{ opacity: 0.3 }} />
            <span>No operational metrics available. Select a municipal department to inspect its task queue.</span>
          </div>
        )}
      </div>
    </section>
  );
}
