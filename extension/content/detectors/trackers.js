/* Tracker & affiliate detector: third-party hosts contacted by the page, matched against rules/trackers.json. */
(function () {
  const ML = window.ML;
  const CATEGORY_MAP = {
    advertising: 'surveillance', analytics: 'surveillance', session_replay: 'surveillance', social_pixel: 'surveillance', fingerprinting: 'surveillance',
    marketing_automation: 'surveillance', ab_testing: 'surveillance', push_notifications: 'surveillance', chat_widget: 'attention', consent_manager: 'surveillance',
    social_proof_widget: 'social_proof', urgency_widget: 'urgency_scarcity', popup_capture: 'attention', bnpl: 'bias_exploit', affiliate: 'source_funding', native_ads: 'dark_pattern', data_broker: 'incentives',
    ad_measurement: 'surveillance', identity: 'surveillance', bot_defence: 'surveillance', fraud_check: 'surveillance', reviews_widget: 'social_proof', funnel_builder: 'attention'
  };
  const BIASES = {
    session_replay: ['data_capture'], fingerprinting: ['data_capture', 'lock_in'], social_pixel: ['data_capture', 'personalization'], advertising: ['personalization', 'data_capture'],
    analytics: ['data_capture'], marketing_automation: ['data_capture', 'interruption'], ab_testing: ['personalization', 'framing'], push_notifications: ['interruption', 'fomo'],
    chat_widget: ['interruption', 'liking'], consent_manager: ['default_effect'], social_proof_widget: ['social_proof', 'fomo'], urgency_widget: ['scarcity', 'loss_aversion'],
    popup_capture: ['interruption', 'data_capture', 'reciprocity'], bnpl: ['hyperbolic_discounting', 'pain_of_paying'], affiliate: ['authority_bias', 'halo_effect'], native_ads: ['halo_effect', 'curiosity_gap'], data_broker: ['data_capture', 'lock_in'],
    ad_measurement: ['data_capture'], identity: ['data_capture', 'lock_in'], bot_defence: ['data_capture'], fraud_check: ['data_capture'], reviews_widget: ['social_proof'], funnel_builder: ['framing']
  };
  const hostIn = (host, reg, key) => host === key || host.endsWith('.' + key) || reg === key;
  // where a link really goes: a publisher's redirect carries the destination in its query string
  function destinationHost(u, params) { for (const p of params) { const v = u.searchParams.get(p); if (v && /^https?:/i.test(v)) { try { return new URL(v).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ } } } return null; }

  function collectUrls() {
    const urls = new Set();
    try { performance.getEntriesByType('resource').forEach((e) => urls.add(e.name)); } catch (e) { /* ignore */ }
    document.querySelectorAll('script[src],iframe[src],img[src],link[href],source[src],video[src],audio[src],embed[src],object[data]').forEach((el) => {
      const u = el.src || el.href || el.getAttribute('data'); if (u) urls.add(String(u));
    });
    document.querySelectorAll('link[rel~="preconnect"],link[rel~="dns-prefetch"]').forEach((l) => { if (l.href) urls.add(l.href); });
    return Array.from(urls);
  }

  ML.detectors.trackers = function (ctx) {
    const T = ctx.trackers, out = [];
    const pageDomain = ML.registrableDomain(location.hostname);
    const urls = collectUrls();
    const hits = {}; // category -> Map(vendorDomain -> count)
    const thirdParty = new Set();
    const domainKeys = Object.keys(T.domains);
    const names = T.vendorNames || {}; const brand = (k) => names[k] || k;
    // a vendor's URL says what role the site plays: an advertiser pixel buys placements, a publisher widget sells them
    const roles = (T.urlRoles || []).map((r) => Object.assign({ re: new RegExp(r.pattern, 'i') }, r));
    const buyRole = new Map(); // advertising vendor -> seen only as a buy-side pixel?
    for (const u of urls) {
      let host; try { host = new URL(u, location.href).hostname; } catch (e) { continue; }
      if (!host) continue;
      const reg = ML.registrableDomain(host);
      if (reg === pageDomain) continue;
      thirdParty.add(reg);
      const lower = u.toLowerCase();
      const role = roles.find((r) => r.re.test(u));
      if (role && role.role === 'ignore') continue;
      if (role && role.category) {
        const key = role.vendor || reg; hits[role.category] = hits[role.category] || new Map(); hits[role.category].set(key, (hits[role.category].get(key) || 0) + 1);
        if (role.category === 'advertising') buyRole.set(key, role.role === 'buy' && buyRole.get(key) !== false);
        continue;
      }
      for (const key of domainKeys) {
        const cat = T.domains[key];
        let match = false;
        if (key.includes('/')) match = lower.includes(key);
        else match = host === key || host.endsWith('.' + key) || reg === key;
        if (match) { hits[cat] = hits[cat] || new Map(); hits[cat].set(key, (hits[cat].get(key) || 0) + 1); if (cat === 'advertising') buyRole.set(key, false); break; }
      }
    }
    // ad space for sale: an ad server or header bidding, or several exchanges at once. One exchange or a conversion pixel is buying ads, not selling them.
    const adServer = urls.some((u) => new RegExp(T.sellSidePattern, 'i').test(u));
    const exchanges = (T.sellSideExchanges || []).filter((d) => urls.some((u) => { try { const h = new URL(u, location.href).hostname; return hostIn(h, ML.registrableDomain(h), d); } catch (e) { return false; } })).length;
    ctx.adServerSeen = adServer;
    const verifying = hits.ad_measurement ? (T.adVerificationHosts || []).some((d) => hits.ad_measurement.has(d)) : false; // audience counters sit on any site; ad verification follows ad slots
    ctx.sellSideAds = adServer || exchanges + (verifying ? 1 : 0) >= 3;
    ctx.buyOnlyAds = Array.from(buyRole.keys()).filter((k) => buyRole.get(k) === true);
    const buyCopy = (ctx.labels && ctx.labels.labels && ctx.labels.labels['tracker.advertising.buy']) || {};
    for (const cat of Object.keys(hits)) {
      const info = T.categoryInfo[cat]; if (!info) continue;
      if (cat === 'affiliate') continue; // merged into source.affiliate_links below: one fact, one finding, severity set by the disclosure
      const vendors = Array.from(hits[cat].keys());
      const buySide = cat === 'advertising' && !ctx.sellSideAds;
      out.push(ML.makeFinding({
        id: 'tracker.' + cat, category: CATEGORY_MAP[cat] || 'surveillance', name: (buySide ? 'Ad pixels' : info.name) + ' (' + vendors.length + ')', severity: info.severity, confidence: 0.9,
        label: buySide ? buyCopy.label : undefined, why: buySide ? buyCopy.why : undefined,
        biases: BIASES[cat] || ['data_capture'],
        explain: info.explain + ' Detected: ' + vendors.slice(0, 8).join(', ') + (vendors.length > 8 ? ' and ' + (vendors.length - 8) + ' more' : '') + '.',
        tip: cat === 'data_broker' ? 'Opt out at the broker (most have a page) and turn on Global Privacy Control. Assume anything you enter here can be joined to a purchasable profile.' : cat === 'session_replay' ? 'Assume anything you type here, including text you delete before submitting, may be recorded. A tracker blocker (uBlock Origin, Privacy Badger) stops most of these.' : cat === 'social_proof_widget' || cat === 'urgency_widget' ? 'The urgency and activity messages on this page are generated by a vendor whose product is manufacturing them. Ignore them.' : 'A content blocker removes most of this. Firefox and Safari block many of these by default.',
        evidence: vendors.slice(0, 6).map((v) => ({ quote: v + (cat === 'advertising' && buyRole.get(v) === true ? ' (advertiser pixel)' : names[v] ? ' (' + names[v] + ')' : ''), elId: null })), count: vendors.length, meta: { vendors, buySide: buySide || undefined }
      }));
    }
    // fonts, CDNs, payment processors and consent platforms are how the page gets built, not who learns you were here
    const infra = T.infrastructureHosts || []; const companies = Array.from(thirdParty).filter((d) => !infra.includes(d));
    if (companies.length >= 20) {
      const named = new Set(); for (const cat of Object.keys(hits)) if (cat !== 'consent_manager') for (const k of hits[cat].keys()) if (!k.includes(' ')) named.add(k);
      const ordered = Array.from(named).concat(companies.filter((d) => !named.has(d)));
      out.push(ML.makeFinding({
        id: 'tracker.third_party_volume', category: 'surveillance', name: companies.length + ' third-party domains contacted', severity: companies.length >= 40 ? 2 : 1, confidence: 0.8, biases: ['data_capture'],
        why: companies.length + ' other domains were contacted when this page loaded.',
        explain: 'Loading this page sent requests to ' + companies.length + ' domains other than the site itself, not counting fonts, CDNs, payment processors and consent platforms. Each one receives your IP address and learns that you are here.',
        tip: 'A content blocker trims this dramatically.', evidence: ordered.slice(0, 8).map((d) => ({ quote: d, elId: null })), count: companies.length
      }));
    }

    // affiliate links
    const patterns = T.affiliateUrlPatterns.map((p) => new RegExp(p, 'i'));
    const affDomains = domainKeys.filter((k) => T.domains[k] === 'affiliate');
    const affLinks = []; const softRedirects = [];
    const redirectRe = new RegExp(T.affiliateRedirectPathPattern, 'i'), softRe = new RegExp(T.affiliateRedirectSoftPathPattern, 'i'); const destParams = T.affiliateDestinationParams || [];
    const isSponsored = (a) => /\bsponsored\b/i.test(a.getAttribute('rel') || '');
    // sponsored-story widgets (Taboola, Outbrain and similar) are ads sold by the widget company, reported as native ads; their links are not the
    // publisher's commission links. Counting them called a Fox News opinion column "a commissioned recommendation page" (16 Nov 2026 review).
    const NATIVE_WIDGET = '[id*="taboola" i],[class*="taboola" i],[id*="outbrain" i],[class*="outbrain" i],[class*="revcontent" i],[id*="revcontent" i],[class*="mgid" i],[id*="mgid" i],[class*="zergnet" i],[id*="zergnet" i],[class*="nativo" i],[id*="nativo" i]';
    const NATIVE_HOST = /(^|\.)(taboola|outbrain|revcontent|mgid|zergnet|nativo)\.com$/i;
    const anchors = Array.from(document.querySelectorAll('a[href]')).slice(0, 3000);
    for (const a of anchors) {
      const href = typeof a.href === 'string' ? a.href : (a.getAttribute('href') || ''); if (!href || href.startsWith('javascript:')) continue; // SVG <a> has an object here
      let parsed; try { parsed = new URL(href); } catch (e) { continue; } const host = parsed.hostname;
      if (NATIVE_HOST.test(host) || (a.closest && a.closest(NATIVE_WIDGET))) continue;
      if (ML.registrableDomain(host) === pageDomain) {
        // a site's own links carry its own tracking (Amazon's ref=), not a commission; but a redirect through its own domain to another merchant is the review-site form of the same link
        const dest = destinationHost(parsed, destParams); const out3rd = dest && ML.registrableDomain(dest) !== pageDomain;
        if (isSponsored(a) || (out3rd && (redirectRe.test(parsed.pathname) || softRe.test(parsed.pathname) || /^\/(v\d+\/otc|api\/v\d+\/adredirect)/i.test(parsed.pathname)))) { affLinks.push(a); if (affLinks.length >= 60) break; }
        else if (redirectRe.test(parsed.pathname)) softRedirects.push(a); // /go/pricing twice is navigation; three or more slug redirects are a pattern
        continue;
      }
      const lower = href.toLowerCase();
      const isAff = isSponsored(a) || patterns.some((re) => re.test(href)) || affDomains.some((d) => host === d || host.endsWith('.' + d) || (d.includes('/') && lower.includes(d)));
      if (isAff) { affLinks.push(a); if (affLinks.length >= 60) break; }
    }
    // a link-rewriting script (Skimlinks, Sovrn Commerce) pays on click whatever the links look like in the page
    const rewriters = hits.affiliate ? Array.from(hits.affiliate.keys()) : [];
    const networkOf = (host) => { const k = Object.keys(names).find((d) => host === d || host.endsWith('.' + d)); return k ? names[k] : null; };
    const linkQuote = (a) => {
      let host = '', dest = null; try { const u = new URL(a.href); host = u.hostname.replace(/^www\./, ''); dest = destinationHost(u, destParams); } catch (e) { /* ignore */ }
      const net = networkOf(host) || (dest && networkOf(dest));
      const img = a.querySelector('img[alt]'); const text = ML.normText(a.innerText || a.textContent || a.getAttribute('aria-label') || (img && img.alt) || '').slice(0, 60);
      return ((text ? text + ' → ' : '') + (dest || host) + (dest ? ' via ' + host : '') + (net ? ' (' + net + ')' : '')).slice(0, 140);
    };
    const ownOffer = ctx.commerce && ctx.commerce.sells && !ctx.commerce.editorial; // a seller's own pricing page linking to a sister brand is not a review earning commission
    if (affLinks.length >= (ownOffer ? 5 : 2) || rewriters.length) {
      const disclosed = new RegExp(T.affiliateDisclosurePattern, 'i').test(ctx.index.fullText) || (ctx.lastFindingsHas && ctx.lastFindingsHas('source.affiliate_disclosure'));
      const noun = ctx.commerce && (ctx.commerce.catalogue || ctx.commerce.addToCart) ? 'listings' : 'deal links';
      const scriptOnly = affLinks.length < 2;
      const rewriterNames = Array.from(new Set(rewriters.map(brand)));
      out.push(ML.makeFinding({
        id: 'source.affiliate_links', category: 'source_funding', name: (scriptOnly ? 'Affiliate link-rewriting script' : affLinks.length + ' affiliate / tracking links') + (disclosed ? ' (disclosed)' : ' (no disclosure found)'), severity: disclosed ? 1 : 2, confidence: 0.85,
        why: scriptOnly ? rewriterNames[0] + ' is loaded: it can turn ordinary outbound links into paid ones on click. ' + (affLinks.length ? 'Only one affiliate link was found in the page itself.' : 'No affiliate links were found in the page itself.') : affLinks.length + ' ' + noun + ' pay the publisher when you buy' + (disclosed ? '; disclosed.' : '.'),
        biases: ['authority_bias', 'halo_effect', 'reciprocity'],
        explain: 'Links on this page carry affiliate or partner tracking, so the publisher earns a commission when you buy. ' + (rewriters.length ? 'A link-rewriting script (' + rewriterNames.join(', ') + ') also turns ordinary links into paid ones on click. ' : '') + (disclosed ? 'The page discloses this, as regulators require.' : 'No disclosure statement was found, which US FTC and UK ASA rules require.') + ' Compensated recommendations skew toward products with the best commissions, not the best products.',
        tip: 'Treat "best X of 2026" lists with affiliate links as advertising. Check independent, non-commissioned reviews.',
        evidence: affLinks.slice().sort((a, b) => (ML.normText(b.innerText || '') ? 1 : 0) - (ML.normText(a.innerText || '') ? 1 : 0)).slice(0, 4).map((a) => ML.evidenceFor(a, linkQuote(a))).concat(rewriters.slice(0, 2).map((v) => ({ quote: 'link-rewriting script: ' + v + (names[v] ? ' (' + names[v] + ')' : ''), elId: null }))), count: Math.max(affLinks.length, 1), meta: { disclosed, scriptOnly, vendors: rewriterNames, links: affLinks.length }
      }));
    }
    ctx.affiliateQuote = affLinks.length ? linkQuote(affLinks[0]) : null;
    const fh = ctx.domConfig.fundingHosts || {}; ctx.fundingVendors = Object.keys(fh).filter((k) => urls.some((u) => u.includes(k))).map((k) => fh[k]);
    ctx.thirdPartyDomains = companies;
    { const keys = []; for (const cat of Object.keys(hits)) for (const k of hits[cat].keys()) keys.push(String(k).split('/')[0]); // what the hand-kept list did not name, for the public lists the background holds (tracker-lists.json)
      ctx.unnamedThirdParty = companies.filter((d) => !keys.some((k) => d === k || k.endsWith('.' + d) || d.endsWith('.' + k))).slice(0, 300); }
    ctx.trackerHits = {}; for (const c of Object.keys(hits)) ctx.trackerHits[c] = Array.from(hits[c].keys());
    ctx.affiliateLinks = affLinks.length;
    for (const a of anchors) { const h = a.getAttribute('href') || ''; for (const k of Object.keys(ctx.domConfig.fundingHosts || {})) if (h.includes(k) && !ctx.fundingVendors.includes(ctx.domConfig.fundingHosts[k])) ctx.fundingVendors.push(ctx.domConfig.fundingHosts[k]); }
    return out;
  };
})();
