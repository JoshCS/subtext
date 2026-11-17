/* Follow a shop's own pages (the owner, 2026-11-06: "shouldn't we always check the site map and see if other pages have the required stuff?").
   When a page that sells names no company or no phone, read up to five of the site's own pages: its contact, legal-notice, terms and about
   links, and the matching entries of its sitemap. Same registrable domain only, through the background worker (no cookies, no referrer),
   once per page load. Returns what those pages name, and which page named it, so the seller facts can say "named on its contact page".
   Nothing about the reader is sent: the site only learns that its own public pages were read. A setting (sellerPages) turns it off. */
(function () {
  const ML = window.ML;
  const KIND = [ // page kind, words in link text or path, rank
    ['legal notice', /impressum|imprint|legal[ -]?notice|mentions[ -]l[ée]gales|aviso[ -]legal|provozovatel|prev[aá]dzkovate|colofon|bedrijfsgegevens|company[ -]?(info|details)|wettelijke|legal[ -]information/i, 4],
    ['contact page', /kontakt|contact|contatti|contacto|kapcsolat|kontakty|kontaktai|yhteystiedot/i, 3],
    ['terms page', /terms|conditions|voorwaarden|podm[ií]nky|podmienky|\bagb\b|gesch[aä]ftsbedingungen|condiciones|condizioni|regulamin|villkor|vilk[aå]r|\bcgv\b|toimitusehdot/i, 2],
    ['about page', /about|o[ -]n[aá]s|over[ -]ons|[uü]ber[ -]uns|qui[ -]sommes|qui[eé]nes[ -]somos|chi[ -]siamo|o[ -]nas/i, 1]
  ];
  const kindOf = (s) => { for (const [k, re, r] of KIND) if (re.test(s)) return { kind: k, rank: r }; return null; };
  // payment, delivery, platform and financing firms named on a seller's pages are not the seller; nor is a place dressed as a company ('Los Angeles, USA, Inc')
  const NOT_SELLER = /\b(shopify|paypal|stripe|klarna|adyen|mollie|google|meta platforms|facebook|apple|amazon|microsoft|wix|squarespace|woocommerce|automattic|cloudflare|visa|mastercard|american express|gls|dhl|dpd|ups|fedex|zásilkovna|packeta|ppl|comgate|gopay|trustpilot|heureka|shoptet|bnp paribas|bank|banka|sparkasse|commerzbank|rabobank|abn amro|raiffeisen|unicredit|santander|bbva|caixabank|cofidis|consors|younited|oney|floa|afterpay|clearpay|scalapay|ratepay|billie|mondu|alma|payu|przelewy24|twint|sofort|trusted shops|ehi|thuiswinkel)\b|,\s*(usa|us|uk)\s*,?\s*(inc|llc|ltd)\b/i;
  const OPERATOR = /(provozovatel(?:em)?|prodávající|prev[aá]dzkovate[lľ]|operator|operated by|the seller is|seller:|company:|firma:|anbieter|betreiber|verkoper|handelsnaam|sprzedawca|vendedor|titular|exploitant|[ée]diteur|we are|wir sind|wij zijn|jsme)\s*:?\s*/gi;
  const ADDRESS = /[\p{L}.' -]{3,40}\s\d{1,4}[a-zA-Z]?(?:\/\d{1,4}[a-zA-Z]?)?,?\s+(?:\d{3}\s?\d{2}|\d{4}\s?[A-Z]{2}|\d{4,5})\s+\p{Lu}[\p{L}-]+/u;
  const sameSite = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) && ML.registrableDomain(x.hostname) === ML.registrableDomain(location.hostname) ? x : null; } catch (e) { return null; } };
  const fetchText = (url, any) => new Promise((res) => chrome.runtime.sendMessage({ type: 'fetchText', url, any: !!any }, (x) => { void chrome.runtime.lastError; res(x && x.text ? x.text : null); })); // any: the sitemap is XML
  function textOf(html) { try { const doc = new DOMParser().parseFromString(html, 'text/html'); doc.querySelectorAll('script,style,noscript,svg').forEach((e) => e.remove()); doc.querySelectorAll('li,p,h1,h2,h3,h4,tr,br,dd,dt,div').forEach((e) => e.after('\n')); return { title: doc.title || '', text: String(doc.body ? doc.body.textContent : '').replace(/[ \t\f\r ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim() }; } catch (e) { return { title: '', text: '' }; } }
  function read(text, kind, cfg) {
    const out = {}; const reg = text.match(new RegExp(cfg.registrationPattern, 'i')); if (reg) out.registration = ML.normText(reg[0]).slice(0, 60);
    // the operator: after an operator word on any page; anywhere on a legal-notice, contact or about page
    let ent = null; OPERATOR.lastIndex = 0; let m;
    const lineEntity = (chunk, min) => { for (const line of chunk.split('\n')) { const e = ML.pickEntity(line.replace(/^\s*\d{3}\s?\d{2}\s+/, ''), cfg.entityPattern, min); if (e && !NOT_SELLER.test(e)) return e.replace(/^\d{1,6}\s+/, ''); } return null; }; // one line at a time: a name never runs across lines
    while (!ent && (m = OPERATOR.exec(text))) { const after = text.slice(m.index + m[0].length, m.index + m[0].length + 200).split('\n').slice(0, 3).join('\n'); ent = lineEntity(after, -10); }
    if (!ent && reg) { const i = text.indexOf(reg[0]); ent = lineEntity(text.slice(Math.max(0, i - 200), i + 40), -10); } // a company named right before its registration number
    if (!ent && kind !== 'terms page') ent = lineEntity(text.slice(0, 20000));
    if (ent) out.entity = ent;
    if (ML.findPhone(text, cfg)) out.phone = true;
    const ad = text.match(ADDRESS) || text.match(new RegExp(cfg.addressPattern)); if (ad && kind !== 'terms page') out.address = ML.normText(ad[0]).slice(0, 80);
    return out;
  }
  ML.followSellerPages = async function (ctx, P) {
    const cfg = ctx.domConfig.provenance; const seen = new Set([location.href.split('#')[0]]); const cands = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const u = sameSite(a.getAttribute('href')); if (!u || u.pathname === '/' || seen.has(u.href.split('#')[0])) continue;
      const k = kindOf((a.innerText || a.textContent || '').slice(0, 60) + ' ' + decodeURIComponent(u.pathname)); if (!k) continue;
      seen.add(u.href.split('#')[0]); cands.push({ url: u.href.split('#')[0], kind: k.kind, rank: k.rank });
    }
    // the sitemap lists pages the footer may not link: robots.txt names it, or the usual place
    if (cands.filter((c) => c.rank >= 3).length < 1) {
      const robots = await fetchText(location.origin + '/robots.txt'); const sm = robots && (robots.match(/^\s*sitemap:\s*(\S+)/im) || [])[1];
      let xml = await fetchText(sameSite(sm || '') ? sm : location.origin + '/sitemap.xml', true);
      if (xml && /<sitemapindex/i.test(xml)) { const child = (xml.match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi) || []).map((x) => x.replace(/<\/?loc>/gi, '').trim()).find((x) => /page|static|cms|info/i.test(x)) || null; xml = child && sameSite(child) ? await fetchText(child, true) : null; }
      for (const loc of ((xml || '').match(/<loc>\s*([^<\s]+)\s*<\/loc>/gi) || []).slice(0, 5000)) {
        const u = sameSite(loc.replace(/<\/?loc>/gi, '').trim()); if (!u || seen.has(u.href)) continue; const k = kindOf(decodeURIComponent(u.pathname)); if (!k) continue;
        seen.add(u.href); cands.push({ url: u.href, kind: k.kind, rank: k.rank, via: 'sitemap' });
      }
    }
    cands.sort((a, b) => b.rank - a.rank);
    const found = { host: P.host, fetched: 0, pages: [] };
    for (const c of cands.slice(0, 5)) {
      const html = await fetchText(c.url); found.fetched++; if (!html) continue;
      const { text } = textOf(html); const r = read(text, c.kind, cfg); found.pages.push({ url: c.url, kind: c.kind, via: c.via || 'link', got: Object.keys(r) });
      for (const k of ['entity', 'registration', 'address']) if (r[k] && !found[k]) { found[k] = r[k]; found.kind = found.kind || c.kind; found.url = found.url || c.url; }
      if (r.phone && !found.phone) { found.phone = true; found.phoneKind = c.kind; }
      if ((found.entity || found.registration) && found.phone) break;
    }
    return found;
  };
})();
