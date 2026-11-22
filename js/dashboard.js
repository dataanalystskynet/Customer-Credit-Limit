/* ==========================================================================
   dashboard.js – KPIs, analysis views, customer table, exports and print.
   ========================================================================== */
(function () {
  'use strict';
  const F = SKY.Filters;

  /* ---------------- formatting (Indian numbering, IST) ---------------- */
  const inrFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
  const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const TZ = () => SKY.config.timeZone || 'Asia/Kolkata';
  SKY.fmt = {
    inr: v => inrFmt.format(Math.round(v || 0)),
    num: v => numFmt.format(v || 0),
    inrShort(v) {
      v = Number(v) || 0; const a = Math.abs(v);
      if (a >= 1e7) return '₹' + (v / 1e7).toFixed(a >= 1e8 ? 1 : 2).replace(/\.0+$/, '') + ' Cr';
      if (a >= 1e5) return '₹' + (v / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
      if (a >= 1e3) return '₹' + (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
      return '₹' + Math.round(v);
    },
    pct: v => (v * 100).toFixed(1) + '%',
    dateTime(d) {
      if (!d) return '—';
      d = new Date(d); if (isNaN(d)) return '—';
      return d.toLocaleString('en-IN', { timeZone: TZ(), day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' IST';
    },
    date(d) { d = new Date(d); return isNaN(d) ? '—' : d.toLocaleDateString('en-IN', { timeZone: TZ(), day: '2-digit', month: 'short', year: 'numeric' }); },
    time(d) { d = new Date(d); return isNaN(d) ? '—' : d.toLocaleTimeString('en-IN', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) + ' IST'; },
    stamp() { // 2026-11-22_2320 in IST for file names
      const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const g = t => p.find(x => x.type === t).value;
      return `${g('year')}-${g('month')}-${g('day')}_${g('hour')}${g('minute')}`;
    }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = id => document.getElementById(id);

  /* ---------------- state ---------------- */
  const state = {
    eligible: [], analytics: null, summary: null, meta: null,
    table: { search: '', hub: '', salesman: '', aging: '', minCredit: '', maxCredit: '', sortKey: 'creditLimit', sortDir: 'desc', page: 1, pageSize: 25 },
    filtered: []
  };
  SKY.state = state;

  /* Load a parsed dataset (all rows) – applies the business rules. */
  function setData(rows, meta) {
    const res = F.applyBusinessRules(rows);
    state.eligible = res.eligible;
    state.summary = res;
    state.meta = meta || {};
    state.analytics = F.computeAnalytics(res.eligible);
    state.refreshedAt = new Date();
    // SAFETY NET: verify the rule one more time before anything is displayed
    const violation = state.eligible.find(r => !(r.creditLimit > 1 && r.status === 'ACTIVE'));
    if (violation) throw new Error('Business-rule check failed – dashboard not rendered.');
    populateFilterOptions();
    SKY.Charts.markAllDirty(['overview', 'hubs', 'salesmen', 'credit', 'aging']);
    renderKPIs();
    applyTableFilters();
  }

  /* ---------------- KPI cards ---------------- */
  const KPI_DEFS = [
    { key: 'customers', label: 'Total Eligible Customers', icon: 'users', money: false, sub: k => `ACTIVE with credit limit > ₹1` },
    { key: 'totalCredit', label: 'Total Credit Limit', icon: 'wallet', money: true, sub: k => '≈ ' + SKY.fmt.inrShort(k.totalCredit) + ' total exposure' },
    { key: 'avgCredit', label: 'Average Credit Limit', icon: 'calculator', money: true, sub: () => 'Per eligible customer' },
    { key: 'maxCredit', label: 'Highest Credit Limit', icon: 'trending-up', money: true, sub: () => topName('max') },
    { key: 'minCredit', label: 'Lowest Credit Limit', icon: 'trending-down', money: true, sub: () => topName('min') },
    { key: 'hubs', label: 'Total Origin Hubs', icon: 'map-pin', money: false, sub: () => state.analytics.hubs.slice(0, 3).map(h => h.label).join(', ') },
    { key: 'salesmen', label: 'Total Salesmen', icon: 'briefcase', money: false, sub: k => k.unassigned ? `${k.unassigned} customers not assigned` : 'All customers assigned' },
    { key: 'missingAging', label: 'Missing Aging Limit', icon: 'alert-triangle', money: false, sub: k => k.customers ? `${SKY.fmt.pct(k.missingAging / k.customers)} of eligible customers` : '—' }
  ];
  function topName(which) {
    if (!state.eligible.length) return '—';
    const v = state.analytics.kpi[which === 'max' ? 'maxCredit' : 'minCredit'];
    const r = state.eligible.find(x => x.creditLimit === v);
    return r ? r.name : '—';
  }
  function renderKPIs() {
    const k = state.analytics.kpi;
    $('kpiGrid').innerHTML = KPI_DEFS.map((d, i) => `
      <article class="kpi tilt" data-k="${i}" style="--i:${i}">
        <div class="kpi-top"><span class="kpi-label">${d.label}</span><span class="kpi-icon"><i data-lucide="${d.icon}"></i></span></div>
        <div class="kpi-value" data-count="${k[d.key]}" data-money="${d.money ? 1 : 0}">${d.money ? '₹0' : '0'}</div>
        <div class="kpi-sub">${esc(d.sub(k))}</div>
      </article>`).join('');
    $('navCount').textContent = SKY.fmt.num(k.customers);
    SKY.icons();
    document.querySelectorAll('#kpiGrid .kpi-value').forEach(el => countUp(el, Number(el.dataset.count), el.dataset.money === '1'));
  }
  function countUp(el, target, money) {
    const f = money ? SKY.fmt.inr : SKY.fmt.num;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !target) { el.textContent = f(target); return; }
    const dur = 1400, t0 = performance.now();
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(target * e);
      if (p < 1) requestAnimationFrame(step); else el.textContent = f(target);
    };
    requestAnimationFrame(step);
  }

  /* ---------------- generic summary table ---------------- */
  function summaryTable(el, firstCol, rows, opts = {}) {
    const total = rows.reduce((a, r) => a + r.total, 0), count = rows.reduce((a, r) => a + r.count, 0);
    const maxTotal = Math.max(1, ...rows.map(r => r.total));
    el.innerHTML = `
      <thead><tr><th>#</th><th>${firstCol}</th><th class="num">Customers</th><th class="num">Total Credit Limit</th>
        <th class="num">Average</th>${opts.noMax ? '' : '<th class="num">Highest</th>'}<th>Share of Exposure</th></tr></thead>
      <tbody>${rows.length ? rows.map((r, i) => `<tr>
        <td class="muted">${i + 1}</td><td><b>${esc(r.label)}</b></td>
        <td class="num">${SKY.fmt.num(r.count)}</td><td class="num amount">${SKY.fmt.inr(r.total)}</td>
        <td class="num">${r.count ? SKY.fmt.inr(r.total / r.count) : '—'}</td>
        ${opts.noMax ? '' : `<td class="num">${r.count ? SKY.fmt.inr(r.max) : '—'}</td>`}
        <td><div class="bar-cell"><i><b style="width:${(r.total / maxTotal * 100).toFixed(1)}%"></b></i><span>${total ? SKY.fmt.pct(r.total / total) : '0%'}</span></div></td>
      </tr>`).join('') : `<tr><td colspan="7" class="empty">No eligible customers.</td></tr>`}</tbody>
      <tfoot><tr><td></td><td>Total</td><td class="num">${SKY.fmt.num(count)}</td><td class="num">${SKY.fmt.inr(total)}</td>
        <td class="num">${count ? SKY.fmt.inr(total / count) : '—'}</td>${opts.noMax ? '' : '<td></td>'}<td>100%</td></tr></tfoot>`;
  }
  function minis(el, items) {
    el.innerHTML = items.map(it => `<div class="mini glass tilt ${it.cls || ''}"><div class="mini-icon"><i data-lucide="${it.icon}"></i></div>
      <div><span>${esc(it.label)}</span><b title="${esc(it.value)}">${esc(it.value)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</div></div>`).join('');
  }

  /* ---------------- views ---------------- */
  const views = {
    overview() {
      const a = state.analytics;
      SKY.Charts.doughnut('ovHubChart', { labels: a.hubs.map(h => h.label), data: a.hubs.map(h => h.total), money: true, centerLabel: 'Total credit' });
      SKY.Charts.bar('ovBucketChart', { labels: a.buckets.map(b => b.label), data: a.buckets.map(b => b.count), label: 'Customers' });
      const top5 = a.salesmen.slice(0, 5);
      SKY.Charts.bar('ovSalesChart', { labels: top5.map(s => s.label), data: top5.map(s => s.total), label: 'Total credit limit', money: true, horizontal: true });
      const ag = a.aging.filter(x => x.count);
      SKY.Charts.polar('ovAgingChart', { labels: ag.map(x => x.label), data: ag.map(x => x.count) });
    },
    hubs() {
      const h = state.analytics.hubs;
      const top = h[0];
      const byAvg = h.slice().sort((x, y) => y.avg - x.avg)[0];
      const byCount = h.slice().sort((x, y) => y.count - x.count)[0];
      minis($('hubSummary'), [
        { icon: 'map-pin', label: 'Origin hubs', value: SKY.fmt.num(h.length) },
        { icon: 'crown', label: 'Highest credit limit hub', value: top ? top.label : '—', sub: top ? SKY.fmt.inr(top.total) : '' },
        { icon: 'users', label: 'Most customers', value: byCount ? byCount.label : '—', sub: byCount ? byCount.count + ' customers' : '' },
        { icon: 'calculator', label: 'Highest average', value: byAvg ? byAvg.label : '—', sub: byAvg ? SKY.fmt.inr(byAvg.avg) : '' }
      ]);
      SKY.Charts.bar('hubBarChart', { labels: h.map(x => x.label), data: h.map(x => x.total), label: 'Total credit limit', money: true,
        secondary: { label: 'Customers', data: h.map(x => x.count) } });
      SKY.Charts.doughnut('hubDoughnutChart', { labels: h.map(x => x.label), data: h.map(x => x.total), money: true, centerLabel: 'Total credit' });
      summaryTable($('hubTable'), 'Origin Hub', h);
    },
    salesmen() {
      const s = state.analytics.salesmen;
      const named = s.filter(x => x.label !== F.NOT_ASSIGNED);
      const top = named[0];
      const byCount = named.slice().sort((x, y) => y.count - x.count)[0];
      const unassigned = s.find(x => x.label === F.NOT_ASSIGNED);
      minis($('salesSummary'), [
        { icon: 'briefcase', label: 'Salesmen', value: SKY.fmt.num(named.length) },
        { icon: 'trophy', label: 'Top by credit limit', value: top ? top.label : '—', sub: top ? SKY.fmt.inr(top.total) : '' },
        { icon: 'users', label: 'Most customers', value: byCount ? byCount.label : '—', sub: byCount ? byCount.count + ' customers' : '' },
        { icon: 'user-x', label: 'Not assigned', value: unassigned ? unassigned.count + ' customers' : '0', sub: unassigned ? SKY.fmt.inr(unassigned.total) : '' }
      ]);
      const top10 = s.slice(0, 10);
      SKY.Charts.bar('salesTopChart', { labels: top10.map(x => x.label), data: top10.map(x => x.total), label: 'Total credit limit', money: true, horizontal: true });
      const byC = s.slice().sort((x, y) => y.count - x.count);
      SKY.Charts.bar('salesCountChart', { labels: byC.map(x => x.label), data: byC.map(x => x.count), label: 'Customers', horizontal: true });
      SKY.Charts.bar('salesCompareChart', { labels: s.map(x => x.label), data: s.map(x => x.total), label: 'Total credit limit', money: true,
        secondary: { label: 'Average credit limit', data: s.map(x => Math.round(x.avg)), money: true } });
      summaryTable($('salesTable'), 'Salesman', s);
    },
    credit() {
      const b = state.analytics.buckets, k = state.analytics.kpi;
      const biggest = b.slice().sort((x, y) => y.total - x.total)[0];
      const most = b.slice().sort((x, y) => y.count - x.count)[0];
      minis($('creditSummary'), [
        { icon: 'wallet', label: 'Total exposure', value: SKY.fmt.inr(k.totalCredit) },
        { icon: 'calculator', label: 'Average limit', value: SKY.fmt.inr(k.avgCredit) },
        { icon: 'layers', label: 'Most customers in', value: most ? most.label : '—', sub: most ? most.count + ' customers' : '' },
        { icon: 'flame', label: 'Largest exposure in', value: biggest ? biggest.label : '—', sub: biggest ? SKY.fmt.inr(biggest.total) : '' }
      ]);
      SKY.Charts.bar('creditCountChart', { labels: b.map(x => x.label), data: b.map(x => x.count), label: 'Customers' });
      SKY.Charts.doughnut('creditExposureChart', { labels: b.map(x => x.label), data: b.map(x => x.total), money: true, centerLabel: 'Exposure' });
      summaryTable($('creditTable'), 'Credit Limit Range', b.map(x => Object.assign({}, x, { max: 0 })), { noMax: true });
    },
    aging() {
      const ag = state.analytics.aging, k = state.analytics.kpi;
      const na = ag.find(x => x.label === F.NOT_AVAILABLE) || { count: 0, total: 0 };
      const withAging = ag.filter(x => x.label !== F.NOT_AVAILABLE && x.count);
      const common = withAging.slice().sort((x, y) => y.count - x.count)[0];
      minis($('agingSummary'), [
        { icon: 'alert-triangle', label: 'Blank aging limit', value: SKY.fmt.num(na.count) + ' customers', sub: SKY.fmt.inr(na.total) + ' exposure', cls: 'mini--err' },
        { icon: 'check-circle-2', label: 'Aging limit set', value: SKY.fmt.num(k.customers - na.count) + ' customers', cls: 'mini--ok' },
        { icon: 'hourglass', label: 'Most common', value: common ? common.label : '—', sub: common ? common.count + ' customers' : '' },
        { icon: 'list', label: 'Distinct aging values', value: SKY.fmt.num(withAging.length) }
      ]);
      SKY.Charts.bar('agingCountChart', { labels: ag.map(x => x.label), data: ag.map(x => x.count), label: 'Customers' });
      SKY.Charts.bar('agingExposureChart', { labels: ag.map(x => x.label), data: ag.map(x => x.total), label: 'Credit exposure', money: true });
      summaryTable($('agingTable'), 'Aging Limit', ag, { noMax: true });
    }
  };
  function renderView(name) {
    if (!state.analytics || !views[name]) return;
    if (!SKY.Charts.isDirty(name)) return;
    views[name]();
    SKY.Charts.clean(name);
    SKY.icons();
  }

  /* ---------------- customer table ---------------- */
  const COLS = [
    { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'hub', label: 'Origin Hub' },
    { key: 'creditLimit', label: 'Credit Limit', num: true }, { key: 'agingLimit', label: 'Aging Limit' },
    { key: 'status', label: 'Status' }, { key: 'salesman', label: 'Salesman' }
  ];
  function populateFilterOptions() {
    const a = state.analytics;
    const fill = (el, first, values, cur) => {
      el.innerHTML = `<option value="">${first}</option>` + values.map(v => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
      if (cur && !values.includes(cur)) { state.table[el.dataset.key] = ''; }
    };
    const t = state.table;
    $('fHub').dataset.key = 'hub'; $('fSalesman').dataset.key = 'salesman'; $('fAging').dataset.key = 'aging';
    fill($('fHub'), 'All hubs', a.hubs.map(h => h.label).sort(), t.hub);
    fill($('fSalesman'), 'All salesmen', a.salesmen.map(s => s.label).sort((x, y) => x === F.NOT_ASSIGNED ? 1 : y === F.NOT_ASSIGNED ? -1 : x.localeCompare(y)), t.salesman);
    fill($('fAging'), 'All aging limits', a.aging.filter(x => x.count).map(x => x.label), t.aging);
    $('fBucket').innerHTML = '<option value="">Any amount</option>' + F.CREDIT_BUCKETS.map((b, i) => `<option value="${i}">${b.label}</option>`).join('');
  }
  function applyTableFilters() {
    const t = state.table;
    state.filtered = F.sortRows(F.filterTable(state.eligible, t), t.sortKey, t.sortDir);
    const pages = Math.max(1, Math.ceil(state.filtered.length / t.pageSize));
    if (t.page > pages) t.page = pages;
    renderTable();
  }
  function renderTable() {
    const t = state.table, el = $('customerTable');
    const start = (t.page - 1) * t.pageSize;
    const pageRows = state.filtered.slice(start, start + t.pageSize);
    const head = `<thead><tr><th>#</th>${COLS.map(c => `<th class="sortable ${c.num ? 'num' : ''} ${t.sortKey === c.key ? 'sorted' : ''}" data-sort="${c.key}" aria-sort="${t.sortKey === c.key ? (t.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}">${c.label}<span class="sort">${t.sortKey === c.key ? (t.sortDir === 'asc' ? '▲' : '▼') : '↕'}</span></th>`).join('')}</tr></thead>`;
    const body = pageRows.length ? pageRows.map((r, i) => `<tr>
        <td class="muted">${start + i + 1}</td>
        <td class="name">${esc(r.name) || '<span class="muted">—</span>'}</td>
        <td><span class="code">${esc(r.code)}</span></td>
        <td>${esc(F.hubKey(r))}</td>
        <td class="num amount">${SKY.fmt.inr(r.creditLimit)}</td>
        <td>${r.agingLimit == null ? '<span class="badge badge--na">Not Available</span>' : `<span class="badge badge--days">${r.agingLimit} days</span>`}</td>
        <td><span class="badge badge--active">${esc(r.status)}</span></td>
        <td>${r.salesman ? esc(r.salesman) : `<span class="muted">${F.NOT_ASSIGNED}</span>`}</td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">No customers match the current filters.</td></tr>`;
    el.innerHTML = head + '<tbody>' + body + '</tbody>';
    const total = state.filtered.reduce((s, r) => s + r.creditLimit, 0);
    $('tableInfo').innerHTML = state.filtered.length
      ? `Showing <b>${SKY.fmt.num(start + 1)}–${SKY.fmt.num(start + pageRows.length)}</b> of <b>${SKY.fmt.num(state.filtered.length)}</b> customers · Total credit <b>${SKY.fmt.inr(total)}</b>`
      : 'No matching customers';
    renderPager();
  }
  function renderPager() {
    const t = state.table, pages = Math.max(1, Math.ceil(state.filtered.length / t.pageSize));
    const btn = (label, page, opts = {}) => `<button data-page="${page}" ${opts.disabled ? 'disabled' : ''} class="${opts.active ? 'active' : ''}" aria-label="${opts.aria || 'Page ' + page}">${label}</button>`;
    const nums = [];
    const add = p => nums.push(btn(p, p, { active: p === t.page }));
    const win = 1;
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - t.page) <= win) add(p);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    $('pager').innerHTML = btn('‹', t.page - 1, { disabled: t.page <= 1, aria: 'Previous page' }) +
      nums.map(n => n === '…' ? '<button disabled>…</button>' : n).join('') +
      btn('›', t.page + 1, { disabled: t.page >= pages, aria: 'Next page' });
  }
  function bindTable() {
    const t = state.table;
    const debounce = (fn, ms) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
    $('fSearch').addEventListener('input', debounce(e => { t.search = e.target.value; t.page = 1; applyTableFilters(); }, 250));
    [['fHub', 'hub'], ['fSalesman', 'salesman'], ['fAging', 'aging']].forEach(([id, k]) =>
      $(id).addEventListener('change', e => { t[k] = e.target.value; t.page = 1; applyTableFilters(); }));
    $('fBucket').addEventListener('change', e => {
      const b = F.CREDIT_BUCKETS[e.target.value];
      t.minCredit = b && b.min > 1 ? b.min + 1 : ''; t.maxCredit = b && isFinite(b.max) ? b.max : '';
      $('fMin').value = t.minCredit; $('fMax').value = t.maxCredit; t.page = 1; applyTableFilters();
    });
    const range = debounce(() => { t.minCredit = $('fMin').value; t.maxCredit = $('fMax').value; $('fBucket').value = ''; t.page = 1; applyTableFilters(); }, 300);
    $('fMin').addEventListener('input', range); $('fMax').addEventListener('input', range);
    $('pageSize').addEventListener('change', e => { t.pageSize = Number(e.target.value); t.page = 1; applyTableFilters(); });
    $('pager').addEventListener('click', e => { const b = e.target.closest('button[data-page]'); if (!b || b.disabled) return; t.page = Number(b.dataset.page); renderTable(); $('customerTable').closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    $('customerTable').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]'); if (!th) return;
      const k = th.dataset.sort;
      if (t.sortKey === k) t.sortDir = t.sortDir === 'asc' ? 'desc' : 'asc';
      else { t.sortKey = k; t.sortDir = (k === 'creditLimit' || k === 'agingLimit') ? 'desc' : 'asc'; }
      applyTableFilters();
    });
    $('resetFilters').addEventListener('click', resetFilters);
  }
  function resetFilters() {
    Object.assign(state.table, { search: '', hub: '', salesman: '', aging: '', minCredit: '', maxCredit: '', page: 1, sortKey: 'creditLimit', sortDir: 'desc' });
    ['fSearch', 'fHub', 'fSalesman', 'fAging', 'fBucket', 'fMin', 'fMax'].forEach(id => { $(id).value = ''; });
    applyTableFilters();
  }
  function setTableFilter(partial) {
    resetFilters();
    Object.assign(state.table, partial);
    if (partial.aging != null) $('fAging').value = partial.aging;
    if (partial.hub != null) $('fHub').value = partial.hub;
    if (partial.salesman != null) $('fSalesman').value = partial.salesman;
    applyTableFilters();
  }

  /* ---------------- exports ---------------- */
  const exportRows = rows => rows.map(r => ({
    'Name': r.name, 'Code': r.code, 'Origin Hub': F.hubKey(r), 'Credit Limit': r.creditLimit,
    'Aging Limit': r.agingLimit == null ? F.NOT_AVAILABLE : r.agingLimit, 'Status': r.status, 'Salesman': r.salesman || F.NOT_ASSIGNED
  }));
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportCSV() {
    const rows = exportRows(state.filtered);
    if (!rows.length) return SKY.toast('Nothing to export – no customers match the filters.', 'warn');
    const cols = Object.keys(rows[0]);
    const e = v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => e(r[c])).join(','))].join('\r\n');
    download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `SKYNET_Credit_Limit_Customers_${SKY.fmt.stamp()}.csv`);
    SKY.toast(`Exported ${rows.length} customers to CSV.`, 'ok');
  }
  function sheetFrom(XLSX, rows, widths, moneyCols) {
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = widths.map(w => ({ wch: w }));
    if (moneyCols && rows.length) {
      const keys = Object.keys(rows[0]);
      moneyCols.forEach(mc => {
        const ci = keys.indexOf(mc); if (ci < 0) return;
        for (let r = 1; r <= rows.length; r++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c: ci })];
          if (cell && cell.t === 'n') cell.z = '"₹"#,##,##0';
        }
      });
    }
    return ws;
  }
  async function exportXLSX(summary) {
    let XLSX;
    try { XLSX = await SKY.Excel.ensureSheetJS(); } catch (e) { return SKY.toast('Excel library could not be loaded. Use CSV export instead.', 'err'); }
    const wb = XLSX.utils.book_new();
    const cust = exportRows(summary ? state.eligible : state.filtered);
    if (!cust.length) return SKY.toast('Nothing to export – no customers match the filters.', 'warn');
    if (summary) {
      const k = state.analytics.kpi, m = state.meta || {};
      const kpis = [
        ['SKYNET WORLDWIDE EXPRESS – Customer Credit Limit Report'], [],
        ['Generated (IST)', SKY.fmt.dateTime(new Date())], ['Source file', m.fileName || '—'], ['Last upload (IST)', SKY.fmt.dateTime(m.uploadedAt)],
        ['Rules', 'Status = ACTIVE AND Credit Limit > 1'], [],
        ['Total records in file', state.summary.total], ['Excluded records', state.summary.excluded],
        ['Total Eligible Customers', k.customers], ['Total Credit Limit', k.totalCredit], ['Average Credit Limit', Math.round(k.avgCredit)],
        ['Highest Credit Limit', k.maxCredit], ['Lowest Credit Limit', k.minCredit], ['Total Origin Hubs', k.hubs],
        ['Total Salesmen', k.salesmen], ['Customers with Missing Aging Limit', k.missingAging]
      ];
      const ws = XLSX.utils.aoa_to_sheet(kpis); ws['!cols'] = [{ wch: 36 }, { wch: 42 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Summary');
      const grp = (rows, first) => rows.map(r => ({ [first]: r.label, 'Customers': r.count, 'Total Credit Limit': Math.round(r.total),
        'Average Credit Limit': r.count ? Math.round(r.total / r.count) : 0, 'Share %': Number((r.share * 100 || 0).toFixed(2)) }));
      const a = state.analytics;
      XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, grp(a.hubs, 'Origin Hub'), [22, 12, 20, 20, 10], ['Total Credit Limit', 'Average Credit Limit']), 'Origin Hubs');
      XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, grp(a.salesmen, 'Salesman'), [24, 12, 20, 20, 10], ['Total Credit Limit', 'Average Credit Limit']), 'Salesmen');
      const tot = a.kpi.totalCredit || 1;
      XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, grp(a.buckets.map(b => Object.assign({}, b, { share: b.total / tot })), 'Credit Limit Range'), [26, 12, 20, 20, 10], ['Total Credit Limit', 'Average Credit Limit']), 'Credit Ranges');
      XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, grp(a.aging.map(b => Object.assign({}, b, { share: b.total / tot })), 'Aging Limit'), [18, 12, 20, 20, 10], ['Total Credit Limit', 'Average Credit Limit']), 'Aging Limits');
    }
    XLSX.utils.book_append_sheet(wb, sheetFrom(XLSX, cust, [42, 12, 16, 16, 14, 10, 20], ['Credit Limit']), summary ? 'Eligible Customers' : 'Customers');
    XLSX.writeFile(wb, `SKYNET_Credit_Limit_${summary ? 'Analytics' : 'Customers'}_${SKY.fmt.stamp()}.xlsx`);
    SKY.toast(`Excel file created with ${cust.length} customers.`, 'ok');
  }
  function printReport() {
    const k = state.analytics.kpi, t = state.table, m = state.meta || {};
    const total = state.filtered.reduce((s, r) => s + r.creditLimit, 0);
    const active = [t.search && `Search "${t.search}"`, t.hub && `Hub: ${t.hub}`, t.salesman && `Salesman: ${t.salesman}`, t.aging && `Aging: ${t.aging}`,
      t.minCredit && `Min ${SKY.fmt.inr(t.minCredit)}`, t.maxCredit && `Max ${SKY.fmt.inr(t.maxCredit)}`].filter(Boolean).join(' · ') || 'None';
    $('printArea').innerHTML = `
      <div class="pr-head"><div><h1>Customer Credit Limit Report</h1><div>SKYNET WORLDWIDE EXPRESS · Printed ${SKY.fmt.dateTime(new Date())}</div>
        <div>Source: ${esc(m.fileName || '—')} · Last upload: ${SKY.fmt.dateTime(m.uploadedAt)} · Rules: Status = ACTIVE and Credit Limit &gt; ₹1</div></div>
        <img src="assets/skynet-logo.png" alt="SKYNET"></div>
      <div class="pr-kpis">
        <div><span>Eligible customers</span><b>${SKY.fmt.num(k.customers)}</b></div><div><span>Total credit limit</span><b>${SKY.fmt.inr(k.totalCredit)}</b></div>
        <div><span>Average credit limit</span><b>${SKY.fmt.inr(k.avgCredit)}</b></div><div><span>Highest / Lowest</span><b>${SKY.fmt.inr(k.maxCredit)} / ${SKY.fmt.inr(k.minCredit)}</b></div>
        <div><span>Origin hubs</span><b>${k.hubs}</b></div><div><span>Salesmen</span><b>${k.salesmen}</b></div>
        <div><span>Missing aging limit</span><b>${k.missingAging}</b></div><div><span>Rows in this print</span><b>${state.filtered.length} · ${SKY.fmt.inr(total)}</b></div>
      </div>
      <p><b>Filters:</b> ${esc(active)}</p>
      <table><thead><tr><th>#</th><th>Name</th><th>Code</th><th>Origin Hub</th><th class="num">Credit Limit</th><th>Aging Limit</th><th>Status</th><th>Salesman</th></tr></thead>
      <tbody>${state.filtered.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td>${esc(r.code)}</td><td>${esc(F.hubKey(r))}</td>
        <td class="num">${SKY.fmt.inr(r.creditLimit)}</td><td>${r.agingLimit == null ? 'Not Available' : r.agingLimit + ' days'}</td><td>${esc(r.status)}</td><td>${esc(r.salesman || F.NOT_ASSIGNED)}</td></tr>`).join('')}</tbody></table>
      <p class="pr-foot">Confidential – for internal use by SKYNET Worldwide Express staff only.</p>`;
    setTimeout(() => window.print(), 150);
  }
  function exportAction(kind) {
    if (!state.analytics) return;
    if (kind === 'csv') exportCSV();
    else if (kind === 'xlsx') exportXLSX(false);
    else if (kind === 'summary') exportXLSX(true);
    else if (kind === 'print') printReport();
  }

  SKY.Dashboard = { setData, renderView, bindTable, resetFilters, setTableFilter, exportAction, state, esc };
})();
