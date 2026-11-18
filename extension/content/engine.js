/* Engine: loads rules, runs detectors, scores, reports to background, handles popup messages, feeds the in-page UI. */
(function () {
  const ML = window.ML;
  if (window.top !== window) return;
  if (!/^https?:$/.test(location.protocol)) return;

  const persistent = new Map(); // behavior findings (survive rescans)
  let ctx = null, lastReport = null, settings = {};
  let rescanTimer = null, scanning = false, pageObserver = null; let tiers = {}; let checkedFacts = {};
  // A route is the URL without its fragment, unless the fragment is the route (#/orders, #!/orders): a jump to an anchor is the same page. background.js keeps the same rule.
  const routeOf = (u) => { const s = String(u || ''), i = s.indexOf('#'); if (i < 0) return s; const frag = s.slice(i + 1); return frag.startsWith('/') || frag.startsWith('!') ? s : s.slice(0, i); };
  let route = routeOf(location.href);
  const OUTLET_WAIT_MS = 4000; // how long the first scan waits for the ownership answer while the background worker wakes
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function init() {
    if (!document.body || (document.contentType && !/html/i.test(document.contentType))) return; // an SVG or XML document has no page to read
    try {
      const [rules, domConfig, trackers, policyRules, labels, reliability, scamPatterns] = await Promise.all([ML.loadJSON('rules/text-rules.json'), ML.loadJSON('rules/dom-config.json'), ML.loadJSON('rules/trackers.json'), ML.loadJSON('rules/policy-rules.json'), ML.loadJSON('rules/labels.json'), ML.loadJSON('rules/reliability.json'), ML.loadJSON('rules/scam-patterns.json').catch(() => null)]);
      tiers = (reliability && reliability.tiers) || {}; checkedFacts = (reliability && reliability.checkedFacts) || {};
      ML.labels = labels;
      settings = (await ML.storage.get('settings')) || {}; delete settings.anthropicKey; delete settings.openaiKey; delete settings.apiKey; ML.testHooks = !!settings.testHooks;
      if (ML.ui) ML.ui.setSettings(settings);
      const disabled = new Set(settings.disabledCategories || []);
      const site = location.hostname.replace(/^www\./, '');
      if ((settings.disabledSites || []).some((s) => site === s || site.endsWith('.' + s))) return;
      ctx = { rules, domConfig, trackers, policyRules, labels, scamPatterns, disabled, onBehavior: onBehavior, onAsyncFindings: onAsyncFindings, settings, requestRescan: scheduleRescan, outlet: null, route: 0 };
      if (settings.autoScan === false) return;
      const answered = ML.hasChrome ? lookupOutlet(0) : null;
      const delay = (domConfig.scanning && domConfig.scanning.initialDelayMs) || 1200;
      // the first scan waits for the ownership answer, so a known outlet is not read as an unnamed site while the worker wakes
      await Promise.all([wait(delay), answered ? Promise.race([answered, wait(OUTLET_WAIT_MS)]) : null]);
      if (!ctx) return; // muted while waiting
      run('initial'); ML.detectors.behavior.install(ctx); watchMutations();
    } catch (e) { console.warn('[Subtext] init failed', e); }
  }

  // the ownership dataset lives in the background; ask up to three times (a worker that is still starting, or a failed
  // file read, answers with an error) and rescan when a late answer changes what the provenance checks should do.
  // Resolves once there is an answer or the attempts run out.
  function lookupOutlet(attempt) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'lookupOutlet', hostname: location.hostname }, (r) => {
          void chrome.runtime.lastError;
          if (!ctx) { resolve(); return; }
          if (!r || r.error) { if (attempt < 3) setTimeout(() => lookupOutlet(attempt + 1).then(resolve), 1500 * (attempt + 1)); else resolve(); return; }
          const had = !!ctx.outlet; ctx.outlet = r.outlet || null; ctx.outletChecked = true; resolve();
          if (!had && ctx.outlet && lastReport) scanAfter(300, 'outlet'); // a tab in the background must not keep the unnamed reading
        });
      } catch (e) { resolve(); /* extension reloaded */ }
    });
  }
  function scanAfter(ms, reason) { clearTimeout(rescanTimer); rescanTimer = setTimeout(() => { rescanTimer = null; run(reason); }, ms); }

  // A single-page app changed the address without a new document: this is another page, so nothing measured on the last one carries over.
  function routeChanged() {
    const now = routeOf(location.href); if (now === route) return false; route = now;
    if (!ctx) return true;
    persistent.clear(); ctx.route++;
    Object.assign(ctx, { lastFindings: new Map(), index: null, errorPage: false, commerce: null, transaction: null, asks: null, pageKind: null, isArticle: false, chartAssets: [], choiceLayout: [], choiceCandidates: [], citations: [], choiceRead: null, postRead: null, claimRecords: [], policyEntity: null, policyEntityKind: null, shopFacts: null, scanMs: 0 });
    try { ML.detectors.incentives.reset(); ML.detectors.behavior.reset(ctx); } catch (e) { console.warn('[Subtext] route reset failed', e); }
    if (settings.autoScan === false && !lastReport) return true; // scanning is manual here: nothing to clear, nothing to start
    if (settings.autoScan !== false) scanAfter(ctx.domConfig.scanning.initialDelayMs || 1200, 'route'); // the new route's content is usually still arriving
    report('route');
    return true;
  }
  const onRouteEvent = () => { routeChanged(); };

  function onBehavior(list) {
    for (const f of list) persistent.set(f.id, f);
    report('behavior');
  }
  function onAsyncFindings(list) {
    for (const f of list) persistent.set(f.id, f);
    report('async');
  }

  function isErrorPage(index) {
    const { errorTitlePattern, bodyBlockPattern } = ctx.domConfig;
    const title = document.title.trim();
    return (index.chars < 4000 && (!title || new RegExp(errorTitlePattern, 'i').test(title))) ||
      (index.chars < 1500 && !!bodyBlockPattern && new RegExp(bodyBlockPattern, 'i').test(index.fullText));
  }

  function run(reason) {
    if (!ctx || scanning || routeChanged()) return;
    scanning = true;
    const t0 = performance.now();
    const found = new Map();
    try {
      ctx.index = ML.buildTextIndex({ maxChars: ctx.domConfig.scanning.maxTextChars });
      ctx.errorPage = isErrorPage(ctx.index);
      // Only a distinctive passage in the body can bring in an outside record. A comment,
      // sidebar or list of related headlines is not the item the reader is looking at.
      ctx.claimRecords = !ctx.errorPage && /trillion/i.test(ctx.index.fullText) ? SubtextClaims.forPage({
        url: location.href, title: document.title,
        mainText: ctx.index.blocks.filter(b => !b.synthetic && ['body','quote'].includes(b.region)).map(b => b.text).join('\n').slice(0, 60000)
      }) : [];
      ctx.citations = ctx.errorPage ? [] : citations();
      ctx.postRead = !ctx.errorPage && !ctx.disabled.has('attention') ? readPost() : null;
      ctx.choiceRead = null;
      ctx.commerce = ML.commerceSignals(ctx); ctx.shopFacts = null; ctx.unnamedThirdParty = null;
      const order = ['text', 'dom', 'charts', 'trackers', 'transparency', 'transaction', 'incentives', 'provenance', 'shoptraits', 'scampatterns'];
      ctx.lastFindings = found; // detectors later in the order may read and adjust what earlier ones found
      ctx.lastFindingsHas = (id) => found.has(id);
      for (const name of order) {
        if (!ML.detectors[name]) continue;
        try { for (const f of ML.detectors[name](ctx)) ML.mergeFinding(found, f); }
        catch (e) { console.warn('[Subtext] detector failed:', name, e); }
      }
      if (!ctx.errorPage && !(settings.disabledRules || []).includes('design.asymmetric_choice') && !ctx.disabled.has('design_psych')) {
        ctx.choiceRead = SubtextInvestigate.choice(ctx.choiceLayout);
      }
    } catch (e) { console.warn('[Subtext] scan failed', e); }
    ctx.lastFindings = found;
    ctx.scanMs = Math.round(performance.now() - t0);
    scanning = false;
    report(reason);
  }

  function allFindings() {
    const out = new Map(ctx && ctx.lastFindings ? ctx.lastFindings : []);
    for (const [id, f] of persistent) ML.mergeFinding(out, f);
    const mutedRules = new Set(settings.disabledRules || []);
    return Array.from(out.values()).filter((f) => (!ctx || !ctx.disabled.has(f.category)) && !mutedRules.has(f.id));
  }

  // "Don't scan this site": everything stops now, not at the next reload
  function muteNow() {
    if (ctx) ctx.stopped = true; // detectors hold this object: a fetch or lookup still in flight checks it before going further
    if (ML.ui) ML.ui.shutdown(); ctx = null; lastReport = null; persistent.clear(); clearTimeout(rescanTimer);
    try { if (pageObserver) pageObserver.disconnect(); } catch (e) { /* ignore */ }
    removeEventListener('popstate', onRouteEvent); removeEventListener('hashchange', onRouteEvent);
    try { ML.detectors.behavior.uninstall(); } catch (e) { /* ignore */ }
  }
  function report(reason) {
    if (!ctx) return; // muted, or a late callback after muting
    if (routeChanged()) return; // that call has already reported the cleared state
    // only rules that have proved reliable reach the reader; the rest keep running so they can earn their way back (rules/reliability.json)
    const findings = [], held = [];
    for (const f of allFindings()) {
      const fact = !!(checkedFacts[f.id] && f.meta && f.meta[checkedFacts[f.id]]); // a statement of plain facts about the page whose truth is measured (eval/fact-check.py) shows at its own weight
      const tier = fact || f.source === 'ai' || /^ai\./.test(f.id) ? 'flag' : (tiers[f.id] || (/\.negated$/.test(f.id) ? 'note' : 'hold'));
      // a flag must show something the reader can check; a claim with no evidence is a quiet note at most
      const evidenced = (f.evidence || []).some((x) => String((x && x.quote) || '').trim());
      // an error page has nothing to read, so what its policy pages say and which vendors it loads (also read as "paid with your data") is a note, not a warning about this page
      if (tier === 'flag' && f.severity > 0 && ctx.errorPage && (f.source === 'policy' || /^(policy|tracker)\.|^incentives\.you_are_the_product$/.test(f.id))) findings.push(Object.assign({}, f, { severity: 0, meta: Object.assign({}, f.meta, { tier: 'note', errorPage: true, judgedSeverity: f.severity }) }));
      else if (tier === 'flag' && f.severity > 0 && !evidenced) findings.push(Object.assign({}, f, { severity: 0, meta: Object.assign({}, f.meta, { tier: 'note', noEvidence: true, judgedSeverity: f.severity }) }));
      else if (tier === 'flag') findings.push(f);
      else if (tier === 'note') findings.push(Object.assign({}, f, { severity: 0, meta: Object.assign({}, f.meta, { tier: 'note', judgedSeverity: f.severity }) }));
      else if (settings.showUnproven) findings.push(Object.assign({}, f, { severity: 0, meta: Object.assign({}, f.meta, { tier: 'hold', unproven: true }) }));
      else held.push(f);
    }
    const score = ML.scoreFindings(findings);
    lastReport = {
      type: 'findings', reason, url: location.href, hostname: location.hostname, title: document.title, findings, held, score, provenance: (ctx && ctx.provenance) || null, transaction: (ctx && ctx.transaction) || null,
      meta: { ...(() => { const links = ctx && ctx.outlet && ctx.outlet.entry && ctx.index ? MLCommon.ownerRelevance(ctx.outlet.entry, { title: document.title, headings: Array.from(document.querySelectorAll('h1, h2')).slice(0, 20).map((h) => (h.innerText || '').trim()).filter(Boolean), text: mainText() }) : []; return { ownerLinks: links, ownerMentions: links.filter((l) => l.via === 'named').map((l) => l.label) }; })(), paidItem: paidItem(), wire: ctx && ctx.index ? wireCopy(mainText()) : null, citations: ctx.citations || [], choiceRead: ctx.choiceRead || null, postRead: ctx.postRead || null, claimRecords: ctx.claimRecords || [], textChars: ctx && ctx.index ? ctx.index.chars : 0, scanMs: ctx ? ctx.scanMs : 0, isArticle: !!(ctx && ctx.isArticle), pageKind: (ctx && ctx.pageKind) || 'page', asks: (ctx && ctx.asks) || null, commerce: (ctx && ctx.commerce) || null, shop: (ctx && ctx.shopFacts) || null, errorPage: !!(ctx && ctx.errorPage), thirdPartyDomains: (ctx && ctx.thirdPartyDomains || []).length, unnamedThirdParty: (ctx && ctx.unnamedThirdParty) || [], charts: (ctx && ctx.chartAssets || []).length, ts: Date.now(), version: ML.VERSION }
    };
    window.__ML_LAST = lastReport;
    if (ML.testHooks) document.documentElement.dataset.mlScanned = String(findings.length);
    // the background adds outlet ownership and any AI findings and hands the composite state back for the panel
    const mine = lastReport;
    if (ML.hasChrome) {
      // no answer means the worker is waking: the panel still names a known outlet, and the report is sent once more
      const send = (retry) => chrome.runtime.sendMessage(mine, (r) => { void chrome.runtime.lastError; if (mine !== lastReport || (r && r.muted)) return; if (r && r.state) { showState(r.state); return; } showState({ report: mine, outlet: ctx ? ctx.outlet : null }); if (retry) setTimeout(() => { if (mine === lastReport) try { send(false); } catch (e) { /* extension reloaded */ } }, 500); });
      try { send(true); }
      catch (e) { showState({ report: lastReport, outlet: ctx.outlet }); }
    } else showState({ report: lastReport });
  }
  function showState(state) { try { if (ML.ui) ML.ui.update(state, ctx); } catch (e) { console.warn('[Subtext] ui failed', e); } }

  function scheduleRescan(delay) {
    if (!ctx) return;
    const wait = delay || ctx.domConfig.scanning.rescanDebounceMs;
    if (rescanTimer) { if (!delay) return; clearTimeout(rescanTimer); }
    rescanTimer = setTimeout(() => { rescanTimer = null; if (document.visibilityState === 'visible') run('mutation'); }, wait);
  }
  function watchMutations() {
    addEventListener('popstate', onRouteEvent); addEventListener('hashchange', onRouteEvent);
    const mo = pageObserver = new MutationObserver((muts) => {
      if (routeChanged()) return;
      const uiHost = ML.ui && ML.ui.host();
      for (const m of muts) { if (uiHost && (m.target === uiHost || Array.from(m.addedNodes).includes(uiHost))) continue; scheduleRescan(); return; }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden'] });
  }

  // ---- extraction for deep (LLM) analysis -----------------------------------
  // Visible text reaches the model (the text index skips hidden nodes), so hidden prompt-injection text is excluded. Two exceptions, both
  // labelled: sections the reader can open (closed <details> and aria-controlled accordions, collapsedSections) and a sponsor's name
  // from the alt text or link label of the logo beside a paid label (paidItem).
  // The in-page UI lives in a shadow root, so the text walker never sees it.
  function mainText(idx) {
    idx = idx || (ctx && ctx.index) || ML.buildTextIndex({ maxChars: 200000 });
    const cands = Array.from(document.querySelectorAll('article, main, [role="main"], [class*="article-body" i], [class*="story-body" i], [class*="post-content" i], [class*="entry-content" i], [itemprop="articleBody"]'));
    let best = null, bestLen = 0;
    for (const c of cands) { const l = (c.innerText || '').length; if (l > bestLen) { best = c; bestLen = l; } }
    const root = bestLen > 800 ? best : null;
    const parts = [];
    for (const b of idx.blocks) { if (b.synthetic) continue; if (root && !root.contains(b.el)) continue; if (b.el.closest && b.el.closest('nav,footer')) continue; parts.push(b.text); }
    let text = parts.join('\n');
    if (text.length < 300) text = idx.blocks.filter((b) => !b.synthetic).map((b) => b.text).join('\n'); // the chosen container held little: use all visible text
    return text.slice(0, 60000);
  }
  // Is THIS item paid for? A short label near the top ("Paid for by", "Paid content", "This article is presented by", "Advertisement feature"),
  // outside sidebars, footers and sponsored-story widgets. A sponsored link elsewhere on the page is not this. The sponsor comes from the
  // label's own words ("presented by TC Brand Studio"), else from the logo beside it (image alt, link label), else the logo link's site:
  // the Guardian prints the sponsor only as a logo (16 Nov 2026 review: "the page names no company as sponsor" was wrong).
  const PAID_LABEL = /^(?:this (?:article|content|story|post|page|feature) (?:is|was) (?:presented|paid for|sponsored|produced|funded) (?:by|in partnership with)|paid for by|paid content|paid partnership|paid post|sponsored content|sponsored by|sponsored post|presented by|in partnership with|advertisement features?|advertiser content|partner content|branded content|advertorial|brand studio|this is paid content)\b/i;
  const PAID_SKIP = 'nav,footer,[role="navigation"],[id*="taboola" i],[class*="taboola" i],[id*="outbrain" i],[class*="outbrain" i],[class*="related" i],[class*="newsletter" i]';
  function paidItem() {
    try {
      const paras = Array.from(document.querySelectorAll('article p, main p, [role="main"] p')).filter((p) => (p.innerText || '').trim().length > 80);
      const limit = paras[2] || paras[paras.length - 1] || null; // the label must come before the third real paragraph
      const els = Array.from(document.querySelectorAll('body *')).slice(0, 6000); let found = null;
      for (const el of els) {
        if (el.children.length > 3) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (!t || t.length > 220 || !PAID_LABEL.test(t)) continue;
        if (Array.from(el.children).some((c) => PAID_LABEL.test((c.innerText || '').replace(/\s+/g, ' ').trim()))) continue; // the innermost label, not a block that also holds the logo link
        if (el.closest(PAID_SKIP) || !ML.isVisibleNow(el)) continue;
        // a side column can carry the item's own label (the Guardian prints "Paid for by" and the logo in an <aside>); a rail of other
        // stories cannot: skip an aside that lists three or more teaser links
        { const side = el.closest('aside,[role="complementary"]'); if (side && Array.from(side.querySelectorAll('a[href]')).filter((a) => (a.innerText || '').trim().length > 25).length >= 3) continue; }
        if (limit && !(el.compareDocumentPosition(limit) & Node.DOCUMENT_POSITION_FOLLOWING) && !limit.contains(el)) continue;
        let sponsor = '';
        const m = t.match(/\b(?:by|with)\s+([^.;|\n]{2,60})/i); if (m && !/^(?:an? |the )?advertiser\b/i.test(m[1])) sponsor = m[1].replace(/\s+(?:and|is|this|the guardian labs).*$/i, '').trim();
        if (!sponsor) {
          let box = el.parentElement;
          for (let i = 0; i < 2 && box && !sponsor; i++, box = box.parentElement) {
            const link = Array.from(box.querySelectorAll('a[href]')).find((a) => !el.contains(a) && (el.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) && !/content-funding|\/info\/|about/i.test(a.getAttribute('href') || ''));
            if (!link) continue;
            const img = link.querySelector('img[alt]'); const alt = img && img.getAttribute('alt').trim();
            const aria = (link.getAttribute('aria-label') || '').replace(/^visit (?:the )?/i, '').replace(/ website$/i, '').trim();
            let host = ''; try { host = new URL(link.href).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
            sponsor = alt || aria || (link.innerText || '').trim().slice(0, 60) || host;
          }
        }
        // the first label decides that the item is paid; a later label beside a logo can still name who paid (the Guardian shows
        // "Paid content" at the top and "Paid for by" with the logo below it)
        if (!found) found = { label: t.slice(0, 120), sponsor: sponsor.slice(0, 80) };
        else if (!found.sponsor && sponsor) found.sponsor = sponsor.slice(0, 80);
        if (found.sponsor) return found;
      }
      return found;
    } catch (e) { /* a page quirk must not stop the scan */ }
    return null;
  }
  // Text the reader can open but the visible-text index skips: closed <details> and accordion panels behind a collapsed button
  // (FAQ answers, plan terms). Sent to the AI labelled as collapsed, so "the page does not say" is checked against it (16 Nov 2026
  // review: a course page's "unanswered" price questions may have been answered inside collapsed FAQs). Only user-openable
  // sections: hidden text with no control to open it stays out, as before.
  function collapsedSections() {
    const out = []; let room = 5000;
    const push = (q, a) => { q = ML.normText(q || '').slice(0, 160); a = ML.normText(a || '').slice(0, 500); if (!a || a.length < 12 || room <= 0 || out.some((x) => x.answer === a)) return; room -= q.length + a.length; out.push({ question: q, answer: a }); };
    try {
      for (const d of Array.from(document.querySelectorAll('details:not([open])')).slice(0, 40)) {
        if (d.closest('nav,footer,[aria-hidden="true"]')) continue;
        const sum = d.querySelector('summary'); const clone = d.cloneNode(true); const cs = clone.querySelector('summary'); if (cs) cs.remove();
        push(sum && sum.textContent, clone.textContent);
      }
      for (const b of Array.from(document.querySelectorAll('[aria-expanded="false"][aria-controls]')).slice(0, 60)) {
        if (b.closest('nav,header,footer') || !ML.isVisibleNow(b)) continue;
        const panel = document.getElementById(b.getAttribute('aria-controls')); if (!panel || panel.contains(b)) continue;
        push(b.textContent, panel.textContent);
      }
    } catch (e) { /* a page quirk must not stop the excerpt */ }
    return out.slice(0, 16);
  }
  // Whose reporting is this? A wire agency's byline or copyright line ("Associated Press", "Copyright 2026 The Associated Press"), a
  // "(Reuters) -" dateline, or "originally published by X" means the outlet republished someone else's reporting (16 Nov 2026 review:
  // an AP story on a local TV site was never named as AP copy). Photo credits ("AP Photo/...") do not count. Skipped on the agency's own site.
  const WIRE = [
    ['The Associated Press', /^(?:by )?(?:the )?associated press$|^copyright \d{4}\.? the associated press\b|\(AP\) [—–-]/i, /(^|\.)apnews\.com$/],
    ['Reuters', /^(?:by )?reuters$|\(Reuters\) [—–-]|^copyright \d{4}\.? reuters\b|^thomson reuters$/i, /(^|\.)reuters\.com$/],
    ['AFP', /^(?:by )?(?:afp|agence france-presse)$|\(AFP\) [—–-]|^copyright \d{4}\.? (?:afp|agence france-presse)\b/i, /(^|\.)afp\.com$/]
  ];
  function wireCopy(text) {
    try {
      const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l && l.length < 200);
      for (const [name, re, home] of WIRE) { if (home.test(location.hostname)) continue; const hit = lines.find((l) => re.test(l) && !/\bphoto\b/i.test(l)); if (hit) return { source: name, line: hit.slice(0, 160) }; }
      const orig = String(text || '').match(/\b(?:(?:this (?:story|article|post) (?:was|is) )?(?:originally|first) (?:published|appeared) (?:in|on|by|at)|republished (?:from|with permission from|courtesy of))\s+([A-Z][^.\n]{2,70})/);
      // a date, a year or a book is not a source of reporting ("originally published on November 3", "first published in Cooking at Home, 2019")
      const src = orig && orig[1].replace(/[,;:(].*$/, '').split(/\s+(?:and|with|under|which|where|who|on|in|at|as)\s+/)[0].trim();
      if (src && !/^(?:January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b|^\d/.test(src) && !/\b(?:book|cookbook|novel|edition|press|publishing|anthology)\b/i.test(orig[0] + ' ' + src) && !/\b(?:in|on) (?:the )?(?:book|print)\b/i.test(orig[0])) return { source: src, line: orig[0].slice(0, 160) };
    } catch (e) { /* a page quirk must not stop the scan */ }
    return null;
  }
  const statusHost = /^(?:www\.)?(?:x|twitter)\.com$/;
  const statusPath = path => /^\/\w+\/status\/\d+\/?$/i.test(path) ? path.replace(/\/$/, '').toLowerCase() : null;
  const postVisible = el => !el.closest('[aria-hidden="true"],[hidden],[contenteditable],[inert]') && ML.isVisibleNow(el);

  function readablePostBody(body) {
    return body && postVisible(body) && !body.querySelector('article,blockquote,[contenteditable],textarea,input');
  }

  // The linked timestamp identifies the item on a status route. A reply, embedded
  // quote, or second visible copy cannot supply its body or attribution.
  function statusPost(path) {
    if (!path) return null;
    let match = null;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      if (article.parentElement.closest('article') || !postVisible(article)) continue;
      const ownVisible = el => el.closest('article') === article && postVisible(el);
      const time = Array.from(article.querySelectorAll('a[href] time')).find(t => {
        const link = t.closest('a[href]');
        return ownVisible(t) && link.protocol === 'https:' && statusHost.test(link.hostname) && statusPath(link.pathname) === path;
      });
      if (!time) continue;
      if (match) return null;
      match = { article, time, ownVisible };
    }
    if (!match) return null;
    const { article, time, ownVisible } = match;
    const bodies = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).filter(ownVisible);
    if (bodies.length !== 1 || !readablePostBody(bodies[0])) return null;
    const authors = Array.from(article.querySelectorAll('[data-testid="User-Name"]')).filter(ownVisible);
    return { body: bodies[0], time, author: authors.length === 1 ? authors[0] : null };
  }

  function readPost() {
    let body;
    if (statusHost.test(location.hostname)) {
      body = statusPost(statusPath(location.pathname))?.body;
    } else {
      // For semantic markup require one standalone post body.
      const posts = document.querySelectorAll('[itemscope][itemtype="https://schema.org/SocialMediaPosting"]');
      if (posts.length!==1 || posts[0].closest('aside,blockquote,[class*="comment" i]')) return null;
      const bodies = posts[0].querySelectorAll('[itemprop="articleBody"]');
      if (bodies.length===1) body=bodies[0];
    }
    if (!readablePostBody(body)) return null;
    const text=body.innerText || '';
    return text.length<=3000 ? SubtextInvestigate.post(text) : null;
  }
  // Only a visible link in the item's prose, never a comment, ad, navigation or
  // bibliography neighbour. Keep the specific passage, not the whole surrounding page.
  function citations() {
    if (!ctx) return [];
    const out = [], seen = new Set(), parts = document.querySelectorAll('article p a[href],main p a[href],[role="main"] p a[href],p a[href],article li a[href]');
    for (let i = 0; i < Math.min(parts.length, 1800) && out.length < 4; i++) {
      const a = parts[i];
      const rec = SubtextRecords.canonical(a.href);
      if (!rec || seen.has(rec.key) || a.closest('aside,footer,nav,header,[aria-hidden="true"],[hidden],[inert],[contenteditable],[role="complementary"],[role="doc-bibliography"],[role="navigation"],[class*="related" i],[class*="comment" i],[id*="comment" i],[class*="recommend" i],[class*="references" i],[class*="sidebar" i]')) continue;
      const parent = a.closest('p,li');
      if (!parent || parent.querySelector('[contenteditable],textarea,input,select')) continue;
      const label = ML.normText(a.innerText || ''), paragraph = ML.normText(parent.innerText || '');
      if (!label || !ML.isVisibleNow(a) || paragraph.length < 28 || paragraph.length > 3000 || paragraph.length - label.length < 12) continue;
      // On a multi-study paragraph, do not pair an unrelated sentence with this link.
      const chunks = paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/);
      const matches = chunks.filter(part=>part.includes(label));
      const passage = matches.length === 1 ? matches[0] : null;
      if (!passage || passage.length > 650 || [...parent.querySelectorAll('a[href]')].some(other=>other!==a && passage.includes(ML.normText(other.innerText || '')) && SubtextRecords.canonical(other.href)?.key !== rec.key)) continue;
      const nearby = [];
      if (rec.kind==='doi' || rec.kind==='pubmed') {
        // Newsrooms often link the paper in the introduction and report the number in
        // the next paragraph. Walk a short distance within that article only. Stop
        // at another cited study, study transition or competing experiment.
        const root = parent.closest('article,[itemprop="articleBody"],main,[role="main"]');
        const ps = root ? [...root.querySelectorAll('p')].slice(0,220) : [];
        const ix=ps.indexOf(parent);
        if (ix>=0) for (const direction of [1,-1]) {
          for(let step=direction===1?0:1;step<=4;step++) {
            const e=ps[ix+direction*step]; if (!e) break;
            if (e.closest('article,[itemprop="articleBody"],main,[role="main"]')!==root ||
              e.closest('footer,nav,aside,blockquote,[aria-hidden="true"],[inert],[contenteditable],[class*="comment" i],[class*="related" i]') ||
              e.querySelector('input,[contenteditable],textarea') || !ML.isVisibleNow(e)) continue;
            const t=ML.normText(e.innerText);
            if(t.length>2000 || /\b(?:separate|different|another|previous|earlier|unrelated) (?:study|trial|experiment)\b/i.test(t) ||
              [...e.querySelectorAll('a[href]')].some(x=>{const r=SubtextRecords.canonical(x.href);return r && r.key!==rec.key;})) break;
            for (const sentence of t.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
              if(sentence!==passage && sentence.length>=28 && sentence.length<=480 && /\d\s*(?:%|percent\b)/i.test(sentence) && !nearby.includes(sentence) && nearby.length<10) nearby.push(sentence);
            }
          }
        }
      }
      seen.add(rec.key); out.push(Object.assign({}, rec, {label:label.slice(0,110), passage,nearby}));
    }
    // No link? A narrowly identified historical event can still have a source we
    // know how to find. The suggestion says where it came from and never fetches on load.
    if (/solar/i.test(document.title+' '+(ctx.index?.fullText || '').slice(0,1500))) {
      const containers = document.querySelectorAll('[itemprop="articleBody"],article,.post-content,.entry-content,.story-body,.article-body');
      const article = [...containers].slice(0,40).filter(el=>!el.closest('aside,nav,footer,[class*="comment" i],[class*="related" i]') && ML.isVisibleNow(el) && el.querySelector('p'))
        .sort((a,b)=>(b.innerText || '').length-(a.innerText || '').length)[0];
      if (!article) return out;
      const paragraphs=[...article.querySelectorAll('p')].slice(0,24).filter(p=>!p.closest('aside,footer,nav,blockquote,[aria-hidden="true"],[class*="comment" i],[class*="related" i]') && ML.isVisibleNow(p)).map(p=>ML.normText(p.innerText)).filter(Boolean);
      const h=SubtextClaims.related({title:document.title,paragraphs,date:document.querySelector('meta[property="article:published_time"]')?.content || article.querySelector('time[datetime]')?.dateTime});
      const rec=h && SubtextRecords.canonical(h.url);
      if (rec && !seen.has(rec.key)) out.unshift({...rec,...h,nearby:[]});
    }
    return out.slice(0,4);
  }
  function inquiryLinks() {
    const out=[],seen=new Set();
    // Read only after an AI click. Collect visible source/disclosure links here;
    // the source reader enforces its public URL and same-origin policy again.
    for (const a of [...document.querySelectorAll('a[href]')].slice(0,2000)) {
      if (a.closest('[aria-hidden="true"],[hidden],[inert],[contenteditable],aside,[class*="comment" i]') || !ML.isVisibleNow(a)) continue;
      const label=ML.normText(a.innerText || '');
      if (!label) continue;
      const item=SubtextInquirySources.candidate(a.getAttribute('href'),location.href,label);
      if (!item || seen.has(item.url)) continue;
      // Validate the raw path before normalization, then check what the browser
      // would actually open. A document's <base> can change a relative link.
      const resolved=SubtextInquirySources.candidate(a.href,location.href,label);
      if (resolved?.url!==item.url || resolved.kind!==item.kind) continue;
      seen.add(item.url);out.push(item);
    }
    // Footer terms often come after a dozen company/navigation links. Keep the
    // decision-bearing records and transaction terms available to the planner;
    // this ordering itself neither fetches them nor treats them as evidence.
    const priority=item=>item.kind==='record'?0:SubtextInquirySources.isTransactionPolicy(item.url)?1:2;
    return out.sort((a,b)=>priority(a)-priority(b)).slice(0,12).map((item,k)=>({...item,id:'link'+(k+1)}));
  }
  function hasArticleProse(root, excluded = null) {
    if (!root) return false;
    let paragraphs = 0;
    for (const p of root.querySelectorAll('p')) {
      if (!excluded?.contains(p) && !p.closest('header,footer,nav,aside,[hidden],[aria-hidden="true"]') &&
          ML.isVisibleNow(p) && ML.normText(p.innerText).length >= 80 && ++paragraphs >= 2) return true;
    }
    return false;
  }
  function hasArticleAccessWall(article) {
    if (!article && !document.querySelector('meta[property="og:type"][content="article" i]')) return false;
    const namedWall = '[id="paywall" i],[id^="paywall-" i],[class~="paywall" i],[class~="subscribe-wall" i],[class~="regwall" i]';
    const wrappers = namedWall + ',dialog[open],[role="dialog"][aria-modal="true"]';
    const accountAction = /\b(subscrib(?:e|ers?|ing)|subscription|sign[ -]in|log[ -]in|register|creat(?:e|ing) (?:an? |a free )?account)\b/i;
    const accessRequirement = /\b(?:to (?:continue reading|keep reading|read (?:the |this )?(?:full )?(?:article|story))|(?:subscription|sign[ -]in|log[ -]in) (?:is )?required|(?:for )?subscribers only|(?:reached|used up|run out of) (?:your )?(?:free articles?|article limit))\b/i;
    for (const wall of document.querySelectorAll(wrappers)) {
      if (wall.closest('nav,footer,[aria-hidden="true"],[hidden]') || !ML.isVisibleNow(wall)) continue;
      const copy = ML.normText(wall.innerText);
      if (accountAction.test(copy) && accessRequirement.test(copy)) return true;
      // Some hard walls show the subscription checkout without explaining the block.
      // Require a named wall, payment and sign-in copy, and only a short article preview.
      if (!wall.matches(namedWall) || !/\balready a subscriber\b/i.test(copy) ||
          !/\bunlimited access\b/i.test(copy)) continue;
      const hasPayment = Array.from(wall.querySelectorAll('button,[role="button"],input[type="submit"]')).some(control =>
        ML.isVisibleNow(control) && /\b(?:paypal|credit\s*[/&]\s*debit)\b/i.test(control.innerText || control.value || control.getAttribute('aria-label') || ''));
      if (!hasPayment) continue;
      const story = article || document.querySelector('main,[role="main"]') || document.body;
      if (!hasArticleProse(story, wall)) return true;
    }
    return false;
  }
  // what the context lookup needs to pick topic words: the headline, the site's own name, the page's tagged keywords and its main text.
  // Read fresh from the page; the worker sends only the chosen words onward, never this text.
  function contextSignals() {
    const metaC = (sel) => ((document.querySelector(sel) || {}).content || '').trim();
    let ldDate = ''; const types = [metaC('meta[property="og:type"]')];
    const tags = [metaC('meta[name="news_keywords"]'), metaC('meta[name="keywords"]')].join(',').split(',').concat(Array.from(document.querySelectorAll('meta[property="article:tag"]')).map((m) => m.content || ''));
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { const j = JSON.parse(s.textContent); for (const x of [].concat(j['@graph'] || j)) { const k = x && x.keywords; if (k) tags.push(...(Array.isArray(k) ? k : String(k).split(','))); if (x && typeof x.datePublished === 'string' && !ldDate) ldDate = x.datePublished; if (x && x['@type']) types.push(String(x['@type'])); } } catch (e) { /* not JSON */ } }
    // the page's own publication date, when it states one in a machine-readable place
    let published = metaC('meta[property="article:published_time"]') || metaC('meta[name="date"]') || metaC('meta[itemprop="datePublished"]') || ldDate || ((document.querySelector('time[datetime]') || {}).dateTime || '');
    /* Three more signals, read from the page's own footer, header and navigation, which the main text leaves out. The worker checks each again.
       taxIds: US tax IDs printed beside a label ("EIN: 12-3456789", "Tax ID# 12-3456789") in the page's footer, and nowhere else: a
         number in the main content can be a customer's, an applicant's or a partner's (an invoice, an account page, a grant form).
         A nine-digit number with no label is never taken.
       taxIdNonprofit: the footer text around such an ID calls the organization a nonprofit.
       statusPages: the site's own status page, as linked from its footer, header or navigation: a host under the site's own domain.
         A link in the main content, a comment or a post is anyone's link and is never taken; no other host is ever taken.
       footerText: the footer's text, for checks on the device only; it is never sent anywhere. */
    // The page's own footer, header or navigation: one whose nearest section is the page itself, not a post's footer, a card's footer or a signature
    const INSIDE = 'main, [role="main"], article, [role="article"], [role="comment"], section, aside, blockquote, details, dialog, fieldset, figure, td';
    const ofPage = (el) => !(el.parentElement && el.parentElement.closest(INSIDE));
    const outermost = (els) => els.filter((el) => !els.some((o) => o !== el && o.contains(el)));
    const pageFooters = outermost(Array.from(document.querySelectorAll('footer, [role="contentinfo"], #footer, .footer, #site-footer, .site-footer')).filter(ofPage));
    // `whole` is the whole text of the page's footer and nothing else: labelled tax IDs are read only from it
    let whole = ''; try { whole = pageFooters.map((el) => el.innerText || '').join('\n'); } catch (e) { whole = ''; }
    if (whole.length > 400000) whole = whole.slice(0, 200000) + '\n' + whole.slice(-200000);
    const taxIds = []; let taxIdNonprofit = false;
    // the label, then at most 40 characters with no digit in them, then NN-NNNNNNN. "EIN" in capitals only: "ein" is a German word.
    const idShape = '[^\\d]{0,40}?(?<![\\d-])(\\d{2})[-\\u2010-\\u2013](\\d{7})(?![\\d-])';
    const labelled = [...whole.matchAll(new RegExp('\\bE\\.?I\\.?N\\b' + idShape, 'g')), ...whole.matchAll(new RegExp('\\b(?:tax(?:payer)?[\\s-]?i\\.?d\\b|tax(?:payer)?[\\s-]identification\\b|employer identification\\b)' + idShape, 'gi'))].sort((a, b) => a.index - b.index);
    for (const m of labelled) {
      const id = m[1] + '-' + m[2]; if (!taxIds.includes(id)) taxIds.push(id);
      // "tax exempt" is not in this list: a billing form asks "Tax exempt: No"
      if (/501\s*\(?c\)?|non-?profit|not-for-profit|tax[- ]deductible|charit/i.test(whole.slice(Math.max(0, m.index - 300), m.index + m[0].length + 300))) taxIdNonprofit = true;
      if (taxIds.length >= 6) break;
    }
    const here = location.hostname.toLowerCase().replace(/^www\./, ''); const reg = (MLCommon.registrableDomain && MLCommon.registrableDomain(here)) || here;
    /* A status link must point under the site's own domain, and never at the site's own host. A page on the registrable domain itself
       (example.com, www.example.com) may link any other host under it; a page on a subdomain only a host under that subdomain, because
       a platform that gives each tenant a subdomain may be on no list. The worker applies the same rule again (SubtextContextData.ownStatusHost). */
    const base = here === reg ? reg : here;
    const REGION = 'footer, header, nav, [role="contentinfo"], [role="banner"], [role="navigation"]';
    const CONTENT = 'main, [role="main"], article, [role="article"], [role="comment"]';
    const statusPages = []; const statusText = [];
    for (const a of document.querySelectorAll(REGION.split(', ').map((r) => r + ' a[href]').join(', '))) {
      if (a.closest(CONTENT)) continue; // inside the main content or a post, whatever element wraps the link
      let region = a.closest(REGION); for (let up = region; up; up = up.parentElement && up.parentElement.closest(REGION)) region = up; // the outermost of them
      if (!region || !ofPage(region)) continue;
      let u = null; try { u = new URL(a.href); } catch (e) { continue; }
      if (u.protocol !== 'https:' || u.origin === location.origin) continue;
      const h = u.hostname.toLowerCase();
      if (!h.endsWith('.' + base) || h === 'www.' + base) continue; // another site's host, or this site's own host
      // "status." under the site's own domain, or a link the page itself labels as its status page
      if (/^status\./.test(h)) { if (!statusPages.includes(u.origin)) statusPages.push(u.origin); }
      else if (/^(?:system |service )?status$/i.test((a.textContent || '').slice(0, 80).replace(/\s+/g, ' ').trim())) { if (!statusText.includes(u.origin)) statusText.push(u.origin); }
      if (statusPages.length >= 4) break;
    }
    // the footer's text for the city check (on the device only). A page with no footer element: an element named like one, else the end of the page's text
    let bodyText = ''; try { bodyText = (document.body && document.body.innerText) || ''; } catch (e) { bodyText = ''; }
    const foot = Array.from(document.querySelectorAll('footer, [role="contentinfo"]')); const footAlt = foot.length ? foot : Array.from(document.querySelectorAll('[id*="footer" i], [class*="footer" i]'));
    const outer = outermost(footAlt);
    const footerText = (outer.length ? outer.map((el) => el.innerText || '').join('\n') : bodyText.slice(-1500)).replace(/\s+/g, ' ').trim().slice(0, 4000);
    return { url: location.href, title: document.title, productPage: types.some((t) => /^product$/i.test(String(t).trim())), published: /^\d{4}-\d{2}-\d{2}/.test(published) ? published.slice(0, 10) : '', siteName: metaC('meta[property="og:site_name"]'), keywords: tags.map((t) => String(t).trim()).filter((t) => t && t.length < 60).slice(0, 15), text: ctx && ctx.index ? mainText().slice(0, 60000) : '',
      taxIds, taxIdNonprofit, statusPages: [...new Set(statusPages.concat(statusText))].slice(0, 4), footerText };
  }
  function extractForLLM() {
    if (!ctx) return { error: 'Subtext is muted on this site.' };
    routeChanged();
    const permalink = statusHost.test(location.hostname) && statusPath(location.pathname);
    const post = permalink ? statusPost(permalink) : null;
    if (permalink && !post) return { error: 'Could not isolate a single visible post at this address.' };
    const currentIndex = ML.buildTextIndex({maxChars:200000, strictVisible:true});
    if (post) {
      const mainText = currentIndex.blocks.filter(b => !b.synthetic && post.body.contains(b.el)).map(b => b.text).join('\n').slice(0, 60000);
      if (!mainText) return { error: 'The post at this address has no readable text.' };
      const credits = [post.author, post.time].map(el => ML.normText(el?.innerText)).filter(Boolean);
      return { url: location.href, title: '', hostname: location.hostname, mainText, credits,
        citations: [], inquiryLinks: [], choiceLayout: [], headings: [], ctas: [], charts: [],
        allText: [mainText, ...credits].join('\n'), signals: null, heuristicFindings: [] };
    }
    const article = document.querySelector('[itemprop="articleBody"]') || document.querySelector('article');
    if (isErrorPage(currentIndex) && !hasArticleProse(article)) return { error: 'The page shows a loading or access error.' };
    if (hasArticleAccessWall(article)) return { error: 'Only an article preview is available behind a subscription or sign-in wall.' };
    const visible = el => ML.isVisibleNow(el) && !el.closest('[aria-hidden="true"]');
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).slice(0, 40).map((h) => ML.normText(h.innerText)).filter(Boolean);
    const ctas = Array.from(document.querySelectorAll('button,a[class*="btn" i],[role="button"],input[type="submit"]')).filter(visible).slice(0, 60).map((b) => ML.normText(b.innerText || b.value || '')).filter((t) => t && t.length < 80);
    const body = mainText(currentIndex), credits = [];
    const firstPart = body.slice(0, Math.floor((settings.maxCharsToAI || 40000) * 0.8));
    // Article extraction strips adjacent material. Recover short visible credits in their own words;
    // a credit is context for the reader model, never a finding or proof of sponsorship.
    for (const b of currentIndex.blocks || []) {
      if (b.synthetic || !b.text || b.text.length > 400 || ['comment', 'quote', 'teaser'].includes(b.region) || firstPart.includes(b.text) || credits.includes(b.text)) continue;
      const byline = b.el.matches('[rel="author"],[itemprop="author"],[class*="byline" i]') || b.el.querySelector('[rel="author"],[itemprop="author"]');
      if (byline || /\b(in partnership with|paid for by|funded by|supported by|sponsored by|presented by|made possible by|republished (?:from|with)|originally published|may (?:earn|receive) (?:a )?commission)\b/i.test(b.text)) credits.push(b.text);
      if (credits.length >= 8) break;
    }
    // a sponsor shown only as a logo beside a paid label (paidItem) is a credit in words for the reader model
    { const paid = paidItem(); if (paid && paid.sponsor && credits.length < 8) credits.push(paid.label.split(/(?<=[.!?])\s/)[0].slice(0, 80) + ' — sponsor named by its logo: ' + paid.sponsor); }
    return { url: location.href, title: document.title, hostname: location.hostname, mainText: body, credits, collapsed: collapsedSections(), citations: citations(), inquiryLinks:inquiryLinks(), choiceLayout: ML.currentChoiceLayout(ctx), headings, ctas, charts: (ctx && ctx.chartAssets) || [], allText: currentIndex.fullText.slice(0, 200000), signals: lastReport ? { outlet: ctx.outlet ? ctx.outlet.entry.name : null, pageKind: lastReport.meta.pageKind, asks: lastReport.meta.asks, transaction: lastReport.transaction, provenance: lastReport.provenance, businessModel: (lastReport.findings.find((f) => f.id === 'incentives.business_model') || {}).name || null } : null, heuristicFindings: (lastReport ? lastReport.findings : []).filter((f) => f.severity > 0 && !(f.meta && (f.meta.unproven || f.meta.tier === 'note'))).map((f) => ({ id: f.id })) };
  }

  function rescan() { if (!ctx || routeChanged()) return; run('manual'); ML.detectors.behavior.recheck(ctx); }
  if (ML.ui) ML.ui.onRescan = rescan;

  // ---- messages from popup/background --------------------------------------
  if (ML.hasChrome) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || !msg.type) return;
      if (msg.type === 'ping') { sendResponse({ ok: true, report: lastReport }); return; }
      if (msg.type === 'getReport') { sendResponse(lastReport); return; }
      // the background saw the address change and dropped this tab's state; a tab still showing the old document ignores it
      if (msg.type === 'urlChanged') { if (ctx && routeOf(msg.url) === routeOf(location.href) && !routeChanged() && lastReport) report('url'); sendResponse({ ok: true }); return; }
      if (msg.type === 'rescan') { rescan(); sendResponse(lastReport); return; }
      if (msg.type === 'highlight') { sendResponse({ ok: !!(ML.ui && ML.ui.locate(msg.elId)) }); return; }
      if (msg.type === 'togglePanel') { if (!ML.ui || !ctx) { sendResponse({ on: false, muted: true }); return; } sendResponse({ on: ML.ui.togglePanel(msg.on) }); return; }
      if (msg.type === 'panelState') { sendResponse({ on: !!(ML.ui && ML.ui.panelOpen()) }); return; }
      if (msg.type === 'stateChanged') { if (msg.state && msg.state.report) showState(msg.state); sendResponse({ ok: true }); return; }
      if (msg.type === 'getCitations') { sendResponse({url:location.href, citations:ctx?.errorPage ? [] : citations()}); return; }
      if (msg.type === 'extractForLLM') { try { sendResponse(extractForLLM()); } catch (e) { sendResponse({ error: String(e) }); } return; }
      if (msg.type === 'contextSignals') { try { sendResponse(contextSignals()); } catch (e) { sendResponse({ error: String(e) }); } return; }
      if (msg.type === 'settingsChanged') { settings = msg.settings || settings; if (ctx) { ctx.settings = settings; ctx.disabled = new Set(settings.disabledCategories || []); } if (ML.ui) ML.ui.setSettings(settings); const here = location.hostname.replace(/^www\./, ''); if ((settings.disabledSites || []).some((s) => here === s || here.endsWith('.' + s))) muteNow(); else if (ctx && lastReport) report('settings'); sendResponse({ ok: true }); return; }
    });
  }
  // test hook (fixtures run without chrome.*): window.__ML_RUN() returns the report
  window.__ML_RUN = async function () { if (!ctx) await init(); if (ctx) { run('test'); } return window.__ML_LAST; };
  window.__ML_EXTRACT = () => extractForLLM();

  init();
})();
