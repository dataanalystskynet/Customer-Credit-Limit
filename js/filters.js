/* ==========================================================================
   filters.js – business rules, analytics aggregation and table filtering.
   Pure functions (no DOM) so they can be unit-tested.
   ========================================================================== */
(function (root) {
  'use strict';
  const SKY = root.SKY = root.SKY || {};

  const NOT_ASSIGNED = 'Not Assigned';
  const NOT_AVAILABLE = 'Not Available';

  /* ---- MANDATORY BUSINESS RULE --------------------------------------------
     Condition 1: Credit Limit (col AG) must be a valid number  > 1
     Condition 2: Status (col AJ) must be exactly ACTIVE
     Both conditions together (AND). Nothing else is ever shown. */
  function isEligible(row, rules) {
    rules = rules || (SKY.config && SKY.config.rules) || { minCreditLimitExclusive: 1, requiredStatus: 'ACTIVE' };
    const creditLimit = Number(row.creditLimit);
    const status = String(row.status || '').trim().toUpperCase();
    return row.creditLimit !== null && row.creditLimit !== '' &&
      Number.isFinite(creditLimit) && creditLimit > rules.minCreditLimitExclusive &&
      status === rules.requiredStatus;
  }
  function applyBusinessRules(rows, rules) {
    const eligible = [];
    let excludedInactive = 0, excludedCredit = 0;
    for (const r of rows) {
      if (isEligible(r, rules)) { eligible.push(r); continue; }
      const st = String(r.status || '').trim().toUpperCase();
      if (st !== 'ACTIVE') excludedInactive++; else excludedCredit++;
    }
    return { eligible, total: rows.length, excluded: rows.length - eligible.length, excludedInactive, excludedCredit };
  }

  /* Display helpers for grouping keys */
  const hubKey = r => r.hub || 'Unknown Hub';
  const salesmanKey = r => r.salesman || NOT_ASSIGNED;
  const agingKey = r => (r.agingLimit == null ? NOT_AVAILABLE : r.agingLimit + ' days');

  /* Group with case-insensitive keys, keeping the first spelling seen. */
  function groupBy(rows, keyFn) {
    const map = new Map();
    for (const r of rows) {
      const label = keyFn(r);
      const k = label.toUpperCase();
      let g = map.get(k);
      if (!g) { g = { label, count: 0, total: 0, max: -Infinity, min: Infinity }; map.set(k, g); }
      g.count++; g.total += r.creditLimit;
      if (r.creditLimit > g.max) g.max = r.creditLimit;
      if (r.creditLimit < g.min) g.min = r.creditLimit;
    }
    const grand = rows.reduce((s, r) => s + r.creditLimit, 0) || 1;
    return [...map.values()].map(g => Object.assign(g, { avg: g.total / g.count, share: g.total / grand }));
  }

  const CREDIT_BUCKETS = [
    { label: '₹ 1 – ₹ 50,000',              min: 1,        max: 50000 },
    { label: '₹ 50,001 – ₹ 1,00,000',       min: 50000,    max: 100000 },
    { label: '₹ 1,00,001 – ₹ 5,00,000',     min: 100000,   max: 500000 },
    { label: '₹ 5,00,001 – ₹ 10,00,000',    min: 500000,   max: 1000000 },
    { label: 'Above ₹ 10,00,000',          min: 1000000,  max: Infinity }
  ];
  // bucket i holds values in (min, max]; bucket 0 also catches anything >1
  function bucketIndex(v) {
    for (let i = 0; i < CREDIT_BUCKETS.length; i++) if (v <= CREDIT_BUCKETS[i].max) return i;
    return CREDIT_BUCKETS.length - 1;
  }

  function computeAnalytics(eligible) {
    const n = eligible.length;
    const values = eligible.map(r => r.creditLimit);
    const total = values.reduce((a, b) => a + b, 0);
    const hubs = groupBy(eligible, hubKey).sort((a, b) => b.total - a.total);
    const salesmen = groupBy(eligible, salesmanKey).sort((a, b) => b.total - a.total);

    const buckets = CREDIT_BUCKETS.map(b => ({ label: b.label, count: 0, total: 0 }));
    for (const r of eligible) { const b = buckets[bucketIndex(r.creditLimit)]; b.count++; b.total += r.creditLimit; }

    const aging = groupBy(eligible, agingKey).sort((a, b) => {
      if (a.label === NOT_AVAILABLE) return -1;
      if (b.label === NOT_AVAILABLE) return 1;
      return parseFloat(a.label) - parseFloat(b.label);
    });
    // Make sure the standard aging slabs are always listed (even with zero customers)
    [7, 10, 15, 20, 25, 30].forEach(d => {
      if (!aging.some(a => a.label === d + ' days')) aging.push({ label: d + ' days', count: 0, total: 0, avg: 0, share: 0, max: 0, min: 0 });
    });
    aging.sort((a, b) => a.label === NOT_AVAILABLE ? -1 : b.label === NOT_AVAILABLE ? 1 : parseFloat(a.label) - parseFloat(b.label));

    return {
      kpi: {
        customers: n,
        totalCredit: total,
        avgCredit: n ? total / n : 0,
        maxCredit: n ? Math.max(...values) : 0,
        minCredit: n ? Math.min(...values) : 0,
        hubs: hubs.length,
        salesmen: salesmen.filter(s => s.label !== NOT_ASSIGNED).length,
        missingAging: eligible.filter(r => r.agingLimit == null).length,
        unassigned: eligible.filter(r => !r.salesman).length
      },
      hubs, salesmen, buckets, aging
    };
  }

  /* ---- Customer table filtering & sorting -------------------------------- */
  function filterTable(rows, f) {
    const q = (f.search || '').trim().toLowerCase();
    const terms = q ? q.split(/\s+/) : [];
    const min = f.minCredit === '' || f.minCredit == null ? null : Number(f.minCredit);
    const max = f.maxCredit === '' || f.maxCredit == null ? null : Number(f.maxCredit);
    return rows.filter(r => {
      if (f.hub && hubKey(r).toUpperCase() !== f.hub.toUpperCase()) return false;
      if (f.salesman && salesmanKey(r).toUpperCase() !== f.salesman.toUpperCase()) return false;
      if (f.aging && agingKey(r) !== f.aging) return false;
      if (min != null && r.creditLimit < min) return false;
      if (max != null && r.creditLimit > max) return false;
      if (terms.length) {
        const hay = (r._search || (r._search = [r.name, r.code, r.hub, r.salesman, r.status,
          r.creditLimit, r.agingLimit].join(' ').toLowerCase()));
        for (const t of terms) if (!hay.includes(t)) return false;
      }
      return true;
    });
  }
  function sortRows(rows, key, dir) {
    if (!key) return rows;
    const m = dir === 'desc' ? -1 : 1;
    const isNum = key === 'creditLimit' || key === 'agingLimit';
    return rows.slice().sort((a, b) => {
      let x = a[key], y = b[key];
      if (isNum) {
        if (x == null && y == null) return 0;
        if (x == null) return 1;          // blanks always last
        if (y == null) return -1;
        return (x - y) * m;
      }
      return String(x || '').localeCompare(String(y || ''), 'en', { sensitivity: 'base', numeric: true }) * m;
    });
  }

  SKY.Filters = {
    isEligible, applyBusinessRules, computeAnalytics, filterTable, sortRows,
    hubKey, salesmanKey, agingKey, CREDIT_BUCKETS, NOT_ASSIGNED, NOT_AVAILABLE
  };
})(typeof self !== 'undefined' ? self : this);
