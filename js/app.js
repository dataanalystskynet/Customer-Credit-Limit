/* ==========================================================================
   app.js – boot, sign-in, navigation, themes, clock, data loading & upload.
   ========================================================================== */
(function () {
  'use strict';
  const C = SKY.config, D = SKY.Dashboard, X = SKY.Excel, F = SKY.Filters;
  const $ = id => document.getElementById(id);
  const esc = D.esc;
  const VERSION = 'v1.0.0';
  const LS = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  const backendMode = () => !!(C.backendUrl && C.backendUrl.trim());

  /* ---------------- small UI helpers ---------------- */
  SKY.icons = () => { if (window.lucide && lucide.createIcons) lucide.createIcons(); };
  SKY.toast = function (text, type = 'ok', ms = 4200) {
    const icon = { ok: 'check-circle-2', err: 'x-circle', warn: 'alert-triangle' }[type] || 'info';
    const el = document.createElement('div');
    el.className = 'toast toast--' + type;
    el.innerHTML = `<i data-lucide="${icon}"></i><div>${esc(text)}</div>`;
    $('toasts').appendChild(el); SKY.icons();
    setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
  };
  function msg(type, html) {
    const icon = { ok: 'check-circle-2', err: 'x-circle', warn: 'alert-triangle' }[type];
    return `<div class="msg msg--${type}"><i data-lucide="${icon}"></i><div>${html}</div></div>`;
  }

  /* ---------------- backend API (Google Apps Script web app) ---------------- */
  async function api(action, payload = {}) {
    // text/plain avoids a CORS pre-flight, which Apps Script does not support
    const res = await fetch(C.backendUrl, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, payload))
    });
    if (!res.ok) throw new Error('Server error ' + res.status);
    const data = await res.json();
    if (!data.ok) { const e = new Error(data.error || 'Request failed'); e.code = data.code; throw e; }
    return data;
  }

  /* ---------------- authentication ---------------- */
  const auth = SKY.auth = {
    async hash(pw) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode((C.localAuth.salt || '') + pw));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    },
    session() {
      try {
        const s = JSON.parse(sessionStorage.getItem('sky.session') || 'null');
        if (s && s.exp > Date.now()) return s;
      } catch (e) {}
      return null;
    },
    save(s) { sessionStorage.setItem('sky.session', JSON.stringify(s)); },
    clear() { sessionStorage.removeItem('sky.session'); },
    required() { return backendMode() || (C.localAuth && C.localAuth.enabled); },
    async login(username, password) {
      const exp = Date.now() + (C.sessionHours || 8) * 3600e3;
      if (backendMode()) {
        const r = await api('login', { username, password });
        const s = { token: r.token, name: r.name, role: r.role, username, exp: r.expires || exp, mode: 'backend' };
        auth.save(s); return s;
      }
      const u = (C.localAuth.users || []).find(x => x.username.toLowerCase() === username.toLowerCase());
      const h = await auth.hash(password);
      if (!u || u.hash !== h) throw new Error('Invalid username or password.');
      const s = { name: u.name, role: u.role, username: u.username, exp, mode: 'local' };
      auth.save(s); return s;
    },
    async logout() {
      const s = auth.session();
      if (s && s.mode === 'backend') { try { await api('logout', { token: s.token }); } catch (e) {} }
      auth.clear(); location.reload();
    }
  };

  function showLogin() {
    $('login').classList.remove('hidden'); $('app').classList.add('hidden');
    $('loginMode').textContent = backendMode() ? 'Secure server sign-in' : 'Local sign-in';
    setTimeout(() => $('loginUser').focus(), 300);
  }
  function bindLogin() {
    const attempts = { n: 0, until: 0 };
    $('togglePass').addEventListener('click', () => {
      const p = $('loginPass'); p.type = p.type === 'password' ? 'text' : 'password';
      $('togglePass').innerHTML = `<i data-lucide="${p.type === 'password' ? 'eye' : 'eye-off'}"></i>`; SKY.icons();
    });
    $('loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (Date.now() < attempts.until) { $('loginError').textContent = 'Too many attempts. Please wait 30 seconds.'; return; }
      const btn = $('loginBtn'); btn.disabled = true; $('loginError').textContent = '';
      try {
        await auth.login($('loginUser').value.trim(), $('loginPass').value);
        $('loginPass').value = '';
        $('login').classList.add('hidden');
        await enterApp();
      } catch (err) {
        attempts.n++; if (attempts.n >= 5) { attempts.until = Date.now() + 30000; attempts.n = 0; }
        $('loginError').textContent = err.message === 'Failed to fetch' ? 'Cannot reach the server. Check your internet connection.' : err.message;
      } finally { btn.disabled = false; }
    });
  }

  /* ---------------- navigation ---------------- */
  const VIEWS = ['overview', 'hubs', 'salesmen', 'credit', 'aging', 'customers', 'upload', 'export', 'themes'];
  let currentView = 'overview';
  function showView(name) {
    if (!VIEWS.includes(name)) name = 'overview';
    currentView = name;
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === name));
    $('viewTitle').textContent = $('view-' + name).dataset.title;
    document.title = $('view-' + name).dataset.title + ' | SKYNET Credit Limit Report';
    $('app').classList.remove('nav-open');
    D.renderView(name);
    if (name === 'export') updateExportInfo();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function bindNav() {
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
    $('openSidebar').addEventListener('click', () => $('app').classList.add('nav-open'));
    $('closeSidebar').addEventListener('click', () => $('app').classList.remove('nav-open'));
    $('scrim').addEventListener('click', () => $('app').classList.remove('nav-open'));
    $('logoutBtn').addEventListener('click', () => auth.logout());
    $('refreshBtn').addEventListener('click', async () => {
      const b = $('refreshBtn'); b.classList.add('spin');
      try { await loadData(true); SKY.toast('Dashboard refreshed with the latest data.', 'ok'); }
      catch (e) { SKY.toast(e.message, 'err'); }
      finally { b.classList.remove('spin'); }
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-export]');
      if (b) D.exportAction(b.dataset.export);
    });
    $('showMissingAging').addEventListener('click', () => { D.setTableFilter({ aging: F.NOT_AVAILABLE }); location.hash = 'customers'; });
  }

  /* ---------------- themes & mode ---------------- */
  const THEMES = [
    { id: 'dark-premium', name: 'Dark Premium', desc: 'Black · red & orange glass', mode: 'dark', sw: ['#050505', '#2a0f06', '#e3262b', '#ff8a00'] },
    { id: 'light-pro', name: 'Light Professional', desc: 'White & grey · blue & red', mode: 'light', sw: ['#f4f6fb', '#ffffff', '#1d5fe0', '#e3262b'] },
    { id: 'midnight-purple', name: 'Midnight Purple', desc: 'Deep purple · violet & pink', mode: 'dark', sw: ['#0d0618', '#2d0f3f', '#8b5cf6', '#ec4899'] },
    { id: 'ocean-blue', name: 'Ocean Blue', desc: 'Navy · cyan & electric blue', mode: 'dark', sw: ['#030b1a', '#062a4a', '#22d3ee', '#2563eb'] },
    { id: 'emerald-green', name: 'Emerald Green', desc: 'Dark green · green & turquoise', mode: 'dark', sw: ['#03120c', '#0a2f2a', '#10b981', '#14b8a6'] }
  ];
  function applyLook(theme, mode, save = true) {
    const root = document.documentElement;
    root.dataset.theme = theme; root.dataset.mode = mode;
    if (save) { LS.set('sky.theme', theme); LS.set('sky.mode', mode); }
    $('modeToggle').innerHTML = `<i data-lucide="${mode === 'dark' ? 'sun' : 'moon'}"></i>`;
    $('modeToggle').title = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === theme));
    document.querySelectorAll('[data-mode-set]').forEach(b => b.classList.toggle('active', b.dataset.modeSet === mode));
    SKY.icons();
    if (SKY.bg3dRecolor) SKY.bg3dRecolor();
    SKY.Charts.applyDefaults();
    if (D.state.analytics) {
      SKY.Charts.markAllDirty(['overview', 'hubs', 'salesmen', 'credit', 'aging']);
      D.renderView(currentView);
    }
  }
  function bindThemes() {
    $('themeGrid').innerHTML = THEMES.map(t => `
      <button class="theme-card tilt" data-theme="${t.id}">
        <div class="theme-swatch" style="background:linear-gradient(135deg,${t.sw[0]},${t.sw[1]})">
          <i style="background:linear-gradient(90deg,${t.sw[2]},${t.sw[3]})"></i><i style="background:${t.sw[3]}"></i><i></i></div>
        <b>${t.name}</b><small>${t.desc}</small></button>`).join('');
    $('themeGrid').addEventListener('click', e => {
      const c = e.target.closest('.theme-card'); if (!c) return;
      const t = THEMES.find(x => x.id === c.dataset.theme);
      applyLook(t.id, t.mode);
      SKY.toast(`${t.name} theme applied.`, 'ok', 2200);
    });
    document.querySelectorAll('[data-mode-set]').forEach(b => b.addEventListener('click', () => applyLook(document.documentElement.dataset.theme, b.dataset.modeSet)));
    $('modeToggle').addEventListener('click', () => applyLook(document.documentElement.dataset.theme, document.documentElement.dataset.mode === 'dark' ? 'light' : 'dark'));
    const t = LS.get('sky.theme') || C.defaultTheme;
    const theme = THEMES.find(x => x.id === t) || THEMES[0];
    applyLook(theme.id, LS.get('sky.mode') || theme.mode, false);
  }

  /* ---------------- 3D tilt (mouse only, very light) ---------------- */
  function bindTilt() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let active = null, raf = 0;
    document.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      const el = e.target.closest('.tilt');
      if (active && active !== el) { active.style.transform = ''; active = null; }
      if (!el) return;
      active = el;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        const max = el.classList.contains('kpi') ? 9 : 3;
        el.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg) translateY(-4px)`;
      });
    }, { passive: true });
    document.addEventListener('pointerleave', () => { if (active) active.style.transform = ''; }, true);
  }

  /* ---------------- clock (IST) ---------------- */
  function startClock() {
    const f = new Intl.DateTimeFormat('en-IN', { timeZone: C.timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const tick = () => { const s = f.format(new Date()) + ' IST'; $('clock').textContent = s; $('loginClock').textContent = s; };
    tick(); setInterval(tick, 1000);
  }

  /* ---------------- data loading ---------------- */
  const LOCAL_KEY = 'sky.localDataset';
  async function fetchText(url) {
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.text();
  }
  function rowsFromCSV(text) {
    const ds = X.buildDataset(X.parseCSV(text));
    if (!ds.ok) throw new Error(ds.errors.join(' '));
    return ds.rows;
  }
  function readLocal() {
    try { return JSON.parse(LS.get(LOCAL_KEY) || 'null'); } catch (e) { return null; }
  }
  async function loadData(force) {
    const sess = auth.session();
    $('localBanner').classList.add('hidden');
    if (backendMode()) {
      try {
        const r = await api('getData', { token: sess && sess.token });
        D.setData(rowsFromCSV(r.csv || ''), Object.assign({}, r.meta || {}, { source: 'Secure server' }));
      } catch (e) {
        if (e.code === 'AUTH') { auth.clear(); SKY.toast('Your session has expired. Please sign in again.', 'warn'); showLogin(); throw e; }
        if (/No data/i.test(e.message)) { D.setData([], { source: 'Secure server (empty)' }); SKY.toast('No dataset has been uploaded yet.', 'warn'); }
        else throw e;
      }
      updateMeta(); return;
    }
    // Static mode: published file in the repo, unless this browser holds a newer local upload
    let published = null, publishedMeta = {};
    try {
      const [csv, meta] = await Promise.all([fetchText(C.dataUrl), fetchText(C.metaUrl).then(JSON.parse).catch(() => ({}))]);
      published = rowsFromCSV(csv); publishedMeta = Object.assign({}, meta, { source: 'Published dataset' });
    } catch (e) { console.warn('Published dataset not available:', e.message); }
    const local = readLocal();
    const localNewer = local && (!published || !publishedMeta.uploadedAt || new Date(local.meta.uploadedAt) > new Date(publishedMeta.uploadedAt));
    if (localNewer) {
      D.setData(rowsFromCSV(local.csv), Object.assign({}, local.meta, { source: 'Local upload (this browser only)' }));
      showLocalBanner(!!published);
    } else if (published) {
      if (local) LS.del(LOCAL_KEY); // the published data is newer – discard stale local copy
      D.setData(published, publishedMeta);
    } else {
      D.setData([], { source: 'No data loaded' });
      SKY.toast('No published dataset was found. Please upload a customer file.', 'warn', 6000);
    }
    updateMeta();
    if (force) D.renderView(currentView);
  }
  function showLocalBanner(canRevert) {
    const b = $('localBanner');
    b.innerHTML = `<i data-lucide="hard-drive"></i><span><b>Showing your local upload.</b> It is saved only in this browser and is not visible to other users.
      Publish it to GitHub (see README) or configure the secure backend to share it.</span>
      ${canRevert ? '<button class="btn btn-ghost btn-sm" id="revertLocal"><i data-lucide="undo-2"></i> Use published data</button>' : ''}`;
    b.classList.remove('hidden'); SKY.icons();
    const r = $('revertLocal');
    if (r) r.addEventListener('click', async () => { LS.del(LOCAL_KEY); await loadData(true); SKY.toast('Switched back to the published dataset.', 'ok'); });
  }
  function updateMeta() {
    const m = D.state.meta || {}, s = D.state.summary || { total: 0, excluded: 0 };
    $('stFile').textContent = m.fileName || '—'; $('stFile').title = m.fileName || '';
    $('stUpload').textContent = m.uploadedAt ? SKY.fmt.dateTime(m.uploadedAt) : 'No upload yet'; $('stUpload').title = $('stUpload').textContent;
    $('stEligible').textContent = SKY.fmt.num(D.state.eligible.length) + ' of ' + SKY.fmt.num(s.total);
    $('stRefresh').textContent = SKY.fmt.time(D.state.refreshedAt);
    $('stSource').textContent = m.source || '—';
    const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    $('metaList').innerHTML =
      row('Last Uploaded File', esc(m.fileName || '—')) +
      row('Last Updated Date', m.uploadedAt ? SKY.fmt.date(m.uploadedAt) : '—') +
      row('Last Updated Time', m.uploadedAt ? SKY.fmt.time(m.uploadedAt) : '—') +
      row('File Last Modified', m.fileModified ? SKY.fmt.dateTime(m.fileModified) : '<span class="muted">Not available</span>') +
      row('Total Records Imported', SKY.fmt.num(s.total)) +
      row('Eligible Customers', `<span style="color:var(--ok)">${SKY.fmt.num(D.state.eligible.length)}</span>`) +
      row('Excluded Customers', `${SKY.fmt.num(s.excluded)} <small class="muted">(${SKY.fmt.num(s.excludedInactive || 0)} not ACTIVE · ${SKY.fmt.num(s.excludedCredit || 0)} credit limit ≤ 1 / blank)</small>`) +
      row('Last Successful Upload Status', m.status ? `<span class="badge badge--active">${esc(m.status)}</span>` : '—') +
      row('Uploaded By', esc(m.uploadedBy || '—')) +
      row('Data Source', esc(m.source || '—'));
  }
  function updateExportInfo() {
    $('exportInfo').textContent = `Customer exports use the filters set on the Customer Details page – currently ${SKY.fmt.num(D.state.filtered.length)} of ${SKY.fmt.num(D.state.eligible.length)} eligible customers.`;
  }

  /* ---------------- upload ---------------- */
  let pending = null, uploadBound = false;
  function canUpload() {
    const s = auth.session();
    if (!auth.required()) return true;
    return !!(s && s.role === 'uploader');
  }
  function bindUpload() {
    if (uploadBound) return; uploadBound = true;
    const dz = $('dropzone'), input = $('fileInput');
    if (!canUpload()) {
      dz.classList.add('disabled');
      $('uploadGate').innerHTML = '<i data-lucide="lock"></i><span>Your account can view reports but cannot upload data. Please contact the administrator.</span>';
      $('uploadGate').classList.remove('hidden');
    } else if (!backendMode()) {
      $('uploadGate').innerHTML = '<i data-lucide="info"></i><span><b>Static mode:</b> uploads refresh the dashboard in <b>this browser only</b>. To share data with all users, configure the secure backend or publish <code>data/customers.csv</code> to GitHub (see README).</span>';
      $('uploadGate').classList.remove('hidden');
    }
    $('confirmLabel').textContent = backendMode() ? 'Publish to server & refresh dashboard' : 'Apply & refresh dashboard';
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); input.value = ''; });
    $('cancelUpload').addEventListener('click', resetUpload);
    $('confirmUpload').addEventListener('click', confirmUpload);
  }
  function resetUpload() {
    pending = null;
    $('uploadPreview').classList.add('hidden'); $('uploadMsg').innerHTML = ''; $('dzFile').textContent = '';
  }
  async function handleFile(file) {
    if (!canUpload()) return;
    resetUpload();
    $('dzFile').textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    if (file.size > 50 * 1024 * 1024) { $('uploadMsg').innerHTML = msg('err', 'File is larger than 50 MB. Please export only the customer sheet.'); SKY.icons(); return; }
    $('uploadProgress').classList.remove('hidden');
    $('uploadMsg').innerHTML = msg('warn', 'Reading and validating <b>' + esc(file.name) + '</b>…'); SKY.icons();
    try {
      const ds = await X.parseFile(file);
      $('uploadProgress').classList.add('hidden');
      if (!ds.ok) {
        $('uploadMsg').innerHTML = msg('err', '<b>Upload rejected – the current dataset was NOT changed.</b><br>' + ds.errors.map(esc).join('<br>'));
        SKY.icons(); SKY.toast('Upload failed validation.', 'err'); return;
      }
      const res = F.applyBusinessRules(ds.rows);
      if (!res.eligible.length) {
        $('uploadMsg').innerHTML = msg('err', '<b>Upload rejected – the current dataset was NOT changed.</b><br>No ACTIVE customers with a Credit Limit greater than 1 were found in this file.');
        SKY.icons(); return;
      }
      pending = { ds, res };
      $('uploadMsg').innerHTML = msg('ok', `<b>${esc(file.name)}</b> passed validation. Review the counts below, then confirm.`) +
        ds.warnings.map(w => msg('warn', esc(w))).join('');
      $('previewStats').innerHTML = [
        ['database', 'Total records imported', res.total, ''],
        ['check-circle-2', 'Eligible customers', res.eligible.length, 'mini--ok'],
        ['x-circle', 'Excluded customers', res.excluded, 'mini--err']
      ].map(([i, l, v, c]) => `<div class="mini glass ${c}"><div class="mini-icon"><i data-lucide="${i}"></i></div><div><span>${l}</span><b>${SKY.fmt.num(v)}</b></div></div>`).join('');
      $('uploadPreview').classList.remove('hidden');
      SKY.icons();
    } catch (err) {
      $('uploadProgress').classList.add('hidden');
      $('uploadMsg').innerHTML = msg('err', '<b>Could not read the file – the current dataset was NOT changed.</b><br>' + esc(err.message || err));
      SKY.icons();
    }
  }
  async function confirmUpload() {
    if (!pending) return;
    const { ds, res } = pending;
    const btn = $('confirmUpload'); btn.disabled = true;
    const sess = auth.session();
    const csv = X.toCSV(ds.rows.map(r => Object.assign({}, r, { creditLimit: r.creditLimit == null ? '' : r.creditLimit, agingLimit: r.agingLimit == null ? '' : r.agingLimit })));
    const meta = {
      fileName: ds.fileName, fileModified: ds.fileModified, uploadedAt: new Date().toISOString(),
      uploadedBy: sess ? sess.name || sess.username : 'Local user', totalRecords: res.total, eligible: res.eligible.length,
      excluded: res.excluded, status: 'Success'
    };
    try {
      if (backendMode()) {
        $('uploadProgress').classList.remove('hidden');
        const r = await api('upload', { token: sess && sess.token, csv, meta });
        D.setData(ds.rows, Object.assign({}, r.meta || meta, { source: 'Secure server' }));
        $('uploadMsg').innerHTML = msg('ok', `<b>Published successfully.</b> All authorised users will see this data on their next refresh.${r.github ? ' GitHub copy updated as well.' : ''}`);
      } else {
        const saved = LS.set(LOCAL_KEY, JSON.stringify({ csv, meta }));
        D.setData(ds.rows, Object.assign({}, meta, { source: 'Local upload (this browser only)' }));
        showLocalBanner(true);
        $('uploadMsg').innerHTML = msg('ok', '<b>Dashboard refreshed with the new file.</b> ' +
          (saved ? 'It is kept in this browser until a newer published dataset is available.' : 'Note: the file was too large to keep after closing the browser.') +
          '<br>To share it with everyone, download the publish-ready file (7 columns only) and upload it to <code>data/</code> in GitHub.' +
          '<br><button class="btn btn-ghost btn-sm" id="dlPublish" style="margin-top:8px"><i data-lucide="download"></i> Download customers.csv for GitHub</button>');
        $('dlPublish').addEventListener('click', () => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv + '\r\n'], { type: 'text/csv;charset=utf-8' }));
          a.download = 'customers.csv'; document.body.appendChild(a); a.click(); a.remove();
        });
      }
      updateMeta();
      D.renderView(currentView);
      $('uploadPreview').classList.add('hidden'); pending = null;
      SKY.icons();
      SKY.toast(`Dashboard updated – ${SKY.fmt.num(res.eligible.length)} eligible customers.`, 'ok');
    } catch (err) {
      if (err.code === 'AUTH') { auth.clear(); showLogin(); }
      $('uploadMsg').innerHTML = msg('err', '<b>Upload failed – the current dataset was NOT changed.</b><br>' + esc(err.message)); SKY.icons();
    } finally { btn.disabled = false; $('uploadProgress').classList.add('hidden'); }
  }

  /* ---------------- enter app / boot ---------------- */
  async function enterApp() {
    const s = auth.session() || { name: 'Guest', role: 'uploader' };
    $('userName').textContent = s.name || s.username;
    $('userRole').textContent = s.role === 'uploader' ? 'Administrator / Uploader' : 'Viewer';
    $('userAvatar').textContent = (s.name || s.username || 'U').trim().charAt(0).toUpperCase();
    if (!auth.required()) $('logoutBtn').classList.add('hidden');
    $('loader').classList.remove('done');
    $('loaderText').textContent = 'Loading credit limit data…';
    try { await loadData(); }
    catch (e) { if (e.code === 'AUTH') { $('loader').classList.add('done'); return; } SKY.toast('Could not load data: ' + e.message, 'err', 8000); D.setData([], { source: 'Error' }); updateMeta(); }
    bindUpload();
    $('app').classList.remove('hidden');
    showView(location.hash.slice(1) || 'overview');
    SKY.icons();
    setTimeout(() => $('loader').classList.add('done'), 250);
  }

  async function boot() {
    $('footVersion').textContent = VERSION;
    SKY.Charts.applyDefaults();
    bindThemes(); bindNav(); bindLogin(); D.bindTable(); bindTilt(); startClock();
    SKY.icons();
    if (auth.required() && !auth.session()) {
      showLogin();
      setTimeout(() => $('loader').classList.add('done'), 400);
    } else {
      await enterApp();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
