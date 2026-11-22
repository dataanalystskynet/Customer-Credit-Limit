/* ==========================================================================
   SKYNET – Customer Credit Limit Report
   config.js – the ONLY file you normally need to edit after deployment.
   ========================================================================== */
window.SKY = window.SKY || {};

SKY.config = {
  appName: 'Customer Credit Limit Report',
  company: 'SKYNET WORLDWIDE EXPRESS',
  timeZone: 'Asia/Kolkata',

  /* ------------------------------------------------------------------
     SECURE BACKEND (recommended for shared, cross-device data)
     Paste the Google Apps Script Web App URL here after deploying
     backend/Code.gs (see README → "Backend setup").
     Leave empty ('') to run in "static mode": the app reads
     data/customers.csv from this repository and browser uploads stay
     on that one browser only.
     Viewing never needs a login. In backend mode only UPLOADING asks
     for an uploader username/password (checked by the server).
     ------------------------------------------------------------------ */
  backendUrl: '',

  /* Published dataset (static mode) */
  dataUrl: 'data/customers.csv',
  metaUrl: 'data/meta.json',

  /* Business rules – do not change unless management approves */
  rules: {
    minCreditLimitExclusive: 1,   // Credit Limit must be  > 1
    requiredStatus: 'ACTIVE'      // Status must equal ACTIVE
  },

  /* Third-party libraries (CDN) */
  cdn: {
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'
  },

  defaultTheme: 'dark-premium'
};
