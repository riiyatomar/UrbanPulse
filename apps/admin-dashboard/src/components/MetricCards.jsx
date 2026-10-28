import React, { useState, useEffect, useRef } from 'react';
import {
  FileText,
  AlertTriangle,
  Clock,
  CheckCircle,
  ShieldAlert,
  Layers,
  Activity,
} from 'lucide-react';

function useAnimatedCount(target, duration = 800) {
  const [count, setCount] = useState(target || 0);
  const prevTarget = useRef(target || 0);

  useEffect(() => {
    const start = prevTarget.current;
    const diff = (target || 0) - start;
    if (diff === 0) return;

    const startTime = performance.now();

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(start + diff * eased));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        prevTarget.current = target || 0;
      }
    }

    requestAnimationFrame(animate);
  }, [target, duration]);

  return count;
}

export default function MetricCards({ complaints = [], stats = null, onFilterClick }) {
  // If authoritative backend stats are provided, use them; otherwise derive strictly from complaints list
  const total = stats ? stats.total : complaints.length;
  const underReview = stats ? stats.under_review : complaints.filter(c => c.status === 'under_review').length;
  const pending = stats ? stats.pending : complaints.filter(c => c.status === 'pending').length;
  const assigned = stats ? stats.assigned : complaints.filter(c => c.status === 'assigned').length;
  const inProgress = stats ? stats.in_progress : complaints.filter(c => c.status === 'in_progress').length;
  const resolved = stats
    ? (stats.closed + stats.verified + stats.repaired)
    : complaints.filter(c => c.status === 'closed' || c.status === 'verified' || c.status === 'repaired').length;
  const rejected = stats ? stats.rejected : complaints.filter(c => c.status === 'rejected').length;
  const highPriority = stats
    ? stats.high_priority
    : complaints.filter(c => c.priority_score !== null && c.priority_score >= 70).length;

  // Real overdue calculation
  const now = new Date();
  const overdue = stats
    ? stats.overdue_sla
    : complaints.filter(c =>
        (c.status === 'assigned' || c.status === 'in_progress') &&
        c.sla_deadline &&
        new Date(c.sla_deadline) < now
      ).length;

  const animTotal = useAnimatedCount(total);
  const animUnderReview = useAnimatedCount(underReview);
  const animOverdue = useAnimatedCount(overdue);
  const animHighPriority = useAnimatedCount(highPriority);
  const animActiveOps = useAnimatedCount(assigned + inProgress);
  const animResolved = useAnimatedCount(resolved);
  const animRejected = useAnimatedCount(rejected);

  return (
    <div className="metrics-grid">
      {/* 1. Total Complaints */}
      <div
        className="metric-card glass accent-blue clickable"
        onClick={() => onFilterClick && onFilterClick({ status: 'All' })}
        title="View all complaints"
      >
        <div className="metric-header">
          <span className="metric-title">Total Reports</span>
          <span className="metric-icon blue"><FileText size={18} /></span>
        </div>
        <span className="metric-value">{animTotal}</span>
        <div className="metric-footer">
          <span className="metric-desc">Registered in database</span>
          <span className="metric-trend trend-neutral">Live DB</span>
        </div>
      </div>

      {/* 2. Under Review (Phase 3 Safe Review) */}
      <div
        className="metric-card glass accent-orange clickable"
        onClick={() => onFilterClick && onFilterClick({ status: 'under_review' })}
        title="Filter complaints under review"
      >
        <div className="metric-header">
          <span className="metric-title">Under Review</span>
          <span className="metric-icon orange"><AlertTriangle size={18} /></span>
        </div>
        <span className="metric-value">{animUnderReview}</span>
        <div className="metric-footer">
          <span className="metric-desc">Uncertain AI / Low confidence</span>
          {underReview > 0 && (
            <span className="metric-trend trend-down">Needs Triage</span>
          )}
        </div>
      </div>

      {/* 3. SLA Overdue */}
      <div
        className="metric-card glass accent-red clickable"
        onClick={() => onFilterClick && onFilterClick({ sla_state: 'overdue' })}
        title="Filter breached SLA complaints"
      >
        <div className="metric-header">
          <span className="metric-title">SLA Overdue</span>
          <span className="metric-icon red"><Clock size={18} /></span>
        </div>
        <span className="metric-value">{animOverdue}</span>
        <div className="metric-footer">
          <span className="metric-desc">Breached target response</span>
          {overdue > 0 && (
            <span className="metric-trend trend-down">Critical</span>
          )}
        </div>
      </div>

      {/* 4. High Priority */}
      <div
        className="metric-card glass accent-purple clickable"
        onClick={() => onFilterClick && onFilterClick({ min_priority: 70 })}
        title="Filter high priority complaints"
      >
        <div className="metric-header">
          <span className="metric-title">High Priority</span>
          <span className="metric-icon purple"><ShieldAlert size={18} /></span>
        </div>
        <span className="metric-value">{animHighPriority}</span>
        <div className="metric-footer">
          <span className="metric-desc">Priority score ≥ 70</span>
          <span className="metric-trend trend-neutral">Automated GIS</span>
        </div>
      </div>

      {/* 5. Active Operations */}
      <div
        className="metric-card glass accent-cyan clickable"
        onClick={() => onFilterClick && onFilterClick({ status: 'assigned' })}
        title="Filter assigned / in progress"
      >
        <div className="metric-header">
          <span className="metric-title">Active Ops</span>
          <span className="metric-icon cyan"><Activity size={18} /></span>
        </div>
        <span className="metric-value">{animActiveOps}</span>
        <div className="metric-footer">
          <span className="metric-desc">Assigned or in progress</span>
          <span className="metric-trend trend-up">Dispatched</span>
        </div>
      </div>

      {/* 6. Resolved */}
      <div
        className="metric-card glass accent-green clickable"
        onClick={() => onFilterClick && onFilterClick({ status: 'closed' })}
        title="Filter resolved / closed"
      >
        <div className="metric-header">
          <span className="metric-title">Resolved</span>
          <span className="metric-icon green"><CheckCircle size={18} /></span>
        </div>
        <span className="metric-value">{animResolved}</span>
        <div className="metric-footer">
          <span className="metric-desc">Verified or closed</span>
          <span className="metric-trend trend-up">Complete</span>
        </div>
      </div>

      {/* 7. Duplicates Rejected */}
      <div
        className="metric-card glass accent-gray clickable"
        onClick={() => onFilterClick && onFilterClick({ status: 'rejected' })}
        title="Filter duplicate rejected complaints"
      >
        <div className="metric-header">
          <span className="metric-title">Duplicates</span>
          <span className="metric-icon gray"><Layers size={18} /></span>
        </div>
        <span className="metric-value">{animRejected}</span>
        <div className="metric-footer">
          <span className="metric-desc">Semantic dedup rejected</span>
          <span className="metric-trend trend-neutral">pgvector</span>
        </div>
      </div>
    </div>
  );
}
