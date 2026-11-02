// Puppeteer 24.43.1 is the last release that runs on our Node 20.9 (.nvmrc); 25
// is ESM-only and needs Node 22.12. Its pinned Chrome predates the fixes for
// CVE-2026-118306 and friends (156.0.8078.73), so pin a patched one here. Keep
// this at the current Chrome for Testing stable until Puppeteer can move on.
module.exports = {
  chrome: { version: "156.0.8078.80" },
};
