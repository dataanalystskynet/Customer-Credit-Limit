#!/usr/bin/env python3
"""Validate data/customers.csv and keep data/meta.json in sync.

Run by .github/workflows/validate-data.yml on every push that changes data/.
Fails the workflow (so you get an email) when the dataset is unusable or when
it contains columns other than the 7 report columns – the full customer
export holds passwords, bank and ID numbers and must never be published.

Usage:  python3 scripts/validate_data.py [--write-meta]
"""
import csv, json, os, subprocess, sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data', 'customers.csv')
META = os.path.join(ROOT, 'data', 'meta.json')
REQUIRED = ['NAME', 'CODE', 'ORIGIN HUB', 'CREDIT LIMIT', 'AGING LIMIT', 'STATUS', 'SALESMAN']


def fail(msg):
    print(f'::error::{msg}')
    sys.exit(1)


def amount(v):
    s = str(v or '').replace(',', '').replace('₹', '').strip()
    try:
        return float(s) if s else None
    except ValueError:
        return None


def main():
    if not os.path.exists(DATA):
        fail('data/customers.csv is missing')
    with open(DATA, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.reader(f))
    if len(rows) < 2:
        fail('data/customers.csv has no customer rows')
    header = [' '.join(h.split()).upper() for h in rows[0]]
    missing = [c for c in REQUIRED if c not in header]
    if missing:
        fail('Missing required columns: ' + ', '.join(missing))
    extra = [h for h in header if h not in REQUIRED]
    if extra:
        fail('Extra columns found (' + ', '.join(extra[:8]) + '…). Publish ONLY the 7 report columns – '
             'the full export contains confidential data. Remove the file from git history if it was pushed.')

    idx = {c: header.index(c) for c in REQUIRED}
    total = eligible = invalid = 0
    for r in rows[1:]:
        if not any(x.strip() for x in r):
            continue
        total += 1
        raw = r[idx['CREDIT LIMIT']] if len(r) > idx['CREDIT LIMIT'] else ''
        cl = amount(raw)
        if cl is None and raw.strip():
            invalid += 1
        status = (r[idx['STATUS']] if len(r) > idx['STATUS'] else '').strip().upper()
        if cl is not None and cl > 1 and status == 'ACTIVE':
            eligible += 1
    if eligible == 0:
        fail('No ACTIVE customers with Credit Limit > 1 – refusing to publish an empty dashboard')

    print(f'Records: {total} | Eligible (ACTIVE & Credit Limit > 1): {eligible} | '
          f'Excluded: {total - eligible} | Non-numeric credit limits: {invalid}')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a') as s:
            s.write(f'### Customer dataset validated ✅\n\n| Total | Eligible | Excluded | Invalid credit |\n|---|---|---|---|\n'
                    f'| {total} | {eligible} | {total - eligible} | {invalid} |\n')

    if '--write-meta' in sys.argv:
        meta = {}
        if os.path.exists(META):
            try:
                meta = json.load(open(META, encoding='utf-8'))
            except Exception:
                meta = {}
        if meta.get('totalRecords') == total and meta.get('eligible') == eligible:
            print('meta.json already matches the dataset – unchanged')
            return
        try:  # time of the commit that changed the CSV = actual upload time
            ts = subprocess.check_output(['git', 'log', '-1', '--format=%cI', '--', 'data/customers.csv'], cwd=ROOT, text=True).strip()
        except Exception:
            ts = ''
        meta.update({
            'fileName': meta.get('fileName') if meta.get('totalRecords') == total else 'customers.csv',
            'fileModified': None,
            'uploadedAt': ts or datetime.now(timezone.utc).isoformat(),
            'uploadedBy': os.environ.get('GITHUB_ACTOR', 'GitHub upload'),
            'totalRecords': total, 'eligible': eligible, 'excluded': total - eligible, 'status': 'Success'
        })
        with open(META, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2)
        print('meta.json updated')


if __name__ == '__main__':
    main()
