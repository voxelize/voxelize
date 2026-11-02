// Puppeteer 25.16.0's pinned Chrome (156.0.8078.47) predates the fixes for
// CVE-2026-118306 and friends (156.0.8078.73), so pin a patched one here. Drop
// this once a Puppeteer release pins 156.0.8078.73 or later; until then keep it
// at the current Chrome for Testing stable.
module.exports = {
  chrome: { version: "156.0.8078.80" },
};
