/* ==========================================================================
   excel.js – file parsing, column mapping and validation.
   Worker-safe: no DOM access at load time (also used by parse-worker.js).
   ========================================================================== */
(function (root) {
  'use strict';
  const SKY = root.SKY = root.SKY || {};

  /* The 7 columns the report uses. `letter` is the Excel column in the
     standard SKYNET customer export; it is used only as a fallback when a
     header cannot be matched by name. */
  const COLUMNS = [
    { key: 'name',        header: 'NAME',         label: 'Name',         letter: 'E'  },
    { key: 'code',        header: 'CODE',         label: 'Code',         letter: 'F'  },
    { key: 'hub',         header: 'ORIGIN HUB',   label: 'Origin Hub',   letter: 'G'  },
    { key: 'creditLimit', header: 'CREDIT LIMIT', label: 'Credit Limit', letter: 'AG' },
    { key: 'agingLimit',  header: 'AGING LIMIT',  label: 'Aging Limit',  letter: 'AH' },
    { key: 'status',      header: 'STATUS',       label: 'Status',       letter: 'AJ' },
    { key: 'salesman',    header: 'SALESMAN',     label: 'Salesman',     letter: 'AW' }
  ];

  const norm = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const normHeader = s => norm(s).toUpperCase();

  function letterToIndex(letter) {
    let n = 0;
    for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  /* Parse an amount such as 100000, "1,00,000", "₹ 50,000.00", "Rs. 500".
     Returns a finite number, or null for blank / invalid values. */
  function parseAmount(v) {
    if (v == null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).replace(/[₹,\s]/g, '').replace(/^(INR|RS\.?)/i, '');
    if (s === '' || !/^-?\d*\.?\d+$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /* RFC-4180 CSV parser (quoted fields, embedded commas/new lines, "" escapes). */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const rows = [];
    let row = [], field = '', i = 0, inQ = false;
    const len = text.length;
    while (i < len) {
      const c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* Find the header row (first 20 rows) and map our 7 columns to indexes. */
  function mapColumns(matrix) {
    const scan = Math.min(matrix.length, 20);
    let best = { headerRow: -1, found: 0, map: {} };
    for (let r = 0; r < scan; r++) {
      const hdr = (matrix[r] || []).map(normHeader);
      const map = {};
      let found = 0;
      COLUMNS.forEach(col => {
        const idx = hdr.indexOf(col.header);
        if (idx > -1) { map[col.key] = idx; found++; }
      });
      if (found > best.found) best = { headerRow: r, found, map };
      if (found === COLUMNS.length) break;
    }
    const missing = COLUMNS.filter(c => best.map[c.key] == null);
    return { headerRow: best.headerRow, map: best.map, missing };
  }

  /* Convert a 2-D array (rows × cells) into normalised customer records. */
  function buildDataset(matrix) {
    const errors = [], warnings = [];
    if (!matrix || matrix.length < 2) {
      return { ok: false, errors: ['The file is empty or has no data rows.'], warnings };
    }
    const { headerRow, map, missing } = mapColumns(matrix);
    if (headerRow < 0 || missing.length) {
      errors.push('Required column(s) not found: ' +
        (missing.length ? missing.map(c => `"${c.header}" (Excel column ${c.letter})`).join(', ') : 'all') +
        '. Please upload the standard SKYNET customer export with its header row.');
      return { ok: false, errors, warnings };
    }
    // Sanity check: in the standard 81-column export the headers sit at fixed letters.
    const offLetter = COLUMNS.filter(c => matrix[headerRow].length >= 49 && map[c.key] !== letterToIndex(c.letter));
    if (offLetter.length) {
      warnings.push('Columns were matched by header name; some are not at their usual Excel letters (' +
        offLetter.map(c => c.header).join(', ') + ').');
    }

    const rows = [];
    let invalidCredit = 0, blankCredit = 0;
    for (let r = headerRow + 1; r < matrix.length; r++) {
      const cells = matrix[r];
      if (!cells || cells.every(v => norm(v) === '')) continue; // skip empty lines
      const rawCredit = cells[map.creditLimit];
      const credit = parseAmount(rawCredit);
      if (credit == null) { if (norm(rawCredit) === '') blankCredit++; else invalidCredit++; }
      const aging = parseAmount(cells[map.agingLimit]);
      rows.push({
        name: norm(cells[map.name]),
        code: norm(cells[map.code]),
        hub: norm(cells[map.hub]),
        creditLimit: credit,                 // null = blank / invalid
        agingLimit: aging,                   // null = Not Available
        status: norm(cells[map.status]).toUpperCase(),
        salesman: norm(cells[map.salesman])
      });
    }
    if (!rows.length) {
      errors.push('No customer records were found below the header row.');
      return { ok: false, errors, warnings };
    }
    const numeric = rows.length - invalidCredit - blankCredit;
    if (numeric === 0) {
      errors.push('Column "CREDIT LIMIT" does not contain any numeric values. Please check the file.');
    }
    if (invalidCredit) warnings.push(`${invalidCredit} record(s) have a non-numeric Credit Limit and were excluded.`);
    if (blankCredit) warnings.push(`${blankCredit} record(s) have a blank Credit Limit and were excluded.`);
    return { ok: errors.length === 0, errors, warnings, rows,
      stats: { totalRecords: rows.length, invalidCredit, blankCredit } };
  }

  /* Rows → 7-column CSV text (used for publishing to the backend). */
  function toCSV(rows, cols) {
    cols = cols || COLUMNS;
    const esc = v => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const out = [cols.map(c => esc(c.header)).join(',')];
    rows.forEach(r => out.push(cols.map(c => esc(r[c.key])).join(',')));
    return out.join('\r\n');
  }

  SKY.Excel = { COLUMNS, parseCSV, parseAmount, mapColumns, buildDataset, toCSV, letterToIndex, norm };
})(typeof self !== 'undefined' ? self : this);

/* ---------- Browser-only helpers (file reading, worker orchestration) ---------- */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  const X = SKY.Excel;

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src; s.async = true; s.dataset.src = src;
      s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  X.ensureSheetJS = async function () {
    if (window.XLSX) return window.XLSX;
    await loadScript(SKY.config.cdn.xlsx);
    return window.XLSX;
  };

  const ext = name => (name.split('.').pop() || '').toLowerCase();

  function matrixFromWorkbookBuffer(buf) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    // Use the first sheet that contains our headers, else the first sheet.
    for (const n of wb.SheetNames) {
      const m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
      if (X.mapColumns(m).missing.length === 0) return m;
    }
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  }

  /* Try a Web Worker (keeps the UI smooth for big files); fall back to main thread. */
  function parseInWorker(buf, kind) {
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker('js/parse-worker.js'); } catch (e) { return reject(e); }
      const t = setTimeout(() => { w.terminate(); reject(new Error('Worker timeout')); }, 60000);
      w.onmessage = e => { clearTimeout(t); w.terminate(); e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result); };
      w.onerror = e => { clearTimeout(t); w.terminate(); reject(e); };
      w.postMessage({ buf, kind, xlsxUrl: SKY.config.cdn.xlsx }, [buf]);
    });
  }

  /* Public: File → { ok, errors, warnings, rows, stats, fileName, fileModified } */
  X.parseFile = async function (file) {
    const e = ext(file.name);
    if (!['csv', 'xlsx', 'xls'].includes(e)) {
      return { ok: false, errors: ['Unsupported file type ".' + e + '". Please upload .xlsx, .xls or .csv.'], warnings: [] };
    }
    const meta = {
      fileName: file.name,
      fileModified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      fileSize: file.size
    };
    const buf = await file.arrayBuffer();
    const kind = e === 'csv' ? 'csv' : 'workbook';
    let result;
    const canWorker = typeof Worker !== 'undefined' && location.protocol !== 'file:';
    if (canWorker && file.size > 200 * 1024) {
      try { result = await parseInWorker(buf.slice(0), kind); } catch (err) { console.warn('Worker parse failed, using main thread', err); }
    }
    if (!result) {
      let matrix;
      if (kind === 'csv') {
        matrix = X.parseCSV(new TextDecoder('utf-8').decode(buf));
      } else {
        try { await X.ensureSheetJS(); }
        catch (err) { return { ok: false, errors: ['Excel reader could not be loaded (no internet?). Save the file as CSV and upload again.'], warnings: [] }; }
        matrix = matrixFromWorkbookBuffer(buf);
      }
      result = X.buildDataset(matrix);
    }
    return Object.assign(result, meta);
  };
})();
