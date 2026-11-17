/* Transaction detector: on pages that sell something, what is sold (digital / physical / subscription), how you pay
   (mainstream card or wallet vs irreversible: crypto, wire, gift cards), where checkout happens (this site, a known
   processor, an affiliate network, an unrelated domain), and whether you can get money back (refund link, "all sales
   final", a guarantee that the small print contradicts). Rolled into ONE finding, incentives.purchase_path; the
   details live in its evidence and meta, and in the "what's going on" reading. */
(function () {
  const ML = window.ML;
  const count = (re, text) => (text.match(re) || []).length;
  const amount = (s) => { let t = String(s).replace(/[^\d.,]/g, '').replace(/[.,]+$/, ''); if (/,\d{2}$/.test(t) && !t.includes('.')) t = t.replace(',', '.'); else t = t.replace(/,/g, ''); const v = parseFloat(t); return isFinite(v) ? v : null; };
  // how many times the monthly cost grows at renewal, when the page states both prices with their periods; unknown periods give nothing rather than a guess
  function renewalJump(rn, text, introPattern) {
    const after = text.slice(rn.index + rn[0].length - 12, rn.index + rn[0].length + 24); const r = rn[1] + ' ' + after;
    const months = /\/\s?(mo|month)\b|per month|monthly|a month/i.test(r) ? 1 : /\/\s?(yr|year|annum)\b|per (year|annum)|annually|yearly|a year/i.test(r) ? 12 : null;
    const renew = amount(rn[1]); if (!months || !renew) return null;
    let intro = null; for (const m of text.slice(Math.max(0, rn.index - 260), rn.index).matchAll(new RegExp(introPattern, 'gi'))) { const v = amount(m[1]); if (v) intro = m[2] ? v / parseInt(m[2], 10) : v; }
    if (!intro) return null;
    const jump = (renew / months) / intro; return jump >= 1.2 && jump <= 30 ? Math.round(jump * 10) / 10 : null;
  }
  ML.detectors.transaction = function (ctx) {
    const cfg = ctx.domConfig.transaction; const out = []; const text = ctx.index.fullText;
    const links = Array.from(document.querySelectorAll('a[href]'));
    const ctas = Array.from(document.querySelectorAll('a[href],button,input[type=submit],[role=button]'));
    const ctaText = (el) => ML.lower(el.innerText || el.value || el.textContent || el.getAttribute('aria-label') || '');
    const checkoutRe = new RegExp(cfg.checkoutWords, 'i');
    const currency = count(new RegExp(ctx.domConfig.pricing.currency, 'gi'), text);
    const checkoutCtas = ctas.filter((el) => checkoutRe.test(ctaText(el)));
    // a subscription needs a plan price ("$12/month") and a subscribe-style button, not just the word "subscribe" somewhere
    // a sale needs a buy or subscribe button with a price in the same box, an add-to-cart button, or Product markup (ML.commerceSignals)
    const cm = ctx.commerce || {}; const subscription = (cm.subBoxes > 0 && cm.planBoxes > 0 && !cm.addToCart) || cm.planBoxes >= 2;
    if (!cm.sells && !document.querySelector('form[action*="checkout" i]')) return out;

    const T = { selling: true };
    const dig = count(new RegExp(cfg.digitalWords, 'gi'), text), phys = count(new RegExp(cfg.physicalWords, 'gi'), text);
    T.product = subscription ? 'subscription' : dig > phys ? 'digital' : phys > dig || cm.addToCart || cm.catalogue ? 'physical' : 'unclear';
    // payment methods are read only where a page talks about paying: logo alt text, text around 'we accept / pay with /
    // payment methods / checkout', the box around a buy button, the footer. Never from article text (a crypto headline is not a payment method).
    const altText = Array.from(document.querySelectorAll('img[alt],img[title]')).map((i) => (i.alt || '') + ' ' + (i.title || '')).join(' ');
    let windows = ''; for (const m of text.matchAll(new RegExp(cfg.paymentContextWords, 'gi'))) windows += ' ' + text.slice(Math.max(0, m.index - 100), m.index + m[0].length + 180);
    let boxes = ''; for (const el of checkoutCtas.slice(0, 6)) { const box = el.closest('form, section, aside, [class*="price" i], [class*="plan" i], [class*="checkout" i], [class*="cart" i], [class*="buy" i], [class*="purchase" i]') || el.parentElement; if (box) boxes += ' ' + ML.normText(box.innerText || '').slice(0, 1500); }
    const footerEl = document.querySelector('footer, [role="contentinfo"]'); const footer = footerEl ? ML.normText(footerEl.innerText || '').slice(0, 2500) : '';
    const payCtx = altText + ' ' + windows + ' ' + boxes + ' ' + footer;
    const strictRe = new RegExp(cfg.irreversibleStrict, 'i');
    const uniq = (re, src) => Array.from(new Set((src.match(re) || []).map((s) => s.toLowerCase())));
    T.mainstream = uniq(new RegExp(cfg.mainstreamPayment, 'gi'), payCtx).slice(0, 8);
    // irreversible methods only from a sentence that says you pay that way: a Gift Cards menu link is not a payment method
    const statements = (windows + ' ' + boxes + ' ' + text).split(/(?<=[.!?\n])\s+/).filter((x) => strictRe.test(x));
    T.irreversible = uniq(new RegExp(cfg.irreversiblePayment, 'gi'), statements.join(' ')).slice(0, 8);
    T.irreversibleStated = T.irreversible.length > 0;
    // where does checkout go?
    const here = ML.registrableDomain(location.hostname); T.checkout = { host: null, where: 'this site', processor: null };
    const targets = [];
    for (const el of checkoutCtas) { const href = el.getAttribute && el.getAttribute('href'); if (href) targets.push(href); const form = el.closest && el.closest('form'); if (form && form.getAttribute('action')) targets.push(form.getAttribute('action')); }
    for (const f of document.querySelectorAll('form[action]')) if (/checkout|order|pay|purchase|buy/i.test(f.getAttribute('action'))) targets.push(f.getAttribute('action'));
    for (const t of targets) {
      let u; try { u = new URL(t, location.href); } catch (e) { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      const rd = ML.registrableDomain(u.hostname); if (rd === here) continue;
      const proc = Object.keys(cfg.processors).find((k) => u.hostname === k || u.hostname.endsWith('.' + k) || rd === k);
      T.checkout = { host: u.hostname, where: proc ? (cfg.affiliateNetworks.includes(proc) ? 'affiliate network' : cfg.merchantsOfRecord.includes(proc) ? 'merchant of record' : 'known processor') : 'unrelated domain', processor: proc ? cfg.processors[proc] : null };
      break;
    }
    // refunds
    const refundLink = links.find((a) => { const t = ML.lower(a.innerText || a.textContent || ''); const h = (a.getAttribute('href') || '').toLowerCase(); if (h === '#' || /^javascript:/.test(h)) return false; return cfg.refundLinkWords.some((w) => t === w || t.includes(w)) || cfg.refundHrefWords.some((w) => h.includes(w)); });
    const refundText = text + ' ' + Array.from(document.querySelectorAll('dialog,[role="dialog"],[class*="modal" i]')).slice(0, 20).map((e) => ML.normText(e.textContent || '')).join(' ').slice(0, 20000); // the terms in a closed checkout modal are terms of this sale
    const noRefund = refundText.match(new RegExp(cfg.noRefundWords, 'i')); const guarantee = refundText.match(new RegExp(cfg.guaranteeWords, 'i'));
    T.refundLink = !!refundLink; T.noRefund = noRefund ? ML.snippet(refundText, noRefund.index, noRefund.index + noRefund[0].length, 60) : null; T.guarantee = guarantee ? ML.normText(guarantee[0]).slice(0, 80) : null;
    T.refundStated = !!(guarantee && /\d+[- ]days?|in full|full refund/i.test(guarantee[0])); // a dated refund promise on the page is refund terms
    // merchant of record named in the text ("sold through Link by Stripe", "powered by Gumroad")
    const mor = text.match(/\b(sold|processed|handled|powered|fulfilled) (through|by|via|with) (Link by )?(Stripe|Paddle|Gumroad|Lemon Squeezy|FastSpring|Payhip|Shopify|PayPal|Square)\b/i);
    if (mor && T.checkout.where === 'this site' && (cm.buyBoxes > 0 || cm.addToCart)) T.checkout = { host: null, where: cfg.merchantsOfRecord.some((k) => k.startsWith(mor[4].toLowerCase().replace(/\s/g, ''))) ? 'merchant of record' : 'known processor', processor: mor[4] };
    // presence outside this site: links to the seller's own profiles or listings elsewhere
    T.presence = Array.from(new Set(links.map((a) => { try { const u = new URL(a.getAttribute('href'), location.href); const h = u.hostname.replace(/^www\./, ''); const hit = cfg.presenceHosts.find((p) => h === p || h.endsWith('.' + p)); return hit && u.pathname.length > 2 && !/\/(share|sharer|intent|dialog)\b/.test(u.pathname) ? hit : null; } catch (e) { return null; } }).filter(Boolean)));
    const rn = text.match(new RegExp(cfg.renewsAtPattern)); T.renewsAt = rn ? ML.normText(rn[1]).replace(/[.,]+$/, '') : null;
    T.renewalJump = rn && cfg.introPricePattern ? renewalJump(rn, text, cfg.introPricePattern) : null;
    const up = text.match(new RegExp(cfg.upfrontPattern, 'i')); T.upfront = up ? ML.lower(up[1]) : null;
    const here2 = location.hostname.replace(/^www\./, ''); T.marketplace = (cfg.marketplaceHosts || []).some((h) => here2 === h || here2.endsWith('.' + h));
    const sb = text.match(new RegExp(cfg.soldByPattern)); T.soldBy = sb ? ML.normText(sb[2]).split(' ').filter((w, i, arr) => !(cfg.soldByStopWords || []).includes(w) && !arr.slice(0, i).some((x) => (cfg.soldByStopWords || []).includes(x))).join(' ').slice(0, 50) || null : null;
    const rw = text.match(new RegExp(cfg.returnWindowPattern, 'i')); T.returnWindow = rw ? parseInt(rw[1], 10) : null;
    let sponsored = 0, firstSponsored = null; for (const el of document.querySelectorAll('span, div, p, a, small, h5, h6')) { if (sponsored >= 50) break; const tx = (el.childElementCount === 0 ? el.textContent : '').trim(); if (/^(sponsored|ad|advertisement|promoted)$/i.test(tx) && ML.isVisible(el)) { sponsored++; firstSponsored = firstSponsored || el; } }
    T.sponsoredPlacements = sponsored;
    // the money mechanic an insider would name first: seats, a cut of each sale, a fee before you start
    T.perSeat = subscription && new RegExp(cfg.perSeatPattern, 'i').test(text);
    const take = text.match(new RegExp(cfg.takeRatePattern, 'i')); T.takeRate = take ? (take[1] || take[2]) : null;
    const setup = text.match(new RegExp(cfg.setupFeePattern, 'i')); T.setupFee = setup ? ML.normText(setup[1] || setup[2]).replace(/[.,]+$/, '') : null;
    ctx.transaction = T;

    // whether refund terms are the question at all: a plan page answers it in its terms, and a brokerage has no product to send back
    const refundQuestion = T.product !== 'subscription' && !!(cm.addToCart || cm.buyBoxes > 0 || cm.schemaProduct || cm.hasCart || cm.catalogue);
    // an absence read before the footer renders is not an absence: judge it only once the page has settled and has no footer links at all
    const footerLinks = document.querySelectorAll('footer a[href],[role="contentinfo"] a[href],[class*="footer" i] a[href],[id*="footer" i] a[href]').length;
    const settled = performance.now() > 5000; if (T.guarantee && !T.refundLink && !settled && ctx.requestRescan) ctx.requestRescan(Math.ceil(5200 - performance.now()));
    const signals = [];
    if (T.irreversible.length && T.irreversibleStated && !T.mainstream.length) signals.push({ id: 'one_way_payment', severity: 3, label: 'One-way payment', short: T.irreversible.slice(0, 2).join(' or ') + ' only', note: 'Payment is accepted only by ' + T.irreversible.join(', ') + '. These transfers cannot be reversed or charged back; consumer-protection bodies list "insists on crypto, wire or gift cards" as the clearest scam sign.' });
    else if (T.irreversible.length) signals.push({ id: 'irreversible_option', severity: 0, label: 'Irreversible option', short: 'also takes ' + T.irreversible[0], note: 'Besides cards, the page offers ' + T.irreversible.join(', ') + '. Pay by card: it can be charged back; a transfer cannot.' });
    if (T.guarantee && T.noRefund) signals.push({ id: 'guarantee_contradicted', severity: 3, label: 'Guarantee contradicted', short: 'a guarantee the small print cancels', note: 'The page promises "' + T.guarantee + '" and elsewhere states "' + ML.normText(noRefund[0]) + '". The page contradicts itself; the small print is what applies.' });
    else if (T.noRefund) signals.push({ id: 'no_refunds', severity: T.product === 'digital' ? 0 : 1, label: 'No refunds', short: 'no refunds', note: 'The page states "' + ML.normText(noRefund[0]) + '". For digital goods this is lawful once you agree to immediate delivery; either way your only recourse after paying is a card chargeback.' });
    else if (T.refundStated) signals.push({ id: 'refund_stated', severity: 0, label: 'Refund terms stated', short: T.guarantee.split(' ').length <= 5 ? 'refund terms stated (' + T.guarantee + ')' : 'refund terms stated on the page', note: 'The page itself states the refund terms: "' + T.guarantee + '".' });
    else if (T.guarantee && !T.refundLink && !refundQuestion) { /* a plan page answers this in its terms */ }
    else if (T.guarantee && !T.refundLink && (!settled || footerLinks > 0)) signals.push({ id: 'guarantee_stated', severity: 0, label: 'Guarantee stated', short: 'a guarantee; terms not linked here', note: 'The page promises "' + T.guarantee + '". Its refund terms are not linked from what was read of this page; they may sit in a page this scan did not open.' });
    else if (T.guarantee && !T.refundLink) signals.push({ id: 'guarantee_no_terms', severity: 2, label: 'Guarantee, no terms', short: 'a guarantee with no refund terms', note: 'The page promises "' + T.guarantee + '" but links to no refund, returns or cancellation terms, so the promise has no stated conditions.' });
    else if (!T.refundLink && refundQuestion && (cm.addToCart || cm.buyBoxes > 0)) signals.push({ id: 'no_refund_policy', severity: 0, label: 'No refund link here', short: 'no refund link on this page', note: 'No refund, returns or cancellation page is linked from this page.' });
    if (T.checkout.where === 'unrelated domain') signals.push({ id: 'offsite_checkout', severity: 2, label: 'Off-site checkout', short: 'checkout on an unrelated domain', note: 'The buy button sends you to ' + T.checkout.host + ', a domain unrelated to this site and not a known payment processor. The merchant of record is whoever runs that domain.' });
    else if (T.checkout.where === 'affiliate network') signals.push({ id: 'affiliate_checkout', severity: 1, label: 'Affiliate checkout', short: 'sold through ' + T.checkout.processor, note: 'Checkout runs through ' + T.checkout.processor + ', an affiliate-marketing network: the page you are reading is likely a commissioned sales page, not the seller.' });
    else if (T.checkout.where === 'merchant of record') signals.push({ id: 'merchant_of_record', severity: 0, label: 'Sold via ' + T.checkout.processor, short: 'sold through ' + T.checkout.processor + ', the seller of record', note: T.checkout.processor + ' is the merchant of record: it takes the payment, issues the receipt and handles refunds under its own terms. That is the clearest "who answers" fact on a small seller\'s page.' });
    else if (T.checkout.where === 'known processor') signals.push({ id: 'processor_checkout', severity: 0, label: 'Checkout via ' + T.checkout.processor, short: 'checkout via ' + T.checkout.processor, note: 'Payment is handled by ' + T.checkout.processor + ', which has its own dispute process (a processor, not the seller of record).' });
    if (T.renewsAt) signals.push({ id: 'renewal_price', severity: 1, label: 'Renewal price', short: 'renews at ' + T.renewsAt + (T.renewalJump ? ' (' + T.renewalJump + 'x)' : ''), note: 'The headline price is an introductory one: the page says it renews at ' + T.renewsAt + (T.renewalJump ? ', ' + T.renewalJump + ' times the introductory rate per month' : '') + (T.upfront ? ' and is ' + T.upfront : '') + '.' });
    else if (T.upfront) signals.push({ id: 'billing_cadence', severity: 0, label: 'Billing terms', short: T.upfront, note: 'The page says: ' + T.upfront + '.' });
    if (T.soldBy) signals.push({ id: 'sold_by', severity: 0, label: 'Sold by ' + T.soldBy, short: 'sold by ' + T.soldBy, note: 'The page names the seller of record as ' + T.soldBy + '.' });
    if (T.sponsoredPlacements >= 3) signals.push({ id: 'sponsored_placements', severity: 0, label: T.sponsoredPlacements + ' sponsored placements', short: T.sponsoredPlacements + ' sponsored placements paid for by other sellers', note: T.sponsoredPlacements + ' items on this page are labelled sponsored: other sellers paid for them to appear next to what you came for.' });
    if (T.returnWindow && !T.noRefund && !T.guarantee) signals.push({ id: 'return_window', severity: 0, label: T.returnWindow + '-day returns', short: 'returns within ' + T.returnWindow + ' days', note: 'The page states a ' + T.returnWindow + '-day return window.' });
    if (T.product === 'digital' && !T.presence.length && !T.marketplace && !(ctx.provenance && ctx.provenance.platform)) signals.push({ id: 'digital_only_here', severity: 0, label: 'No listing elsewhere', short: 'no listing elsewhere linked', note: 'What is sold is a download or access, and the page links to no profile, store listing or review page for the seller elsewhere. Nothing outside this site vouches for the product.' });
    if (!signals.length) return out;
    const strongest = signals.slice().sort((a, b) => b.severity - a.severity);
    const severity = strongest[0].severity;
    const whyParts = []; for (const x of (strongest.filter((y) => y.severity > 0).length ? strongest.filter((y) => y.severity > 0) : strongest).slice(0, 3)) { if (whyParts.length && whyParts.concat(x.short).join(' ').split(/\s+/).length > 12) break; whyParts.push(x.short); } // twelve words at most; the rest is in the explanation
    const why = whyParts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.';
    const evidence = [];
    if (T.noRefund) evidence.push({ quote: T.noRefund, elId: null });
    if (T.irreversible.length) { const m = text.match(new RegExp(cfg.irreversiblePayment, 'i')); if (m) evidence.push({ quote: ML.snippet(text, m.index, m.index + m[0].length, 70), elId: null }); }
    if (T.checkout.host) evidence.push({ quote: 'checkout: ' + T.checkout.host, elId: null });
    if (guarantee) evidence.push({ quote: ML.snippet(refundText, guarantee.index, guarantee.index + guarantee[0].length, 60), elId: null });
    if (rw && !guarantee && !noRefund) evidence.push({ quote: ML.snippet(text, rw.index, rw.index + rw[0].length, 60), elId: null });
    if (rn) evidence.push({ quote: ML.snippet(text, rn.index, rn.index + rn[0].length, 60), elId: null });
    if (up && !rn) evidence.push({ quote: ML.snippet(text, up.index, up.index + up[0].length, 60), elId: null });
    if (firstSponsored && T.sponsoredPlacements >= 3) { const box = firstSponsored.parentElement || firstSponsored; const t = ML.normText(box.innerText || box.textContent || '').slice(0, 100); evidence.push(ML.evidenceFor(box, (t ? t + ' ' : '') + '(' + T.sponsoredPlacements + ' items labelled sponsored)')); }
    out.push(ML.makeFinding({
      id: 'incentives.purchase_path', category: 'incentives', name: 'Purchase path: ' + strongest.map((x) => x.label).join(', '), severity, confidence: severity >= 3 ? 0.8 : 0.7,
      label: strongest[0].label, why,
      biases: ['sunk_cost', 'loss_aversion'],
      explain: 'What happens to your money if you buy. ' + strongest.map((x) => x.note).join(' ') + (T.product !== 'unclear' ? ' The product reads as ' + T.product + '.' : ''),
      tip: 'Pay only by a method you can reverse (card or PayPal), after finding the refund terms and the seller\'s name outside this page.',
      evidence, count: signals.length, meta: { signals: signals.map((x) => x.id), product: T.product, mainstream: T.mainstream, irreversible: T.irreversible, checkout: T.checkout, refundLink: T.refundLink, presence: T.presence }
    }));
    return out;
  };
})();
