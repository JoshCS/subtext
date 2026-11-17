/* End-to-end test: loads the real extension into headless Chromium, serves the fixtures on realistic domains,
   drives the pages (scroll, exit-intent, reload) and asserts which techniques are flagged.
   Usage: node test/run.js [--screens]   (writes screenshots to test/out/) */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const EXT = path.resolve(__dirname, '..', 'extension');
require(path.join(EXT, 'common.js')); const LABELS = require(path.join(EXT, 'rules', 'labels.json'));
const FIX = path.resolve(__dirname, 'fixtures');
const OUT = path.resolve(__dirname, 'out');
const SCREENS = process.argv.includes('--screens');

const PAGES = [
  {
    name: 'shop', file: 'shop.html', url: 'https://dealzone-shop.test/product/ultra-widget',
    expect: ['urgency.deadline_language', 'scarcity.low_stock', 'scarcity.high_demand', 'urgency.price_increase_threat', 'social.join_millions', 'social.bestseller_badges', 'social.activity_feed', 'social.everyone_is', 'social.testimonial_markers',
      'attention.gamification', 'surveillance.personalized_feed', 'surveillance.notification_prompt_language', 'surveillance.email_capture_incentive', 'interpersonal.flattery_love_bombing', 'interpersonal.negging', 'interpersonal.hoovering_winback',
      'bias.anchoring_price_compare', 'bias.charm_pricing', 'bias.per_day_reframing', 'bias.bnpl', 'bias.decoy_tier_badge', 'bias.free_with_conditions', 'bias.monthly_display_annual_billing', 'bias.hidden_fees', 'bias.default_optout_language', 'bias.loss_framing',
      'claims.asterisked_claim', 'claims.guarantee_puffery', 'claims.grandiosity_puffery', 'claims.fake_trust_signals', 'claims.results_disclaimer', 'claims.trust_badge_images',
      'dark.confirmshaming', 'dark.trick_question', 'dark.sneak_into_basket', 'dark.cancellation_friction', 'dark.preselection', 'dark.disguised_ads', 'dark.interrupting_overlay', 'dark.exit_intent_popup',
      'design.red_urgency', 'design.animated_cta', 'design.asymmetric_choice', 'surveillance.consent_no_reject', 'surveillance.notification_preprompt',
      'attention.engagement_feed', 'attention.infinite_scroll', 'attention.autoplay_media', 'urgency.live_countdown', 'urgency.fake_countdown_reset',
      'tracker.session_replay', 'tracker.social_pixel', 'tracker.social_proof_widget', 'tracker.bnpl', 'tracker.popup_capture', 'tracker.urgency_widget', 'tracker.analytics', 'tracker.advertising', 'tracker.native_ads', 'tracker.data_broker', 'incentives.business_model', 'incentives.do_not_sell_link', 'incentives.purchase_path', 'source.unknown_operator', 'surveillance.consent_or_pay', 'policy.sells_personal_info', 'policy.shares_or_sells_ccpa', 'policy.third_party_marketing', 'policy.data_brokers', 'policy.combine_sources', 'policy.precise_location', 'policy.inferences_profiling', 'policy.automated_decisions', 'policy.email_tracking', 'policy.bankruptcy_transfer', 'policy.indefinite_retention', 'policy.opt_out_friction', 'policy.arbitration_class_waiver', 'policy.unilateral_changes'],
    minGrade: 'D', reading: /pressure sale of a digital product/,
    drive: async (page, ctx) => {
      const interact = async () => {
        await page.waitForTimeout(2500); // timed modal appears at 1.8s
        for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 4000); await page.waitForTimeout(400); }
        await page.waitForTimeout(2200);
        await page.evaluate(() => { document.documentElement.dispatchEvent(new MouseEvent('mouseleave', { clientY: -1, bubbles: false })); document.dispatchEvent(new MouseEvent('mouseleave', { clientY: -1 })); });
        await page.waitForTimeout(1500);
      };
      await interact();
      // age the stored countdown so a reload looks like a return visit 10 minutes later
      await ctx.sw.evaluate(async () => { const all = await chrome.storage.local.get(null); for (const k of Object.keys(all)) if (k.startsWith('timer:') && all[k].ts) { all[k].ts -= 600000; await chrome.storage.local.set({ [k]: all[k] }); } });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 15000 });
      await interact();
      await page.waitForTimeout(1500);
    }
  },
  {
    name: 'article', file: 'article.html', url: 'https://citizens-for-truth-institute.org/report/2026/the-truth-about-the-economy',
    expect: ['source.affiliate_links', 'attention.clickbait_curiosity', 'attention.listicle_headline', 'rhetoric.weasel_attribution', 'rhetoric.absolutism', 'rhetoric.obviousness_appeal', 'rhetoric.false_dilemma', 'rhetoric.slippery_slope', 'rhetoric.ad_hominem', 'rhetoric.whataboutism',
      'rhetoric.thought_terminating', 'rhetoric.loaded_question', 'rhetoric.anecdote_as_evidence', 'rhetoric.just_asking_questions', 'rhetoric.cherry_pick_markers', 'rhetoric.percent_vs_points',
      'emotional.outrage_lexicon', 'emotional.fear_lexicon', 'emotional.tribal_labels', 'emotional.dehumanizing', 'emotional.guilt_trip', 'emotional.sensational_formatting',
      'interpersonal.isolation_distrust_others', 'interpersonal.darvo_victim_reversal', 'interpersonal.gaslighting_markers', 'interpersonal.cult_community', 'interpersonal.manufactured_enemy',
      'charts.truncated_bar_axis', 'charts.dual_axis', 'charts.inverted_axis', 'charts.no_source', 'charts.short_window', 'charts.image_chart',
      'dark.disguised_ads', 'tracker.native_ads', 'source.low_transparency', 'source.advocacy_no_funding_disclosure', 'source.unknown_operator', 'source.funded_section'],
    forbid: ['rhetoric.weasel_attribution:sourced'],
    minGrade: 'D', reading: /An ad-funded page/,
    drive: async (page) => { await page.waitForTimeout(1500); }
  },
  {
    name: 'clean', file: 'clean.html', url: 'https://www.theguardian.com/food/2026/nov/04/weeknight-pasta-lemon-peas',
    expect: ['source.ownership', 'policy.no_sale_statement', 'policy.gpc_honoured', 'policy.deletion_right'], maxScore: 20, noSeverity3: true, expectOutlet: 'The Guardian', reading: /^A page from The Guardian[;.]/, readingNot: /owned by|earns from|Scott Trust/, // a recipe does not inherit its publisher's owner (16 Nov 2026)
    drive: async (page) => { await page.waitForTimeout(2500); }
  }
,
  // ---- negative fixtures: the traps real pages showed (eval/corpus-run.js). Words about money, fear or data in the wrong place must not fire.
  // an opinion column with a sponsored-story widget: the widget's outbound links are native ads, not the publisher's commission links (16 Nov 2026, Fox)
  // a paid feature whose sponsor appears only as a logo: the summary line leads with who paid (16 Nov 2026, Guardian Wales rail)
  { name: 'paid-feature', file: 'neg/paid-feature.html', url: 'https://www.dailycourier-news.test/travel/slow-rail', expect: [], reading: /^This item is paid for by Transport for Wales: the page labels it "Paid content"/, drive: async (page) => { await page.waitForTimeout(1500); } },
  // a recipe's book credit is not the site's copyright line (16 Nov 2026, Food Network: 'Operator: Ina Garten, Clarkson Potter/Publisher')
  { name: 'recipe-credit', file: 'neg/recipe-credit.html', url: 'https://www.kitchennotes-recipes.test/recipes/roast-chicken', expect: [], forbid: ['source.named_operator'], readingNot: /Ina Garten|Clarkson/, drive: async (page) => { await page.waitForTimeout(1500); } },
  // a rail of sponsored stories above the article is not this item's paid label
  { name: 'rail-before', file: 'neg/rail-before.html', url: 'https://www.dailycourier-news.test/news/road-budget', expect: [], readingNot: /paid for/i, drive: async (page) => { await page.waitForTimeout(1500); } },
  // product photos from a shop's CDN on a news page do not make it a shop (16 Nov 2026, GMA)
  { name: 'shop-images', file: 'neg/news-shop-images.html', url: 'https://www.morningshow-tv.test/food/baker-cookbook', expect: [], readingNot: /Shopify|sale of products/i, drive: async (page) => { await page.waitForTimeout(1500); } },
  // republished wire copy says whose reporting it is; AP photos alone do not make a story AP's (16 Nov 2026, KSAT)
  { name: 'wire-ap', file: 'neg/wire-ap.html', url: 'https://www.channel9-news.test/news/big-waves', expect: [], reading: /^This is The Associated Press's reporting, republished here/, drive: async (page) => { await page.waitForTimeout(1500); } },
  { name: 'wire-local', file: 'neg/wire-local.html', url: 'https://www.channel9-news.test/local/coast-waves', expect: [], readingNot: /Associated Press|republished/, drive: async (page) => { await page.waitForTimeout(1500); } },
  // "originally published on <date>" is not a source; "originally published by <outlet>" is
  { name: 'note-dated', file: 'neg/note-dated.html', url: 'https://www.dailycourier-news.test/local/library-dated', expect: [], readingNot: /reporting, republished/, drive: async (page) => { await page.waitForTimeout(1500); } },
  { name: 'note-republished', file: 'neg/note-republished.html', url: 'https://www.dailycourier-news.test/region/library-harbor', expect: [], reading: /^This is The Harbor Times's reporting, republished here/, drive: async (page) => { await page.waitForTimeout(1500); } },
  // the owner card opens when the subject touches the owner's interests: a billionaire tax at a billionaire-owned paper (the owner, 16 Nov 2026)
  { name: 'owner-tax', file: 'neg/owner-tax.html', url: 'https://www.washingtonpost.com/opinions/2026/11/06/billionaire-tax-backfire/', expect: [], reading: /^Jeff Bezos owns The Washington Post; it is about taxes on the very wealthy, which touches its owner's interests/, readingNeeds: 'extension/data/owner-interests.json', drive: async (page) => { await page.waitForTimeout(1500); } },
  { name: 'neg-native', file: 'neg/opinion-native-ads.html', url: 'https://www.dailycourier-news.test/opinion/fix-the-bridge', expect: [], forbid: ['source.affiliate_links'], readingNot: /commissioned recommendation|partner links|paid for/i, drive: async (page) => { await page.waitForTimeout(1500); } },
  { name: 'neg-news', file: 'neg/news-index.html', url: 'https://www.dailycourier-news.test/news', policyFile: 'neg/privacy-boilerplate.html', expect: [], forbid: ['policy.arbitration_class_waiver', 'incentives.purchase_path', 'emotional.fear_lexicon', 'emotional.outrage_lexicon', 'rhetoric.ad_hominem', 'urgency.deadline_language', 'social.bestseller_badges', 'bias.anchoring_price_compare', 'claims.unlimited_hedge', 'surveillance.notification_prompt_language', 'source.unknown_operator', 'policy.sells_personal_info', 'policy.shares_or_sells_ccpa', 'policy.indefinite_retention', 'policy.automated_decisions', 'policy.biometric_sensitive', 'policy.precise_location', 'policy.children_data', 'policy.third_party_marketing', 'policy.inferences_profiling'], readingNot: /crypto|gift card|pressure sale|sale of/i, maxScore: 14, drive: async (page) => { await page.waitForTimeout(2500); } },
  { name: 'neg-retail', file: 'neg/retail.html', url: 'https://www.acmegoods-shop.test/p/tote', expect: ['incentives.business_model'], forbid: ['claims.unlimited_hedge', 'source.unknown_operator', 'source.affiliate_links', 'source.low_transparency'], reading: /sale of goods/, readingNot: /gift card|no company name|no address/i, maxScore: 29, drive: async (page) => { await page.waitForTimeout(2000); } },
  { name: 'neg-blog', file: 'neg/blog.html', url: 'https://samsnotes-blog.test/open-systems', expect: [], forbid: ['rhetoric.absolutism', 'rhetoric.obviousness_appeal', 'rhetoric.just_asking_questions', 'rhetoric.whataboutism', 'rhetoric.anecdote_as_evidence', 'rhetoric.cherry_pick_markers', 'social.activity_feed', 'claims.grandiosity_puffery', 'interpersonal.future_faking', 'emotional.sensational_formatting', 'incentives.purchase_path', 'source.low_transparency'], readingNot: /sale|copyright line: (infringement|have)|named as (notices|have)/i, maxScore: 14, drive: async (page) => { await page.waitForTimeout(2000); } },
  { name: 'neg-gov', file: 'neg/gov.html', url: 'https://www.examplehealth.gov/flu', expect: [], forbid: ['source.unknown_operator', 'urgency.deadline_language', 'interpersonal.hoovering_winback', 'surveillance.notification_prompt_language', 'source.low_transparency'], reading: /US government site/, maxScore: 14, drive: async (page) => { await page.waitForTimeout(2000); } },
  { name: 'neg-pricing', file: 'neg/pricing.html', url: 'https://www.teamly.test/pricing', expect: ['incentives.purchase_path'], forbid: ['source.unknown_operator', 'dark.no_cancel_path', 'bias.hidden_fees'], reading: /A sale of a subscription.*per seat.*setup fee of \$3,000/, readingNot: /payment methods not shown/, maxScore: 29, drive: async (page) => { await page.waitForTimeout(2000); } },
  { name: 'neg-lazyfooter', file: 'neg/lazyfooter.html', url: 'https://www.lensly.test/round', policyFile: 'neg/policy-named.html', expect: ['incentives.business_model'], forbid: ['source.unknown_operator', 'policy.precise_location'], reading: /A sale of goods.*names Lensly Eyewear Inc/, readingNot: /no company name/, maxScore: 29, drive: async (page) => { await page.waitForTimeout(6000); } },
  { name: 'neg-indie', file: 'neg/indie.html', url: 'https://www.practicallayout.test/', expect: ['incentives.purchase_path'], forbid: ['source.unknown_operator', 'dark.no_cancel_path', 'dark.content_gate'], reading: /sale of a digital product.*Gumroad.*refund terms stated/, maxScore: 29, drive: async (page) => { await page.waitForTimeout(2000); } }
];
const GRADES = ['A', 'B', 'C', 'D', 'F'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const userDataDir = path.join(OUT, 'profile-' + Date.now());
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true, channel: 'chromium', viewport: { width: 1200, height: 800 }, deviceScaleFactor: SCREENS ? 2 : 1,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await require('./hooks')(sw);
  const extId = new URL(sw.url()).host;
  await context.route('**/*', (route) => {
    const req = route.request(); const u = req.url();
    if (u.startsWith('chrome-extension://') || u.startsWith('data:')) return route.continue();
    const fixture = PAGES.find((p) => u.startsWith(p.url));
    if (fixture && req.resourceType() === 'document') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, fixture.file), 'utf8') });
    { const owner = PAGES.find((p) => p.policyFile && new URL(u).hostname === new URL(p.url).hostname && /\/(privacy|terms)/.test(new URL(u).pathname)); if (owner) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, owner.policyFile), 'utf8') }); }
    if (/^https:\/\/dealzone-shop\.test\/(privacy|terms)/.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, 'privacy.html'), 'utf8') });
    if (/^https:\/\/www\.theguardian\.com\/info\/privacy/.test(u)) return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(FIX, 'privacy-clean.html'), 'utf8') });
    return route.abort();
  });

  let failures = 0; const summary = [];
  for (const spec of PAGES) {
    const page = await context.newPage();
    const swallowed = []; page.on('console', (m) => { if (/\[Subtext\].*fail/i.test(m.text())) swallowed.push(m.text().slice(0, 300)); });
    await page.goto(spec.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.documentElement.dataset.mlScanned != null, null, { timeout: 20000 });
    await spec.drive(page, { sw, context });
    // Policy findings come from a background fetch of the privacy page and can land after the fixed drive wait when the machine
    // is busy (16 Nov 2026: 'clean' lost its three policy findings while eval runs loaded the CPU). Wait for those ids only, up to
    // 15 s; waiting on page findings too let later rescans drop findings the drive had produced (the shop's dismissed overlay).
    const late = spec.expect.filter((id) => /^policy\./.test(id));
    for (const until = Date.now() + 15000; late.length && Date.now() < until; await page.waitForTimeout(300)) {
      const got = await sw.evaluate((url) => handle({ type: 'testStateByUrl', url }, {}), spec.url).catch(() => null);
      const st = got && got.state, rep = st && st.report;
      const have = new Set((rep ? (rep.findings || []).concat(rep.held || []) : []).concat((st && st.outletFindings) || []).map((f) => f.id));
      if (late.every((id) => have.has(id))) break;
    }
    // ask the content script for the latest report and the background for the composite state
    // content scripts live in an isolated world, so read the report through the background's per-tab state
    const { state } = await sw.evaluate((url) => handle({ type: 'testStateByUrl', url }, {}), spec.url);
    const report = (state && state.report) || await sw.evaluate(async (url) => { const tabs = await chrome.tabs.query({ url }); return tabs[0] ? chrome.tabs.sendMessage(tabs[0].id, { type: 'getReport' }) : null; }, spec.url);
    if (!report) throw new Error('no report for ' + spec.url);
    const findings = (report.findings || []).concat((state && state.outletFindings) || []);
    const everything = findings.concat(report.held || []); const ids = new Set(everything.map((f) => f.id)); // a held rule still runs; its fixture proves that, the panel just does not show it
    const score = (function (fs) { let w = 0; for (const f of fs) if (f.severity > 0) w += f.severity * (f.confidence == null ? 0.7 : f.confidence) * Math.sqrt(Math.min(f.count || 1, 6)); const s = Math.round(100 * (1 - Math.exp(-w / 14))); return { score: s, grade: s < 15 ? 'A' : s < 30 ? 'B' : s < 50 ? 'C' : s < 70 ? 'D' : 'F' }; })(findings);
    const missing = spec.expect.filter((id) => !ids.has(id));
    const problems = [];
    if (missing.length) problems.push('missing: ' + missing.join(', '));
    
    if (spec.maxScore != null && score.score > spec.maxScore) problems.push('score ' + score.score + ' above ' + spec.maxScore + ' — findings: ' + findings.map((f) => f.id + '(' + f.severity + ')').join(', '));
    // gates: nothing swallowed by the engine's try/catch, the reading builds, and both surfaces render it
    if (swallowed.length) problems.push('swallowed errors: ' + swallowed.join(' | '));
    let readingText = ''; try { const F = findings.map((f) => Object.assign({}, f, MLCommon.labelFor(f, LABELS), { weight: MLCommon.findingWeight(f) })).sort((a, b) => b.severity - a.severity || b.weight - a.weight); readingText = MLCommon.reading(F, Object.assign({}, state, { report })).text; } catch (e) { problems.push('reading() threw: ' + e.message); }
    // a reading built from a data file that is held out of this copy (docs/PUBLISHING.md) cannot be checked here: say so, and run every other check on the page
    const readingHeld = spec.readingNeeds && !fs.existsSync(path.join(__dirname, '..', spec.readingNeeds));
    if (readingHeld) console.log('skipped: ' + spec.readingNeeds + ' is not in this copy (' + spec.name + ': the expected reading)');
    else if (spec.reading && !spec.reading.test(readingText)) problems.push('reading does not match ' + spec.reading + ': ' + readingText);
    if (spec.readingNot && spec.readingNot.test(readingText)) problems.push('reading says what it must not (' + spec.readingNot + '): ' + readingText);
    for (const id of spec.forbid || []) { if (id.includes(':')) continue; const hit = everything.find((f) => f.id === id && f.severity > 0); if (hit) problems.push('false alarm ' + id + ': ' + JSON.stringify((hit.evidence[0] || {}).quote || '').slice(0, 120)); }
    console.log('   reading: ' + readingText);
    const tabsNow = await sw.evaluate(() => chrome.tabs.query({})); const thisTab = tabsNow.find((t) => t.url === spec.url);
    if (thisTab) {
      const pop = await context.newPage(); const popErrors = []; pop.on('pageerror', (e) => popErrors.push(String(e).slice(0, 200)));
      await pop.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${thisTab.id}`); await pop.waitForTimeout(500);
      const popText = await pop.evaluate(() => (document.querySelector('.reading__t') || {}).textContent || ''); await pop.close();
      if (popErrors.length) problems.push('popup errors: ' + popErrors.join(' | ')); if (!popText) problems.push('popup did not render the reading');
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'togglePanel', on: true }), thisTab.id); await page.waitForTimeout(300);
      const cdp = await context.newCDPSession(page); const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); const hasPanelReading = JSON.stringify(root).includes('reading__t'); await cdp.detach().catch(() => {});
      await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'togglePanel', on: false }), thisTab.id);
      if (!hasPanelReading) problems.push('panel did not render the reading');
    }
    if (spec.noSeverity3 && findings.some((f) => f.severity >= 3)) problems.push('severity-3 finding on clean page: ' + findings.filter((f) => f.severity >= 3).map((f) => f.id).join(', '));
    if (spec.expectOutlet && !(state && state.outlet && state.outlet.entry.name === spec.expectOutlet)) problems.push('outlet lookup failed (got ' + (state && state.outlet ? state.outlet.entry.name : 'none') + ')');
    if (spec.name === 'article') {
      const weasel = findings.find((f) => f.id === 'rhetoric.weasel_attribution');
      if (weasel && weasel.evidence.some((e) => /bls\.gov|studies show/i.test(e.quote) && /studies show/.test(e.match || ''))) problems.push('sourced "studies show" (with link) was wrongly flagged');
    }
    const extra = findings.map((f) => f.id).filter((id) => !spec.expect.includes(id));
    summary.push({ page: spec.name, score: score.score, grade: score.grade, findings: findings.length, expected: spec.expect.length, missing: missing.length, extra, outlet: state && state.outlet ? state.outlet.entry.name : '-', scanMs: report.meta.scanMs, textChars: report.meta.textChars });
    if (problems.length) { failures++; console.log(`\n✗ ${spec.name}: ` + problems.join(' | ')); } else console.log(`\n✓ ${spec.name}: ${findings.length} findings, score ${score.score} (${score.grade})`);
    if (extra.length) console.log(`   unexpected (review for false positives): ${extra.join(', ')}`);
    if (SCREENS) {
      const tabs = await sw.evaluate(() => chrome.tabs.query({}));
      const tab = tabs.find((t) => t.url === spec.url);
      if (tab) {
        // in-page panel (shadow root) open, with the strongest finding located on the page
        await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'togglePanel', on: true }), tab.id);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(OUT, `${spec.name}-page.png`) });
        await sw.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'togglePanel', on: false }), tab.id);
        const popup = await context.newPage();
        await popup.setViewportSize({ width: 400, height: 640 });
        await popup.goto(`chrome-extension://${extId}/popup/popup.html?tabId=${tab.id}&tall=1`);
        await popup.waitForTimeout(900);
        await popup.evaluate(() => document.querySelectorAll('.cat').forEach((c, i) => { if (i < 3) c.classList.add('open'); const f = c.querySelector('.f'); if (f && i < 2) f.classList.add('open'); }));
        await popup.screenshot({ path: path.join(OUT, `${spec.name}-popup.png`), fullPage: true });
        await popup.close();
        // hover tooltip: rest the mouse on the strongest flagged element (no outlines are drawn; the tooltip is the only cue)
        const elIds = findings.filter((f) => f.severity > 0).sort((a, b) => b.severity - a.severity).flatMap((f) => f.evidence.map((e) => e.elId)).filter(Boolean);
        const hovered = await page.evaluate((ids) => { for (const id of ids) { const t = document.querySelector('[data-ml-id="' + id + '"]'); if (!t || !t.checkVisibility()) continue; t.scrollIntoView({ block: 'center' }); const r = t.getBoundingClientRect(); return { x: r.left + Math.min(40, r.width / 2), y: r.top + Math.min(12, r.height / 2) }; } return null; }, elIds);
        if (hovered) { await page.mouse.move(hovered.x, hovered.y); await page.waitForTimeout(600); await page.screenshot({ path: path.join(OUT, `${spec.name}-hover.png`) }); }
      }
    }
    fs.writeFileSync(path.join(OUT, `${spec.name}-report.json`), JSON.stringify({ report, outlet: state && state.outlet, outletFindings: state && state.outletFindings }, null, 2));
    await page.close();
  }
  console.log('\nSummary:'); console.table(summary.map((s) => ({ page: s.page, score: s.score, grade: s.grade, findings: s.findings, expected: s.expected, missing: s.missing, outlet: s.outlet, scanMs: s.scanMs, textChars: s.textChars })));
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  if (failures) { console.log(failures + ' page(s) failed'); process.exit(1); }
  console.log('all fixture pages passed');
})().catch((e) => { console.error(e); process.exit(1); });
