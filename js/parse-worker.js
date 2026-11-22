/* parse-worker.js – parses large Excel/CSV files off the main thread. */
/* global importScripts, XLSX, SKY */
self.SKY = self.SKY || {};
importScripts('excel.js');

self.onmessage = function (e) {
  const { buf, kind, xlsxUrl } = e.data;
  try {
    let matrix;
    if (kind === 'csv') {
      matrix = SKY.Excel.parseCSV(new TextDecoder('utf-8').decode(buf));
    } else {
      if (!self.XLSX) importScripts(xlsxUrl);
      const wb = XLSX.read(buf, { type: 'array', cellDates: false });
      let chosen = null;
      for (const n of wb.SheetNames) {
        const m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
        if (SKY.Excel.mapColumns(m).missing.length === 0) { chosen = m; break; }
      }
      matrix = chosen || XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
    }
    self.postMessage({ result: SKY.Excel.buildDataset(matrix) });
  } catch (err) {
    self.postMessage({ error: err && err.message ? err.message : String(err) });
  }
};
