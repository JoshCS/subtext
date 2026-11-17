/* Regression checks for the report's controls on the real extension: keyboard access, "Not accurate", rule and site mutes, the information fold,
   locate from a quote, grade states. Clicks go through real mouse and keyboard input into the closed shadow root.
   Usage: node test/ui/actions.js   (or part of: npm run test:ui:all) */
const path = require('path'); const L = require('./lib');
const OUT = path.join(__dirname, '..', 'out', 'ui-actions');
const results = []; const log = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + JSON.stringify(detail).slice(0, 200) : '')); };
const clickNode = async (page, cdp, node) => { await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId: node.nodeId }); await page.waitForTimeout(120); const b = await L.box(cdp, node); await page.mouse.click((b.left + b.right) / 2, (b.top + b.bottom) / 2); await page.waitForTimeout(250); };
const text = async (cdp, node) => { const { outerHTML } = await cdp.send('DOM.getOuterHTML', { nodeId: node.nodeId }); return outerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); };
const attr = (node, k) => { const a = node.attributes || []; for (let i = 0; i < a.length; i += 2) if (a[i] === k) return a[i + 1]; return null; };
(async () => {
  const { context, sw, close } = await L.launch(OUT);
  const { page, cdp } = await L.open(context, L.SHOP);
  await page.waitForTimeout(1500); await page.evaluate(() => document.querySelectorAll('.modal.show .no').forEach((b) => b.click()));
  await L.togglePanel(sw, L.SHOP, true); await page.waitForTimeout(500);
  // keyboard: a category header opens with Enter
  let hd = await L.find(cdp, 'cat__hd'); log('category header is a focusable button', attr(hd, 'role') === 'button' && attr(hd, 'tabindex') === '0');
  await cdp.send('DOM.focus', { nodeId: hd.nodeId }); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  hd = await L.find(cdp, 'cat__hd'); log('Enter opens the category', attr(hd, 'aria-expanded') === 'true');
  // keyboard: a finding opens with Space, then its controls exist
  // A live scan can replace the row between CDP lookup and focus. Re-find only on
  // that stale-node error; still send a real Space and assert that the controls open.
  for (let attempt=0;;attempt++) {
    const fh=await L.find(cdp,'f__hd');
    try { await cdp.send('DOM.focus',{nodeId:fh.nodeId}); break; }
    catch (e) { if (attempt>=2 || !/Could not find node/.test(e.message)) throw e; }
  } await page.keyboard.press(' '); await page.waitForTimeout(250);
  const act = await L.find(cdp, 'f__act'); log('finding shows its controls', !!act);
  // locate from a quote by keyboard pins the tooltip by the element
  // open findings until one has a quote with a place on the page; re-found each step, because a rescan can rebuild the report between keys
  const openAll = async (cls, key) => { for (let i = 0; i < 40; i++) { const hs = await L.findAll(cdp, cls); const h = hs.find((x) => attr(x, 'aria-expanded') !== 'true'); if (!h) return; const ok = await cdp.send('DOM.focus', { nodeId: h.nodeId }).then(() => true, () => false); if (ok) await page.keyboard.press(key); await page.waitForTimeout(60); } };
  await openAll('cat__hd', 'Enter'); await openAll('f__hd', ' ');
  const quotes = await L.findAll(cdp, 'q'); let q = null; for (const n of quotes) { if (attr(n, 'data-el') && await cdp.send('DOM.focus', { nodeId: n.nodeId }).then(() => true).catch(() => false)) { q = n; break; } }
  if (q) { await cdp.send('DOM.focus', { nodeId: q.nodeId }); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); const tip = await L.rectOf(cdp, 'tip'); const panel = (await L.rectOf(cdp, 'panel')).rect; log('locate by keyboard opens the tooltip, clear of the panel', !tip.hidden && tip.rect && tip.rect.right <= panel.left, tip.rect); await page.keyboard.press('Escape'); await page.waitForTimeout(200); } else log('a locatable quote exists', false);
  // Not accurate is stored on this device
  { const a = await L.find(cdp, 'f__act'); if (a && a.children && a.children[0]) await clickNode(page, cdp, a.children[0]); } // re-found: a rescan may have re-rendered the report
  const fb = await sw.evaluate(async () => (await chrome.storage.local.get('feedback')).feedback || []);
  log('"Not accurate" stored locally with rule, host and quote', fb.length === 1 && !!fb[0].ruleId && !!fb[0].host, fb[0]);
  // Don't flag this again removes the finding from the report and persists
  const before = await L.state(sw, L.SHOP); const ruleId = fb[0] && fb[0].ruleId; const fresh = await L.find(cdp, 'f__act');
  if (fresh && fresh.children && fresh.children[1]) await clickNode(page, cdp, fresh.children[1]);
  await page.waitForTimeout(800); const after = await L.state(sw, L.SHOP);
  const settings = await sw.evaluate(async () => (await chrome.storage.local.get('settings')).settings || {});
  log('rule mute removes the finding and persists', (settings.disabledRules || []).includes(ruleId) && !after.report.findings.some((f) => f.id === ruleId) && before.report.findings.some((f) => f.id === ruleId), ruleId);
  // no letter grade or score anywhere in the header
  const meta = await L.find(cdp, 'ph__meta'); const metaText = await text(cdp, meta); log('panel header gives no grade or score', /to know|Nothing to flag/.test(metaText) && !/\b[A-F]\b|\/100/.test(metaText), metaText);
  // site mute removes the UI and survives a reload
  const mute = await L.find(cdp, 'pf__mute'); await clickNode(page, cdp, mute); await page.waitForTimeout(600);
  log('site mute removes the panel', !(await L.shadow(cdp)));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500); log('muted site stays unscanned after reload', !(await L.shadow(cdp)));
  // the popup on a muted site: one line and Unmute, no dead buttons
  { const id = await L.tabId(sw, L.SHOP); const pm = await context.newPage(); await pm.goto('chrome-extension://' + new URL(sw.url()).host + '/popup/popup.html?tabId=' + id); await pm.waitForTimeout(700);
    const m = await pm.evaluate(() => ({ site: document.querySelector('#site').textContent, label: document.querySelector('#label').textContent, toolbar: !document.querySelector('#toolbar').hidden, footer: !document.querySelector('#footer').hidden, notice: !document.querySelector('#notice').hidden, buttons: Array.from(document.querySelectorAll('#report button')).map((b) => b.textContent) }));
    log('popup on a muted site is one line plus Unmute', /muted on/.test(m.site) && !m.label && !m.toolbar && !m.footer && !m.notice && m.buttons.join() === 'Unmute', m); await pm.screenshot({ path: path.join(OUT, 'popup-muted.png') }); await pm.close(); }
  await page.close();
  // information fold on the clean page, with no warning heading above it
  const { page: p2, cdp: c2 } = await L.open(context, 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas');
  await p2.waitForTimeout(1500); await L.togglePanel(sw, 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas', true); await p2.waitForTimeout(500);
  const cats = await L.findAll(c2, 'cat'); const info = await L.find(c2, 'cat--info');
  log('severity-0 facts sit in the "Also noticed" fold only', !!info && cats.length === 1, { cats: cats.length });
  const pill = await L.find(c2, 'pill'); await L.togglePanel(sw, 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas', false); await p2.waitForTimeout(300);
  log('a page with little to flag has a quiet or plain pill', !/(^|\s)[A-F](\s|$|·)|\bgrade\b/i.test(await text(c2, await L.find(c2, 'pill'))));
  await p2.close(); await close();
  const bad = results.filter((r) => !r.ok).length; console.log('\n' + (results.length - bad) + '/' + results.length + ' checks passed'); if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
