/* Test harnesses only: asks the extension to write its data-ml-* attributes so page-world test code can see scan state and flagged elements.
   Production never does this (docs/THREAT-MODEL.md §F). */
module.exports = async function enableTestHooks(sw) {
  await sw.evaluate(async () => { await new Promise((r) => setTimeout(r, 250)); const s = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: Object.assign({}, s.settings || {}, { testHooks: true }) }); });
};
