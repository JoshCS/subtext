/* Transparency detector: for article-like pages, check for byline, date, about/contact/corrections/funding links. */
(function () {
  const ML = window.ML;
  function jsonLd() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { try { const j = JSON.parse(s.textContent); (Array.isArray(j) ? j : [j]).forEach((x) => out.push(x)); if (j && j['@graph']) j['@graph'].forEach((x) => out.push(x)); } catch (e) { /* ignore */ } });
    return out;
  }
  ML.detectors.transparency = function (ctx) {
    const cfg = ctx.domConfig.transparency, out = [];
    const ld = jsonLd();
    const ogType = (document.querySelector('meta[property="og:type"]') || {}).content || '';
    const pCount = document.querySelectorAll('p').length;
    const pChars = Array.from(document.querySelectorAll('article p, main p, p')).slice(0, 400).reduce((n, p) => n + (p.innerText || '').length, 0);
    const explicit = /article/i.test(ogType) || !!document.querySelector('article') || ld.some((x) => /Article|NewsArticle|BlogPosting|Report/i.test(String(x['@type'])));
    const currencyHits = (ctx.index.fullText.match(new RegExp(ctx.domConfig.pricing.currency, 'gi')) || []).length;
    const commerce = currencyHits >= 3 || document.querySelectorAll('form input[type="email"], button, [class*="cart" i], [class*="checkout" i]').length > 12;
    const isArticle = explicit || (pCount >= 8 && pChars > 2500 && !commerce);
    ctx.isArticle = isArticle;
    // page kind: evergreen pages (recipes, guides, how-tos, reviews, lists) exist to bring search traffic; news is dated
    const path = location.pathname.toLowerCase(); const siteName = ML.lower((document.querySelector('meta[property="og:site_name"]') || {}).content || ''); const title = ML.lower(document.title).split(/\s[|–—-]\s/).filter((p, i, all) => all.length === 1 || (p !== siteName && !(i === all.length - 1))).join(' ') || ML.lower(document.title); // the site's own name in the title says nothing about the page (National Review is not a review)
    const ldType = ld.map((x) => String(x['@type'])).join(' ');
    ctx.pageKind = /Recipe/i.test(ldType) || /\/(recipe|recipes|food)\b/.test(path) || /\brecipe\b/.test(title) ? 'recipe'
      : /HowTo|FAQPage/i.test(ldType) || /\/(how-to|howto|guide|guides|explainer|tips)\b/.test(path) || /\b(how to|guide|explained|tips)\b/.test(title) ? 'guide'
      : /Review/i.test(ldType) || /\/(review|reviews|best)\b/.test(path) || /\b(review|the best|top \d+)\b/.test(title) ? 'review'
      : /\b\d+ (reasons|things|ways|signs)\b/.test(title) ? 'listicle' : /\/(donate|donation|give)(\/|\.|$)/i.test(location.pathname) ? 'donation' : isArticle ? 'article'
      : (ctx.index && ctx.index.blocks.filter((b) => b.region === 'teaser' && b.text.split(/\s+/).length >= 6).length >= 5 && !(ctx.commerce && ctx.commerce.sells)) ? 'index' : 'page';
    if (!isArticle) return out;

    const hasAuthor = !!(document.querySelector('meta[name="author"],[rel="author"],[class*="byline" i],[class*="author" i],[itemprop="author"]') || ld.some((x) => x.author));
    const hasDate = !!(document.querySelector('time[datetime],meta[property="article:published_time"],meta[name="date"],meta[name="pubdate"],[itemprop="datePublished"],[class*="date" i],[class*="timestamp" i]') || ld.some((x) => x.datePublished));
    ctx.masthead = { hasAuthor, hasDate };
    const linkTexts = Array.from(document.querySelectorAll('a[href]')).map((a) => ML.lower(a.innerText || a.textContent || a.getAttribute('aria-label') || '')).filter(Boolean);
    const has = (words) => linkTexts.some((t) => words.some((w) => t === w || t.startsWith(w + ' ') || t.endsWith(' ' + w) || (w.length > 7 && t.includes(w))));
    const found = {};
    for (const k of Object.keys(cfg.footerLinkWords)) found[k] = has(cfg.footerLinkWords[k]);
    if (document.querySelector('a[href^="mailto:" i],a[href^="tel:" i],address')) found.contact = true; // an address or an email is a way to reach them
    const missing = [];
    if (!hasAuthor) missing.push('no author byline');
    if (!hasDate) missing.push('no publication date');
    if (!found.about) missing.push('no About page link');
    if (!found.contact) missing.push('no Contact link');
    if (!found.corrections) missing.push('no corrections/standards policy link');
    const isHome = /^\/(index\.html?)?$/.test(location.pathname) || (!explicit && /^\/[a-z-]+\/?$/i.test(location.pathname)); // a front page has no byline by design
    const instTld = Object.keys((ctx.domConfig.provenance || {}).institutionTlds || {}).some((t) => location.hostname.endsWith(t) || location.hostname.replace(/^www\./, '') === t.slice(1));
    const articleMarkup = /article/i.test(ogType) || ld.some((x) => /Article|NewsArticle|BlogPosting|Report/i.test(String(x['@type'])));
    const paymentPage = ctx.pageKind === 'donation' || /\/(checkout|donate|donation|give)(\/|\.|$)/i.test(location.pathname) || !!document.querySelector('input[autocomplete^="cc-" i],input[name*="card" i],input[name*="cvv" i],input[name*="cvc" i],form[action*="donat" i],form[action*="checkout" i]'); // a donation form is not an article missing its byline
    if ((missing.length >= 3 || !hasAuthor || !hasDate) && missing.length >= 2 && articleMarkup && pCount >= 8 && !paymentPage && !isHome && !instTld && !(ctx.commerce && ctx.commerce.sells)) out.push(ML.makeFinding({
      id: 'source.low_transparency', category: 'source_funding', name: 'Low transparency: ' + missing.join(', '), label: 'No masthead', why: (missing.slice(0, 3).map((m) => m.replace(/ link$/, '')).join(', ') + '.').replace(/^./, (c) => c.toUpperCase()), severity: missing.length >= 4 ? 2 : 1, confidence: 0.7,
      biases: ['authority_bias'],
      explain: 'Credible publishers tell you who wrote the piece, when, who they are and how to reach them, and how they correct errors. This page is missing ' + missing.length + ' of those five signals. Absence is not proof of bad faith, but it removes your ability to hold anyone accountable.',
      tip: 'Search the outlet name plus "owner" or "funding". Check the domain\'s age at a WHOIS service. Look for the same story from a source that does have a masthead.',
      evidence: missing.slice(0, 5).map((m) => ({ quote: m, elId: null })), count: missing.length, meta: { missing, found }
    }));
    const host = location.hostname.replace(/^www\./, '');
    const advocacyName = cfg.advocacyDomainWords.some((w) => host.replace(/[-.]/g, ' ').includes(w)) || cfg.advocacyDomainWords.some((w) => ML.lower(document.title).includes(w) && /institute|foundation|council|coalition|center for|centre for|project|initiative/.test(w));
    const instTlds = Object.keys((ctx.domConfig.provenance || {}).institutionTlds || {}); const institution = instTlds.some((t) => host.endsWith(t.replace(/^\./, '')) && host.length > t.length);
    if (advocacyName && !ctx.outlet && !institution && !found.ownership && !/\b(990|donors?|our funding|funded by|supported by grants|annual report|financial statements?)\b/i.test(ctx.index.fullText)) out.push(ML.makeFinding({
      id: 'source.advocacy_no_funding_disclosure', category: 'source_funding', name: 'Organization-style name, no visible funding disclosure', severity: 2, confidence: 0.6,
      biases: ['authority_bias', 'halo_effect'],
      explain: 'The site presents as an institute, foundation, council or campaign but nothing on the page links to who funds it. Names like these confer authority; astroturf groups and industry front organizations rely on that.',
      tip: 'Look the name up on OpenSecrets, ProPublica Nonprofit Explorer (Form 990), InfluenceWatch and SourceWatch (the latter two have opposite political lenses; read both). The Source card above has one-click searches.',
      evidence: [], count: 1
    }));
    return out;
  };
})();
