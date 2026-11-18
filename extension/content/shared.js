/* Subtext — shared utilities, text index, finding model, scoring.
   Loaded first; every other content script attaches to window.ML. */
(function () {
  const ML = (window.ML = window.ML || {});
  ML.VERSION = '0.3.0';
  ML.detectors = ML.detectors || {};
  ML.hasChrome = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  ML.preloaded = window.__ML_PRELOADED || {};

  // ---- resource loading (rules/data JSON) ---------------------------------
  ML.loadJSON = async function (path) {
    if (ML.preloaded[path]) return ML.preloaded[path];
    if (ML.hasChrome) { // through the background: no web-accessible files for a page to probe
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'getResource', path }, (x) => { void chrome.runtime.lastError; res(x); }); } catch (e) { res(null); } });
        if (r && r.data) return r.data;
        await new Promise((res) => setTimeout(res, 200 * (attempt + 1)));
      }
      throw new Error('Failed to load ' + path);
    }
    throw new Error('No data available for ' + path);
  };

  // ---- storage (chrome.storage.local with localStorage fallback) ---------
  ML.storage = {
    async get(key) {
      try {
        if (ML.hasChrome && chrome.storage && chrome.storage.local) {
          const r = await chrome.storage.local.get(key);
          return r[key];
        }
        const v = localStorage.getItem('ml:' + key);
        return v ? JSON.parse(v) : undefined;
      } catch (e) { return undefined; }
    },
    async set(key, value) {
      try {
        if (ML.hasChrome && chrome.storage && chrome.storage.local) {
          await chrome.storage.local.set({ [key]: value });
        } else {
          localStorage.setItem('ml:' + key, JSON.stringify(value));
        }
      } catch (e) { /* ignore */ }
    }
  };

  // ---- element helpers ----------------------------------------------------
  // Element marks live in this isolated world only: a page must not be able to see which elements (or that any) were flagged.
  // ML.testHooks (settings.testHooks, set only by the test harnesses) also writes data attributes so tests in the page world can find them.
  let uid = 0; const markIds = new WeakMap(), markEls = new Map();
  ML.mark = function (el) {
    if (!el || el.nodeType !== 1) return null;
    let id = markIds.get(el);
    if (!id) { id = 'ml' + (++uid); markIds.set(el, id); markEls.set(id, new WeakRef(el)); if (ML.testHooks && el.dataset) el.dataset.mlId = id; }
    return id;
  };
  ML.elById = function (id) { const r = id && markEls.get(id); return r ? r.deref() || null : null; };

  let visCache = new WeakMap();
  ML.freshVisibilityCache = function () { visCache = new WeakMap(); };
  ML.isVisibleNow = function (el) { return ML.isVisible(el, true); };
  ML.isVisible = function (el, fresh) {
    if (!el || el.nodeType !== 1) return false;
    if (!fresh && visCache.has(el)) return visCache.get(el);
    let v;
    try {
      if (typeof el.checkVisibility === 'function') {
        v = el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } else {
        const cs = getComputedStyle(el);
        v = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' &&
            (el.offsetParent !== null || cs.position === 'fixed');
      }
      if (v && el.getAttribute('aria-hidden') === 'true') v = false;
    } catch (e) { v = true; }
    if (!fresh) visCache.set(el, v);
    return v;
  };

  ML.normText = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  ML.lower = (s) => ML.normText(s).toLowerCase();

  ML.rectArea = (r) => Math.max(0, r.width) * Math.max(0, r.height);
  ML.viewportArea = () => window.innerWidth * window.innerHeight;

  ML.snippet = function (text, start, end, pad) {
    pad = pad == null ? 55 : pad;
    const s = Math.max(0, start - pad), e = Math.min(text.length, end + pad);
    return (s > 0 ? '…' : '') + text.slice(s, e) + (e < text.length ? '…' : '');
  };

  // ---- hostnames ----------------------------------------------------------
  const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'or', 'ne', 'go', 'mil']);
  ML.registrableDomain = (host) => MLCommon.registrableDomain(host);
  ML.hostOf = function (url) {
    try { return new URL(url, location.href).hostname; } catch (e) { return ''; }
  };

  // ---- colors -------------------------------------------------------------
  ML.parseColor = function (str) {
    if (!str) return null;
    const m = String(str).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i) ||
              String(str).match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
    if (!m) return null;
    let a = m[4] == null ? 1 : parseFloat(m[4]);
    if (String(m[4] || '').endsWith('%')) a = a / 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  };
  ML.luminance = function (c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  ML.contrast = function (c1, c2) {
    if (!c1 || !c2) return null;
    const l1 = ML.luminance(c1), l2 = ML.luminance(c2);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  ML.isReddish = function (c) {
    if (!c || c.a === 0) return false;
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    if (max < 120 || max - min < 60) return false;
    const sat = (max - min) / max;
    // hue near 0/360 (red) or 15-ish (orange-red)
    let h;
    if (max === c.r) h = ((c.g - c.b) / (max - min)) * 60; else return false;
    if (h < 0) h += 360;
    return sat > 0.45 && (h <= 22 || h >= 345);
  };
  ML.effectiveBackground = function (el) {
    let e = el, depth = 0;
    while (e && e.nodeType === 1 && depth++ < 12) {
      const c = ML.parseColor(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.1) return c;
      e = e.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  ML.hasSolidBackground = function (el) {
    const cs = getComputedStyle(el);
    const c = ML.parseColor(cs.backgroundColor);
    const hasImg = cs.backgroundImage && cs.backgroundImage !== 'none';
    const border = parseFloat(cs.borderTopWidth) > 0 && !/transparent|rgba\(0, 0, 0, 0\)/.test(cs.borderTopColor);
    return (c && c.a > 0.2) || hasImg || border;
  };

  // ---- text index ---------------------------------------------------------
  const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'DD', 'DT', 'BLOCKQUOTE', 'FIGCAPTION',
    'LABEL', 'BUTTON', 'SUMMARY', 'CAPTION', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV', 'MAIN', 'FORM',
    'FIELDSET', 'PRE', 'ADDRESS', 'DETAILS', 'DIALOG', 'TR', 'UL', 'OL', 'TABLE', 'BODY', 'FIGURE', 'OPTION', 'LEGEND']);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'CODE', 'KBD', 'TEXTAREA', 'IFRAME', 'OBJECT', 'CANVAS']);
  const HEADING_TAGS = new Set(['H1', 'H2', 'H3']);
  const CTA_SELECTOR = 'button,a,[role="button"],label,summary,input,[class*="btn" i],[class*="button" i],[class*="cta" i]';

  // Which part of the page a text block belongs to. Rules accept only some regions (dom-config.json `lexical`).
  function regionOf(b) {
    if (b.synthetic) return 'title';
    const el = b.el; if (!el || !el.closest) return 'body';
    if (el.closest('nav,[role="navigation"],[role="menu"],[role="menubar"]') || (el.closest('header,[role="banner"]') && !el.closest('article,main'))) return 'nav';
    if (el.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i],[class*="gdpr" i]')) return 'legal';
    if (el.closest('footer,[role="contentinfo"],[id*="footer" i],[class*="footer" i]')) return 'footer';
    if (el.closest('blockquote,q,[class*="pullquote" i]')) return 'quote';
    if (el.closest('cite,sup,[role="doc-bibliography"],[id*="references" i],[class*="reflist" i],[class*="citation" i],[class*="footnote" i],[class*="references" i]')) return 'cite';
    if (el.closest('[id*="comment" i],[class*="comment" i]')) return 'comment';
    if (el.closest('button,[role="button"],label,summary') || el.tagName === 'INPUT') return 'cta';
    if (b.hasLink && b.text.length <= 170 && (b.linkChars || 0) >= 0.6 * b.text.length) return 'teaser';
    if (el.closest('aside,[role="complementary"],[class*="sidebar" i]')) return 'aside';
    return 'body';
  }

  // Does this page actually sell or fundraise? A buy or subscribe button with a price in the same box, an add-to-cart button, or Product markup.
  ML.commerceSignals = function (ctx) {
    const tx = ctx.domConfig.transaction, curRe = new RegExp(ctx.domConfig.pricing.currency, 'i'), buyRe = new RegExp(tx.checkoutWords, 'i'), subRe = new RegExp(tx.subscriptionCtaWords, 'i'), planRe = new RegExp(tx.planPricePattern, 'i');
    const out = { sells: false, buyBoxes: 0, ownBuyBoxes: 0, otherBuyBoxes: 0, subBoxes: 0, planBoxes: 0, addToCart: false, schemaProduct: false, fundraises: false, strongShop: false, editorial: false };
    const payHosts = Object.keys(tx.processors || {}).filter((h) => !/^(amazon|apple|etsy|play\.google)/.test(h));
    const ownOffer = (el) => { // whose offer is this button? this site's, or a payment page working for it; a link out to another merchant is a referral
      const href = el.getAttribute('href'); if (el.tagName !== 'A' || !href) return true;
      if ((el.getAttribute('rel') || '').includes('sponsored') || /\/(go|out|goto|recommends|deal|affiliate)\//i.test(href)) return false;
      try { const h = new URL(href, location.href).hostname; if (MLCommon.registrableDomain(h) === MLCommon.registrableDomain(location.hostname)) return true; return payHosts.some((p) => h === p || h.endsWith('.' + p)); } catch (e) { return true; }
    };
    let seen = 0;
    for (const el of document.querySelectorAll('a[href],button,input[type=submit],[role=button]')) {
      if (seen > 60) break;
      const t = ML.lower(el.innerText || el.value || el.textContent || el.getAttribute('aria-label') || ''); if (!t || t.length > 48) continue;
      if (/^(donate|give|give now|give today|make a (gift|donation)|contribute)( now| today)?$/.test(t)) { out.fundraises = true; continue; }
      if (/^(cart|basket|bag|warenkorb|shopping (cart|bag)|view cart)\b/.test(t) || /\/(cart|basket|warenkorb)(\/|\?|$)/i.test(el.getAttribute('href') || '') || /\b(cart|basket|warenkorb|shopping bag)\b/i.test(el.getAttribute('aria-label') || '')) out.hasCart = true;
      const buy = buyRe.test(t), sub = subRe.test(t); if (!buy && !sub) continue;
      if (el.closest('nav,footer,[role="navigation"],[role="contentinfo"]') || !ML.isVisible(el)) continue;
      if (/github\.com\/sponsors|patreon\.com|ko-fi\.com|buymeacoffee\.com/i.test(el.getAttribute('href') || '')) continue; // supporting the author, not buying a product
      const inline = el.tagName === 'A' && el.closest('p,li,blockquote,td'); if (inline && ML.normText(inline.textContent).length > 3 * t.length + 20) continue; // a link inside a sentence is not a buy button
      seen++;
      if (/^(add to (cart|basket|bag)|in den warenkorb)/.test(t)) out.addToCart = true;
      let box = el, d = 0, price = false, plan = false;
      while (box.parentElement && d++ < 6) { box = box.parentElement; const txt = box.textContent || ''; if (txt.length > 1200) break; /* a price further away than this is prose, not this button's price */ if (curRe.test(txt)) { price = true; plan = planRe.test(ML.normText(txt)); break; } }
      if (price && buy) { out.buyBoxes++; if (ownOffer(el)) out.ownBuyBoxes++; else out.otherBuyBoxes++; } if (price && sub) out.subBoxes++; if (plan) out.planBoxes++;
    }
    let refs = 0; for (const el of document.querySelectorAll('a[href]')) { if (refs >= 40) break; const t = ML.lower(el.textContent || ''); if (t.length < 28 && /^(apply now|apply|view deal|get (this )?(deal|offer)|see (the )?(deal|offer)|check (the )?price|view offer|see offers?)\b/.test(t) && !ownOffer(el) && ML.isVisible(el)) refs++; } out.referralCtas = refs; // buttons that send the reader to another company's offer
    const ogType = (document.querySelector('meta[property="og:type"]') || {}).content || '';
    let ld = ''; document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => { if (ld.length < 200000) ld += s.textContent || ''; });
    out.schemaProduct = /product/i.test(ogType) || !!document.querySelector('meta[property="product:price:amount"],meta[property="og:price:amount"]') || !!document.querySelector('[itemtype*="schema.org/Product" i]') || /"@type"\s*:\s*"(Product|Offer|AggregateOffer)"/.test(ld);
    // a catalogue page: several elements styled as prices (retail home and category pages have no buy button yet)
    let priced = 0; for (const el of document.querySelectorAll('[class*="price" i],[data-price],[itemprop="price"]')) { if (priced >= 6) break; if ((el.textContent || '').length < 40 && curRe.test(el.textContent || '') && ML.isVisible(el)) priced++; }
    out.catalogue = priced >= 4;
    if (!out.hasCart) for (const el of document.querySelectorAll('a[href*="/cart" i],a[href*="/basket" i],a[href*="warenkorb" i],a[aria-label*="cart" i],a[aria-label*="basket" i],button[aria-label*="cart" i],button[aria-label*="basket" i]')) { if (ML.isVisible(el)) { out.hasCart = true; break; } }
    const pricingPath = /\/(pricing|plans|plan|subscribe|membership|premium)(\/|$)/i.test(location.pathname) && curRe.test(document.body.innerText || '');
    if (pricingPath) { out.pricingPath = true; if (!out.subBoxes) out.subBoxes = 1; if (!out.planBoxes) out.planBoxes = 1; }
    // a cart link is a shop, unless the page is a news front page: dated headline links and no prices (a magazine with a merch shop). Product tiles also read like long headlines, but carry no dates.
    const headlines = ctx.index ? ctx.index.blocks.filter((b) => b.region === 'teaser' && b.text.split(/\s+/).length >= 6).length : 0;
    const dated = document.querySelectorAll('time').length >= 3 || /"@type"\s*:\s*"(NewsMediaOrganization|NewsArticle)"/.test(ld) || !!ctx.outlet;
    if (headlines >= 10 && dated && !out.buyBoxes && !out.addToCart && !out.schemaProduct) { out.hasCart = false; out.catalogue = false; }
    // editorial pages narrate offers, they do not make them: a review quoting a price, a news story. Marked-up articles need no own buy box (or long prose with one);
    // otherwise a byline or referral buttons plus long prose, and no own buy box. A long sales letter has its own buy buttons; a shop category page has a cart and no byline.
    const ldArticle = /"@type"\s*:\s*\[?\s*"(Article|NewsArticle|BlogPosting|Review|TechArticle|ReportageNewsArticle|OpinionNewsArticle|AnalysisNewsArticle|Report)"/.test(ld);
    let longParas = 0; for (const p of document.querySelectorAll('p')) { if ((p.textContent || '').length >= 200 && ++longParas >= 6) break; }
    const prose = longParas >= 6;
    const byline = !!document.querySelector('meta[name="author"],[rel="author"],[class*="byline" i],meta[property="article:published_time"],article time,main time');
    out.editorial = !out.addToCart && !pricingPath && ((ldArticle && (out.ownBuyBoxes === 0 || (prose && out.ownBuyBoxes < 2))) || (!out.catalogue && !out.hasCart && out.ownBuyBoxes === 0 && ((/article/i.test(ogType) && byline) || (prose && (byline || out.otherBuyBoxes > 0)))));
    if (out.editorial) { out.buyBoxes = 0; out.schemaProduct = false; out.catalogue = false; out.hasCart = false; out.sells = false; out.strongShop = false; return out; }
    out.sells = out.addToCart || out.buyBoxes > 0 || out.subBoxes > 0 || out.schemaProduct || out.catalogue || !!out.hasCart;
    out.strongShop = out.addToCart || out.schemaProduct || out.buyBoxes >= 2 || out.catalogue || !!out.hasCart;
    return out;
  };

  ML.buildTextIndex = function (opts) {
    for (const [id, ref] of markEls) if (!ref.deref()) markEls.delete(id); // long-lived feeds keep adding marks; drop the ones whose element is gone
    opts = opts || {};
    const maxChars = opts.maxChars || 200000;
    ML.freshVisibilityCache();
    const blocks = [];
    const byEl = new Map();
    let total = 0;

    function blockFor(node) {
      let el = node.parentElement;
      while (el && el !== document.documentElement) {
        if (BLOCK_TAGS.has(el.tagName)) return el;
        el = el.parentElement || (el.getRootNode && el.getRootNode().host) || null;
      }
      return document.body;
    }
    function getBlock(el) {
      let b = byEl.get(el);
      if (!b) {
        b = { el, parts: [], isHeading: HEADING_TAGS.has(el.tagName) || !!el.closest('h1,h2,h3,[role="heading"]'), hasLink: false, hasCta: false, linkChars: 0, text: '', start: 0 };
        byEl.set(el, b); blocks.push(b);
      }
      return b;
    }

    // synthetic block: document title + meta description
    const titleEl = document.querySelector('h1') || document.body;
    const metaDesc = document.querySelector('meta[name="description"],meta[property="og:description"]');
    const titleText = ML.normText(document.title) + (metaDesc ? ' ' + ML.normText(metaDesc.content) : '');
    if (titleText) {
      const tb = { el: titleEl, parts: [titleText], isHeading: true, hasLink: false, hasCta: false, text: '', start: 0, synthetic: true };
      blocks.push(tb); total += titleText.length;
    }

    // open shadow roots hold page text too (web components); closed ones, like ours, cannot be read
    const roots = [document.body]; let scanned = 0;
    for (let r = 0; r < roots.length && scanned < 30000; r++) { for (const el of roots[r].querySelectorAll('*')) { if (++scanned > 30000) break; if (el.shadowRoot) roots.push(el.shadowRoot); } }
    for (const walkRoot of roots) {
    const walker = document.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || p.namespaceURI === 'http://www.w3.org/2000/svg') return NodeFilter.FILTER_REJECT;
        if (!/\S/.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode()) && total < maxChars) {
      const bEl = blockFor(n);
      if (!ML.isVisible(bEl) || (opts.strictVisible && (!ML.isVisible(n.parentElement) || n.parentElement.closest('[aria-hidden="true"]')))) continue; // strict only for what the AI reads: the scan keeps every block a sighted reader sees
      const b = getBlock(bEl);
      const t = ML.normText(n.nodeValue);
      if (!t) continue;
      b.parts.push(t); total += t.length + 1;
      const p = n.parentElement;
      if (p.closest('a[href]')) b.linkChars += t.length;
      if (!b.hasLink && p.closest('a[href]')) {
        const a = p.closest('a[href]');
        const href = a.getAttribute('href') || '';
        if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) b.hasLink = true;
      }
      if (!b.hasCta && p.closest(CTA_SELECTOR)) b.hasCta = true;
    }
    }
    // button/submit values and placeholders
    document.querySelectorAll('input[type="submit"][value],input[type="button"][value]').forEach((inp) => {
      if (total > maxChars || !ML.isVisible(inp)) return;
      const t = ML.normText(inp.value); if (!t) return;
      const b = { el: inp, parts: [t], isHeading: false, hasLink: false, hasCta: true, text: '', start: 0 };
      blocks.push(b); total += t.length + 1;
    });

    let offset = 0;
    const fullParts = [];
    for (const b of blocks) {
      b.text = b.parts.join(' ');
      b.start = offset;
      fullParts.push(b.text);
      offset += b.text.length + 1; // newline separator
    }
    for (const b of blocks) b.region = regionOf(b);
    const fullText = fullParts.join('\n');
    const starts = blocks.map((b) => b.start);
    function blockAt(pos) {
      let lo = 0, hi = starts.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; }
      return lo;
    }
    return { blocks, fullText, blockAt, chars: fullText.length, truncated: total >= maxChars };
  };

  // ---- findings -----------------------------------------------------------
  // A company name found in text, judged before anyone is told "run by": a product tile ("Limited edition") or a privacy representative is not the operator.
  ML.sharesBrand = function (name) { const brand = String(MLCommon.registrableDomain(location.hostname).split('.')[0] + ' ' + ((document.querySelector('meta[property="og:site_name"]') || {}).content || '')).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3); return String(name || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => brand.includes(w)); };
  // A phone number of the business in page text: after a phone word in any of several languages (cfg.phonePattern), in international form with no label (+43 664 1876044),
  // a little after a contact word ('Telefonische bereikbaarheid: 0297-269594') or right after an email address. 9 to 15 digits, so prices, dates and order numbers do not count.
  ML.findPhone = function (text, cfg) {
    const t = String(text || ''); const digits = (m, lo) => { const n = m.replace(/\D/g, '').length; return n >= (lo || 9) && n <= 15; };
    if (cfg && cfg.phonePattern && new RegExp(cfg.phonePattern, 'i').test(t)) return true;
    if ((t.match(/(?:^|[^\w+])\+\s?\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.\/-]?\d{2,4}){2,4}(?!\d)/g) || []).some((m) => digits(m, 8))) return true;
    if ((t.match(/(?:telefo\w*|phone|bereikbaar\w*|kantooruren|erreichbar\w*|kunden(?:service|dienst)|klantenservice|customer service|hotline|infolinka|volejte|appelez|llámanos|whatsapp)[^\d@\n]{0,40}\+?\d[\d\s().\/-]{7,}\d/gi) || []).some((m) => digits(m.replace(/^\D+/, '')))) return true;
    return (t.match(/@[\w-]+(?:\.[\w-]+)+\s*[•|·,–-]?\s*\+?\d[\d\s().\/-]{7,}\d/g) || []).some((m) => digits(m.replace(/^[^\s•|·,–-]+/, '')));
  };
  ML.pickEntity = function (text, pattern, minScore) {
    const re = new RegExp(pattern, 'g'); let best = null, bestScore = -99, m, n = 0;
    const brand = new Set(String(MLCommon.registrableDomain(location.hostname).split('.')[0] + ' ' + ((document.querySelector('meta[property="og:site_name"]') || {}).content || '')).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
    while ((m = re.exec(text)) && n++ < 40) {
      if (!m[0]) { re.lastIndex++; continue; }
      const name = ML.normText(m[0]).replace(/^\d{3,6}\s+/, ''); const head = name.replace(/,?\s+\S+$/, ''); // a postcode before the name is not part of it
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40), before = text.slice(Math.max(0, m.index - 120), m.index);
      if (/^(new|shop|buy|get|sale|free|best|our|your|this|see|view|limited)\b/i.test(name) || /\b(limited|inc|llc|ltd|gmbh|corp)\b/i.test(head)) continue;
      if (/^\s*(edition|time|offer|run|stock|availability|release|drop|warranty|liability|to)\b/i.test(after)) continue;
      if (/\s(SE|AG|KG|UG|SA|Oy|Limited)$/.test(name) && head === head.toUpperCase() && !name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => brand.has(w))) continue; // an all-capitals button such as "PŘIHLÁSIT SE" (log in) is not a company
      let score = 0;
      if (/\b(representative|processor|vendor|service providers?|such as|including|acquired|powered by|partners?)\b/i.test(before + after)) score -= 5;
      if (name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => brand.has(w))) score += 3;
      if (/^\s*[,(]*\s*\(?\s*["“']?(we|us|our|the company|company|formerly)\b/i.test(after)) score += 3;
      if (/(operated by|provided by|owned by|controlled by|controller is|©|copyright[^.]{0,20})\s*$/i.test(before)) score += 3;
      if (score > bestScore) { best = name; bestScore = score; }
    }
    if (bestScore < (minScore == null ? -4 : minScore) || !best) return null;
    // "Head of Privacy Canva Pty Ltd" and "20181. ABOUT Figma, Inc.": where the site's own name appears, the company's name starts there
    const words = best.split(/\s+/); const at = words.findIndex((w) => brand.has(w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')));
    return (at > 0 ? words.slice(at).join(' ') : best).slice(0, 80);
  };
  ML.makeFinding = function (f) {
    if (f && f.evidence && f.evidence.length > 1) { const seen = new Set(); f.evidence = f.evidence.filter((e) => { const q = e && e.quote; if (!q) return true; if (seen.has(q)) return false; seen.add(q); return true; }); } // the same quote three times is one piece of evidence
    return Object.assign({
      id: 'unknown', category: 'dark_pattern', name: 'Finding', severity: 1, confidence: 0.7,
      biases: [], explain: '', tip: '', evidence: [], count: 1, source: 'heuristic', meta: {}
    }, f);
  };
  ML.mergeFinding = function (map, f) {
    f = ML.makeFinding(f);
    const prev = map.get(f.id);
    if (!prev) { map.set(f.id, f); return f; }
    prev.count = Math.max(prev.count, f.count) + (f.source === 'behavior' ? 0 : 0);
    prev.severity = Math.max(prev.severity, f.severity);
    prev.confidence = Math.max(prev.confidence, f.confidence);
    const seen = new Set(prev.evidence.map((e) => e.quote + '|' + e.elId));
    for (const e of f.evidence) { const k = e.quote + '|' + e.elId; if (!seen.has(k) && prev.evidence.length < 6) { prev.evidence.push(e); seen.add(k); } }
    Object.assign(prev.meta, f.meta);
    return prev;
  };
  ML.evidenceFor = function (el, quote, extra) {
    return Object.assign({ quote: quote || ML.normText(el && el.textContent || '').slice(0, 160), elId: ML.mark(el) }, extra || {});
  };

  // ---- scoring ------------------------------------------------------------
  ML.scoreFindings = function (findings) {
    if (typeof MLCommon !== 'undefined') return MLCommon.scoreFindings(findings);
    let w = 0; const perCategory = {};
    for (const f of findings) {
      if (f.severity <= 0) continue;
      const v = f.severity * (f.confidence == null ? 0.7 : f.confidence) * Math.sqrt(Math.min(f.count || 1, 6));
      w += v; perCategory[f.category] = (perCategory[f.category] || 0) + v;
    }
    const score = Math.round(100 * (1 - Math.exp(-w / 14)));
    let grade, label;
    if (score < 15) { grade = 'A'; label = 'Low pressure'; }
    else if (score < 30) { grade = 'B'; label = 'Some persuasion'; }
    else if (score < 50) { grade = 'C'; label = 'Moderate pressure'; }
    else if (score < 70) { grade = 'D'; label = 'High pressure'; }
    else { grade = 'F'; label = 'Very high pressure'; }
    return { score, grade, label, weight: Math.round(w * 10) / 10, perCategory };
  };
})();
