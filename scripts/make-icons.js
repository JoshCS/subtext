// Renders the extension icon at the sizes the manifest needs. Run: node scripts/make-icons.js
const { chromium } = require('playwright');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f618d"/><stop offset="1" stop-color="#6c3483"/></linearGradient></defs>
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#g)"/>
  <circle cx="56" cy="54" r="30" fill="none" stroke="#fff" stroke-width="10"/>
  <line x1="78" y1="76" x2="104" y2="102" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
  <path d="M56 36 L72 66 L40 66 Z" fill="#f39c12"/>
  <rect x="53.5" y="46" width="5" height="11" rx="2" fill="#15171a"/><circle cx="56" cy="61" r="2.8" fill="#15171a"/>
</svg>`;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, '..', 'extension', 'icons', `icon${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await browser.close();
  console.log('icons written');
})();
