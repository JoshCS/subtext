/* AI evaluation harness: extracts each fixture page exactly as the extension does, sends it to Claude and/or ChatGPT
   with the extension's own prompt and schema, and saves the structured findings for comparison with the heuristics.
   Usage: ANTHROPIC_API_KEY=… OPENAI_API_KEY=… node eval/run-ai.js [--provider anthropic|openai|both] [--model id] [--pages shop,article,clean]
   Output: eval/out/<page>-<provider>.json. Then: node eval/compare.js */
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const SubtextAI = require('../extension/ai.js');
const rules = require('../extension/rules/text-rules.json');
const EXT = path.resolve(__dirname, '..', 'extension'); const FIX = path.resolve(__dirname, '..', 'test', 'fixtures'); const OUT = path.join(__dirname, 'out');
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const providers = opt('provider', 'both') === 'both' ? ['anthropic', 'openai'] : [opt('provider')];
const want = opt('pages', 'shop,article,clean').split(',');
const realUrls = args.filter((a, i) => args[i - 1] === '--url');
const PAGES = { shop: 'https://dealzone-shop.test/product/ultra-widget', article: 'https://citizens-for-truth-institute.org/report/2026/the-truth-about-the-economy', clean: 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas' };
const FILES = { shop: 'shop.html', article: 'article.html', clean: 'clean.html' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ud = path.join(OUT, 'profile-' + Date.now());
  const ctx = await chromium.launchPersistentContext(ud, { headless: true, channel: 'chromium', viewport: { width: 1200, height: 800 }, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`] });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  await require('../test/hooks')(sw);
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('chrome-extension://') || u.startsWith('data:')) return route.continue(); const k = Object.keys(FILES).find((p) => u.startsWith(PAGES[p])); if (k && route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(FIX, FILES[k]), 'utf8') }); if (/dealzone-shop\.test|citizens-for-truth-institute\.org|theguardian\.com\/(food\/2026|info\/privacy)/.test(u)) return route.abort(); return route.continue(); });
  // real URLs (on a machine with network): routed to the live site, not the fixtures
  for (const u of realUrls) { const name = u.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 60); PAGES[name] = u; want.push(name); }
  for (const name of want) {
    const page = await ctx.newPage(); await page.goto(PAGES[name], { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 15000 }); await page.waitForTimeout(2000);
    const extracted = await sw.evaluate(async (u) => { const tabs = await chrome.tabs.query({ url: u }); return chrome.tabs.sendMessage(tabs[0].id, { type: 'extractForLLM' }); }, PAGES[name]);
    const { state } = await sw.evaluate((u) => handle({ type: 'testStateByUrl', url: u }, {}), PAGES[name]);
    fs.writeFileSync(path.join(OUT, name + '-heuristics.json'), JSON.stringify(state.report.findings, null, 2));
    console.log(`${name}: heuristics found ${state.report.findings.filter((f) => f.severity > 0).length} flags`);
    const charts = (extracted.charts || []).slice(0, 4).map((c) => c.type === 'svg' ? { type: 'svg', markup: c.markup, caption: c.caption } : c.type === 'canvas' && c.dataUrl ? { type: 'image', media_type: 'image/png', data: c.dataUrl.split(',')[1] } : { type: 'text', text: 'image not fetched in eval (' + (c.src || '').slice(0, 80) + ')' });
    const packetOpts = { charts, outletLine: state.outlet ? 'Known outlet: ' + state.outlet.entry.name : undefined };
    const blocks = SubtextAI.buildUserBlocks(extracted, packetOpts);
    for (const provider of providers) {
      const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
      if (!key) { console.log(name, provider, '→ skipped (no key in env)'); continue; }
      const model = opt('model', SubtextAI.PROVIDERS[provider].models[0].id);
      try {
        const t0 = Date.now();
        const res = await SubtextAI.analyze({ provider, model, key, system: SubtextAI.systemPrompt(rules.categories, require('../extension/data/category-playbook.json')), blocks });
        const findings = SubtextAI.toFindings(res.parsed, extracted.charts || [], SubtextAI.pageTextOf(extracted));
        fs.writeFileSync(path.join(OUT, `${name}-${provider}.json`), JSON.stringify({ provider, model: res.model, usage: res.usage, cost: res.cost, ms: Date.now() - t0, parsed: res.parsed, findings }, null, 2));
        console.log(`${name} ${provider} (${res.model}): ${findings.length} findings, pressure=${res.parsed.overall_pressure}, ${res.usage.input}/${res.usage.output} tokens, $${res.cost}, ${Date.now() - t0}ms`);
        const reading = SubtextAI.screenReading(res.parsed.reading, extracted, packetOpts);
        console.log('   reading: ' + (reading ? reading.lead : '(no supported reading)'));
        for (const f of findings.slice(0, 6)) console.log(`   - [${f.category}] ${f.label}: ${f.why}`);
      } catch (e) { console.log(name, provider, '→ ERROR', e.message); }
    }
    await page.close();
  }
  await ctx.close(); fs.rmSync(ud, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
