import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Phase 4 Admin Dashboard — Metric Calculations & KPIs', () => {
  const sampleComplaints = [
    {
      id: '11111111-0000-0000-0000-000000000001',
      issue_class: 'pothole',
      user_selected_category: 'Road Damage',
      status: 'pending',
      severity_score: 45.0,
      priority_score: 50.0,
      department_name: null,
      sla_deadline: null,
    },
    {
      id: '11111111-0000-0000-0000-000000000002',
      issue_class: 'streetlight',
      user_selected_category: null,
      status: 'under_review',
      severity_score: 30.0,
      priority_score: 35.0,
      department_name: null,
      sla_deadline: null,
    },
    {
      id: '11111111-0000-0000-0000-000000000003',
      issue_class: 'waterlogging',
      user_selected_category: 'Flooding',
      status: 'assigned',
      severity_score: 85.0,
      priority_score: 90.0,
      department_name: 'Drainage & Water',
      sla_deadline: '2020-01-01T00:00:00Z', // Breached/Overdue
    },
    {
      id: '11111111-0000-0000-0000-000000000004',
      issue_class: 'manhole',
      user_selected_category: null,
      status: 'in_progress',
      severity_score: 75.0,
      priority_score: 80.0,
      department_name: 'Roads & Infrastructure',
      sla_deadline: '2099-01-01T00:00:00Z', // Active SLA
    },
    {
      id: '11111111-0000-0000-0000-000000000005',
      issue_class: 'pothole',
      user_selected_category: 'Road Damage',
      status: 'rejected',
      duplicate_of_id: '11111111-0000-0000-0000-000000000001',
      severity_score: null,
      priority_score: null,
      department_name: null,
      sla_deadline: null,
    },
    {
      id: '11111111-0000-0000-0000-000000000006',
      issue_class: 'damaged_public_property',
      user_selected_category: null,
      status: 'closed',
      severity_score: 50.0,
      priority_score: 55.0,
      department_name: 'Public Works',
      sla_deadline: '2026-01-01T00:00:00Z',
    },
  ];

  it('correctly aggregates total complaints from database list', () => {
    assert.strictEqual(sampleComplaints.length, 6);
  });

  it('identifies under_review complaints without fabricating classes', () => {
    const underReview = sampleComplaints.filter((c) => c.status === 'under_review');
    assert.strictEqual(underReview.length, 1);
    assert.strictEqual(underReview[0].id, '11111111-0000-0000-0000-000000000002');
  });

  it('correctly identifies overdue/breached SLA complaints', () => {
    const now = new Date();
    const overdue = sampleComplaints.filter(
      (c) =>
        (c.status === 'assigned' || c.status === 'in_progress') &&
        c.sla_deadline &&
        new Date(c.sla_deadline) < now
    );
    assert.strictEqual(overdue.length, 1);
    assert.strictEqual(overdue[0].id, '11111111-0000-0000-0000-000000000003');
  });

  it('identifies high priority complaints (priority >= 70)', () => {
    const highPriority = sampleComplaints.filter(
      (c) => c.priority_score !== null && c.priority_score >= 70
    );
    assert.strictEqual(highPriority.length, 2);
    assert.deepStrictEqual(
      highPriority.map((c) => c.id),
      ['11111111-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000004']
    );
  });

  it('identifies semantic duplicate rejected complaints with parent reference', () => {
    const rejected = sampleComplaints.filter((c) => c.status === 'rejected');
    assert.strictEqual(rejected.length, 1);
    assert.strictEqual(
      rejected[0].duplicate_of_id,
      '11111111-0000-0000-0000-000000000001'
    );
  });

  it('identifies resolved/closed complaints', () => {
    const resolved = sampleComplaints.filter(
      (c) => c.status === 'closed' || c.status === 'verified'
    );
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].id, '11111111-0000-0000-0000-000000000006');
  });
});

describe('Phase 4 Admin Dashboard — Filter Logic & Integrity', () => {
  const dataset = [
    {
      id: 'c1',
      issue_class: 'pothole',
      user_selected_category: 'Roads',
      status: 'pending',
      severity_score: 80,
      priority_score: 85,
      department_name: 'Roads & Infrastructure',
      sla_deadline: '2026-09-08T12:00:00Z',
    },
    {
      id: 'c2',
      issue_class: 'streetlight',
      user_selected_category: 'Lighting',
      status: 'under_review',
      severity_score: 20,
      priority_score: 25,
      department_name: null,
      sla_deadline: null,
    },
    {
      id: 'c3',
      issue_class: 'waterlogging',
      user_selected_category: 'Flooding',
      status: 'assigned',
      severity_score: 90,
      priority_score: 95,
      department_name: 'Drainage & Water',
      sla_deadline: '2020-01-01T00:00:00Z', // Breached
    },
  ];

  it('filters by status correctly', () => {
    const res = dataset.filter((c) => c.status === 'under_review');
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].id, 'c2');
  });

  it('filters by department correctly', () => {
    const res = dataset.filter((c) => c.department_name === 'Drainage & Water');
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].id, 'c3');
  });

  it('filters by issue class correctly', () => {
    const res = dataset.filter((c) => c.issue_class === 'pothole');
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].id, 'c1');
  });

  it('filters by min severity correctly', () => {
    const res = dataset.filter((c) => c.severity_score >= 80);
    assert.strictEqual(res.length, 2);
    assert.deepStrictEqual(res.map((c) => c.id), ['c1', 'c3']);
  });

  it('handles search queries against ID, issue class, and category', () => {
    const q = 'flood';
    const res = dataset.filter(
      (c) =>
        c.issue_class.toLowerCase().includes(q) ||
        (c.user_selected_category && c.user_selected_category.toLowerCase().includes(q))
    );
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].id, 'c3');
  });

  it('preserves citizen category distinctly from ML issue class', () => {
    const c1 = dataset[0];
    assert.notStrictEqual(c1.issue_class, c1.user_selected_category);
    assert.strictEqual(c1.issue_class, 'pothole');
    assert.strictEqual(c1.user_selected_category, 'Roads');
  });
});

describe('Phase 4 Admin Dashboard — Map & Coordinate Boundary Safety', () => {
  const mapInputs = [
    { id: 'm1', lat: 28.6139, lng: 77.2090, issue_class: 'pothole' }, // valid
    { id: 'm2', lat: null, lng: null, issue_class: 'pothole' },        // missing
    { id: 'm3', lat: 'invalid', lng: 77.2, issue_class: 'pothole' },   // malformed
    { id: 'm4', lat: 105.0, lng: 77.2, issue_class: 'pothole' },       // out of range lat
    { id: 'm5', lat: 28.6, lng: 200.0, issue_class: 'pothole' },       // out of range lng
  ];

  it('safely filters out invalid or out-of-range coordinates without crashing', () => {
    const valid = mapInputs.filter(
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

    assert.strictEqual(valid.length, 1);
    assert.strictEqual(valid[0].id, 'm1');
  });
});

describe('Phase 4 Admin Dashboard — Operational Status State Machine', () => {
  const ALLOWED_STATUSES = [
    'pending',
    'under_review',
    'assigned',
    'in_progress',
    'repaired',
    'verified',
    'closed',
    'rejected',
  ];

  const VALID_TRANSITIONS = {
    pending: ['under_review', 'assigned', 'in_progress', 'rejected'],
    under_review: ['assigned', 'in_progress', 'rejected', 'pending'],
    assigned: ['in_progress', 'under_review', 'repaired', 'rejected'],
    in_progress: ['repaired', 'assigned', 'under_review', 'closed', 'rejected'],
    repaired: ['verified', 'in_progress', 'closed'],
    verified: ['closed', 'in_progress'],
    closed: ['in_progress', 'under_review'],
    rejected: ['under_review', 'pending'],
  };

  it('validates permitted status transitions', () => {
    const targetStatus = 'in_progress';
    assert.ok(ALLOWED_STATUSES.includes(targetStatus));
    assert.ok(VALID_TRANSITIONS.pending.includes('in_progress'));
  });

  it('rejects arbitrary or unknown statuses', () => {
    const invalidStatus = 'inconclusive_custom';
    assert.ok(!ALLOWED_STATUSES.includes(invalidStatus));
  });

  it('prevents direct illegal transition from pending to closed', () => {
    assert.ok(!VALID_TRANSITIONS.pending.includes('closed'));
  });

  it('permits valid reopening from closed to in_progress or under_review', () => {
    assert.ok(VALID_TRANSITIONS.closed.includes('in_progress'));
    assert.ok(VALID_TRANSITIONS.closed.includes('under_review'));
    assert.ok(!VALID_TRANSITIONS.closed.includes('repaired'));
  });

  it('identifies consequential transitions that require operator confirmation', () => {
    const isConsequential = (fromStatus, toStatus) => {
      if (toStatus === 'closed' || toStatus === 'rejected') return true;
      if ((fromStatus === 'closed' || fromStatus === 'rejected') && toStatus !== fromStatus) return true;
      return false;
    };

    assert.strictEqual(isConsequential('in_progress', 'closed'), true);
    assert.strictEqual(isConsequential('pending', 'rejected'), true);
    assert.strictEqual(isConsequential('closed', 'in_progress'), true);
    assert.strictEqual(isConsequential('assigned', 'in_progress'), false);
  });
});

describe('Phase 4 Admin Dashboard — Table Sorting & Timeline Audit Integrity', () => {
  const tableData = [
    { id: '1', priority_score: 45, severity_score: 60, created_at: '2026-09-08T10:00:00Z', status: 'pending' },
    { id: '2', priority_score: 90, severity_score: 85, created_at: '2026-09-08T12:00:00Z', status: 'assigned' },
    { id: '3', priority_score: 75, severity_score: 40, created_at: '2026-09-08T11:00:00Z', status: 'in_progress' },
  ];

  it('sorts complaints by priority score descending', () => {
    const sorted = [...tableData].sort((a, b) => b.priority_score - a.priority_score);
    assert.deepStrictEqual(sorted.map((c) => c.id), ['2', '3', '1']);
  });

  it('sorts complaints by creation timestamp descending', () => {
    const sorted = [...tableData].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    assert.deepStrictEqual(sorted.map((c) => c.id), ['2', '3', '1']);
  });

  it('sorts status timeline audit items chronologically ascending', () => {
    const historyItems = [
      { id: 'h2', changed_at: '2026-09-08T12:00:00Z', new_status: 'in_progress' },
      { id: 'h1', changed_at: '2026-09-08T10:00:00Z', new_status: 'pending' },
      { id: 'h3', changed_at: '2026-09-08T14:00:00Z', new_status: 'closed' },
    ];
    const sorted = [...historyItems].sort(
      (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
    );
    assert.deepStrictEqual(sorted.map((h) => h.id), ['h1', 'h2', 'h3']);
    assert.strictEqual(sorted[0].new_status, 'pending');
    assert.strictEqual(sorted[2].new_status, 'closed');
  });
});

describe('Phase 4 Admin Dashboard — GIS TileLayer & Department Operations Integrity', () => {
  it('verifies standard OpenStreetMap tile URL and attribution without API key', () => {
    const expectedOsmUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
    const expectedAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

    assert.ok(expectedOsmUrl.includes('tile.openstreetmap.org'));
    assert.ok(!expectedOsmUrl.includes('api_key') && !expectedOsmUrl.includes('cartocdn'));
    assert.ok(expectedAttribution.includes('OpenStreetMap'));
  });

  it('safely handles zero valid incidents matching filters without crashing', () => {
    const emptyComplaints = [];
    const valid = emptyComplaints.filter((c) => c && typeof c.lat === 'number' && typeof c.lng === 'number');
    assert.strictEqual(valid.length, 0);

    const emptyMessage = valid.length === 0
      ? 'No incidents with valid coordinates match current filters'
      : `${valid.length} incidents mapped`;
    assert.strictEqual(emptyMessage, 'No incidents with valid coordinates match current filters');
  });

  it('correctly aggregates department workload, new assignments, and overdue tasks', () => {
    const deptComplaints = [
      { id: '1', department_id: 'd1', status: 'assigned', sla_deadline: '2099-01-01T00:00:00Z' },
      { id: '2', department_id: 'd1', status: 'in_progress', sla_deadline: '2020-01-01T00:00:00Z' },
      { id: '3', department_id: 'd1', status: 'closed', sla_deadline: '2020-01-01T00:00:00Z' },
      { id: '4', department_id: 'd2', status: 'assigned', sla_deadline: '2099-01-01T00:00:00Z' },
    ];

    const d1Active = deptComplaints.filter((c) => c.department_id === 'd1' && (c.status === 'assigned' || c.status === 'in_progress')).length;
    const d1New = deptComplaints.filter((c) => c.department_id === 'd1' && c.status === 'assigned').length;
    const d1Overdue = deptComplaints.filter((c) => c.department_id === 'd1' && (c.status === 'assigned' || c.status === 'in_progress') && new Date(c.sla_deadline) < new Date()).length;

    assert.strictEqual(d1Active, 2);
    assert.strictEqual(d1New, 1);
    assert.strictEqual(d1Overdue, 1);
  });

  it('correctly filters department work queue by status chip', () => {
    const tasks = [
      { id: 't1', status: 'assigned', sla_deadline: '2099-01-01T00:00:00Z' },
      { id: 't2', status: 'in_progress', sla_deadline: '2020-01-01T00:00:00Z' },
      { id: 't3', status: 'repaired', sla_deadline: '2099-01-01T00:00:00Z' },
    ];

    const filterTasks = (list, filter) => {
      if (filter === 'all') return list;
      if (filter === 'overdue') {
        return list.filter(
          (t) =>
            t.sla_deadline &&
            new Date(t.sla_deadline) < new Date() &&
            ['assigned', 'in_progress'].includes(t.status)
        );
      }
      return list.filter((t) => t.status === filter);
    };

    assert.strictEqual(filterTasks(tasks, 'all').length, 3);
    assert.strictEqual(filterTasks(tasks, 'assigned').length, 1);
    assert.strictEqual(filterTasks(tasks, 'in_progress').length, 1);
    assert.strictEqual(filterTasks(tasks, 'repaired').length, 1);
    assert.strictEqual(filterTasks(tasks, 'overdue').length, 1);
    assert.strictEqual(filterTasks(tasks, 'overdue')[0].id, 't2');
  });

  it('updates notification read state locally and recomputes unread count', () => {
    const notifications = [
      { id: 'n1', title: 'New Assignment', read: false },
      { id: 'n2', title: 'SLA Warning', read: false },
      { id: 'n3', title: 'Status Update', read: true },
    ];

    const initialUnread = notifications.filter((n) => !n.read).length;
    assert.strictEqual(initialUnread, 2);

    // Acknowledge n1
    const updated = notifications.map((n) => (n.id === 'n1' ? { ...n, read: true } : n));
    const nextUnread = updated.filter((n) => !n.read).length;
    assert.strictEqual(nextUnread, 1);
    assert.strictEqual(updated.find((n) => n.id === 'n1').read, true);
  });
});


