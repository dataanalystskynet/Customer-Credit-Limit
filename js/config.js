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
     ------------------------------------------------------------------ */
  backendUrl: '',

  /* Static-mode sign-in (used ONLY when backendUrl is empty).
     This is a convenience gate, not real security: anything published
     on GitHub Pages can be downloaded by anyone who knows the URL.
     Passwords are stored as SHA-256 hashes of  salt + password.
     Generate a new hash in the browser console on the login page:
        await SKY.auth.hash('MyNewPassword')
     Default:  admin / Skynet@2026  – CHANGE IT before going live. */
  localAuth: {
    enabled: true,
    salt: 'skynet-ccl-v1:',
    users: [
      { username: 'admin', name: 'Administrator', role: 'uploader',
        hash: 'a7ad6d2801077b2c97e643627a4fb34cf4c9456a8c2bafa893ecbb9a7c98bf38' }
    ]
  },

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

  defaultTheme: 'dark-premium',
  sessionHours: 8
};
