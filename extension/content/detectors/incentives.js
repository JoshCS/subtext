/* Incentives detector: what the site gets from you (business model), data-selling signals, lead capture,
   and a scan of the linked privacy policy / terms against rules/policy-rules.json. */
(function () {
  const ML = window.ML;
  let policyRequested = false;
  const policyText = new Map(); // url -> text: a new route of a single-page app that links the same policy reads this, with no second request

  function findPolicyLinks(cfgWords) {
    const out = { privacy: null, terms: null };
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const score = (a, words) => { const t = ML.lower(a.innerText || a.textContent || a.getAttribute('aria-label') || ''); const h = (a.getAttribute('href') || '').toLowerCase(); let s = 0; for (const w of words) { if (t === w) s = Math.max(s, 3); else if (t.includes(w)) s = Math.max(s, 2); } if (/privacy|terms|legal|conditions/.test(h)) s += 1; return s; };
    for (const kind of ['privacy', 'terms']) {
      let best = null, bs = 0;
      for (const a of anchors) { const s = score(a, cfgWords[kind]); if (s > bs && !/^javascript:|^#/.test(a.getAttribute('href') || '')) { bs = s; best = a; } }
      if (best && bs >= 2 && (best.innerText || best.textContent || '').length <= 40) { try { const u = new URL(best.getAttribute('href'), location.href); if (/^https?:$/.test(u.protocol) && ML.registrableDomain(u.hostname) === ML.registrableDomain(location.hostname)) out[kind] = u.href; } catch (e) { /* ignore */ } }
    }
    return out;
  }

  function htmlToText(html) {
    try { const doc = new DOMParser().parseFromString(html, 'text/html');
      const head = ML.lower((doc.title || '') + ' ' + ((doc.querySelector('h1') || {}).textContent || ''));
      if (!/privacy|terms|policy|legal|conditions|notice|datenschutz|agb|cookie|user agreement/.test(head) || /\bhow to\b/.test(head)) return ''; // an article about privacy is not a privacy policy
      doc.querySelectorAll('script,style,noscript,nav,header,footer').forEach((e) => e.remove());
      doc.querySelectorAll('li,p,h1,h2,h3,h4,h5,h6,tr,br,dd,dt').forEach((e) => e.after('\n')); // keep the page's line structure, so a bulleted list is separate sentences
      return String(doc.body ? doc.body.textContent : '').replace(/[ \t\f\r\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim(); }
    catch (e) { return ML.normText(String(html).replace(/<[^>]+>/g, ' ')); }
  }

  // Always through the background worker: the request then carries no Referer naming the page the reader is on, and the page's
  // own scripts cannot see it in their resource timings or their service worker. Without chrome.* (fixtures outside the extension) it stays same-origin.
  async function fetchPolicy(url) {
    if (policyText.has(url)) return policyText.get(url);
    let text = null;
    try {
      if (ML.hasChrome) { const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'fetchText', url }, (x) => { void chrome.runtime.lastError; res(x); })); text = r && r.text ? htmlToText(r.text) : null; }
      else if (new URL(url).origin === location.origin) { const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' }); if (r.ok) text = htmlToText(await r.text()); }
    } catch (e) { /* ignore */ }
    if (text != null) policyText.set(url, text);
    return text;
  }

  // Sentence splitter for policy text. Bullets and line breaks end a sentence, so unpunctuated list items stay apart. A list item carries its lead-in ("We may share your data with:", "You have the right to know:") as `f`, so it keeps the lead-in's subject and legal frame even when split at semicolons or bullets.
  function splitPolicy(text, frame) {
    const SENT = /(?<=[.;:?!])\s+(?=[A-Z(•"'])|(?<=[a-z)][.;:?!])(?=[A-Z][a-z])/; // '?X' and ':X' with no space also end a sentence (glued headings)
    const out = []; let carry = '', prev = '';
    for (const raw of text.split(/\s*[\r\n]+\s*|\s*[•▪◦‣●]\s*/)) {
      const block = raw.trim(); if (!block) continue;
      if (carry && block.length > 160 && !/[;:,]$/.test(prev)) carry = '';
      for (const p of block.split(SENT)) {
        const t = p.trim(); if (!t) continue;
        out.push({ s: t, f: carry ? carry + ' ' + t : t, off: carry ? carry.length + 1 : 0 });
        const end = t.slice(-1); const lead = t.match(/^(.{0,300}?:)(\s|$)/);
        if (!carry && (end === ':' || end === ';') && (lead || (frame && frame.test(t)))) carry = lead ? lead[1] : t;
        else if (carry && end !== ';' && end !== ',' && end !== ':' && block.length > 160) carry = '';
        prev = t;
      }
    }
    return out;
  }

  function scanPolicy(text, rules, url, kind, offers) {
    const usedSentences = new Set(); // one sentence is one finding, not two
    const frame = rules.legalFrame ? new RegExp(rules.legalFrame, 'i') : null;
    const sentences = splitPolicy(text, frame);
    const byRule = []; const fired = new Set();
    // highest severity first, so a severity-1 rule never takes a sentence from a severity-3 rule
    const order = rules.rules.map((r, i) => i).sort((a, b) => (rules.rules[b].severity || 0) - (rules.rules[a].severity || 0) || a - b);
    for (const idx of order) {
      const rule = rules.rules[idx]; const out = byRule[idx] = [];
      if (rule.suppressedBy && rule.suppressedBy.some((id) => fired.has(id))) continue; // e.g. 'does not sell' beside an admission that it sells or shares
      if (rule.suppressIfText && new RegExp(rule.suppressIfText, 'i').test(text)) continue; // e.g. a refund guarantee elsewhere in the terms
      const re = new RegExp(rule.pattern, 'i'); const practice = !rule.positive && rule.anyVoice !== true; const neg = rule.negation ? new RegExp(rule.negation, 'i') : null;
      let count = 0, negated = 0; const quotes = [];
      for (const { s, f, off } of sentences) {
        const m = s.length > 900 ? null : re.exec(f); if (!m || m.index + m[0].length <= off) continue; // the match must reach into the item itself, not sit in the lead-in
        { const w = s.split(/\s+/); if (w.length >= 10 && w.filter((x) => /^[A-Z][a-z]/.test(x)).length / w.length > 0.55) continue; } /* a run of section headings, not a sentence; a disclaimer in capitals is still a sentence */
        if (neg && neg.test(f)) { negated++; continue; }
        if (practice && (!/\b(we|us|our)\b/i.test(f) || (frame && frame.test(f)))) continue; // a rights notice or a legal definition is not an admission
        if (!rule.positive) { if (usedSentences.has(f)) continue; usedSentences.add(f); }
        count++; if (quotes.length < 3) { const at = Math.max(0, m.index - 90); quotes.push((at ? '…' : '') + f.slice(at, at + 220)); }
      }
      if (count === 0 && negated > 0 && rule.positiveLabel) {
        out.push(ML.makeFinding({ id: rule.id + '.negated', category: 'incentives', name: rule.positiveLabel, label: rule.positiveLabel, why: rule.positiveWhy || '', severity: 0, confidence: 0.6, biases: [], explain: rule.positiveWhy + ' Found in the ' + kind + ' at ' + url + '. Policies can still "share" what they do not "sell"; check the sharing clauses.', tip: '', evidence: [], count: negated, source: 'policy', meta: { url, kind } }));
        continue;
      }
      if (count === 0) continue;
      fired.add(rule.id);
      out.push(ML.makeFinding({
        id: rule.id, category: 'incentives', name: rule.name, label: rule.label, why: rule.why, severity: rule.positive || (rule.saleOnly && !offers) ? 0 : rule.severity, confidence: 0.7, biases: rule.positive ? [] : ['data_capture', 'default_effect'],
        explain: (rule.positive ? 'Positive signal. ' : '') + rule.why + ' Found in the ' + kind + ' (' + url + '). Policies are written to be skimmed past; this clause is what you are agreeing to.',
        tip: rule.positive ? '' : 'Use a disposable email, decline optional data, and prefer sites whose policy says plainly what they do not do.',
        evidence: quotes.map((q) => ({ quote: q, elId: null, url })), count, source: 'policy', meta: { url, kind }
      }));
    }
    return [].concat(...rules.rules.map((r, i) => byRule[i] || []));
  }

  ML.detectors.incentives = function (ctx) {
    const cm = ctx.commerce || {};
    const out = []; const add = (f) => out.push(ML.makeFinding(Object.assign({ category: 'incentives' }, f)));
    const hits = ctx.trackerHits || {}; const vendors = (c) => (hits[c] ? hits[c].length : 0);
    const full = ctx.index.fullText; const lower = full.toLowerCase();
    const currency = (full.match(new RegExp(ctx.domConfig.pricing.currency, 'gi')) || []).length;
    const anchors = Array.from(document.querySelectorAll('a[href],button'));
    const anchorText = anchors.map((a) => ML.lower(a.innerText || a.textContent || ''));

    // signals
    const names = (c) => (hits[c] || []).slice(0, 3);
    const adTech = vendors('advertising') + vendors('native_ads');
    const buyOnly = ctx.buyOnlyAds || []; // an advertiser pixel means this site buys placements; it sells none
    const adBidders = Math.max(0, adTech - buyOnly.length);
    const brokers = (hits.data_broker || []).concat(hits.identity || []); const measurement = hits.ad_measurement || []; const verifyHosts = (ctx.trackers && ctx.trackers.adVerificationHosts) || []; const verifiers = measurement.filter((k) => verifyHosts.includes(k)); const audience = measurement.filter((k) => !verifyHosts.includes(k));
    const brandOf = (k) => ((ctx.trackers && ctx.trackers.vendorNames) || {})[k] || k;
    const dataVendors = vendors('social_pixel') + vendors('data_broker') + vendors('identity') + vendors('marketing_automation') + vendors('session_replay') + vendors('fingerprinting');
    const affiliate = ctx.affiliateLinks || 0;
    const tx = ctx.domConfig.transaction || {}; const txn = ctx.transaction || null; // the transaction detector runs before this one
    if (txn && txn.selling && txn.product !== 'subscription' && ctx.lastFindings && ctx.lastFindings.get('source.affiliate_links') && ctx.lastFindings.get('source.affiliate_links').meta.scriptOnly) { const f = ctx.lastFindings.get('source.affiliate_links'); f.severity = 0; f.label = 'Affiliate program'; f.why = 'This seller pays referrers; the page sells its own goods.'; f.name = 'Affiliate-network script on a seller\'s own page (its referral programme)'; } // a merchant running its own programme is not a page of paid recommendations
    const subscription = cm.subBoxes > 0 && cm.planBoxes > 0;
    const commerce = !!(cm.addToCart || cm.buyBoxes > 0 || cm.schemaProduct || cm.catalogue || cm.hasCart);
    const donation = /\b(donate|make a (gift|donation)|support (our|independent) (work|journalism)|become a (member|supporter|patron))\b/i.test(full);
    const sponsored = ctx.lastFindingsHas ? ctx.lastFindingsHas('source.sponsored_content') : /\bsponsored\b/i.test(full);
    const leadForms = Array.from(document.querySelectorAll('form')).filter((f) => { if (!ML.isVisible(f) || f.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i]')) return false; const inputs = f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=checkbox]):not([type=radio]),select,textarea'); if ((f.innerText || '').length > 1200 || f.querySelector('main,article,nav,h1') || inputs.length > 12) return false; /* a form wrapping the whole page (ASP.NET) is not a lead form */ const t = ML.lower(Array.from(f.querySelectorAll('label,legend,button,input[type=submit]')).map((e) => e.innerText || e.value || '').concat(Array.from(inputs).map((i) => i.getAttribute('placeholder') || '')).join(' | ')); const hasContact = !!f.querySelector('input[type=tel],input[type=email],input[name*="phone" i],input[name*="email" i]'); return inputs.length >= 3 && hasContact && /\b(quote|estimate|consultation|get started|apply|request|callback|call back|demo|enquiry|inquiry|eligib\w*|pre-?approv\w*|rates?|insurance|loan|solar|mortgage|refinanc\w*)\b/.test(t); });
    // consent-or-pay: refusing cookies routes to a paid tier (config flags in inline scripts, or the banner's own wording)
    const inlineJs = Array.from(document.scripts).filter((s) => !s.src).map((s) => s.textContent || '').join('\n').slice(0, 2000000);
    const copRe = ctx.domConfig.consent && ctx.domConfig.consent.consentOrPayPattern ? new RegExp(ctx.domConfig.consent.consentOrPayPattern, 'i') : null;
    // the pay option counts only when the banner itself shows it; a config flag may apply to other regions
    const copBanner = copRe && ctx.consentBannerText ? ctx.consentBannerText.match(copRe) : null;
    const copScript = copRe && !copBanner ? (inlineJs.match(copRe) || full.match(copRe)) : null;
    const consentOrPay = !!copBanner;
    // donations: where the money goes and on what terms
    const donateLink = anchors.find((a) => /^(donate|give|give now|give today|make a (gift|donation)|contribute)( now| today)?$/i.test(ML.normText(a.innerText || a.textContent || '')) && a.getAttribute && a.getAttribute('href'));
    let donate = null; if (donateLink) { try { const u = new URL(donateLink.getAttribute('href'), location.href); donate = { host: u.hostname.replace(/^www\./, ''), external: ML.registrableDomain(u.hostname) !== ML.registrableDomain(location.hostname), taxNote: /\bnot tax[- ]deductible\b/i.test(full) ? 'not tax-deductible' : /\btax[- ]deductible\b/i.test(full) ? 'tax-deductible' : null, deadline: /\b(give|donate|gift)\b[^.]{0,60}\b(before|by) (midnight|[A-Z][a-z]+ \d{1,2})\b/.test(full) }; } catch (e) { /* ignore */ } }
    const dnsLink = anchors.find((a) => /do not sell( or share)?( my)?( personal)?( information| info| data)?|your privacy choices|your california privacy (rights|choices)|opt[- ]out of (sale|sharing)/i.test(ML.normText(a.innerText || a.textContent || '')));

    // what this page asks of the reader, for the one-line reading (independent of whether anything is for sale)
    const supportPrompt = /\b(support (the|our|independent) (guardian|journalism|work|reporting)|support us|become a (supporter|member|patron)|make a contribution|contribute today|fund our|donate)\b/i.test(anchorText.filter((t) => t.length < 60).join(' | ')); // a button asks; a story mentioning donations does not
    const newsletter = !!Array.from(document.querySelectorAll('form input[type=email]')).find((i) => ML.isVisible(i)) || /\b(sign up (for|to) (our|the) (newsletter|daily|weekly)|newsletter)\b/i.test(anchorText.join(' '));
    const registration = /\b(sign in|log in|register|create (an |a free )?account)\b/i.test(anchorText.join(' '));
    // ad slots on the page (sell-side requests, ad containers, native widgets) earn money; pixels alone buy ads elsewhere to bring visitors back
    const adBox = Array.from(document.querySelectorAll('ins.adsbygoogle,[id^="div-gpt-ad"],[id^="google_ads_iframe"],iframe[id^="google_ads"],[data-ad-slot],[data-google-query-id]')).some((el) => { const r = el.getBoundingClientRect(); return r.width * r.height > 1500; });
    const adSlots = adBox || (!(!ctx.outlet && (cm.fundraises || donate) && !ctx.adServerSeen) && (vendors('native_ads') > 0 || (ctx.sellSideAds && (ctx.adServerSeen || !commerce) && (adBidders + measurement.length >= 6 || (adBidders + measurement.length >= 4 && !!ctx.isArticle))))); // a charity's or a shop's pixels measure the ads it buys; it sells none
    const mkRe = tx.marketingCtaWords ? new RegExp(tx.marketingCtaWords, 'i') : null; const mkHits = mkRe ? anchorText.filter((t) => t.length < 48 && mkRe.test(t)) : []; const marketing = !cm.editorial && mkHits.some((t) => !/^sign up\b/.test(t)); // a newsletter 'sign up' is not a product pitch, and an article is not a marketing page
    ctx.asks = { ads: adSlots ? adBidders : 0, pixels: adSlots ? 0 : adTech, marketing, dataVendors, affiliate, subscription, support: supportPrompt || donation, newsletter, registration, leadForms: leadForms.length, commerce, consentOrPay, donate, funding: ctx.fundingVendors || [], vendors: { advertising: names('advertising'), identity: Array.from(new Set(brokers.map(brandOf))).slice(0, 3), replay: names('session_replay'), native: names('native_ads') } };
    const model = [];
    if (adBidders && adSlots) model.push('advertising (' + adBidders + ' ad vendor' + (adBidders > 1 ? 's' : '') + ')');
    else if (adTech) model.push('retargeting pixels (' + adTech + ' vendor' + (adTech > 1 ? 's' : '') + ')');
    if (dataVendors) model.push('data collection (' + dataVendors + ' profiling/identity vendor' + (dataVendors > 1 ? 's' : '') + ')');
    if (affiliate >= 2) model.push('affiliate commissions (' + affiliate + ' links)');
    if (subscription) model.push('subscriptions');
    if (commerce) model.push('direct sales');
    if (leadForms.length) model.push('lead generation (' + leadForms.length + ' form' + (leadForms.length > 1 ? 's' : '') + ')');
    const donationAsk = supportPrompt || !!donate || !!cm.fundraises; // a button asks; a story mentioning donations does not
    if (donationAsk) model.push('donations/memberships');
    if (sponsored) model.push('sponsored content');
    // the revenue lines, strongest first: one host or quote per line, so a reader can check each claim
    const reviewKind = ['review', 'guide', 'listicle'].includes(ctx.pageKind);
    const firstCta = (re) => { const i = anchorText.findIndex((t) => t.length > 1 && t.length < 32 && !/\?\s*$/.test(t) && re.test(t)); return i >= 0 ? ML.normText(anchors[i].innerText || anchors[i].textContent || '') : null; };
    const planMatch = tx.planPricePattern ? full.match(new RegExp(tx.planPricePattern, 'i')) : null;
    const bidderHosts = (hits.advertising || []).filter((k) => !buyOnly.includes(k)).concat(hits.native_ads || []);
    const lines = [];
    if (adBidders && adSlots) lines.push({ key: 'Ads', score: 10 + adBidders * 2, signal: adBidders + ' ad bidder' + (adBidders > 1 ? 's' : ''), quote: 'ads: ' + bidderHosts.slice(0, 2).join(', ') });
    if (affiliate >= 2) lines.push({ key: 'Commissions', score: 10 + affiliate * 2 + (reviewKind ? 100 : 0), signal: affiliate + ' affiliate link' + (affiliate > 1 ? 's' : ''), quote: 'commissions: ' + (ctx.affiliateQuote || affiliate + ' links') });
    if (commerce && (!subscription || cm.addToCart)) { const cta = firstCta(/^(buy|add to|order|shop now|checkout|check out|purchase|pay now|enrol|enroll|claim|complete my|proceed to)\b/i); lines.push({ key: 'Sales', score: 60, signal: cta ? '"' + cta.split(/\s+/).slice(0, 3).join(' ') + '" button' : cm.schemaProduct ? 'product markup' : cm.catalogue ? 'priced product grid' : 'a shopping cart', quote: 'sales: ' + (cta || (cm.schemaProduct ? 'Product markup on the page' : cm.catalogue ? 'priced product grid' : 'a cart link')) }); }
    if (subscription) { const cta = firstCta(new RegExp(tx.subscriptionCtaWords || 'subscribe', 'i')); lines.push({ key: 'Subscriptions', score: 40, signal: planMatch ? ML.normText(planMatch[0]) + ' plan' : cta ? '"' + cta.split(/\s+/).slice(0, 3).join(' ') + '" plan box' : 'a plan box', quote: 'subscriptions: ' + (planMatch ? ML.normText(planMatch[0]) : '') + (cta ? (planMatch ? ', ' : '') + cta : '') }); }
    if (leadForms.length) lines.push({ key: 'Leads', score: 30, signal: leadForms.length + ' lead form' + (leadForms.length > 1 ? 's' : ''), quote: 'leads: ' + ML.normText(leadForms[0].innerText || '').slice(0, 100) });
    if (donationAsk) { const t = donateLink ? ML.normText(donateLink.innerText || donateLink.textContent || '') : null; const ask = t || firstCta(/\b(support|contribute|donate|become a (member|supporter|patron))\b/i); lines.push({ key: 'Donations', score: 12, signal: ask ? '"' + ask.split(/\s+/).slice(0, 3).join(' ') + '" button' : 'a support prompt', quote: 'donations: ' + (ask || 'a support prompt') + (donate ? ' → ' + donate.host : '') }); }
    if (sponsored) { const sp = ctx.lastFindings && ctx.lastFindings.get('source.sponsored_content'); const q = sp && sp.evidence && sp.evidence[0] && sp.evidence[0].quote; lines.push({ key: 'Sponsors', score: 15, signal: 'a sponsored unit', quote: 'sponsors: ' + (q ? String(q).slice(0, 100) : 'a sponsored unit') }); }
    lines.sort((a, b) => b.score - a.score);
    if (lines.length) {
      const top = lines.slice(0, 2);
      const fit = (parts, max) => { const out2 = []; for (const p of parts) { if ((out2.concat(p).join(' ').split(/\s+/).length) > max) break; out2.push(p); } return out2; };
      add({
        id: 'incentives.business_model', name: 'Business model: ' + model.join(' + '), severity: 0, confidence: 0.7, biases: [],
        label: top[0].key + (top[1] ? ' + ' + top[1].key.toLowerCase() : ''), why: (fit(top.map((l) => l.signal), 12).join('; ') || top[0].signal).replace(/^[a-z]/, (c) => c.toUpperCase()) + '.',
        explain: 'What this site appears to earn from your visit, inferred from the page: ' + model.join('; ') + '. Reading the page with that in mind helps.',
        tip: 'Ask of each prominent element: which revenue line does this serve?', evidence: lines.map((l) => ({ quote: l.quote, elId: null })), count: lines.length, meta: { model, lines: lines.map((l) => l.key), adTech, adBidders, dataVendors, affiliate, leadForms: leadForms.length }
      });
    }
    if (!subscription && !commerce && !donation && adSlots && (adBidders + measurement.length >= 3 || brokers.length >= 1)) {
      const brokerNames = Array.from(new Set(brokers.map(brandOf)));
      const brokerPart = brokerNames.length === 0 ? null : brokerNames.length === 1 ? brokerNames[0] + ' works out who you are' : brokerNames.length === 2 ? brokerNames.join(' and ') + ' work out who you are' : brokerNames.length + ' firms work out who you are';
      const bidPart = adBidders + ' companies bid to show ads', verifyPart = verifiers.length ? verifiers.length + ' verify' : null, affPart = affiliate >= 2 ? affiliate + ' links pay commission' : null;
      // twelve words at most: on a review page the commissions outrank the verifiers; the evidence and the explanation keep every role
      const words = (list) => list.filter(Boolean).join(' ').split(/\s+/).length; const chosen = [bidPart, brokerPart].filter(Boolean);
      for (const p of reviewKind ? [affPart, verifyPart] : [verifyPart, affPart]) if (p && words(chosen.concat(p)) <= 12) chosen.push(p);
      const whyLine = [bidPart, verifyPart, brokerPart, affPart].filter((p) => chosen.includes(p)).join(', ') + '.';
      add({
        id: 'incentives.you_are_the_product', name: 'Free to use, paid for with your data', severity: 1, confidence: 0.75, why: whyLine, biases: ['data_capture', 'zero_price_effect'],
        explain: (reviewKind && affiliate >= 2 ? 'This page is paid by ads and commissions. ' : '') + 'Nothing is for sale here, yet this page loads ' + adBidders + ' vendors that bid for its ad slots' + (verifiers.length ? ', ' + verifiers.length + ' that verify ads' : '') + (audience.length ? ', ' + audience.length + ' that count audiences' : '') + (brokerNames.length ? ', and identity services including ' + brokerNames.slice(0, 3).join(', ') : '') + '. The product is your attention and your profile; the content exists to keep you here while they are collected.',
        tip: 'Content blockers remove most of the collection. Ask what the page would look like if it were not optimized for time-on-site.',
        evidence: bidderHosts.slice(0, 3).map((d) => ({ quote: 'bids for ad slots: ' + d, elId: null })).concat(verifiers.slice(0, 1).map((d) => ({ quote: 'verifies ads: ' + d, elId: null })), audience.slice(0, 1).map((d) => ({ quote: 'counts audiences: ' + d, elId: null })), brokers.slice(0, 2).map((d) => ({ quote: 'identity broker: ' + d + (brandOf(d) !== d ? ' (' + brandOf(d) + ')' : ''), elId: null }))), count: 1, meta: { bidders: adBidders, verifiers: verifiers.length, brokers: brokerNames, affiliate }
      });
    }
    if (consentOrPay || copScript) {
      const m = copBanner || copScript; const src = copBanner ? ctx.consentBannerText : (m.input || '');
      add({
        id: 'surveillance.consent_or_pay', category: 'surveillance', name: copBanner ? 'Consent-or-pay wall: refusing cookies routes to a paid tier' : 'Consent-or-pay configured, not shown in this banner', severity: copBanner ? 2 : 0, confidence: 0.8, biases: ['default_effect', 'data_capture'],
        why: copBanner ? undefined : 'Configured for some regions; no pay option shown here.',
        explain: (copBanner ? 'The cookie choice is "accept tracking" or "pay for a subscription". ' : 'The page carries a consent-or-pay setting, but the banner shown here does not offer the pay option; it may apply in other regions. ') + 'Regulators in several EU countries have questioned whether consent given under that choice is freely given; either way, your data is the price of the free tier.',
        tip: 'Reject and leave, or use a content blocker. Do not take a subscription you did not want to escape a banner.', evidence: [{ quote: ML.snippet(src, m.index, m.index + Math.min(m[0].length, 120), 80).slice(0, 300), elId: null }], count: 1
      });
    }
    if (dnsLink) add({
      id: 'incentives.do_not_sell_link', name: '"Do Not Sell or Share" link present', severity: 0, confidence: 0.8, biases: ['default_effect', 'data_capture'],
      explain: 'California law requires a "Do Not Sell or Share" link from businesses that sell personal data or share it for cross-context advertising. Some sites post it as a precaution; either way the link is your opt-out.',
      tip: 'Click it and opt out. Turn on Global Privacy Control in your browser so the opt-out is sent automatically.', evidence: [ML.evidenceFor(dnsLink)], count: 1
    });
    if (leadForms.length) add({
      id: 'incentives.lead_capture', name: 'Lead-capture form' + (leadForms.length > 1 ? 's' : ''), severity: 1, confidence: 0.65, biases: ['data_capture', 'foot_in_door'],
      explain: 'Forms asking for contact details in exchange for a quote, estimate or consultation are typically sold as "leads" to several vendors who will each contact you. The page is the shop window; you are the item.',
      tip: 'Expect calls. Use a separate phone number and email, and ask who the form data is sent to before submitting.', evidence: leadForms.slice(0, 2).map((f) => ML.evidenceFor(f, ML.normText(f.innerText || '').slice(0, 120))), count: leadForms.length
    });

    // policy scan (async, once per page; results arrive through ctx.onAsyncFindings)
    const links = findPolicyLinks(ctx.policyRules.linkWords);
    ctx.policyLinks = links;
    const hasPolicyLink = !!links.privacy || Array.from(document.querySelectorAll('a[href]')).some((a) => { const h = a.getAttribute('href') || ''; return h !== '#' && !/^javascript:/i.test(h) && /\b(privacy|datenschutz|confidentialit|privacidad|legal)\b/i.test((a.innerText || a.textContent || '') + ' ' + h); });
    const needsPolicy = adTech + dataVendors >= 3 || leadForms.length > 0 || commerce || subscription || !!document.querySelector('form input[type=email],form input[type=password]');
    if (!hasPolicyLink && needsPolicy) add({
      id: 'incentives.policy_unavailable', name: 'No privacy policy link found', severity: 0, confidence: 0.55, biases: ['data_capture'],
      explain: 'This page collects data or money but no privacy policy link was found on it. Most jurisdictions require one to be reachable from every page.',
      tip: 'Do not enter personal data on a site that will not say what it does with it.', evidence: [], count: 1
    });
    if (!policyRequested && (links.privacy || links.terms) && ctx.settings.policyScan !== false) {
      policyRequested = true;
      const forRoute = ctx.route; const live = () => ctx.route === forRoute && !ctx.stopped; // muted, or the page moved on: nothing further is requested or reported
      (async () => {
        const scanned = [];
        for (const kind of ['privacy', 'terms']) {
          const u = links[kind]; if (!u || !live()) continue;
          const text = await fetchPolicy(u); if (!live() || !text || text.length < 400) continue;
          scanned.push(...scanPolicy(text.slice(0, 400000), ctx.policyRules, u, kind === 'privacy' ? 'privacy policy' : 'terms', !!(cm.sells || ctx.asks.marketing)));
          if (!ctx.policyEntity && ctx.domConfig.provenance) { // the legal page names the company; provenance reads this on the next scan
            const head = (text.slice(0, 6000) + ' ' + text.slice(-3000)).replace(/[^.]{0,200}\b(trademarks?|registered marks?|service marks?|licensed (by|from|to)|not affiliated|endorsed by|powered by|copyright act)\b[^.]{0,200}\.?/gi, ' ');
            const em = ML.pickEntity(head, ctx.domConfig.provenance.entityPattern, 3); if (em) { ctx.policyEntity = em; ctx.policyEntityKind = kind; if (ctx.requestRescan) ctx.requestRescan(300); } // only a name tied to this site or to "we": policies also name their representatives and vendors
          }
        }
        if (!live()) return;
        // the same clause in the privacy policy and the terms is one finding with both quotes, not the second overwriting the first
        const byId = new Map();
        for (const f of scanned) {
          const had = byId.get(f.id); if (!had) { byId.set(f.id, f); continue; }
          const count = had.count + f.count, first = { url: had.meta.url, kind: had.meta.kind };
          ML.mergeFinding(byId, f); had.count = count; Object.assign(had.meta, first, { alsoIn: { url: f.meta.url, kind: f.meta.kind } });
          had.explain += ' Also found in the ' + f.meta.kind + ' (' + f.meta.url + ').';
        }
        const found = Array.from(byId.values());
        if (ctx.lastFindingsHas && ctx.lastFindingsHas('tracker.data_broker')) for (const f of found) if (f.id === 'policy.data_brokers') { f.severity = 1; f.name += ' (a broker vendor is already observed on the page)'; } // one fact, counted once
        if (found.some((f) => f.id === 'policy.sells_personal_info') && found.some((f) => f.id === 'policy.shares_or_sells_ccpa')) for (const f of found) if (f.id === 'policy.shares_or_sells_ccpa') { f.severity = 1; f.name += ' (same disclosure as the sale clause)'; }
        if (found.some((f) => /^policy\.(sells_personal_info|shares_or_sells_ccpa)$/.test(f.id))) for (const f of out) if (f.id === 'incentives.do_not_sell_link') f.severity = 1; // the link restates the policy
        if (found.length && ctx.onAsyncFindings) ctx.onAsyncFindings(found);
        if (ML.hasChrome && ctx.settings.tosdrLookup) {
          chrome.runtime.sendMessage({ type: 'tosdr', hostname: location.hostname }, (r) => { void chrome.runtime.lastError; if (live() && r && r.finding && ctx.onAsyncFindings) ctx.onAsyncFindings([ML.makeFinding(r.finding)]); });
        }
      })().catch(() => {});
    }
    return out;
  };
  ML.detectors.incentives.reset = () => { policyRequested = false; };
})();
