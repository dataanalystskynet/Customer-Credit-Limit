/* ==========================================================================
   charts.js – theme-aware Chart.js wrappers with lazy rendering.
   ========================================================================== */
(function () {
  'use strict';
  const registry = new Map();          // canvasId -> Chart instance

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const available = () => typeof window.Chart !== 'undefined';

  /* Categorical palette: theme accents first, then a fixed distinguishable set. */
  function palette(n) {
    const base = [css('--a1'), css('--a2'), css('--a3'),
      '#22c55e', '#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#a855f7',
      '#14b8a6', '#f97316', '#3b82f6', '#e11d48', '#10b981', '#8b5cf6', '#eab308', '#0ea5e9', '#d946ef', '#64748b'];
    const out = [];
    for (let i = 0; i < n; i++) out.push(base[i % base.length]);
    return out;
  }
  function alpha(hex, a) {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    const n = parseInt(h, 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  }
  function gradient(ctx, area, c1, c2, horizontal) {
    if (!area) return c1;
    const g = horizontal
      ? ctx.createLinearGradient(area.left, 0, area.right, 0)
      : ctx.createLinearGradient(0, area.bottom, 0, area.top);
    g.addColorStop(0, alpha(c1, .85)); g.addColorStop(1, alpha(c2, 1));
    return g;
  }

  function applyDefaults() {
    if (!available()) return;
    const C = Chart.defaults;
    C.font.family = css('--font') || 'Inter, sans-serif';
    C.font.size = 12;
    C.color = css('--muted');
    C.borderColor = css('--border');
    C.plugins.legend.labels.usePointStyle = true;
    C.plugins.legend.labels.boxWidth = 8;
    C.plugins.tooltip.backgroundColor = css('--surface-solid');
    C.plugins.tooltip.titleColor = css('--text');
    C.plugins.tooltip.bodyColor = css('--text-2');
    C.plugins.tooltip.borderColor = css('--border-strong');
    C.plugins.tooltip.borderWidth = 1;
    C.plugins.tooltip.padding = 10;
    C.plugins.tooltip.cornerRadius = 10;
    C.animation.duration = 700;
    C.maintainAspectRatio = false;
    C.responsive = true;
  }

  function make(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !available()) return null;
    destroy(id);
    const chart = new Chart(canvas, config);
    registry.set(id, chart);
    return chart;
  }
  function destroy(id) { const c = registry.get(id); if (c) { c.destroy(); registry.delete(id); } }
  function destroyAll() { registry.forEach(c => c.destroy()); registry.clear(); }

  const fmt = v => SKY.fmt.inr(v);
  const fmtShort = v => SKY.fmt.inrShort(v);
  const gridColor = () => css('--border');

  /* --- chart builders --- */
  function bar(id, { labels, data, label, money, horizontal, colors, secondary }) {
    const a1 = css('--a1'), a2 = css('--a2');
    const datasets = [{
      label, data, borderRadius: 8, borderSkipped: false, maxBarThickness: 46,
      backgroundColor: colors || (c => gradient(c.chart.ctx, c.chart.chartArea, a1, a2, horizontal)),
      yAxisID: horizontal ? undefined : 'y', xAxisID: horizontal ? 'x' : undefined
    }];
    if (secondary) {
      datasets.push({
        type: 'line', label: secondary.label, data: secondary.data, yAxisID: 'y2',
        borderColor: css('--a3') || '#999', backgroundColor: css('--a3'), tension: .35, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2.5
      });
    }
    const valueAxis = {
      grid: { color: gridColor() }, border: { display: false }, beginAtZero: true,
      ticks: { callback: v => money ? fmtShort(v) : (Number.isInteger(v) ? v : '') }
    };
    const catAxis = { grid: { display: false }, border: { display: false },
      ticks: { autoSkip: false, maxRotation: 45, callback(v) { const l = this.getLabelForValue(v); return l.length > 18 ? l.slice(0, 17) + '…' : l; } } };
    const scales = horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis };
    if (secondary) scales.y2 = { position: 'right', grid: { display: false }, border: { display: false }, beginAtZero: true,
      ticks: { callback: v => secondary.money ? fmtShort(v) : (Number.isInteger(v) ? v : '') } };
    return make(id, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: horizontal ? 'y' : 'x',
        plugins: {
          legend: { display: !!secondary },
          tooltip: { callbacks: { label: c => {
            const isSec = secondary && c.datasetIndex === 1;
            const m = isSec ? secondary.money : money;
            return ` ${c.dataset.label}: ${m ? fmt(c.raw) : c.raw.toLocaleString('en-IN')}`;
          } } }
        },
        scales
      }
    });
  }

  function doughnut(id, { labels, data, money, centerLabel }) {
    const colors = palette(labels.length);
    const total = data.reduce((a, b) => a + b, 0);
    const center = {
      id: 'center',
      afterDraw(chart) {
        const { ctx, chartArea: a } = chart;
        if (!a) return;
        const meta = chart.getDatasetMeta(0);
        const arc = meta.data[0];
        if (!arc) return;
        const x = arc.x, y = arc.y;
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = css('--text'); ctx.font = `800 ${Math.max(14, Math.min(22, a.width / 14))}px ${css('--font')}`;
        ctx.fillText(money ? fmtShort(total) : total.toLocaleString('en-IN'), x, y - 8);
        ctx.fillStyle = css('--muted'); ctx.font = `600 11px ${css('--font')}`;
        ctx.fillText(centerLabel || 'Total', x, y + 12);
        ctx.restore();
      }
    };
    return make(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: css('--surface-solid'), borderWidth: 3, hoverOffset: 12 }] },
      options: {
        cutout: '66%',
        layout: { padding: 8 },
        plugins: {
          legend: { position: window.innerWidth < 640 ? 'bottom' : 'right', labels: { color: css('--text-2'), padding: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${money ? fmt(c.raw) : c.raw.toLocaleString('en-IN')} (${total ? (c.raw / total * 100).toFixed(1) : 0}%)` } }
        }
      },
      plugins: [center]
    });
  }

  function polar(id, { labels, data }) {
    const colors = palette(labels.length).map(c => alpha(c, .75));
    return make(id, {
      type: 'polarArea',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: css('--surface-solid'), borderWidth: 2 }] },
      options: {
        scales: { r: { grid: { color: gridColor() }, angleLines: { color: gridColor() }, ticks: { display: false } } },
        plugins: { legend: { position: window.innerWidth < 640 ? 'bottom' : 'right', labels: { color: css('--text-2') } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} customers` } } }
      }
    });
  }

  /* --- lazy rendering: a view's charts are only built when it is shown --- */
  const dirty = new Set();
  function markAllDirty(views) { views.forEach(v => dirty.add(v)); }
  function isDirty(view) { return dirty.has(view); }
  function clean(view) { dirty.delete(view); }

  window.addEventListener('resize', debounce(() => registry.forEach(c => c.resize()), 200));
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  SKY.Charts = { applyDefaults, bar, doughnut, polar, destroy, destroyAll, available, palette, markAllDirty, isDirty, clean };
})();
