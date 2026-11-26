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
  /* darken / lighten a #hex colour (f < 0 darkens, f > 0 lightens) */
  function shade(hex, f) {
    const h = String(hex).trim().replace('#', '');
    if (h.length !== 6) return 'rgba(0,0,0,.35)';
    const n = parseInt(h, 16);
    const ch = v => Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f);
    return `rgb(${ch(n >> 16 & 255)},${ch(n >> 8 & 255)},${ch(n & 255)})`;
  }

  /* ---- Pseudo-3D plugin: extruded bars, thick doughnuts, soft drop shadows ---- */
  const depth3d = {
    id: 'depth3d',
    beforeDatasetDraw(chart, args, opts) {
      try {
        const meta = args.meta, ctx = chart.ctx;
        if (meta.hidden || !opts || opts.enabled === false) return;
        const type = meta.type;
        if (type === 'bar') {
          const horiz = chart.options.indexAxis === 'y';
          const d = opts.depth || 9, dx = d * .9, dy = -d * .65;
          const faceTop = opts.top, faceSide = opts.side;
          meta.data.forEach((el, i) => {
            const p = el.getProps(['x', 'y', 'base', 'width', 'height'], true);
            let l, r, t, b;
            if (!horiz) { l = p.x - p.width / 2; r = p.x + p.width / 2; t = Math.min(p.y, p.base); b = Math.max(p.y, p.base); }
            else { l = Math.min(p.x, p.base); r = Math.max(p.x, p.base); t = p.y - p.height / 2; b = p.y + p.height / 2; }
            if (!(r - l > 1) || !(b - t > 1)) return;
            const active = chart.getActiveElements().some(a => a.datasetIndex === args.index && a.index === i);
            ctx.save();
            ctx.globalAlpha = active ? 1 : .92;
            ctx.beginPath(); ctx.moveTo(r, t); ctx.lineTo(r + dx, t + dy); ctx.lineTo(r + dx, b + dy); ctx.lineTo(r, b); ctx.closePath();
            ctx.fillStyle = Array.isArray(faceSide) ? faceSide[i % faceSide.length] : faceSide; ctx.fill();
            ctx.beginPath(); ctx.moveTo(l, t); ctx.lineTo(l + dx, t + dy); ctx.lineTo(r + dx, t + dy); ctx.lineTo(r, t); ctx.closePath();
            ctx.fillStyle = Array.isArray(faceTop) ? faceTop[i % faceTop.length] : faceTop; ctx.fill();
            ctx.restore();
          });
        } else if (type === 'doughnut' || type === 'pie') {
          const layers = opts.depth || 14, colors = opts.colors || [];
          for (let k = layers; k > 0; k--) {
            meta.data.forEach((arc, i) => {
              const p = arc.getProps(['x', 'y', 'startAngle', 'endAngle', 'innerRadius', 'outerRadius'], true);
              const off = ((arc.options && arc.options.offset) || 0) / 4, mid = (p.startAngle + p.endAngle) / 2;
              const x = p.x + Math.cos(mid) * off, y = p.y + Math.sin(mid) * off + k;
              ctx.beginPath();
              ctx.arc(x, y, p.outerRadius, p.startAngle, p.endAngle);
              ctx.arc(x, y, p.innerRadius, p.endAngle, p.startAngle, true);
              ctx.closePath();
              ctx.fillStyle = shade(colors[i % colors.length] || '#888888', k === layers ? -.6 : -.42);
              ctx.fill();
            });
          }
        } else if (type !== 'polarArea') { return; }
        ctx.save();
        ctx.shadowColor = opts.shadow || 'rgba(0,0,0,.35)';
        ctx.shadowBlur = 16; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8;
        chart.$depthSaved = true;
      } catch (e) { /* never break a chart because of decoration */ }
    },
    afterDatasetDraw(chart) {
      if (chart.$depthSaved) { chart.ctx.restore(); chart.$depthSaved = false; }
    }
  };

  /* ---- value labels at the end of each bar, e.g. "68 (69%)" ---- */
  const valueLabels = {
    id: 'valueLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || typeof opts.format !== 'function') return;
      const ctx = chart.ctx, ds = chart.data.datasets[0], meta = chart.getDatasetMeta(0);
      const total = ds.data.reduce((a, b) => a + (+b || 0), 0);
      const horiz = chart.options.indexAxis === 'y';
      ctx.save();
      ctx.font = `700 12px ${css('--font') || 'Inter, sans-serif'}`;
      ctx.fillStyle = css('--text');
      meta.data.forEach((el, i) => {
        const v = ds.data[i];
        if (!v) return;
        const txt = opts.format(v, total);
        if (horiz) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(txt, el.x + 16, el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(txt, el.x, el.y - 12); }
      });
      ctx.restore();
    }
  };

  /* shared hover animation + click handling */
  function interaction(onPick) {
    return {
      transitions: { active: { animation: { duration: 750, easing: 'easeOutBack' } } },
      onHover(evt, els) { if (evt.native && evt.native.target) evt.native.target.style.cursor = els.length && onPick ? 'pointer' : 'default'; },
      onClick(evt, els, chart) { if (onPick && els.length) onPick(chart.data.labels[els[0].index]); }
    };
  }
  /* slow, staggered grow: bars rise from the bottom (left→right for horizontal bars) */
  const grow = { delay: c => (c.type === 'data' && c.mode === 'default') ? c.dataIndex * 140 : 0, duration: 1800, easing: 'easeOutCubic' };

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
    chart.$type = config.type;
    registry.set(id, chart);
    return chart;
  }
  function destroy(id) { stopSpinSafe(id); const c = registry.get(id); if (c) { c.destroy(); registry.delete(id); } }
  function stopSpinSafe(id) { try { stopSpin(id); } catch (e) {} }
  function destroyAll() { registry.forEach(c => c.destroy()); registry.clear(); }

  const fmt = v => SKY.fmt.inr(v);
  const fmtShort = v => SKY.fmt.inrShort(v);
  const gridColor = () => css('--border');

  /* --- chart builders --- */
  function bar(id, { labels, data, label, money, horizontal, colors, secondary, onPick, valueLabels: vl }) {
    const a1 = css('--a1'), a2 = css('--a2');
    const lineColor = css('--line-c') || '#38bdf8';
    const datasets = [{
      label, data, order: 1, borderRadius: 4, borderSkipped: false, maxBarThickness: 46,
      borderWidth: 0, hoverBorderWidth: 3, hoverBorderColor: 'rgba(255,255,255,.85)',
      backgroundColor: colors || (c => gradient(c.chart.ctx, c.chart.chartArea, a1, a2, horizontal)),
      yAxisID: horizontal ? undefined : 'y', xAxisID: horizontal ? 'x' : undefined
    }];
    if (secondary) {
      datasets.push({
        type: 'line', label: secondary.label, data: secondary.data, yAxisID: 'y2', order: 0,
        borderColor: lineColor, backgroundColor: lineColor, borderWidth: 3, borderDash: [],
        cubicInterpolationMode: 'monotone', tension: .3,
        pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: lineColor, pointBorderColor: '#ffffff', pointBorderWidth: 2
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
      ticks: { color: lineColor, font: { weight: '600' }, callback: v => secondary.money ? fmtShort(v) : (Number.isInteger(v) ? v : '') } };
    return make(id, {
      type: 'bar',
      data: { labels, datasets },
      plugins: vl ? [depth3d, valueLabels] : [depth3d],
      options: Object.assign(interaction(onPick), {
        indexAxis: horizontal ? 'y' : 'x',
        animation: grow,
        layout: { padding: { top: vl && !horizontal ? 28 : 12, right: vl && horizontal ? 86 : 14 } },
        plugins: {
          depth3d: Array.isArray(colors)
            ? { depth: 9, top: colors.map(c => shade(c, .25)), side: colors.map(c => shade(c, -.38)) }
            : { depth: 9, top: shade(a2, .25), side: shade(a1, -.38) },
          valueLabels: vl ? { format: vl } : false,
          legend: { display: !!secondary, labels: { sort: (a, b) => a.datasetIndex - b.datasetIndex } },
          tooltip: { callbacks: { label: c => {
            const isSec = secondary && c.datasetIndex === 1;
            const m = isSec ? secondary.money : money;
            return ` ${c.dataset.label}: ${m ? fmt(c.raw) : c.raw.toLocaleString('en-IN')}`;
          } } }
        },
        scales
      })
    });
  }

  function doughnut(id, { labels, data, money, centerLabel, onPick }) {
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
    const chart = make(id, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: css('--surface-solid'), borderWidth: 2, hoverOffset: 26, hoverBorderWidth: 0 }] },
      plugins: [depth3d, center],
      options: Object.assign(interaction(onPick), {
        cutout: '62%',
        layout: { padding: { top: 16, bottom: 22, left: 16, right: 16 } },
        animation: { animateRotate: true, animateScale: true, duration: 2200, easing: 'easeOutCubic' },
        plugins: {
          depth3d: { depth: 14, colors },
          legend: { position: window.innerWidth < 640 ? 'bottom' : 'right', labels: { color: css('--text-2'), padding: 12 } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${money ? fmt(c.raw) : c.raw.toLocaleString('en-IN')} (${total ? (c.raw / total * 100).toFixed(1) : 0}%)` } }
        }
      })
    });
    return chart;
  }

  function polar(id, { labels, data }) {
    const colors = palette(labels.length).map(c => alpha(c, .75));
    return make(id, {
      type: 'polarArea',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: css('--surface-solid'), borderWidth: 2, hoverBorderWidth: 4, hoverBorderColor: 'rgba(255,255,255,.8)' }] },
      plugins: [depth3d],
      options: {
        transitions: { active: { animation: { duration: 750, easing: 'easeOutBack' } } },
        animation: { animateRotate: true, animateScale: true, duration: 2200, easing: 'easeOutCubic' },
        scales: { r: { grid: { color: gridColor() }, angleLines: { color: gridColor() }, ticks: { display: false } } },
        plugins: { depth3d: {}, legend: { position: window.innerWidth < 640 ? 'bottom' : 'right', labels: { color: css('--text-2') } },
          tooltip: { callbacks: { label: c => ` ${c.label}: ${c.raw} customers` } } }
      }
    });
  }

  /* --- lazy rendering: a view's charts are only built when it is shown --- */
  const dirty = new Set();
  function markAllDirty(views) { views.forEach(v => dirty.add(v)); }
  function isDirty(view) { return dirty.has(view); }
  function clean(view) { dirty.delete(view); }

  /* ---- Hover motion: when the mouse enters a chart card, replay the build-up
     animation slowly (bars rise from the bottom); round charts keep turning
     slowly while the mouse stays on the card. ---- */
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spins = new Map();
  function replay(id) {
    const c = registry.get(id);
    if (!c || reduceMotion) return;
    const now = Date.now();
    if (c.$lastReplay && now - c.$lastReplay < 2600) return;   // don't restart while still animating
    c.$lastReplay = now;
    c.reset(); c.update();
  }
  function startSpin(id) {
    const c = registry.get(id);
    if (!c || reduceMotion || !['doughnut', 'pie', 'polarArea'].includes(c.$type) || spins.has(id)) return;
    let last = 0;
    const step = t => {
      if (!spins.has(id) || !registry.has(id)) return;
      if (t - last > 33) {                       // ~30 fps, ~8° per second
        last = t;
        if (!c.$lastReplay || Date.now() - c.$lastReplay > 2300) {
          c.options.startAngle = ((c.options.startAngle || 0) + .27) % 360;   // polar area
          c.options.rotation = ((c.options.rotation || 0) + .27) % 360;       // doughnut / pie
          c.update('none');
        }
      }
      spins.set(id, requestAnimationFrame(step));
    };
    spins.set(id, requestAnimationFrame(step));
  }
  function stopSpin(id) { const r = spins.get(id); if (r) cancelAnimationFrame(r); spins.delete(id); }
  const canvasesIn = card => [...card.querySelectorAll('canvas')].map(c => c.id).filter(id => registry.has(id));
  document.addEventListener('mouseover', e => {
    const card = e.target.closest && e.target.closest('.card');
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    canvasesIn(card).forEach(id => { replay(id); startSpin(id); });
  });
  document.addEventListener('mouseout', e => {
    const card = e.target.closest && e.target.closest('.card');
    if (!card || (e.relatedTarget && card.contains(e.relatedTarget))) return;
    canvasesIn(card).forEach(stopSpin);
  });

  window.addEventListener('resize', debounce(() => registry.forEach(c => c.resize()), 200));
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  SKY.Charts = { depth3d, shade, applyDefaults, bar, doughnut, polar, destroy, destroyAll, available, palette, markAllDirty, isDirty, clean };
})();
