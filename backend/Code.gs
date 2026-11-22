/* ============================================================================
   SKYNET – Customer Credit Limit Report · Secure backend (Google Apps Script)
   ----------------------------------------------------------------------------
   What it does
     • Signs users in (passwords stored only as salted SHA-256 hashes)
     • Serves the latest dataset ONLY to signed-in users
     • Accepts new uploads from "uploader" users, re-validates them on the
       server, stores them in this Google Sheet and logs every upload
     • (Optional) also commits the 7-column CSV to GitHub. The GitHub token
       lives in Script Properties – it is never sent to the browser.

   Setup (5 minutes) – full details in README.md → "Backend setup"
     1. Create a new Google Sheet → Extensions → Apps Script → paste this file.
     2. Run  setup()            (authorise when asked)
     3. Edit and run  createFirstAdmin()   – then DELETE the password from the code.
     4. Deploy → New deployment → Web app → Execute as: Me,
        Who has access: Anyone → copy the /exec URL into js/config.js (backendUrl).
   ============================================================================ */

const SHEET = { users: 'Users', data: 'Data', meta: 'Meta', log: 'UploadLog' };
const COLUMNS = ['NAME', 'CODE', 'ORIGIN HUB', 'CREDIT LIMIT', 'AGING LIMIT', 'STATUS', 'SALESMAN'];
const SESSION_SECONDS = 6 * 60 * 60;       // CacheService maximum is 6 hours
const MAX_FAILED_LOGINS = 5;               // per username, per 15 minutes
const MAX_CSV_BYTES = 10 * 1024 * 1024;    // 7-column CSV, ~100k customers

/* ---------------------------- one-time setup ---------------------------- */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ensure = (name, header) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (header && sh.getLastRow() === 0) { sh.appendRow(header); sh.setFrozenRows(1); }
    return sh;
  };
  ensure(SHEET.users, ['Username', 'Name', 'Role (uploader/viewer)', 'Password Hash', 'Active (TRUE/FALSE)', 'Created']);
  ensure(SHEET.data, COLUMNS);
  ensure(SHEET.meta, ['Key', 'Value']);
  ensure(SHEET.log, ['Uploaded At (IST)', 'Uploaded By', 'File Name', 'File Modified', 'Total Records', 'Eligible', 'Excluded', 'Status', 'GitHub']);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PASSWORD_SALT')) props.setProperty('PASSWORD_SALT', Utilities.getUuid());
  ss.getSheetByName(SHEET.data).getRange('A:G').setNumberFormat('@');
  Logger.log('Setup complete. Now edit and run createFirstAdmin().');
}

/* Edit the values, run once, then remove the password from this file. */
function createFirstAdmin() {
  addUser('admin', 'CHANGE-ME-Strong#Password1', 'Administrator', 'uploader');
}

/* Add or reset a user. role = 'uploader' (can upload) or 'viewer' (read-only). */
function addUser(username, password, name, role) {
  if (!username || !password || password.length < 8) throw new Error('Username and a password of at least 8 characters are required.');
  role = role === 'uploader' ? 'uploader' : 'viewer';
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.users);
  const values = sh.getDataRange().getValues();
  const hash = hashPassword_(password);
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase() === username.toLowerCase()) {
      sh.getRange(i + 1, 2, 1, 4).setValues([[name || username, role, hash, true]]);
      Logger.log('Updated user ' + username); return;
    }
  }
  sh.appendRow([username, name || username, role, hash, true, new Date()]);
  Logger.log('Added user ' + username + ' (' + role + ')');
}

/* ------------------------------ HTTP entry ------------------------------ */
function doGet() {
  return json_({ ok: true, app: 'SKYNET Customer Credit Limit Report API', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    switch (body.action) {
      case 'login':   return json_(login_(body));
      case 'logout':  CacheService.getScriptCache().remove('sess_' + body.token); return json_({ ok: true });
      case 'getData': return json_(getData_(requireSession_(body.token)));
      case 'upload':  return json_(upload_(requireSession_(body.token, 'uploader'), body));
      default:        return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err), code: err.code || 'ERROR' });
  }
}

/* ------------------------------- actions -------------------------------- */
function login_(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username.toLowerCase();
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_FAILED_LOGINS) throw new Error('Too many failed attempts. Try again in 15 minutes.');

  const values = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.users).getDataRange().getValues();
  const hash = hashPassword_(password);
  const row = values.slice(1).find(r => String(r[0]).toLowerCase() === username.toLowerCase());
  if (!row || String(row[4]).toUpperCase() !== 'TRUE' || row[3] !== hash) {
    cache.put(failKey, String(fails + 1), 15 * 60);
    Utilities.sleep(600);
    throw new Error('Invalid username or password.');
  }
  cache.remove(failKey);
  const token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  const session = { username: row[0], name: row[1], role: row[2] === 'uploader' ? 'uploader' : 'viewer' };
  cache.put('sess_' + token, JSON.stringify(session), SESSION_SECONDS);
  return { ok: true, token: token, name: session.name, role: session.role, expires: Date.now() + SESSION_SECONDS * 1000 };
}

function getData_(session) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET.data);
  if (sh.getLastRow() < 2) throw new Error('No data has been uploaded yet.');
  const values = sh.getRange(1, 1, sh.getLastRow(), COLUMNS.length).getDisplayValues();
  return { ok: true, csv: toCsv_(values), meta: readMeta_() };
}

function upload_(session, body) {
  const csv = String(body.csv || '');
  if (!csv) throw new Error('No file content received.');
  if (csv.length > MAX_CSV_BYTES) throw new Error('File too large.');
  const rows = Utilities.parseCsv(csv);
  const header = (rows[0] || []).map(h => String(h).trim().toUpperCase());
  if (header.join('|') !== COLUMNS.join('|')) throw new Error('Unexpected columns. Expected: ' + COLUMNS.join(', '));
  const data = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
  if (!data.length) throw new Error('The file has no customer records.');

  // Re-check the business rules on the server – never trust the browser's numbers
  let eligible = 0;
  data.forEach(r => {
    const credit = Number(String(r[3]).replace(/[₹,\s]/g, ''));
    const status = String(r[5] || '').trim().toUpperCase();
    if (r[3] !== '' && isFinite(credit) && credit > 1 && status === 'ACTIVE') eligible++;
  });
  if (!eligible) throw new Error('No ACTIVE customers with Credit Limit greater than 1 – upload rejected.');

  const m = body.meta || {};
  const meta = {
    fileName: String(m.fileName || 'customers.csv').slice(0, 200),
    fileModified: m.fileModified || '',
    uploadedAt: new Date().toISOString(),               // server time = actual upload time
    uploadedBy: session.name || session.username,
    totalRecords: data.length, eligible: eligible, excluded: data.length - eligible,
    status: 'Success'
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.data);
    const width = COLUMNS.length;
    const out = [COLUMNS].concat(data.map(r => { const a = r.slice(0, width); while (a.length < width) a.push(''); return a.map(String); }));
    sh.clearContents();
    sh.getRange(1, 1, out.length, width).setNumberFormat('@').setValues(out);
    writeMeta_(meta);
  } finally { lock.releaseLock(); }

  let github = false, githubError = '';
  try { github = publishToGitHub_(csv, meta); } catch (err) { githubError = err.message; }
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.log).appendRow([
    Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd-MMM-yyyy hh:mm:ss a'), meta.uploadedBy, meta.fileName,
    meta.fileModified, meta.totalRecords, meta.eligible, meta.excluded, meta.status, github ? 'Published' : (githubError || 'Off')]);
  return { ok: true, meta: meta, github: github, githubError: githubError };
}

/* ----------------------- optional: publish to GitHub ---------------------
   Script Properties (Project Settings → Script properties):
     PUBLISH_TO_GITHUB = true
     GITHUB_TOKEN      = fine-grained token, only this repo, Contents: Read & write
     GITHUB_REPO       = your-user/customer-credit-limit-report
     GITHUB_BRANCH     = main
   WARNING: GitHub Pages sites are public. Anything committed to data/ can be
   downloaded by anyone with the URL. Keep this OFF unless that is acceptable. */
function publishToGitHub_(csv, meta) {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('PUBLISH_TO_GITHUB') !== 'true') return false;
  const token = p.getProperty('GITHUB_TOKEN'), repo = p.getProperty('GITHUB_REPO'), branch = p.getProperty('GITHUB_BRANCH') || 'main';
  if (!token || !repo) throw new Error('GitHub properties missing');
  const put = (path, content, message) => {
    const url = 'https://api.github.com/repos/' + repo + '/contents/' + path;
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const cur = UrlFetchApp.fetch(url + '?ref=' + branch, { headers: headers, muteHttpExceptions: true });
    const sha = cur.getResponseCode() === 200 ? JSON.parse(cur.getContentText()).sha : undefined;
    const res = UrlFetchApp.fetch(url, {
      method: 'put', headers: headers, contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ message: message, branch: branch, sha: sha,
        content: Utilities.base64Encode(content, Utilities.Charset.UTF_8) })
    });
    if (res.getResponseCode() >= 300) throw new Error('GitHub ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200));
  };
  const msg = 'Data upload: ' + meta.fileName + ' by ' + meta.uploadedBy;
  put('data/customers.csv', csv, msg);
  put('data/meta.json', JSON.stringify(meta, null, 2), msg + ' (meta)');
  return true;
}

/* -------------------------------- helpers ------------------------------- */
function requireSession_(token, role) {
  const raw = token && CacheService.getScriptCache().get('sess_' + token);
  if (!raw) { const e = new Error('Session expired. Please sign in again.'); e.code = 'AUTH'; throw e; }
  const s = JSON.parse(raw);
  if (role && s.role !== role) { const e = new Error('Your account is not allowed to upload data.'); e.code = 'FORBIDDEN'; throw e; }
  return s;
}
function hashPassword_(pw) {
  const salt = PropertiesService.getScriptProperties().getProperty('PASSWORD_SALT') || '';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pw, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function readMeta_() {
  const v = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.meta).getDataRange().getValues();
  const o = {};
  v.slice(1).forEach(r => { if (r[0]) o[r[0]] = r[1] instanceof Date ? r[1].toISOString() : r[1]; });
  return o;
}
function writeMeta_(meta) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.meta);
  sh.clearContents();
  const rows = [['Key', 'Value']].concat(Object.keys(meta).map(k => [k, String(meta[k])]));
  sh.getRange(1, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
}
function toCsv_(values) {
  return values.map(r => r.map(v => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
