/* Provenance detector: when the site is not in the ownership dataset, check the common signs of a site that does not
   say who is behind it, and report them as ONE finding (source.unknown_operator) with the checklist behind it. In-page, no network: legally expected pages (privacy, terms, legal notice), a postal address or
   legal entity / registration number, a named copyright holder, how you can reach them (business email, webmail only,
   form only, phone), a free-hosting platform. Opt-in, via the background: the domain's public registration record (RDAP):
   registration date and whether the registrant is named or redacted. Absence is reported as absence, never as intent. */
(function () {
  const ML = window.ML;
  let rdapRequested = false; let sellerPagesRequested = false;

  function allLinks() {
    return Array.from(document.querySelectorAll('a[href]')).map((a) => {
      const href = (a.getAttribute('href') || '').trim(); let path = '';
      try { const u = new URL(href, location.href); if (/^https?:$/.test(u.protocol)) path = (u.pathname + u.hash).toLowerCase(); } catch (e) { /* ignore */ }
      return { a, href, path, text: ML.lower(a.innerText || a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || ''), dead: href === '' || href === '#' || /^javascript:/i.test(href) };
    });
  }
  const textHit = (t, words) => words.some((w) => t === w || t.startsWith(w + ' ') || t.endsWith(' ' + w) || (w.length > 6 && t.includes(w)));
  function pageLink(L, words, hrefWords) { return L.find((l) => !l.dead && (textHit(l.text, words) || (hrefWords || []).some((w) => l.path.includes(w)))) || null; }
  function jsonLdOrgs() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { const j = JSON.parse(s.textContent); const list = Array.isArray(j) ? j : [j]; for (const x of list) { if (x && x['@graph']) list.push(...x['@graph']); if (x && /Organization|LocalBusiness|Corporation|NewsMediaOrganization|Person/i.test(String(x['@type']))) out.push(x); } } catch (e) { /* ignore */ } });
    return out;
  }

  ML.detectors.provenance = function (ctx) {
    const cfg = ctx.domConfig.provenance; const out = [];
    const L = allLinks(); const text = ctx.index.fullText; const host = location.hostname.replace(/^www\./, '');
    const tw = ctx.domConfig.transparency.footerLinkWords;
    const P = {
      host, registrable: ML.registrableDomain(location.hostname), dataset: ctx.outlet ? 'known' : 'unknown',
      pages: {
        privacy: !!pageLink(L, cfg.legalLinkWords.privacy, cfg.legalHrefWords.privacy), terms: !!pageLink(L, cfg.legalLinkWords.terms, cfg.legalHrefWords.terms), imprint: !!pageLink(L, cfg.legalLinkWords.imprint, cfg.legalHrefWords.imprint),
        about: !!pageLink(L, tw.about.concat(['über uns', 'wir über uns', 'qui sommes-nous', 'quiénes somos', 'company']), ['/about', '/ueber', '/company']), contact: !!pageLink(L, tw.contact.concat(['kontakt', 'contacto', 'nous contacter', 'hilfe']), ['/contact', '/kontakt', '/help']), corrections: !!pageLink(L, tw.corrections, ['/corrections', '/standards', '/ethics'])
      }
    };
    const footerEl = document.querySelector('footer, [role="contentinfo"]'); const rawFooter = footerEl ? String(footerEl.innerText || '').slice(0, 4000) : ''; const footerText = ML.normText(rawFooter);
    // the operator is named in the footer or at the end of the page; anywhere else, an address or company name is what the page is about
    const idText = footerText + ' ' + text.slice(-4000);
    const addr = idText.match(new RegExp(cfg.addressPattern)); const reg = idText.match(new RegExp(cfg.registrationPattern, 'i'));
    // legal forms (Inc, LLC, Ltd, GmbH ...) count anywhere; organisation words (Foundation, Trust, Company ...) only in the footer, where they name the operator rather than a product or a headline
    const ent = ML.pickEntity(idText.replace(/[^.]{0,200}\b(trademarks?|registered marks?|service marks?|licensed (by|from|to)|not affiliated|endorsed by|powered by)\b[^.]{0,200}\.?/gi, ' '), cfg.entityPattern); // organisation words are judged on the copyright line only (copyrightEntity below): footers carry link lists where "Company" is a heading
    const addressEl = Array.from(document.querySelectorAll('address')).find((a) => ML.isVisible(a) && ML.normText(a.innerText).length > 12);
    P.address = addr ? ML.normText(addr[0]).slice(0, 80) : addressEl ? ML.normText(addressEl.innerText).slice(0, 80) : null;
    P.entity = ent || null;
    P.registration = reg ? ML.normText(reg[0]).slice(0, 60) : null;
    const orgs = jsonLdOrgs(); const org = orgs.find((o) => o.legalName || o.address || o.taxID || o.vatID || o.duns);
    P.orgSchema = org ? ML.normText(String(org.legalName || org.name || org['@type'])).slice(0, 80) : null;
    // the raw footer keeps its line breaks, so the holder stops at the end of the line. Without a footer line, the end of the page text is read,
    // skipping a credit for a work printed in the content ("Adapted from The Barefoot Contessa Cookbook, Copyright 1999 by Ina Garten,
    // Clarkson Potter/Publisher" named a cookbook's author as a recipe site's operator, 16 Nov 2026 review)
    const CREDIT = /(adapted|excerpted|reprinted|reproduced|abridged|taken|recipe|courtesy|cookbook|book|photograph|photo|image|illustration|lyrics|poem|used with permission|from the)\b[^.\n]{0,140}$/i;
    const tailCopyright = () => { const tail = text.slice(-4000); const re = new RegExp(cfg.copyrightPattern, 'gi'); let m; while ((m = re.exec(tail))) { if (!CREDIT.test(tail.slice(Math.max(0, m.index - 160), m.index))) return m; if (m[0].length === 0) re.lastIndex++; } return null; };
    const cr = rawFooter.match(new RegExp(cfg.copyrightPattern, 'i')) || tailCopyright();
    P.copyright = cr ? ML.normText(cr[1]).replace(/^(?:copyright\s*(?:©\s*)?|©\s*)(?:\d{4}(?:\s*[-–]\s*\d{4})?[,\s]+)?/i, '').replace(/\s*(all rights reserved|alle rechte vorbehalten|tous droits|alle rechten voorbehouden|všechna práva vyhrazena|všetky práva vyhradené|todos los derechos reservados|tutti i diritti riservati|wszelkie prawa zastrzeżone|alle rettigheter|alla rättigheter|kaikki oikeudet).*$/i, '').split(/\s[|·]\s|\s[-–]\s(?=[A-Z])|\.\s+(?=[a-z])/)[0].replace(/^[,\s]+|[,\s.]+$/g, '').slice(0, 80) : null;
    if (P.copyright) { P.copyright = P.copyright.replace(/\s+(Accessibility|Terms|Privacy|Contact|Site ?map|Cookies?|Legal|About|Careers|Do Not Sell|Your Privacy|Help|Powered by|Omogućuje|Impressum|Datenschutz|AGB|Kontakt)\b.*$/i, '').trim(); P.copyright = P.copyright.replace(/\s+(19|20)\d{2}$/, '').trim(); if (P.copyright.split(/\s+/).length > 8) P.copyright = null; } // a flat footer runs straight on into its links; past eight words it is not a name
    if (P.copyright && (/^(\d{4}|the|all)$/i.test(P.copyright) || !/\p{L}{2}/u.test(P.copyright))) P.copyright = null;
    if (P.copyright) { const onCr = ML.pickEntity(P.copyright, cfg.entityPattern); if (onCr) P.entity = onCr; }
    if (P.entity) P.entity = P.entity.replace(/^\d{4}(\s*[-–]\s*\d{4})?[,\s]+/, '');
    if (P.entity && /^(USA|US|UK|America),?\s/.test(P.entity)) P.entity = null; // the tail of 'Some Name, USA, Inc.' is not a name // the copyright line's own legal name beats a fragment found elsewhere
    const par = idText.match(new RegExp(cfg.parentPattern)); P.parent = par ? ML.normText(par[1]).slice(0, 60) : null;
    P.copyrightEntity = !!(P.copyright && (new RegExp(cfg.entityPattern).test(P.copyright) || (cfg.orgEntityPattern && new RegExp(cfg.orgEntityPattern).test(P.copyright))));
    const emails = new Set();
    for (const l of L) if (/^mailto:/i.test(l.href)) { const e = l.href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase(); if (e) emails.add(e); }
    for (const m of text.match(new RegExp(cfg.emailPattern, 'g')) || []) emails.add(m.toLowerCase());
    P.emails = Array.from(emails).slice(0, 5);
    P.webmailOnly = P.emails.length > 0 && P.emails.every((e) => cfg.webmailDomains.includes(e.split('@')[1]));
    const ldPhone = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((sc) => /"telephone"\s*:\s*"[^"]*\d{3}/.test(sc.textContent || '')); // a telephone in the page's structured data counts too, so 'no phone' is said only when none is anywhere
    P.phone = !!(L.some((l) => /^tel:/i.test(l.href)) || ML.findPhone(text, cfg) || ldPhone);
    P.contactForm = !!document.querySelector('form textarea');
    const m = ctx.masthead || {}; P.author = !!m.hasAuthor; P.date = !!m.hasDate;
    P.platform = cfg.platformHosts.find((h) => host.endsWith('.' + h) && host.replace(/^www\./, '') !== h) || null; // the platform's own site is not one of its tenants
    // a custom domain served from a hosting platform's CDN is platform-hosted too (Substack, Shopify, Wix ...)
    if (!P.platform && cfg.platformAssets) {
      // the site's own theme code (scripts, stylesheets), not images: a news page embedding product photos from a shop's CDN is not
      // that shop (16 Nov 2026, Good Morning America read as a Shopify store)
      const assetHosts = new Set(); for (const el of document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) { try { const u = new URL(el.src || el.href, location.href); assetHosts.add(u.hostname); } catch (e) { /* ignore */ } if (assetHosts.size > 400) break; }
      for (const h of assetHosts) { const k = Object.keys(cfg.platformAssets).find((a) => h === a || h.endsWith('.' + a)); if (k && !host.endsWith(k) && MLCommon.registrableDomain(h) !== MLCommon.registrableDomain(host)) { P.platform = cfg.platformAssets[k]; P.platformVia = 'assets'; break; } }
    }
    // institutional top-level domains identify the operator class (a .gov registrant is a government body by registry rule)
    const tldHit = Object.keys(cfg.institutionTlds || {}).find((t) => host.endsWith(t) || host === t.slice(1)); P.institution = tldHit ? cfg.institutionTlds[tldHit] : null;
    // the copyright line beats a company name found elsewhere unless that name is plainly this site's (Otto's page text named Meta; its copyright line named Otto)
    // ...unless the page says this company runs the site ('operated by', 'beheerd door', a registration number right after it)
    const runsIt = (e) => { const i = idText.indexOf(e); if (i < 0) return false; const before = idText.slice(Math.max(0, i - 50), i); const after = idText.slice(i + e.length, i + e.length + 60);
      return /(operated|run|managed|owned|provided)\s+by\s*$|beheerd\s+door\s*$|betrieben\s+von\s*$|provozovatel(em)?\s*(je|:)?\s*$|prodávající\s*(je|:)?\s*$|(firma|společnost|company|unternehmen|bedrijf)\s*:?\s*$/i.test(before) || new RegExp('^[\\s,|·-]{0,6}(?:' + cfg.registrationPattern + ')', 'i').test(after); };
    if (P.entity && P.copyright && !ML.sharesBrand(P.entity) && !P.copyright.includes(P.entity) && !runsIt(P.entity)) P.entity = null;
    if (!P.entity && ctx.policyEntity) { P.entity = ctx.policyEntity; P.entityVia = ctx.policyEntityKind; }
    // what the site's own contact, legal-notice, terms or about pages say (ML.followSellerPages, below); the facts then name the page they came from
    const off = ctx.provenance && ctx.provenance.offPage && ctx.provenance.offPage.host === host ? ctx.provenance.offPage : null;
    if (off) { P.offPage = off;
      if (!P.entity && off.entity) { P.entity = off.entity; P.entityVia = off.kind; }
      if (!P.registration && off.registration) P.registration = off.registration;
      if (!P.address && off.address) P.address = off.address;
      if (!P.phone && off.phone) { P.phone = true; P.phoneVia = off.phoneKind; } }
    P.social = L.some((l) => /^https?:\/\/(www\.)?(twitter\.com|x\.com|github\.com|linkedin\.com|mastodon\.|bsky\.app|news\.ycombinator\.com\/user)/i.test(l.href));
    // a parent named in the footer identifies the operator; so does a full organisation name in the copyright line beside legal pages. A shop owes more: its route is the legal form or namedOperator below.
    const sellsHere = !!((ctx.commerce || {}).sells || document.querySelector('form input[type=password]'));
    if (P.parent && /^(American|British|Canadian|German|French|European|Delaware|Fortune|Global|Family|Small|Local|New|US|UK)\b/.test(P.parent)) P.parent = null; // "a Delaware company" says where, not who
    const capitalisedHolder = !!(P.copyright && /^(?:The\s+)?\p{Lu}[\p{L}\d&'.-]*(?:\s+(?:of|for|and|the|&|de)?\s*\p{Lu}[\p{L}\d&'.-]*)+/u.test(P.copyright));
    P.identity = !!(P.address || P.entity || P.registration || P.orgSchema || P.copyrightEntity || P.institution || P.pages.imprint || P.parent || (capitalisedHolder && !sellsHere && (P.pages.privacy || P.pages.terms))); // a legal-notice page names the operator
    // a copyright holder plus the full set of legal pages names an operator, even without a legal form after the name
    P.namedOperator = !P.identity && !!(P.copyright && P.pages.privacy && (P.pages.terms || P.pages.imprint) && (P.pages.contact || P.emails.length));
    if (P.institution) P.dataset = ctx.outlet ? 'known' : 'institution';
    ctx.provenance = Object.assign(P, ctx.provenance && ctx.provenance.rdap ? { rdap: ctx.provenance.rdap } : {}, off ? { offPage: off } : {});
    if (ctx.outlet || P.institution) return out; // the dataset or the registry answers the question; nothing to flag

    // One finding, not six: the signals below roll up into source.unknown_operator. Tier 1 is the label, tier 2 names the
    // two or three strongest failed checks, tier 3 (the Source card) holds the full checklist. Site type sets the stakes
    // (Google rater guidelines 2.5.3 / 5.5): a shop or a heavily tracked page owes more than a personal page with a byline.
    const trackers = (ctx.thirdPartyDomains || []).length;
    const cmc = ctx.commerce || {}; const commerce = !!(cmc.sells || document.querySelector('form input[type=password]'));
    const tracked = trackers >= 3;
    const personal = !commerce && P.author; // a byline or alias is the accepted minimum for a personal site
    const dach = /^de\b/i.test(document.documentElement.lang || ''); // a legal notice (Impressum) is required by law on German-language commercial sites
    const signals = []; // { id, severity, short, note }
    const missing = ['privacy', 'terms', 'imprint'].filter((k) => !P.pages[k]);
    if ((!P.pages.privacy && !ctx.lastFindingsHas('incentives.policy_unavailable')) || (dach && !P.pages.imprint)) signals.push({ id: 'legal_pages', severity: dach && !P.pages.imprint ? 2 : personal || (P.identity && !commerce) || !(commerce || tracked) ? 0 : 1, short: 'no legal pages', note: 'No working link to a ' + missing.map((k) => ({ privacy: 'privacy policy', terms: 'terms page', imprint: 'legal notice' })[k]).join(', ') + '.' });
    if (!P.identity && !commerce && P.pages.about) signals.push({ id: 'about_only', severity: 0, short: 'named on its About page only', note: 'An About page is linked; no company name or address appears on this page, which is normal for a personal site.' });
    else if (!P.identity && P.namedOperator) signals.push({ id: 'named_only', severity: 0, short: 'named only in the copyright line (' + P.copyright + ')', note: 'The copyright line names "' + P.copyright + '" and the legal pages are present, but no street address, legal form or registration number appears on this page.' });
    else if (!P.identity) signals.push({ id: 'identity', severity: personal || P.platform ? 0 : commerce ? 2 : tracked ? 1 : 0, short: 'no company name on this page', note: 'No street address, company name with a legal form, registration or VAT number, or organization markup.' + (P.copyright ? ' The copyright line reads "' + P.copyright + '".' : ' There is no copyright line.') });
    if (P.webmailOnly) signals.push({ id: 'webmail', severity: 0, short: 'webmail-only contact', note: 'The only email address is on a free webmail service (' + P.emails[0].split('@')[1] + ').' });
    else if (!P.emails.length && !P.phone && !P.pages.contact && !P.social) signals.push({ id: 'contact', severity: commerce && !P.platform && !P.identity ? 1 : 0, short: 'no contact route on this page', note: 'No email address, phone number or contact page.' + (P.contactForm ? ' There is a form.' : '') });
    if (P.platform) signals.push({ id: 'platform', severity: 0, short: 'hosted on ' + P.platform, note: 'Hosted on ' + P.platform + (P.platformVia === 'assets' ? ' under a custom domain' : '') + '; the account holder, not the platform, is the publisher, and payments usually run through the platform.' });
    const rec = P.rdap;
    if (rec && !rec.error && !rec.notFound) {
      if (rec.ageDays != null && rec.ageDays < cfg.recentDomainDays.info) signals.push({ id: 'recent_domain', severity: rec.ageDays >= cfg.recentDomainDays.flag ? 0 : commerce && !P.identity ? 2 : 1, short: 'domain ' + ageText(rec.ageDays) + ' old', note: 'Registered ' + rec.registered.slice(0, 10) + (rec.registrar ? ' via ' + rec.registrar : '') + '.' });
      if (rec.redacted && !rec.registrantUnknown) signals.push({ id: 'hidden_registrant', severity: P.identity || P.platform ? 0 : 1, short: 'registrant hidden', note: 'The registration record names no person or organization (privacy service or GDPR redaction, which most registrars apply by default).' });
    }
    P.signals = signals;
    const thin = ctx.index && ctx.index.chars < 1000; // most of the page has not loaded or was blocked: absence means nothing yet
    const severity = !thin && signals.length ? Math.max(...signals.map((x) => x.severity)) : 0;
    const operatorName = P.entity || P.orgSchema || P.copyright || P.parent || P.registration || null;
    if ((P.identity || P.namedOperator) && severity === 0) {
      // the operator is named and nothing failed: a positive fact, not a flag
      if (operatorName || P.address) out.push(ML.makeFinding({
        id: 'source.named_operator', category: 'source_funding', name: operatorName ? 'Operator named: ' + operatorName : 'An address, no company name', severity: 0, confidence: 0.7, biases: [], label: 'Named operator', why: operatorName ? ('Operator: ' + String(operatorName).replace(/^©\s*/, '').split(/\s+/).slice(0, 8).join(' ') + '.').replace(/\.\.$/, '.') : 'A street address is on this page.',
        explain: 'This site is not in the ownership dataset; the page itself names who runs it. ' + signals.map((x) => x.note).join(' '), tip: '', evidence: [{ quote: P.copyright ? '© ' + P.copyright.replace(/^©\s*/, '') : String(operatorName || P.address), elId: null }], count: 1, meta: { signals: signals.map((x) => x.id) }
      }));
    } else if (signals.some((x) => x.id !== 'platform')) {
    const strongest = signals.filter((x) => x.id !== 'platform').slice().sort((a, b) => b.severity - a.severity).slice(0, 3); // the platform is context for the checklist, not a failed check
    const whyParts = []; for (const x of (strongest.length ? strongest : signals)) { if (whyParts.length && whyParts.concat(x.short).join(' ').split(/\s+/).length > 12) break; whyParts.push(x.short); } // twelve words at most; the checklist holds the rest
    const why = whyParts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
    const evidence = [];
    if (P.copyright) evidence.push({ quote: '© ' + P.copyright, elId: null });
    if (P.webmailOnly) evidence.push({ quote: P.emails[0], elId: null });
    if (rec && rec.registered) evidence.push({ quote: 'registered ' + rec.registered.slice(0, 10) + (rec.registrar ? ' via ' + rec.registrar : ''), elId: null });
    for (const x of strongest) evidence.push({ quote: 'check failed: ' + x.short, elId: null });
    out.push(ML.makeFinding({
      id: 'source.unknown_operator', category: 'source_funding', name: 'Site does not say who runs it (' + signals.length + ' of the provenance checks failed)', severity, confidence: severity ? 0.7 : 0.6,
      label: P.identity || P.namedOperator ? 'Operator checks' : 'Unnamed operator', why,
      biases: ['authority_bias'],
      explain: 'This site is not in the ownership dataset' + (P.identity || P.namedOperator ? '. The page names an operator, but these checks failed. ' : ', and the page itself names nobody accountable. ') + signals.map((x) => x.note).join(' ') + ' Honest small sites sometimes omit some of this; sites that would rather not be held accountable omit all of it.',
      tip: 'Open the Source card for the full checklist and the one-click lookups. Give the site nothing it can keep until someone is named.',
      evidence, count: signals.length, meta: { signals: signals.map((x) => x.id), checks: { pages: P.pages, address: !!P.address, entity: !!(P.entity || P.registration || P.orgSchema), copyright: P.copyright, author: P.author, emails: P.emails.length, phone: P.phone, platform: P.platform, rdap: rec ? (rec.error ? 'error' : rec.notFound ? 'none' : 'ok') : 'off' } }
    }));
    }

    // a shop that names no company or phone on this page: read its own contact, legal-notice and terms pages and its sitemap, once, same site only (ML.followSellerPages)
    if (!sellerPagesRequested && ML.hasChrome && ML.followSellerPages && ctx.settings.sellerPages !== false && sellsHere && !ctx.outlet && !P.institution && (!P.identity || !P.phone)) {
      sellerPagesRequested = true;
      ML.followSellerPages(ctx, P).then((r) => { if (r && ctx.provenance) { ctx.provenance.offPage = r; if (ctx.requestRescan) ctx.requestRescan(300); } }).catch(() => {});
    }
    // registration record (opt-in): the background sends only the registrable domain; the result lands in ctx.provenance
    // and a quick rescan folds it into the same finding
    if (!rdapRequested && ML.hasChrome && ctx.settings.rdapLookup && P.registrable && !P.platform && !P.institution) {
      rdapRequested = true;
      chrome.runtime.sendMessage({ type: 'rdap', domain: P.registrable }, (r) => {
        void chrome.runtime.lastError;
        if (ctx.provenance) ctx.provenance.rdap = (r && r.record) || { error: (r && r.error) || 'no response' };
        if (ctx.requestRescan) ctx.requestRescan(300);
      });
    }
    return out;
  };
  function ageText(days) { if (days < 60) return days + ' days'; if (days < 730) return Math.round(days / 30) + ' months'; return (days / 365).toFixed(1).replace(/\.0$/, '') + ' years'; }
})();
