/* Traits measured on shops from public warning lists against honest small shops vouched for by trust marks (eval/scam-features.py, eval/scam-run.js, docs/CALIBRATION.md section 9).
   On a shop, the facts are folded into the one finding about the seller (source.unknown_operator or source.named_operator from provenance); source.thin_shop only when provenance made none.
   Each trait is stated as a fact about the page with how common it is on listed and honest shops. It never says a shop is a fraud. Honest new shops can show these too.
   Fully local: nothing about the page leaves the browser. Thresholds were fixed on the train half and tested once on the holdout half. */
(function () {
  const ML = window.ML;
  const SOCIAL = /https?:\/\/(?:www\.)?(facebook|instagram|twitter|x|youtube|pinterest|tiktok|linkedin)\.com(\/[^"'\s>]*)?/gi;
  const SHARE = /^(sharer|share|intent|dialog|tr|plugins|embed|watch|p\/|pin\/create|sharearticle|hashtag)/i;
  const SALE = /\b(sale|outlet|cheap|discount|clearance|levn|sleva|slevy|výprodej|vyprodej|výpredaj|vypredaj|lacn|tilbud|rabatt|günstig|gunstig|pas cher|solde|soldes|oferta|barato|goedkoop|online shop|online store|eshop|e-shop|obchod)\w*/g;
  const COUNTRY = /\b(cz|sk|pl|nz|uk|au|ca|finland|suomi|norge|sverige|danmark|deutschland|österreich|schweiz|france|italia|españa|nederland|polska|česká republika|praha|canada|australia|ireland)\b/;
  const COMPANY = /\b(s\.r\.o\.|a\.s\.|gmbh|ug \(|ltd\.?|llc|inc\.|b\.v\.|sarl|s\.a\.|sp\. z o\.o\.|kg\b|ag\b|ičo|ič:|ust-?id|vat|dič|handelsregister|hrb|company (no|number)|registered (office|in))/;
  const LEGAL = /impressum|obchodní podmínky|obchodni-podminky|kontakty|algemene voorwaarden|agb|widerruf/;
  const PHONE = /tel:|\+\d{1,3}[\s-]?\d{2,3}[\s-]?\d{3}|\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\b\d{3}-\d{3}-\d{4}\b/;
  const NO_RX = /(without (a )?prescription|no prescription( needed| required)?|bez předpisu|bez receptu|sans ordonnance|ohne rezept|sin receta|senza ricetta|χωρισ συνταγη|χωρίς συνταγή|zonder recept)/;
  const DRUG = /(viagra|cialis|kamagra|levitra|sildenafil|tadalafil|xanax|tramadol|ozempic|semaglutide|oxycodone|adderall)/;
  const SCARE = /(your (computer|pc|device|windows|mac|iphone) (is|has been|may be) (infected|hacked|locked|compromised|blocked)|(virus|malware|trojan|spyware)s? (has been |were |was )?(detected|found) (on|in) your|windows defender.{0,40}(alert|warning)|access to this (pc|computer) has been blocked)/;
  const CALL = /(call|contact) (microsoft|apple|windows|support|technical support|tech support|us|the number|toll[- ]free)|toll[- ]free/;
  ML.shopTraitsOf = function (doc, title) {
    const html = doc.documentElement.outerHTML; const low = html.toLowerCase().slice(0, 2000000); const t = String(title || '').toLowerCase().slice(0, 300);
    const socials = []; SOCIAL.lastIndex = 0; let m; while ((m = SOCIAL.exec(html)) && socials.length < 400) socials.push(String(m[2] || '').replace(/^\/+|\/+$/g, ''));
    const realSocial = socials.some((p) => p && !SHARE.test(p)); const dead = socials.length > 0 && !realSocial;
    const words = (t.match(SALE) || []).length; const repeat = /\b([a-z]{4,})\b.*\b\1\b/.test(t) && words >= 1; const place = COUNTRY.test(t) && words >= 1;
    return { realSocial, dead, phone: PHONE.test(low), company: COMPANY.test(low), legal: LEGAL.test(low), titleStuffed: (repeat || place) && !realSocial }; // on its own a title like this also fits Shein and an honest Czech sports shop, both of which have real social profiles
  };
  ML.detectors.shoptraits = function (ctx) {
    const out = []; const text = ctx.index.fullText.toLowerCase().slice(0, 300000);
    if (ctx.outlet) return out;
    // a page telling you your machine is infected and to call a number: seen on tech-support scam pages, stated with the proof, and it needs no shop
    if (SCARE.test(text) && CALL.test(text) && (document.fullscreenElement || /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|\+\d{1,3}[\s-]?\d{2,3}[\s-]?\d{3}/.test(text)) && !/\b(scam|fraud|how to (spot|avoid)|beware|fake (alert|warning|pop))\b/.test(text)) {
      const s = text.match(SCARE); out.push(ML.makeFinding({ id: document.fullscreenElement ? 'source.scare_support' : 'source.scare_text', // seen taking over the screen is a direct proof; the words alone have not been tested on real pages category: 'deceptive_claims', name: 'Says your device is infected and gives a number to call', severity: 3, confidence: 0.8, biases: ['loss_aversion'], label: 'Call-us alert', why: 'A web page cannot see an infection on your device.',
        explain: 'This page says your device is infected or locked and asks you to call a number. A web page cannot detect that. Real security companies and Microsoft or Apple do not ask you to phone a number shown on a web page.', tip: 'Close the tab. If it will not close, quit the browser. Do not call the number or let anyone connect to your computer.', evidence: [{ quote: String(s[0]).slice(0, 200), elId: null }], count: 1, meta: { direct: true } }));
    }
    if (DRUG.test(text) && NO_RX.test(text)) {
      const s = text.match(NO_RX); const i = text.indexOf(s[0]); out.push(ML.makeFinding({ id: 'source.no_prescription', category: 'deceptive_claims', name: 'Offers prescription medicine without a prescription', severity: 3, confidence: 0.8, biases: [], label: 'No prescription', why: 'Offers prescription medicine without a prescription.', explain: 'Selling prescription-only medicine without a prescription is illegal in most countries, and medicine from such sites may be fake or unsafe.', tip: 'Check whether your national pharmacy regulator lists this seller.', evidence: [{ quote: text.slice(Math.max(0, i - 60), i + s[0].length + 60).trim(), elId: null }], count: 1, meta: {} }));
    }
    // archived and script-heavy shops can hide their buy buttons from the sale check, so a cart word with several prices also counts as a shop
    const prices = (text.match(/(?:[$€£]\s?\d|\d[.,]\d{2}\s?(?:€|kč|eur|usd|zł|kr)|\d\s?kč)/g) || []).length; const cartWord = /add to (cart|bag|basket)|shopping (cart|bag)|do košíku|in den warenkorb|warenkorb|ajouter au panier|panier|añadir al carrito|carrito|do koszyka|winkelwagen|lägg i varukorg|kosár/.test(text);
    if (!((ctx.commerce || {}).sells || (cartWord && prices >= 3))) return out; // a title alone is not a shop: search results and news headlines can read the same way
    // Describe, do not judge (the owner, 2026-11-06): each trait is a fact about this page, stated with how often it shows on listed and honest shops.
    // Who-runs-it facts come from the provenance detector (footer, legal pages, policy page, rescans), so the two checks cannot disagree.
    const T = ML.shopTraitsOf(document, document.title); const P = ctx.provenance || { pages: {} }; const pages = P.pages || {};
    const named = !!(P.identity || P.namedOperator); const discounts = (text.match(/-\s?[6-9]\d\s?%|[6-9]\d\s?% off/g) || []).length;
    const facts = { social: T.realSocial ? 'real' : T.dead ? 'dead' : 'none', phone: !!P.phone, named, terms: !!(pages.terms || pages.imprint), titleStuffed: T.titleStuffed, bigDiscounts: discounts >= 3 };
    ctx.shopFacts = facts;
    const TRAITS = [ // id, the fact as stated, short form for the one line
      [facts.social === 'none', 'social_none', 'No link to a social media profile.', 'no social profile'],
      [facts.social === 'dead', 'social_dead', 'Social media icons that link to nothing or only to share buttons.', 'social links that lead nowhere'],
      [!facts.phone, 'no_phone', 'No phone number.', 'no phone'],
      [!facts.named, 'no_company', 'No company name, registration number or address.', 'no company name'],
      [!facts.terms, 'no_terms', 'No link to terms of sale or a legal notice.', 'no terms of sale'],
      [facts.titleStuffed, 'title_stuffed', 'The page title pairs a name with a country or sale words.', 'a title stuffed with place or sale words'],
      [facts.bigDiscounts, 'big_discounts', 'Three or more discounts of 60% or more.', 'discounts of 60% or more']
    ].filter((t) => t[0]).map(([, id, fact, short]) => ({ id, fact, short }));
    if (!TRAITS.length) return out;
    const R = (ctx.domConfig.shopTraitRates || {}); const rate = (id) => { const r = R.traits && R.traits[id]; return r ? ' (also true of ' + r.listed + ' of ' + R.listed + ' shops on warning lists and ' + r.honest + ' of ' + R.honest + ' honest shops we checked)' : ''; };
    // only the combination is rare on honest shops (held-back half: 24 of 52 listed, 3 of 74 honest); any one trait alone is ordinary
    const combo = facts.social !== 'real' && !facts.phone && !facts.named;
    const short = TRAITS.slice(0, 3).map((t) => t.short); const why = short.join(', ').replace(/^./, (c) => c.toUpperCase()) + ' on this page.';
    const off = P.offPage; const offLine = off && (off.entity || off.registration || off.phone) ? ' Read from its own other pages: ' + [off.entity ? 'its ' + off.kind + ' names ' + off.entity : off.registration ? 'its ' + off.kind + ' gives ' + off.registration : '', off.phone ? 'its ' + off.phoneKind + ' gives a phone number' : ''].filter(Boolean).join('; ') + '.' : off && off.fetched ? ' Subtext also read ' + off.fetched + ' of its own contact, legal or terms pages and found no company name or phone there either.' : '';
    const explain = 'Checked on this page: ' + TRAITS.map((t) => t.fact.replace(/\.$/, '') + rate(t.id) + '.').join(' ') + ' The listed shops are archived pages of shops on public warning lists; the honest shops carry a trust mark, which requires them to show who they are, so honest new shops lack these details more often than the figures suggest. None of this shows that this shop is dishonest. It is what you can and cannot check about the seller before you pay.' + offLine;
    const tip = 'Search the shop name with the word "reviews" before paying, and pay by card or PayPal so you can claim the money back.';
    const evidence = TRAITS.map((t) => ({ quote: 'Checked this page: ' + t.short, elId: null }));
    const found = ctx.lastFindings; const op = found && (found.get('source.unknown_operator') || found.get('source.named_operator'));
    if (op) { // one finding about the seller, not two: fold the shop facts into the provenance finding
      const keep = (P.signals || []).filter((s) => /recent_domain|hidden_registrant/.test(s.id) || (s.id === 'legal_pages' && s.severity >= 2)); // registration age and a missing legally required notice keep their own weight
      const extra = keep.filter((s) => s.severity > 0).map((s) => s.short);
      Object.assign(op, { name: 'What this shop shows about its seller', label: 'About the seller', severity: Math.max(combo ? 2 : 0, ...keep.map((s) => s.severity)), confidence: 0.7,
        why: (extra.length ? short.slice(0, 2).concat(extra[0]) : short).join(', ').replace(/^./, (c) => c.toUpperCase()) + (extra.length ? '.' : ' on this page.'),
        explain: explain + (keep.length ? ' ' + keep.map((s) => s.note).join(' ') : ''), tip, evidence: evidence.concat(op.evidence.filter((e) => /^registered |^©/.test(e.quote))).slice(0, 6), count: TRAITS.length,
        meta: Object.assign({}, op.meta, { shop: facts, traits: TRAITS.map((t) => t.id) }) });
      return out;
    }
    out.push(ML.makeFinding({ id: 'source.thin_shop', category: 'source_funding', name: 'What this shop shows about its seller', severity: combo ? 2 : 0, confidence: 0.7, biases: ['authority_bias'], label: 'About the seller', why, explain, tip, evidence, count: TRAITS.length, meta: { shop: facts, traits: TRAITS.map((t) => t.id) } }));
    return out;
  };
})();
