# SKYNET – Customer Credit Limit Report

A 3D, glass-style analytics dashboard for **SKYNET WORLDWIDE EXPRESS** that reads the standard customer export (Excel or CSV), applies the credit-limit rules and shows KPIs, hub / salesman / credit / aging analysis, a searchable customer table, exports and print.

Built with plain **HTML5, CSS3 and JavaScript**, plus Chart.js, Three.js, SheetJS and Lucide icons loaded from CDNs. No build step: it runs directly on **GitHub Pages**.

---

## 1. Business rules (applied to every dataset)

Only customers that meet **both** conditions are shown anywhere in the dashboard:

| # | Column | Rule |
|---|---|---|
| 1 | **AG – CREDIT LIMIT** | Must be a valid number **greater than 1**. Zero, 1, blank and non-numeric values are excluded. |
| 2 | **AJ – STATUS** | Must be **ACTIVE**. INACTIVE and other values are excluded. |

The rules live in `js/filters.js → isEligible()`. Before anything is drawn, `js/dashboard.js` checks every displayed row again and refuses to render if a row breaks the rules.

The app reads only these 7 columns (matched by header name, with the usual Excel letters shown in messages):

| Excel | Header | Shown as |
|---|---|---|
| E | NAME | Name |
| F | CODE | Code |
| G | ORIGIN HUB | Origin Hub |
| AG | CREDIT LIMIT | Credit Limit |
| AH | AGING LIMIT | Aging Limit (blank = *Not Available*) |
| AJ | STATUS | Status |
| AW | SALESMAN | Salesman (blank = *Not Assigned*) |

**Result for the bundled file (`customers_22-Nov-2026-11-00-PM.csv`):** 1,971 records → **98 eligible**, 1,873 excluded (63 not ACTIVE, 1,810 with Credit Limit ≤ 1). Total credit limit ₹7,51,25,010.

---

## 2. Project structure

```text
customer-credit-limit-report/
├── index.html                  App shell: loader, login, sidebar, all views
├── css/style.css               5 themes × dark/light, glass UI, 3D cards, print layout
├── js/
│   ├── config.js               ← the only file you normally edit
│   ├── excel.js                Excel/CSV parsing, column mapping, validation
│   ├── parse-worker.js         Web Worker for large files
│   ├── filters.js              Business rules, analytics, table filters/sort
│   ├── charts.js               Theme-aware Chart.js helpers (lazy rendering)
│   ├── dashboard.js            KPIs, analysis views, table, Excel/CSV export, print
│   ├── bg3d.js                 Subtle Three.js background (30 fps, auto-pauses)
│   └── app.js                  Boot, sign-in, navigation, themes, clock, upload
├── assets/skynet-logo.png      Official logo (transparent PNG)
├── data/
│   ├── customers.csv           Published dataset (7 columns only)
│   └── meta.json               File name, upload time, counts
├── backend/Code.gs             Secure backend (Google Apps Script)
├── scripts/validate_data.py    Dataset validator used by GitHub Actions
├── .github/workflows/validate-data.yml
├── .nojekyll
└── README.md
```

---

## 3. Run it on your computer

Browsers block `fetch()` from `file://`, so start a small local server inside the project folder:

```bash
# Python (already on most PCs)
python -m http.server 8080
# then open http://localhost:8080
```

Default static-mode sign-in: **admin / Skynet@2026**. Change it before going live (section 7).

---

## 4. Deploy to GitHub Pages

1. Create a repository on GitHub, e.g. `customer-credit-limit-report`.
2. Upload **all** files and folders from this project (keep the folder structure, including `.github/` and `.nojekyll`).
   *GitHub website:* **Add file → Upload files**, drag the folder contents in, then **Commit changes**.
   *Git:*
   ```bash
   git init && git add . && git commit -m "SKYNET credit limit report"
   git branch -M main
   git remote add origin https://github.com/<your-user>/customer-credit-limit-report.git
   git push -u origin main
   ```
3. Open **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
4. After 1–2 minutes the site is live at `https://<your-user>.github.io/customer-credit-limit-report/`.
5. Open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions**. The validation workflow needs this to update `meta.json`.

---

## 5. ⚠️ Read before publishing customer data

**GitHub Pages sites are public.** Even if the repository is private, anyone who has the URL can download `data/customers.csv` directly. The static-mode login screen only stops casual visitors and is **not** real security.

Choose one of these setups:

| Setup | Who can see the data | Shared across devices | Recommended for |
|---|---|---|---|
| **A. Secure backend** (section 6) | Only users who sign in | ✅ Yes, instantly | **Live company use** |
| **B. Static + GitHub upload** (section 8) | Anyone with the URL | ✅ After a commit (~1–2 min) | Non-sensitive or demo data |
| Browser-only upload (no setup) | Only that browser | ❌ No | Quick checks |

Never commit the full 81-column export. It contains portal passwords, bank account numbers, Aadhaar/PAN files and e-mail addresses. The app and backend only send or store the 7 report columns, and the GitHub Action **fails** if extra columns are pushed.

---

## 6. Backend setup (Option A – secure, recommended)

The backend is a free **Google Apps Script web app** connected to a private Google Sheet. It signs users in, serves the data only to signed-in users, re-checks every upload on the server and keeps an upload log. No passwords or tokens are stored in the website code.

1. Create a new **Google Sheet** (e.g. *SKYNET Credit Limit – Backend*) with the company Google account. Do not share it.
2. **Extensions → Apps Script.** Delete the sample code and paste the full contents of `backend/Code.gs`. Save.
3. In the function dropdown choose **`setup`** → **Run** → approve the permissions. This creates the sheets *Users, Data, Meta, UploadLog*.
4. Edit `createFirstAdmin()` with your username, a strong password and your name → **Run** it → then **delete the password from the code** and save.
   Add more users the same way from the editor, for example:
   ```js
   function addTeam() {
     addUser('rahul', 'Str0ng#Pass1', 'Rahul (Accounts)', 'viewer');   // view only
     addUser('anil',  'Str0ng#Pass2', 'Anil Mandal',     'uploader'); // can upload
   }
   ```
   To disable a user, set **Active** to `FALSE` in the *Users* sheet.
5. **Deploy → New deployment → ⚙ Web app**
   * Execute as: **Me**
   * Who has access: **Anyone** (required so the website can call it; every data request still needs a valid sign-in token)
   * **Deploy** → copy the URL that ends in `/exec`.
6. In GitHub, edit `js/config.js` and paste the URL:
   ```js
   backendUrl: 'https://script.google.com/macros/s/AKfy.../exec',
   ```
7. **Remove the public copy of the data.** Replace `data/customers.csv` with the header line only, then commit:
   ```text
   NAME,CODE,ORIGIN HUB,CREDIT LIMIT,AGING LIMIT,STATUS,SALESMAN
   ```
8. Open the site, sign in as the uploader and use **Upload Data** to load the first file. Every user sees it at their next sign-in or **Refresh**.

**After changing `Code.gs`:** use **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** so the `/exec` URL stays the same.

**Optional: also keep a copy in GitHub.** In Apps Script, open **Project Settings → Script properties** and add `PUBLISH_TO_GITHUB=true`, `GITHUB_TOKEN` (a fine-grained token limited to this one repository with *Contents: Read and write*), `GITHUB_REPO=<user>/<repo>` and `GITHUB_BRANCH=main`. Only do this if a public copy is acceptable (see section 5).

Sessions last up to 6 hours. After 5 wrong passwords, that username is locked for 15 minutes.

---

## 7. Static-mode sign-in (Option B or local use)

Used only when `backendUrl` is empty. To change the password:

1. Open the site, press **F12 → Console** on the login page and run:
   ```js
   await SKY.auth.hash('YourNewPassword')
   ```
2. Copy the long result into `js/config.js → localAuth.users[0].hash` and commit.

Add more users to the `users` list in the same way. `role: 'viewer'` hides uploading. To remove the login screen completely, set `localAuth.enabled: false`.

---

## 8. Updating data without a backend (Option B – GitHub upload)

1. Open the dashboard → **Upload Data** → drop the latest export (.xlsx/.xls/.csv).
2. Check the counts (total / eligible / excluded) → **Apply & refresh dashboard**. This updates *your* browser straight away.
3. Click **Download customers.csv for GitHub**. The downloaded file contains only the 7 columns.
4. In GitHub open the `data` folder → **Add file → Upload files** → drop `customers.csv` → **Commit changes**.
5. The **Validate customer dataset** action checks the file and updates `meta.json` with the commit time. If it fails, you get an email and the reason appears under the **Actions** tab. Pages republishes within about 1–2 minutes, and every user then sees the new data.

---

## 9. Features

* **8 animated KPI cards:** eligible customers, total, average, highest and lowest credit limit, origin hubs, salesmen, and customers with a missing aging limit. Numbers count up and cards tilt in 3D.
* **Origin Hub analysis:** customers, total, average and highest per hub, plus the top hub. Includes a bar + line chart and a doughnut chart.
* **Salesman analysis:** count, total and average per salesman. Shows the top 10, customer counts and a comparison of total vs average. Customers with no salesman appear as *Not Assigned*.
* **Credit Limit analysis:** 5 ranges (₹1–₹50,000 … above ₹10,00,000) with customer count and exposure for each.
* **Aging Limit analysis:** count and exposure for blank (*Not Available*), 7, 10, 15, 20, 25 and 30 days and any other values. One click lists the customers with a blank aging limit.
* **Customer table:**
  * debounced global search, sorting on every column, pagination (25 / 50 / 100)
  * filters for hub, salesman, aging, credit range and min/max amount, plus **Reset all filters**
  * exports the filtered rows to Excel or CSV, and prints them
* **Export Reports:** a full analytics workbook (Summary, Origin Hubs, Salesmen, Credit Ranges, Aging Limits and Eligible Customers sheets) and a print / Save-as-PDF report.
* **Upload:**
  * drag and drop, column and number validation, preview counts before applying
  * the current dataset is replaced only after the file passes validation
  * Web Worker for files over 200 KB
* **Upload details:** last file name, upload date and time (IST), the file's own last-modified time, records imported, eligible and excluded counts, status and who uploaded it.
* **5 themes** (Dark Premium, Light Professional, Midnight Purple, Ocean Blue, Emerald Green) plus a separate **dark/light toggle**. Both are saved in `localStorage` and apply instantly.
* **Live IST clock** and a status strip showing file, last upload, eligible records, last refresh time and data source.
* **Performance:**
  * charts are built only when their page is opened
  * the 3D background is capped at 30 fps, pauses in hidden tabs and switches off for reduced-motion users and on small phones
  * SheetJS loads only when it is needed
* **Responsive** across desktop, tablet and mobile (slide-out sidebar).

---

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| Blank page when opening `index.html` directly | Use a local server (section 3) or the GitHub Pages URL. |
| "Required column(s) not found" | Upload the standard customer export with its header row. Header names must include the 7 columns in section 1. |
| Excel upload says the reader could not be loaded | The device has no internet access to the SheetJS CDN. Save the file as CSV and upload that. |
| Charts or icons missing | A firewall is blocking `cdn.jsdelivr.net` or `unpkg.com`. Allow these domains. |
| "Cannot reach the server" | Check `backendUrl` in `js/config.js`, and that the deployment is set to *Anyone* and ends with `/exec`. |
| Dashboard still shows old data after a GitHub upload | Wait 1–2 minutes for Pages, then press the **Refresh** button (top right). |
| Action fails with "Extra columns found" | You pushed the full export. Delete it, rewrite the file history (or recreate the repository), and upload the 7-column file from step 8.3. |

---

**Libraries:** Chart.js 4.4.1 · Three.js r149 · SheetJS 0.20.3 · Lucide 0.460 · Inter / JetBrains Mono fonts.
© SKYNET Worldwide Express – internal use.
