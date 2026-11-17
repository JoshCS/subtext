/* UI regression scenarios on the real extension: tooltip placement against the panel, pill, folds across rescans, Escape, touch, dark mode.
   Usage: node test/ui/scenarios.js [label]   (or: npm run test:ui). Screenshots and findings.json go to test/out/ui-<label>/. Exits non-zero on any failed check. */
const path = require('path'); const fs = require('fs');
const L = require('./lib');
const label = process.argv[2] || 'run';
const OUT = path.join(__dirname, '..', 'out', 'ui-' + label);
const results = []; const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok === null ? '·' : ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); };
// the reading has its own "More" fold; these checks exercise the Source card's fold
const checksBtn = async (cdp) => (await L.findAll(cdp, 'card__more')).find((n) => L.attrs(n)['data-fold'] !== 'reading');
const checksFoldRect = async (cdp) => { const folds = await L.findAll(cdp, 'card__fold'); const f = folds.length > 1 ? folds[1] : folds[0]; return f && !('hidden' in L.attrs(f)) ? L.box(cdp, f) : null; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.png') });
async function waitUntil(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { context, sw, close } = await L.launch(OUT);
  // ---------------- shop page ----------------
  const { page, cdp } = await L.open(context, L.SHOP);
  // dismiss the timed modal by clicking its close text if present, otherwise it covers the page; keep it: it is itself flagged
  await page.waitForTimeout(1500);
  const dismiss = async (pg) => { await pg.evaluate(() => document.querySelectorAll('.modal.show .no').forEach((b) => b.click())); await pg.waitForTimeout(300); };
  await dismiss(page);
  const st = await L.state(sw, L.SHOP);
  const els = await L.flagged(page, st);
  fs.writeFileSync(path.join(OUT, 'flagged.json'), JSON.stringify(els, null, 2));
  await L.togglePanel(sw, L.SHOP, true); await page.waitForTimeout(500);
  const panel = (await L.rectOf(cdp, 'panel')).rect;
  log('panel open', !!panel, panel);
  // 2. pill while panel open
  const pill = await L.rectOf(cdp, 'pill');
  log('pill hidden while panel open', pill.hidden, { hidden: pill.hidden, rect: pill.rect, overlapsPanel: L.overlap(pill.rect, panel) });
  await shot(page, '01-panel-open');

  // 1. tooltip on a flagged element near the right edge, pointer close to the panel
  const vw = 1200;
  const nearRight = els.filter((e) => e.visible && e.right > panel.left - 40 && e.left < panel.left - 20 && e.top >= 50 && e.bottom <= 800 && e.height < 400 && e.width > 40).sort((a, b) => b.right - a.right); // the pointer lands left of the panel, so the element must reach there
  fs.writeFileSync(path.join(OUT, 'near-right.json'), JSON.stringify(nearRight, null, 2));
  const pick = nearRight[0];
  log('candidate near right edge', !!pick, pick);
  if (pick) {
    const px = Math.min(pick.right - 6, panel.left - 20), py = Math.min(Math.max(pick.top + 8, 60), pick.bottom - 4);
    await page.mouse.move(px, py); await page.waitForTimeout(600);
    const tip = await L.rectOf(cdp, 'tip');
    await shot(page, '02-tip-near-panel');
    log('tooltip shown near right edge', !tip.hidden && !!tip.rect, { mouse: { x: px, y: py }, tip: tip.rect });
    if (tip.rect) {
      log('tooltip does not overlap panel', !L.overlap(tip.rect, panel) && tip.rect.right <= panel.left - 8, { tipRight: tip.rect.right, panelLeft: panel.left });
      const dx = Math.min(Math.abs(tip.rect.left - px), Math.abs(tip.rect.right - px)), dy = Math.min(Math.abs(tip.rect.top - py), Math.abs(tip.rect.bottom - py));
      log('tooltip is near the pointer (<= 40px)', dx <= 40 && dy <= 40, { dx, dy });
      log('tooltip inside viewport', tip.rect.left >= 0 && tip.rect.top >= 0 && tip.rect.right <= vw && tip.rect.bottom <= 800, tip.rect);
      // Details expansion re-places the tooltip
      const more = await L.find(cdp, 'tip__more');
      if (more) { await L.clickNode(page, cdp, more); await page.waitForTimeout(200); const t2 = await L.rectOf(cdp, 'tip'); await shot(page, '03-tip-details'); log('after Details: tooltip inside viewport and clear of panel', !!t2.rect && t2.rect.bottom <= 800 && t2.rect.right <= panel.left - 8, t2.rect); }
    }
  }
  // 4. Escape: first closes the tooltip, second (pointer over panel) closes the panel
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  const tipAfterEsc = await L.rectOf(cdp, 'tip'); const panelAfterEsc1 = await L.rectOf(cdp, 'panel');
  log('Escape #1 closes tooltip, panel stays', tipAfterEsc.hidden && !panelAfterEsc1.hidden, { tipHidden: tipAfterEsc.hidden, panelHidden: panelAfterEsc1.hidden });
  await page.mouse.move(panel.left + 100, panel.top + 300); await page.waitForTimeout(100);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  const panelAfterEsc2 = await L.rectOf(cdp, 'panel'); const pillAfter = await L.rectOf(cdp, 'pill');
  log('Escape #2 (pointer over panel) closes panel, pill back', panelAfterEsc2.hidden && !pillAfter.hidden, { panelHidden: panelAfterEsc2.hidden, pillHidden: pillAfter.hidden });
  await shot(page, '04-after-escape');
  // washes cleared on close: hover a finding row in the panel (wash), then close, count wash nodes
  await L.togglePanel(sw, L.SHOP, true); await page.waitForTimeout(400);
  const sig = await L.findAll(cdp, 'f');
  const cat = await L.find(cdp, 'cat__hd'); if (cat) { await L.clickNode(page, cdp, cat); await page.waitForTimeout(150); }
  const rows = await L.findAll(cdp, 'f');
  if (rows.length) { const b = await L.box(cdp, rows[0]); if (b) { await page.mouse.move((b.left + b.right) / 2, (b.top + b.bottom) / 2); await page.waitForTimeout(150); } }
  const washBefore = (await L.findAll(cdp, 'wash')).length;
  await L.togglePanel(sw, L.SHOP, false); await page.waitForTimeout(100);
  const washAfter = (await L.findAll(cdp, 'wash')).length;
  log('wash overlays cleared when panel closes', washAfter === 0, { washBefore, washAfter });
  await page.mouse.move(5, 400); await dismiss(page);

  // 3. fold state survives a rescan re-render (toast mutates every 3 s → rescan debounce 4 s)
  await L.togglePanel(sw, L.SHOP, true); await page.waitForTimeout(400);
  let more = (await checksBtn(cdp));
  log('Source card has a fold button', !!more, more && await L.textOf(cdp, more));
  if (more) {
    await L.clickNode(page, cdp, more); await page.waitForTimeout(150);
    // scroll the panel main a bit so scroll restoration is tested too
    const main = await L.rectOf(cdp, 'pm');
    await page.mouse.move(main.rect.left + 50, main.rect.top + 50); await page.mouse.wheel(0, 120); await page.waitForTimeout(200);
    const r0 = await checksFoldRect(cdp); const fold0 = { rect: r0, hidden: !r0 }; const more0 = (await checksBtn(cdp));
    const readingTop0 = ((await L.rectOf(cdp, 'reading')).rect || {}).top;
    log('fold opened', !fold0.hidden, { text: await L.textOf(cdp, more0) });
    await shot(page, '05-fold-open');
    await page.mouse.move(5, 400); await dismiss(page); // pointer out of the panel so a deferred render may run
    await page.waitForTimeout(9000); // at least one rescan cycle
    const r1 = await checksFoldRect(cdp); const fold1 = { rect: r1, hidden: !r1 }; const more1 = (await checksBtn(cdp));
    const scanned = await page.evaluate(() => document.documentElement.dataset.mlScanned);
    await shot(page, '06-fold-after-rescan');
    const readingTop1 = ((await L.rectOf(cdp, 'reading')).rect || {}).top;
    log('panel scroll position survives re-render', readingTop0 === readingTop1 && readingTop0 < 60, { readingTop0, readingTop1 });
    log('fold state survives re-render', !fold1.hidden && /Hide/.test(await L.textOf(cdp, more1)), { foldHidden: fold1.hidden, button: await L.textOf(cdp, more1), scanned });
  }
  // deferred render while pointer inside the panel: stamp a node, keep the pointer inside through a rescan cycle, the stamp must survive; leave, it must go
  const catHd = await L.find(cdp, 'cat__hd');
  if (catHd) {
    await L.clickNode(page, cdp, catHd); await page.waitForTimeout(100);
    const b = await L.box(cdp, catHd); await page.mouse.move((b.left + b.right) / 2, (b.top + b.bottom) / 2);
    await L.stamp(cdp, 'cat');
    await page.waitForTimeout(9000);
    const scannedA = await page.evaluate(() => document.documentElement.dataset.mlScanned);
    log('no re-render while pointer is inside panel (stamp survived a rescan cycle)', await L.stamped(cdp, 'cat'), { scanned: scannedA });
    await page.mouse.move(5, 400); await dismiss(page); await page.waitForTimeout(300);
    log('pending render applied on mouseleave (stamp gone)', !(await L.stamped(cdp, 'cat')));
  }
  // a rebuild of the report body while a row holds focus puts focus back on that row
  for (const [what, get] of [['category row', () => L.find(cdp, 'cat__hd')], ['chip row', () => L.find(cdp, 'sig')], ['checks fold button', () => checksBtn(cdp)]]) {
    const nd = await get(); await cdp.send('DOM.focus', { nodeId: nd.nodeId });
    const before = await L.focused(cdp); await L.stamp(cdp, 'reading');
    // Run the real rescan button without transferring focus to it.
    const rescan = await L.find(cdp, 'ib-rescan');
    const { object } = await cdp.send('DOM.resolveNode', { nodeId: rescan.nodeId });
    await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: 'function () { this.click(); }' });
    const rebuilt = await waitUntil(async () => !(await L.stamped(cdp, 'reading')));
    const afterF = await L.focused(cdp);
    log('focus stays on the same ' + what + ' across a rescan', rebuilt && before.length === 1 && before.join() === afterF.join(), { before, afterF, rebuilt });
  }
  // 5. tooltip hides when the page scrolls the element away
  await L.togglePanel(sw, L.SHOP, false); await page.waitForTimeout(100);
  const els2 = await L.flagged(page, st);
  const mid = els2.filter((e) => e.visible && e.top > 60 && e.bottom < 700 && e.height < 300 && e.width > 40 && e.left < 600)[0];
  if (mid) {
    await page.mouse.move(mid.left + 10, mid.top + 6); await page.waitForTimeout(600);
    const t = await L.rectOf(cdp, 'tip'); log('tooltip opened on mid-page element', !t.hidden, { el: mid.text });
    await page.mouse.wheel(0, 1500); await page.waitForTimeout(700);
    const t2 = await L.rectOf(cdp, 'tip');
    const stillThere = await page.evaluate((id) => { const t = document.querySelector('[data-ml-id="' + id + '"]'); const r = t.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }, mid.id);
    await shot(page, '07-after-scroll');
    log('tooltip hidden after the element scrolled away', stillThere ? null : t2.hidden, { tipHidden: t2.hidden, elementStillInView: stillThere });
  }
  // hide/open race: hover flagged, leave, re-enter within CLOSE_DELAY, and check it is still open (no flicker close) then leave and confirm it closes
  await page.mouse.move(5, 400); await dismiss(page); await page.waitForTimeout(500);
  const els3 = await L.flagged(page, st);
  const e3 = els3.filter((e) => e.visible && e.top > 60 && e.bottom < 700 && e.height < 300 && e.width > 60 && e.left < 600)[0];
  if (e3) {
    await page.mouse.move(e3.left + 10, e3.top + 6); await page.waitForTimeout(500);
    await page.mouse.move(5, 400); await page.waitForTimeout(100); // leave: hide scheduled at 300ms
    await page.mouse.move(e3.left + 12, e3.top + 6); await page.waitForTimeout(450); // re-enter before the hide fires
    const t3 = await L.rectOf(cdp, 'tip');
    log('re-entering before the hide timer keeps the tooltip open', !t3.hidden, { hidden: t3.hidden });
    await page.mouse.move(5, 400); await page.waitForTimeout(600);
    const t4 = await L.rectOf(cdp, 'tip'); log('tooltip closes after leaving', t4.hidden, { hidden: t4.hidden });
  }
  // tooltip while pointer is over the panel: hover the panel area over a flagged element behind it
  await L.togglePanel(sw, L.SHOP, true); await page.waitForTimeout(300);
  await page.mouse.move(panel.left + 150, panel.top + 400); await page.waitForTimeout(600);
  const t5 = await L.rectOf(cdp, 'tip'); log('no tooltip while pointer over the panel', t5.hidden, { hidden: t5.hidden });
  await L.togglePanel(sw, L.SHOP, false);
  await page.close();

  // ---------------- small window: panel must fit; resize handles when window is narrower than the panel ----------------
  const small = await context.newPage(); await small.setViewportSize({ width: 300, height: 400 });
  await small.goto(L.SHOP, { waitUntil: 'domcontentloaded' }); await small.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 }); await small.waitForTimeout(1500);
  const cdp2 = await context.newCDPSession(small); await cdp2.send('DOM.enable');
  await L.togglePanel(sw, L.SHOP, true); await small.waitForTimeout(400);
  const p2 = (await L.rectOf(cdp2, 'panel')).rect;
  await shot(small, '08-small-window');
  log('panel fits a 300x400 window', !!p2 && p2.left >= 0 && p2.right <= 300 && p2.top >= 0 && p2.bottom <= 400, p2);
  // drag the width handle to the left past the window edge
  const rs = await L.rectOf(cdp2, 'rs-w');
  if (rs.rect) { await small.mouse.move(rs.rect.left + 3, rs.rect.top + 100); await small.mouse.down(); await small.mouse.move(-50, rs.rect.top + 100, { steps: 5 }); await small.mouse.up(); await small.waitForTimeout(200); const p3 = (await L.rectOf(cdp2, 'panel')).rect; log('after dragging width handle past the edge the panel still fits', !!p3 && p3.left >= 0 && p3.right <= 300, p3); }
  await L.togglePanel(sw, L.SHOP, false);
  await small.close();

  // ---------------- dark mode tooltip ----------------
  const dark = await context.newPage(); await dark.emulateMedia({ colorScheme: 'dark' });
  await dark.goto(L.SHOP, { waitUntil: 'domcontentloaded' }); await dark.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 }); await dark.waitForTimeout(1500);
  const cdp3 = await context.newCDPSession(dark); await cdp3.send('DOM.enable'); await dismiss(dark);
  // a timer is flagged only after it has been seen ticking, so wait for a candidate instead of assuming the first scan has it
  let ea = null; for (let i = 0; i < 12 && !ea; i++) { const elsA = await L.flagged(dark, await L.state(sw, L.SHOP)); ea = elsA.filter((e) => e.visible && e.top > 60 && e.bottom < 700 && e.height < 300 && e.width > 60 && e.left < 700)[0]; if (!ea) await dark.waitForTimeout(500); } // the pointer lands at left + 10, clear of the open panel
  log('dark-mode candidate exists', !!ea);
  if (ea) { await dismiss(dark); await dark.mouse.move(ea.left + 10, ea.top + 6); await dark.waitForTimeout(600); await shot(dark, '09-dark-tip'); const ta = await L.rectOf(cdp3, 'tip'); log('dark-mode tooltip shown', !ta.hidden, ta.rect); }
  await cdp3.send('CSS.enable');
  const aiBtn = await L.find(cdp3, 'pb--ai');
  if (aiBtn) { const { computedStyle } = await cdp3.send('CSS.getComputedStyleForNode', { nodeId: aiBtn.nodeId }); const bg = computedStyle.find((p) => p.name === 'background-color').value; const m = bg.match(/\d+/g).map(Number); const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; const lum = 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]); const ratio = 1.05 / (lum + 0.05); log('dark-mode AI button: white text contrast >= 4.5', ratio >= 4.5, { bg, ratio: ratio.toFixed(2) }); }
  await dark.close();

  // ---------------- one list: pill, badge, header, chips and "+N more" read the same count ----------------
  const GRADE = /(^|\s)[A-F](\s|$|·)|\b[Gg]rade\b|\/100/;
  const CAT_SHORT = Object.values(require('../../extension/rules/labels.json').categories).map((c) => c.short);
  const extId = new URL(sw.url()).host; let vendorFlagSeen = false;
  await context.clearCookies(); await sw.evaluate(() => chrome.storage.local.set({ ui: { panelW: 360, panelH: 0, panelOpen: false, marks: false } }));
  for (const url of [L.SHOP, L.ARTICLE, 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas']) {
    const short = new URL(url).hostname; const { page: pg, cdp: c } = await L.open(context, url);
    const pst = await L.state(sw, url); const raw = (pst.report.findings || []).concat(pst.outletFindings || []);
    if (raw.some((f) => f.severity > 0 && /^(tracker\.|source\.ownership)/.test(f.id))) vendorFlagSeen = true;
    const pillText = await L.textOf(c, await L.find(c, 'pill__txt'));
    const badge = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), await L.tabId(sw, url));
    await L.togglePanel(sw, url, true); await pg.waitForTimeout(500);
    const metaText = await L.textOf(c, await L.find(c, 'ph__meta'));
    const n = (metaText.match(/^(?:Error page · )?(\d+) things? to know/) || [])[1]; const header = n ? +n : 0;
    const chips = (await L.findAll(c, 'sig')).length; const moreNode = await L.find(c, 'glance__more'); const more = moreNode ? +((await L.textOf(c, moreNode)).match(/\d+/) || [0])[0] : 0;
    log(short + ': header count equals the chips plus "+N more"', header === chips + more && (header > 0 || /Nothing to flag|Too little|Error page/.test(metaText)), { metaText, chips, more });
    log(short + ': badge reads the same count', String(header || '') === badge, { badge, header });
    log(short + ': pill reads the same count', header <= 1 ? !/ \+\d+$/.test(pillText) : pillText.endsWith(' +' + (header - 1)), { pillText, header });
    log(short + ': no letter grade or score in the pill, badge or header', !GRADE.test(pillText) && !GRADE.test(metaText) && /^\d*$/.test(badge), { pillText, metaText, badge });
    const catNames = []; for (const nd of await L.findAll(c, 'cat__name')) { const t = (await L.textOf(c, nd)).replace(/^[^\p{L}]+/u, ''); if (t !== 'Also noticed') catNames.push(t); }
    log(short + ': category folds use the plain short names, with no score bar', catNames.every((t) => CAT_SHORT.includes(t)) && !(await L.find(c, 'cat__bar')), catNames);
    const catCount = (await Promise.all((await L.findAll(c, 'cat')).filter((nd) => !L.hasClass(nd, 'cat--info')).map(async (nd) => +(await L.textOf(c, L.walk(nd, (x) => x.nodeType === 1 && L.hasClass(x, 'cat__count')))) || 0))).reduce((a, b) => a + b, 0);
    log(short + ': the folds hold the same list', catCount === header, { catCount, header });
    const note = await L.find(c, 'pf__note');
    log(short + ': footer disclaimer shows only with flags', ('hidden' in L.attrs(note)) === (header === 0), { header });
    const src = await L.find(c, 'reading__src'); const srcText = src ? await L.textOf(c, src) : '';
    log(short + ': the reading has no "not who runs it" caption', !/not who runs it/.test(srcText), srcText);
    log(short + ': sections have real headings', (await L.find(c, 'reading__hd')).nodeName === 'H2' && (header === 0 || (await L.find(c, 'glance__hd')).nodeName === 'H2'));
    const linkTexts = []; L.walkAll(await L.shadow(c), (x) => { if (x.nodeName === 'A') linkTexts.push(x); return false; });
    const named = []; for (const a of linkTexts) named.push(await L.textOf(c, a)); log(short + ': no link is just called "source"', !named.includes('source'), named.filter((t) => /source/i.test(t)));
    await L.togglePanel(sw, url, false); await pg.close();
  }
  log('a page in this run flags a vendor or dataset lookup, so the count checks can fail', vendorFlagSeen);
  // pure checks on the list itself: the review's notion.com case, the ordering, and one fact shown once
  require('../../extension/common.js'); const MC = globalThis.MLCommon;
  const nf = [{ id: 'tracker.social_pixel', severity: 2, category: 'surveillance', label: 'Tells Facebook', confidence: 0.9 }, { id: 'source.ownership', severity: 2, category: 'source_funding', label: 'Owner', confidence: 0.9 }];
  const ng = MC.glance(nf, { textChars: 5000 });
  log('vendor and dataset findings count: never "Nothing to flag" above two chips', ng.count === 2 && /^2 things to know/.test(ng.meta) && ng.pill.endsWith(' +1'), ng.meta);
  const og = MC.glance([{ id: 'tracker.x', severity: 2, category: 's', confidence: 1, count: 6 }, { id: 'dark.y', severity: 2, category: 'd', confidence: 0.2 }, { id: 'urgency.z', severity: 2, category: 'u', source: 'behavior', confidence: 0.1 }, { id: 'a.b', severity: 3, category: 'a', confidence: 0.1 }], { textChars: 5000 });
  log('order: severity, then behaviour-proven, then the rest, vendor lookups last', og.flags.map((f) => f.id).join() === 'a.b,urgency.z,dark.y,tracker.x', og.flags.map((f) => f.id));
  const dg = MC.glance([{ id: 'policy.auto_renewal', severity: 1, category: 'incentives', evidence: [{ quote: 'terms' }] }, { id: 'bias.default_optout_language', severity: 2, category: 'bias_exploit', evidence: [{ quote: 'page' }] }], { textChars: 5000 });
  log('one fact, one chip: auto-renew merges, stronger severity and both quotes kept', dg.count === 1 && dg.top.id === 'policy.auto_renewal' && dg.top.severity === 2 && dg.top.evidence.length === 2, dg.flags.map((f) => f.id));
  const noteMerge = MC.oneFactEach([{ id: 'policy.auto_renewal', severity: 2, evidence: [] }, { id: 'bias.default_optout_language', severity: 0, evidence: [{ quote: 'page' }] }]);
  log('a quiet note of the same fact folds into the chip', noteMerge.length === 1 && noteMerge[0].severity === 2 && noteMerge[0].evidence.length === 1, noteMerge.map((f) => f.id));
  log('severity-0 stays out of the list and out of a merge', MC.glance([{ id: 'policy.auto_renewal', severity: 0 }, { id: 'bias.default_optout_language', severity: 2, category: 'b' }], {}).top.id === 'bias.default_optout_language');

  // ---------------- dialog basics, on a real pill click ----------------
  await sw.evaluate(() => chrome.storage.local.set({ ui: { panelW: 360, panelH: 0, panelOpen: false, marks: false } }));
  const { page: dp, cdp: dc } = await L.open(context, L.SHOP); await dp.waitForTimeout(800); await dismiss(dp);
  const hostFirst = await (async () => { const { root } = await dc.send('DOM.getDocument', { depth: -1, pierce: true }); const body = L.walk(root, (n) => n.nodeName === 'BODY'); return /^SUBTEXT-/i.test(body.children[0].nodeName); })();
  log('the host is first in body, so Tab reaches the pill', hostFirst);
  const tabFirst = await context.newPage(); await tabFirst.goto(L.SHOP, { waitUntil: 'domcontentloaded' }); await tabFirst.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 }); await tabFirst.waitForTimeout(1200); const tfc = await context.newCDPSession(tabFirst); await tfc.send('DOM.enable');
  await tabFirst.keyboard.press('Tab'); await tabFirst.waitForTimeout(150); log('the first Tab on a fresh page lands on the pill', (await L.focused(tfc)).some((t) => /^button \| Subtext:/.test(t)), await L.focused(tfc)); await tabFirst.close();
  const pillNode = await L.find(dc, 'pill'); log('pill has an accessible name', /^Subtext: /.test(L.attrs(pillNode)['aria-label'] || ''), L.attrs(pillNode)['aria-label']);
  await dp.evaluate(() => { window.__escSeen = 0; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.__escSeen++; }); });
  await L.clickNode(dp, dc, pillNode); await dp.waitForTimeout(500);
  log('pill click opens the panel', !(await L.rectOf(dc, 'panel')).hidden);
  log('focus moves into the panel on open', (await L.focused(dc)).some((t) => /^button \| Close/.test(t)), await L.focused(dc));
  const icons = { 'ib-marks': /dots/, 'ib-rescan': /Scan the page/, 'ib-settings': /settings/i, 'ib-close': /Close/ };
  for (const [cls, re] of Object.entries(icons)) { const nd = await L.find(dc, cls); log(cls + ' has a real aria-label', re.test(L.attrs(nd)['aria-label'] || ''), L.attrs(nd)['aria-label']); }
  const panelNode = await L.find(dc, 'panel'); const order = panelNode.children.map((n) => (L.attrs(n).class || '').split(' ')[0]);
  log('resize separators come after the header in tab order', order.indexOf('ph') >= 0 && order.indexOf('rs') > order.indexOf('ph'), order);
  // Escape with the pointer outside the panel, on a spot with no tooltip pending
  await dp.mouse.move(5, 400); await dp.waitForTimeout(500); log('no tooltip before the Escape check', (await L.rectOf(dc, 'tip')).hidden);
  await dp.keyboard.press('Escape'); await dp.waitForTimeout(250);
  log('Escape closes the panel with the pointer outside it', (await L.rectOf(dc, 'panel')).hidden);
  log('focus returns to the pill on close', (await L.focused(dc)).some((t) => /^button \| Subtext:/.test(t)), await L.focused(dc));
  log('Escape from inside the panel is not passed to the page', (await dp.evaluate(() => window.__escSeen)) === 0);
  // focus the reader put in the page: the panel still closes, the page keeps both the focus and the key
  const panelPreference = () => sw.evaluate(async () => (await chrome.storage.local.get('ui')).ui?.panelOpen);
  await L.togglePanel(sw, L.SHOP, true);
  if (!await waitUntil(async () => await panelPreference() === true)) throw new Error('The open panel preference did not persist.');
  await dp.evaluate(() => { const i = document.createElement('input'); i.id = 'siteSearch'; document.body.appendChild(i); i.focus(); }); await dp.keyboard.press('Escape'); await dp.waitForTimeout(200);
  log('Escape from a page field closes the panel, keeps the field focused, reaches the page', (await L.rectOf(dc, 'panel')).hidden && await dp.evaluate(() => document.activeElement.id === 'siteSearch' && window.__escSeen === 1), await dp.evaluate(() => window.__escSeen));
  await dp.evaluate(() => { const i = document.getElementById('siteSearch'); i.blur(); i.remove(); });
  // a panel restored on page load must not take focus from the page
  if (!await waitUntil(async () => await panelPreference() === false)) throw new Error('The closed panel preference did not persist.');
  await sw.evaluate(() => chrome.storage.local.set({ ui: { panelW: 360, panelH: 0, panelOpen: true, marks: false } }));
  await dp.reload({ waitUntil: 'domcontentloaded' });
  const dc2 = await context.newCDPSession(dp); await dc2.send('DOM.enable');
  const restored = await waitUntil(async () => !(await L.rectOf(dc2, 'panel')).hidden);
  const restoreFocus = await L.focused(dc2);
  log('a panel restored on page load stays open without taking focus', restored && !restoreFocus.some((t) => /^button \| Close/.test(t)), { restored, focus: restoreFocus });
  await sw.evaluate(() => chrome.storage.local.set({ ui: { panelW: 360, panelH: 0, panelOpen: false, marks: false } })); await dp.close();

  // ---------------- tooltip beside the open panel at narrow widths ----------------
  const tipAt = async (w) => {
    const pg = await context.newPage(); await pg.setViewportSize({ width: w, height: 800 }); await pg.goto(L.SHOP, { waitUntil: 'domcontentloaded' }); await pg.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 }); await pg.waitForTimeout(1500); await dismiss(pg);
    const c = await context.newCDPSession(pg); await c.send('DOM.enable'); await L.togglePanel(sw, L.SHOP, true); await pg.waitForTimeout(400);
    const pr = (await L.rectOf(c, 'panel')).rect; const cand = (await L.flagged(pg, await L.state(sw, L.SHOP))).filter((e) => e.visible && e.top > 40 && e.bottom <= 800 && e.height < 400 && e.left + 10 < pr.left - 5)[0]; // the pointer lands left of the panel
    let tip = null; if (cand) { await pg.mouse.move(cand.left + 10, cand.top + 6); await pg.waitForTimeout(600); tip = await L.rectOf(c, 'tip'); }
    await L.togglePanel(sw, L.SHOP, false); await pg.close(); return { pr, cand: !!cand, tip };
  };
  const t640 = await tipAt(640);
  log('at 640 wide the tooltip shrinks to the space left of the panel', t640.cand ? !t640.tip.hidden && t640.tip.rect.right <= t640.pr.left - 8 && t640.tip.rect.width >= 200 : null, { panelLeft: t640.pr.left, tip: t640.tip && t640.tip.rect });
  const t480 = await tipAt(480);
  log('at 480 wide (under 200px of room) no tooltip shows over the panel', t480.cand ? t480.tip.hidden : null, { panelLeft: t480.pr.left, hidden: t480.tip && t480.tip.hidden });

  // ---------------- source card wording, on synthetic provenance in the real renderer ----------------
  const pv = await context.newPage(); await pv.goto('chrome-extension://' + extId + '/popup/popup.html?tabId=0'); await pv.waitForTimeout(400);
  const card = (P) => pv.evaluate((P) => { const d = document.createElement('div'); document.body.appendChild(d); SubtextView.render(d, { state: { report: { hostname: 'www.example.com', findings: [], meta: { textChars: 5000 }, provenance: P } }, rules: {}, labels: {} }); const k = d.querySelector('.kind'); const out = { badge: k.textContent, bg: getComputedStyle(k).backgroundColor, text: d.querySelector('.card p').textContent }; d.remove(); return out; }, P);
  const noPages = { privacy: false, terms: false, imprint: false, about: false, contact: false }; const allPages = { privacy: true, terms: true, imprint: false, about: true, contact: true };
  const addr = await card({ pages: noPages, address: '47 West Polk Street', identity: true, signals: [] });
  log('an address is never promoted to a name', addr.badge === 'not named' && !/names/.test(addr.text), addr);
  const ent = await card({ pages: allPages, entity: 'Example Labs, Inc.', identity: true, emails: [], signals: [{ id: 'platform', severity: 0, short: 'hosted on Wix' }] });
  log('a named company reads "named on page", with legal pages from the checklist', ent.badge === 'named on page' && /names Example Labs, Inc/.test(ent.text) && /privacy policy/.test(ent.text) && !/Does not say/.test(ent.text), ent);
  const nolegal = await card({ pages: noPages, entity: 'Example GmbH', identity: true, emails: [], signals: [] });
  log('"has legal pages" follows the checklist: none found, none claimed', /No legal pages/.test(nolegal.text) && !/It links/.test(nolegal.text), nolegal);
  const nobody = await card({ pages: noPages, emails: [], identity: false, signals: [{ id: 'identity', severity: 2, short: 'no company name on this page' }] });
  log('a page naming nobody reads "not named"', nobody.badge === 'not named' && /Does not say who runs it/.test(nobody.text), nobody);
  const inst = await pv.evaluate(() => { const d = document.createElement('div'); document.body.appendChild(d); SubtextView.render(d, { state: { report: { hostname: 'x.gov', findings: [], meta: { textChars: 5000 }, provenance: { institution: 'a government body', pages: {}, signals: [] } } }, rules: {}, labels: {} }); const bg = getComputedStyle(d.querySelector('.kind.sev0')).backgroundColor; d.remove(); return bg; });
  const greyish = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2]) < 25; };
  log('severity-0 badges are neutral grey, never green', greyish(inst), inst);
  await pv.close();

  // ---------------- popup states ----------------
  const pop = async (tab) => { const p = await context.newPage(); await p.goto('chrome-extension://' + extId + '/popup/popup.html?tabId=' + tab); await p.waitForTimeout(700); const r = await p.evaluate(() => ({ site: document.querySelector('#site').textContent, label: document.querySelector('#label').textContent, meta: document.querySelector('#meta').textContent, toolbar: !document.querySelector('#toolbar').hidden, buttons: Array.from(document.querySelectorAll('#toolbar button')).filter((b) => !b.hidden).map((b) => b.id), note: !document.querySelector('#ftrNote').hidden, ai: document.querySelector('#aiBtn').textContent })); return { p, r }; };
  const cleanUrl = 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas';
  const { page: cp } = await L.open(context, cleanUrl); const qp = await pop(await L.tabId(sw, cleanUrl));
  log('popup: the label is never just "Subtext"', qp.r.label !== 'Subtext' && qp.r.label.length > 0, qp.r);
  log('popup: no letter grade in the label or meta', !GRADE.test(qp.r.label) && !GRADE.test(qp.r.meta), qp.r);
  log('popup: label and meta do not repeat each other', !qp.r.meta.includes(qp.r.label), qp.r);
  log('popup: the AI button uses one name (Investigate or Deep analyze) and drops "AI key"', /Investigate|Deep analyze/.test(qp.r.ai) && !/AI key/.test(qp.r.ai), qp.r.ai);
  await shot(qp.p, '10-popup-quiet'); await qp.p.close(); await cp.close();
  // opened the moment the page loads, before any report: scanning, never "can't read"
  const early = await context.newPage(); await early.goto(cleanUrl, { waitUntil: 'commit' }); const ep = await pop(await L.tabId(sw, cleanUrl));
  log('popup: a page still loading is not called unreadable', ep.r.site !== "Subtext can't read this page", ep.r); await ep.p.waitForTimeout(6000);
  const epLabel = await ep.p.evaluate(() => document.querySelector('#label').textContent); log('popup: it settles on the report once the scan lands', epLabel !== 'Scanning…' && epLabel.length > 0, epLabel); await ep.p.close(); await early.close();
  const blank = await context.newPage(); await blank.goto('about:blank'); const blankId = (await sw.evaluate(() => chrome.tabs.query({}))).find((t) => t.url === 'about:blank').id;
  const bp = await pop(blankId); log('popup: a tab with no report says it cannot read the page, with no dead buttons', bp.r.site === "Subtext can't read this page" && !bp.r.toolbar, bp.r);
  await shot(bp.p, '11-popup-unreadable'); await bp.p.close(); await blank.close();

  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  await close();
  const bad = results.filter((r) => r.ok === false).length;
  console.log('\n' + (results.length - bad) + '/' + results.length + ' checks passed');
  if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
