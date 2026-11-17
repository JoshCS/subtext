/* Isolated no-key investigation demo. No HTTP server or listening debug port.
 * node scripts/investigation-demo.js
 * node scripts/investigation-demo.js --refresh (save original public sources; no browser)
 * node scripts/investigation-demo.js --headless --smoke (closes after startup checks)
 * Only the four .test screens and selected saved public-record responses are served.
 * Browser offline mode and DNS denial backstop catch-all request interception.
 * No persistent user profile is read, and no extension behavior/findings are mocked.
 */
const { chromium } = require('playwright');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { PAGES, SEC_URL, refresh, checkCache, routeDemo } = require('./investigation-fixtures');
async function main() {
  if (process.argv.includes('--refresh')) { await refresh(); return; }
  checkCache();
  if (process.env.PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK) throw new Error('Unset PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK: demo requires service-worker network interception.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'subtext-investigation-'));
  const ext = path.resolve(__dirname, '..', 'extension');
  let context; let closing; let interrupted = false;
  const close = () => closing || (closing = (async () => {
    try { if (context) await context.close(); } finally { fs.rmSync(profile, { recursive: true, force: true }); }
  })());
  const signal = () => { interrupted = true; if (context) close().catch(console.error); };
  process.once('SIGINT', signal); process.once('SIGTERM', signal);
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: process.argv.includes('--headless'), channel: 'chromium',
      viewport: { width: 1440, height: 960 }, offline: true,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking']
    });
    if (interrupted) return;
    context.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') console.error('[browser]', message.text()); });
    context.on('page', page => page.on('pageerror', error => console.error('[page]', error.message)));
    await context.route('**/*', routeDemo);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20000 });
    const pages = [];
    for (const url of Object.keys(PAGES)) {
      const page = pages.length ? await context.newPage() : context.pages()[0] || await context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await worker.evaluate(async (url) => {
        const deadline = Date.now() + 25000;
        while (Date.now() < deadline) {
          const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => t.url === url);
          if (tab) try { const r = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }); if (r && r.report) return; } catch { /* content script starting */ }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        throw new Error('Article scan did not finish: ' + url);
      }, url);
      pages.push(page);
    }
    await pages[0].bringToFront();
    const opened = await worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => t.url === url);
      if (!tab) throw new Error('Demo article tab missing');
      return chrome.tabs.sendMessage(tab.id, { type: 'togglePanel', on: true });
    }, Object.keys(PAGES)[0]);
    if (!opened || !opened.on) throw new Error('Extension panel did not open');
    console.log('Offline investigation demo ready. Fresh temporary browser; no API key needed.');
    console.log(Object.keys(PAGES).join('\n'));
    console.log('The first article has the real Subtext panel open. Click Compare SEC filing to see what the launch was asking shareholders to believe. No comparison was auto-started.');
    console.log('Record replies are saved original public responses, not live retrievals. All other external traffic is blocked. Close the window or press Ctrl+C to delete this temporary profile.');
    if (process.argv.includes('--smoke')) {
      const checks = await worker.evaluate(async (secUrl) => {
        const sec = await fetch(secUrl).then(r => r.text());
        const trial = await fetch('https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID%3A37952131%20AND%20SRC%3AMED&format=json&resultType=core&pageSize=5').then(r => r.json());
        let blocked = false; try { await fetch('https://example.com/'); } catch { blocked = true; }
        return { sec: sec.includes('Important Voting Information Regarding Tesla'), trial: trial.resultList.result[0].id === '37952131', blocked };
      }, SEC_URL);
      if (!checks.sec || !checks.trial || !checks.blocked) throw new Error('Offline route smoke check failed: ' + JSON.stringify(checks));
      const offerGeometry = await pages[2].evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        const buttons = [...dialog.querySelectorAll('button')].map(button => { const r = button.getBoundingClientRect(); return {text:button.textContent, width:r.width, height:r.height}; });
        return {width:dialog.getBoundingClientRect().width, viewport:innerWidth, buttons, terms:dialog.querySelector('.terms').innerText};
      });
      if (offerGeometry.width <= offerGeometry.viewport * 0.08 || offerGeometry.buttons.length !== 2 || offerGeometry.buttons[0].width !== 240 || offerGeometry.buttons[0].height !== 60 || offerGeometry.buttons[1].width !== 120 || offerGeometry.buttons[1].height !== 24 || offerGeometry.terms !== '$14 per month, billed annually') throw new Error('Offer fixture geometry failed: ' + JSON.stringify(offerGeometry));
      // Explicit smoke mode exercises actual user-input events; normal demo never auto-compares.
      const walk = (node, predicate) => {
        if (predicate(node)) return node;
        for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const found = walk(child, predicate); if (found) return found; }
        return null;
      };
      const hasClass = (node, cls) => { const attrs = node.attributes || []; const i = attrs.indexOf('class'); return i >= 0 && attrs[i + 1].split(/\s+/).includes(cls); };
      for (const [index, expected] of [[0, 'The other audience for the launch'], [1, 'The percentage, in people']]) {
        const page = pages[index]; await page.bringToFront();
        await worker.evaluate(async (url) => { const tab = (await chrome.tabs.query({})).find(t => t.url === url); return chrome.tabs.sendMessage(tab.id, {type:'togglePanel', on:true}); }, page.url());
        const cdp = await context.newCDPSession(page); await cdp.send('DOM.enable');
        const document = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        const button = walk(document.root, node => hasClass(node, 'investigation__button'));
        if (!button) throw new Error('Compare button missing: ' + page.url());
        await cdp.send('DOM.scrollIntoViewIfNeeded', {nodeId:button.nodeId});
        const {model} = await cdp.send('DOM.getBoxModel', {nodeId:button.nodeId});
        const x = (model.content[0] + model.content[2]) / 2, y = (model.content[1] + model.content[5]) / 2;
        await cdp.send('Input.dispatchMouseEvent', {type:'mousePressed', x, y, button:'left', clickCount:1});
        await cdp.send('Input.dispatchMouseEvent', {type:'mouseReleased', x, y, button:'left', clickCount:1});
        const result = await worker.evaluate(async (url) => {
          const tab = (await chrome.tabs.query({})).find(t => t.url === url);
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            const state = await getState(tab.id);
            if (state && state.investigation) return state.investigation;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          const citations = await chrome.tabs.sendMessage(tab.id, {type:'getCitations'});
          throw new Error('Compare click did not produce a result: ' + JSON.stringify(citations));
        }, page.url());
        if (result.heading !== expected || result.evidence.length < 2) throw new Error('Unexpected comparison: ' + JSON.stringify(result));
        const rendered = await cdp.send('DOM.getDocument', {depth:-1,pierce:true});
        const text = node => [node.nodeValue || '', ...(node.children || []).map(text), ...(node.shadowRoots || []).map(text)].join(' ');
        const panel = walk(rendered.root, node => hasClass(node,'investigation'));
        if (index===0 && (!result.stake?.text.includes('$165 million') || !text(panel).includes('Who else had money at stake?'))) throw new Error('Related financial interest missing from solar comparison');
        if (!panel || !text(panel).includes(expected)) throw new Error('Comparison was not rendered in the panel');
        console.log('Actual click verified:', result.heading, '—', result.lead);
        console.log('Original source excerpts:', result.evidence.map(e => e.quote).join(' | '));
        if (index===0) {
          const button=walk(panel,n=>n.nodeName==='BUTTON' && (n.attributes || []).some((k,i,a)=>k==='data-fold' && a[i+1]==='stake'));
          await cdp.send('DOM.focus',{nodeId:button.nodeId}); await page.keyboard.press('Enter');
          const ui=await cdp.send('Accessibility.getFullAXTree');
          if (!ui.nodes.some(n=>(n.name?.value || '').includes('SpaceX bought about $165 million'))) throw new Error('Financial interest did not open for the reader');
        }
        if (process.argv.includes('--screens')) await page.screenshot({path:path.join(__dirname,'../eval/out-investigation-demo',index===0?'solar-panel.png':'trial-panel.png')});
        await cdp.detach();
      }
      console.log('Smoke checks passed: four scanned screens, real panel, SEC HTML, Europe PMC JSON, external request blocked.');
    } else {
      await new Promise(resolve => context.once('close', resolve));
    }
  } finally {
    await close(); process.removeListener('SIGINT', signal); process.removeListener('SIGTERM', signal);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
