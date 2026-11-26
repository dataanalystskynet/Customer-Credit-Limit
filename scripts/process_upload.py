#!/usr/bin/env python3
"""Auto-convert an uploaded customer export into the dashboard dataset.

Run by .github/workflows/auto-update-data.yml whenever an Excel / CSV file is
uploaded to the repository (GitHub website → Add file → Upload files).

What it does
  1. Finds every uploaded export (.xlsx / .xlsm / .xls / .csv) outside data/.
  2. Takes the newest one (latest commit time, then file name).
  3. Keeps ONLY the 7 report columns and writes data/customers.csv.
  4. Updates data/meta.json (file name, upload time, uploader, counts).
  5. Deletes ALL raw uploads from the repository – the full export holds
     portal passwords, Aadhaar / PAN files and e-mail IDs and must not stay
     on a public site.

If the file is unusable (missing columns, no eligible customers) the script
fails, the current dashboard data is left unchanged and GitHub e-mails you.

Usage:  python3 scripts/process_upload.py [--keep-raw]
"""
import csv, io, json, os, re, subprocess, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, 'data')
DATA = os.path.join(DATA_DIR, 'customers.csv')
META = os.path.join(DATA_DIR, 'meta.json')
REQUIRED = ['NAME', 'CODE', 'ORIGIN HUB', 'CREDIT LIMIT', 'AGING LIMIT', 'STATUS', 'SALESMAN']
EXTS = ('.xlsx', '.xlsm', '.xls', '.csv')
SKIP_DIRS = {'.git', '.github', 'data', 'node_modules', 'assets', 'css', 'js', 'backend', 'scripts'}
MONTHS = {m: i for i, m in enumerate(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], 1)}


def fail(msg):
    print(f'::error::{msg}')
    sys.exit(1)


def git(*args):
    try:
        return subprocess.check_output(['git', *args], cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return ''


def norm(h):
    return ' '.join(str(h if h is not None else '').split()).upper()


def cell(v):
    """Excel cell → clean text (integers without .0)."""
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, datetime):
        return v.strftime('%d-%m-%Y')
    return ' '.join(str(v).split())


def amount(v):
    s = str(v or '').replace(',', '').replace('₹', '').strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


# ---------------------------------------------------------------- find files
def find_uploads():
    found = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        rel_dir = os.path.relpath(dirpath, ROOT)
        top = rel_dir.split(os.sep)[0]
        if top in SKIP_DIRS:
            dirnames[:] = []
            continue
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.lower().endswith(EXTS) and not fn.startswith('~$'):
                found.append(os.path.relpath(os.path.join(dirpath, fn), ROOT))
    return found


def commit_time(rel):
    return git('log', '-1', '--format=%cI', '--', rel)


# ---------------------------------------------------------------- read files
def read_rows(path):
    low = path.lower()
    if low.endswith('.csv'):
        raw = open(path, 'rb').read()
        for enc in ('utf-8-sig', 'cp1252', 'latin-1'):
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        return [[cell(c) for c in r] for r in csv.reader(io.StringIO(text, newline=''))]
    if low.endswith('.xls'):
        import xlrd
        book = xlrd.open_workbook(path)
        sheets = [[[cell(c) for c in sh.row_values(i)] for i in range(sh.nrows)] for sh in book.sheets()]
    else:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        sheets = [[[cell(c) for c in r] for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets]
    # use the first sheet that contains the report header
    for rows in sheets:
        if header_index(rows) is not None:
            return rows
    return sheets[0] if sheets else []


def header_index(rows):
    for i, r in enumerate(rows[:15]):
        h = [norm(c) for c in r]
        if 'NAME' in h and 'CREDIT LIMIT' in h and 'STATUS' in h:
            return i
    return None


def file_date_from_name(name):
    """customers_26-Nov-2026-12-11-PM.xlsx → 2026-11-26T12:11:00+05:30"""
    m = re.search(r'(\d{1,2})-([A-Za-z]{3})-(\d{4})-(\d{1,2})-(\d{2})-(AM|PM)', name)
    if not m:
        return None
    d, mon, y, hh, mm, ap = m.groups()
    mon = MONTHS.get(mon.upper())
    if not mon:
        return None
    hh = int(hh) % 12 + (12 if ap.upper() == 'PM' else 0)
    try:
        return datetime(int(y), mon, int(d), hh, int(mm)).strftime('%Y-%m-%dT%H:%M:00+05:30')
    except ValueError:
        return None


# ---------------------------------------------------------------- main
def main():
    uploads = find_uploads()
    if not uploads:
        print('No uploaded Excel/CSV file found – nothing to convert.')
        return
    uploads.sort(key=lambda p: (commit_time(p), os.path.basename(p)), reverse=True)
    src = uploads[0]
    print('Uploaded files:', ', '.join(uploads))
    print('Using newest:', src)

    rows = read_rows(os.path.join(ROOT, src))
    hi = header_index(rows)
    if hi is None:
        fail(f'{src}: header row not found. The file must contain the columns: ' + ', '.join(REQUIRED))
    header = [norm(c) for c in rows[hi]]
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        fail(f'{src}: required column(s) not found: ' + ', '.join(missing))
    idx = {c: header.index(c) for c in REQUIRED}  # first match ('ORIGIN HUB', not 'HUB')

    out, total, eligible, inactive, low_credit, exposure = [], 0, 0, 0, 0, 0.0
    for r in rows[hi + 1:]:
        if not any(str(x).strip() for x in r):
            continue
        rec = [(r[idx[c]] if idx[c] < len(r) else '') for c in REQUIRED]
        total += 1
        cl = amount(rec[3])
        active = rec[5].strip().upper() == 'ACTIVE'
        if not active:
            inactive += 1
        elif cl is None or cl <= 1:
            low_credit += 1
        else:
            eligible += 1
            exposure += cl
        out.append(rec)

    if total == 0:
        fail(f'{src}: no customer rows found')
    if eligible == 0:
        fail(f'{src}: no ACTIVE customers with Credit Limit > 1 – refusing to publish an empty dashboard')

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(DATA, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, lineterminator='\n')
        w.writerow(REQUIRED)
        w.writerows(out)

    meta = {
        'fileName': os.path.basename(src),
        'fileModified': file_date_from_name(os.path.basename(src)),
        'uploadedAt': commit_time(src) or datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'uploadedBy': git('log', '-1', '--format=%an', '--', src) or os.environ.get('GITHUB_ACTOR', 'GitHub upload'),
        'totalRecords': total,
        'eligible': eligible,
        'excluded': total - eligible,
        'status': 'Success',
        'autoUpdated': True,
    }
    with open(META, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')

    msg = (f'{src} → data/customers.csv | Records: {total} | Eligible: {eligible} | '
           f'Excluded: {total - eligible} ({inactive} not ACTIVE, {low_credit} credit ≤ 1/blank) | '
           f'Total credit: ₹{exposure:,.0f}')
    print(msg)

    if '--keep-raw' not in sys.argv:
        for p in uploads:
            os.remove(os.path.join(ROOT, p))
            print('Removed raw upload:', p)

    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as s:
            s.write('### Dashboard data auto-updated ✅\n\n'
                    f'**File:** `{src}`  \n**Uploaded by:** {meta["uploadedBy"]}\n\n'
                    '| Total | Eligible | Not ACTIVE | Credit ≤ 1 / blank | Total credit |\n|---|---|---|---|---|\n'
                    f'| {total} | {eligible} | {inactive} | {low_credit} | ₹{exposure:,.0f} |\n\n'
                    'The raw export was deleted from the repository (it is still in git history).\n')
    out_env = os.environ.get('GITHUB_OUTPUT')
    if out_env:
        with open(out_env, 'a', encoding='utf-8') as o:
            o.write(f'file={os.path.basename(src)}\neligible={eligible}\ntotal={total}\n')


if __name__ == '__main__':
    main()
