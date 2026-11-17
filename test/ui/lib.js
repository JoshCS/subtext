/* Shared harness for the Subtext UI pass: loads the extension headless, serves the fixtures on their fake domains,
   and reads the closed shadow root through CDP (DOM.getDocument pierce:true), which Playwright locators cannot do. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'extension');
const FIX = path.join(ROOT, 'test', 'fixtures');
const FIXTURES = {
  'https://dealzone-shop.test/product/ultra-widget': 'shop.html',
  'https://citizens-for-truth-institute.org/report/2026/the-truth-about-the-economy': 'article.html',
  'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas': 'clean.html'
};
const SHOP = 'https://dealzone-shop.test/product/ultra-widget';
const ARTICLE = 'https://citizens-for-truth-institute.org/report/2026/the-truth-about-the-economy';

async function launch(outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const userDataDir = path.join(outDir, 'profile-' + Date.now());
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true, channel: 'chromium', viewport: opts.viewport || { width: 1200, height: 800 }, deviceScaleFactor: 1,
    colorScheme: opts.colorScheme || 'light',
    hasTouch: !!opts.hasTouch,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await require('../hooks')(sw);
  await context.route('**/*', (route) => {
    const req = route.request(); const u = req.url();
    if (u.startsWith('chrome-extension://') || u.startsWith('data:')) return route.continue();
    const fix = Object.keys(FIXTURES).find((k) => u.startsWith(k));
    if (fix && req.resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, FIXTURES[fix]), 'utf8') });
    if (/^https:\/\/dealzone-shop\.test\/(privacy|terms)/.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, 'privacy.html'), 'utf8') });
    if (/^https:\/\/www\.theguardian\.com\/info\/privacy/.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, 'privacy-clean.html'), 'utf8') });
    return route.abort();
  });
  const close = async () => { await context.close(); fs.rmSync(userDataDir, { recursive: true, force: true }); };
  return { context, sw, close };
}

async function open(context, url) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable');
  return { page, cdp };
}

async function tabId(sw, url) { const tabs = await sw.evaluate(() => chrome.tabs.query({})); const t = tabs.find((t) => t.url === url); return t && t.id; }
async function togglePanel(sw, url, on) { const id = await tabId(sw, url); return sw.evaluate(([id, on]) => chrome.tabs.sendMessage(id, { type: 'togglePanel', on }), [id, on]); }
async function state(sw, url) { const r = await sw.evaluate((url) => handle({ type: 'testStateByUrl', url }, {}), url); return r && r.state; }

// ---- closed shadow root access through CDP ----
function attrs(node) { const o = {}; const a = node.attributes || []; for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1]; return o; }
function walk(node, fn) { if (fn(node)) return node; for (const c of (node.children || [])) { const r = walk(c, fn); if (r) return r; } for (const s of (node.shadowRoots || [])) { const r = walk(s, fn); if (r) return r; } return null; }
function walkAll(node, fn, out = []) { if (fn(node)) out.push(node); for (const c of (node.children || [])) walkAll(c, fn, out); for (const s of (node.shadowRoots || [])) walkAll(s, fn, out); return out; }
async function shadow(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const host = walk(root, (n) => /^SUBTEXT-/i.test(n.nodeName));
  if (!host || !host.shadowRoots || !host.shadowRoots[0]) return null;
  return host.shadowRoots[0];
}
function hasClass(node, cls) { const c = attrs(node).class || ''; return c.split(/\s+/).includes(cls); }
async function find(cdp, cls) { const s = await shadow(cdp); if (!s) return null; return walk(s, (n) => n.nodeType === 1 && hasClass(n, cls)); }
async function findAll(cdp, cls) { const s = await shadow(cdp); if (!s) return []; return walkAll(s, (n) => n.nodeType === 1 && hasClass(n, cls)); }
async function box(cdp, node) {
  if (!node) return null;
  try { const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId }); const b = model.border; return { left: Math.min(b[0], b[6]), top: Math.min(b[1], b[3]), right: Math.max(b[2], b[4]), bottom: Math.max(b[5], b[7]), width: model.width, height: model.height }; }
  catch (e) { return null; }
}
async function rectOf(cdp, cls) { const n = await find(cdp, cls); if (!n) return { node: null, rect: null, hidden: true }; const a = attrs(n); return { node: n, rect: 'hidden' in a ? null : await box(cdp, n), hidden: 'hidden' in a, attrs: a }; }
async function textOf(cdp, node) { const t = []; walkAll(node, (n) => { if (n.nodeType === 3) t.push(n.nodeValue); return false; }); return t.join(' ').replace(/\s+/g, ' ').trim(); }
// what holds focus, read from the accessibility tree: document.activeElement is the host for everything inside the closed shadow root
async function focused(cdp) { await cdp.send('Accessibility.enable'); const { nodes } = await cdp.send('Accessibility.getFullAXTree'); return nodes.filter((n) => (n.properties || []).some((p) => p.name === 'focused' && p.value && p.value.value === true) && !/RootWebArea/.test((n.role && n.role.value) || '')).map((n) => ((n.role && n.role.value) || '') + ' | ' + ((n.name && n.name.value) || '')); }
function overlap(a, b) { if (!a || !b) return false; return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top; }

// flagged elements with their viewport rects (main world; data-ml-id attributes are visible there)
async function flagged(page, st) {
  const ids = []; for (const f of (st.report.findings || [])) if (f.severity > 0) for (const e of f.evidence || []) if (e.elId && !ids.includes(e.elId)) ids.push(e.elId);
  return page.evaluate((ids) => ids.map((id) => { const t = document.querySelector('[data-ml-id="' + id + '"]'); if (!t) return null; const r = t.getBoundingClientRect(); return { id, tag: t.tagName, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, visible: t.checkVisibility && t.checkVisibility(), text: (t.innerText || '').slice(0, 50).replace(/\s+/g, ' ') }; }).filter(Boolean), ids);
}
async function clickNode(page, cdp, node) { try { await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId }); } catch (e) { /* ignore */ } const b = await box(cdp, node); if (!b) throw new Error('node has no box'); await page.mouse.click((b.left + b.right) / 2, (b.top + b.bottom) / 2); }
// a re-render replaces the node, so a stamped attribute that survives proves the DOM was left alone
async function stamp(cdp, cls) { const n = await find(cdp, cls); await cdp.send('DOM.setAttributeValue', { nodeId: n.nodeId, name: 'data-probe', value: '1' }); }
async function stamped(cdp, cls) { const n = await find(cdp, cls); return !!n && attrs(n)['data-probe'] === '1'; }

module.exports = { focused, tabId, stamp, stamped, launch, open, togglePanel, state, shadow, find, findAll, box, rectOf, textOf, attrs, overlap, flagged, clickNode, walk, walkAll, hasClass, SHOP, ARTICLE, ROOT };
