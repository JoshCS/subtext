/* DOM dark-pattern detector: structure, defaults, consent asymmetry, disguised ads, trust badges, gates, feeds. */
(function () {
  const ML = window.ML;

  function textOf(el) { return ML.lower(el.innerText || el.textContent || el.value || el.getAttribute('aria-label') || ''); }
  function labelTextFor(input) {
    let t = '';
    if (input.labels && input.labels.length) t += ' ' + Array.from(input.labels).map((l) => l.innerText || l.textContent).join(' ');
    const wrap = input.closest('label'); if (wrap) t += ' ' + (wrap.innerText || wrap.textContent);
    const al = input.getAttribute('aria-label'); if (al) t += ' ' + al;
    const lb = input.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach((id) => { const e = document.getElementById(id); if (e) t += ' ' + e.textContent; });
    if (!t.trim() && input.parentElement) t = input.parentElement.innerText || input.parentElement.textContent || '';
    return ML.lower(t).slice(0, 400);
  }
  const CONTROL = 'button,a[href],[role="button"],input[type="button"],input[type="submit"]';
  const CLICKABLE = CONTROL + ',[class*="btn" i],[class*="button" i]';
  // leaf controls only: a wrapper styled "buttons" holds both choices and would classify as either
  function clickables(container) {
    return Array.from(container.querySelectorAll(CLICKABLE)).filter((el) => {
      if (!ML.isVisible(el) || textOf(el).length === 0 || textOf(el).length >= 80) return false;
      if (el.matches(CONTROL)) return !el.querySelector(CONTROL);
      return !el.querySelector(CLICKABLE) && !el.closest(CONTROL); // a label span inside a real button is the button
    });
  }
  // Measured context for Deep Analyze, not another warning. Only unambiguous,
  // visible two-choice containers; never read input values or editable fields.
  const DIALOG = '[role="dialog"],dialog[open],[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="overlay" i],[class*="lightbox" i]';
  function recordChoiceLayout(ctx, container, primary, alternative, controls) {
    if (ctx.choiceLayout.length >= 3 || controls.length !== 2 || primary === alternative) return;
    if (!primary || !alternative || !ML.isVisible(container)) return;
    if (!primary.matches(CONTROL) || !alternative.matches(CONTROL)) return;
    if (!container.contains(primary) || !container.contains(alternative) || primary.contains(alternative) || alternative.contains(primary)) return;
    // A broad overlay can contain several sibling dialogs; do not pair across them.
    const aDialog = primary.closest(DIALOG), bDialog = alternative.closest(DIALOG);
    if (aDialog !== bDialog || (aDialog && aDialog !== container && !aDialog.contains(container))) return;
    const label = (el) => {
      if (!ML.isVisible(el) || el.matches('input,textarea,select,[contenteditable]') || el.querySelector('input,textarea,select,[contenteditable]')) return '';
      return ML.normText(el.innerText || '').slice(0, 80);
    };
    const a = label(primary), b = label(alternative);
    if (!a || !b || a === b) return;
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? Math.round(r.width * r.height) : 0; };
    const primaryArea = area(primary), alternativeArea = area(alternative);
    if (![primaryArea, alternativeArea].every((v) => Number.isSafeInteger(v) && v > 0)) return;
    if (ctx.choiceLayout.some((v) => v.primary === a && v.alternative === b && v.primaryArea === primaryArea && v.alternativeArea === alternativeArea)) return;
    // The price must be displayed in this same choice, never lifted from a different plan.
    let terms = '';
    if (!container.querySelector('input,textarea,[contenteditable]') && (container.innerText || '').length <= 1400) {
      const rows = (container.innerText || '').split(/\n/).map(ML.normText).filter(t=>t.length<=180 && /(?:billed|charged|payable) (?:annually|yearly)/i.test(t));
      const other = rows.length===1 ? (container.innerText || '').replace(rows[0],'') : '';
      if (rows.length === 1 && !/[$€£]\s*\d|\b(?:per (?:user|person|seat)|minimum|introductory|first \d+ months?|starting (?:at|from)|up to|excluding|plus tax)\b/i.test(other)) terms = rows[0];
    }
    ctx.choiceLayout.push({ primary: a, alternative: b, primaryArea, alternativeArea, ...(terms ? {terms} : {}) });
    if (ctx.choiceCandidates) ctx.choiceCandidates.push({ container, primary, alternative });
  }
  // A modal can resize or close between the scan and the request. Remeasure on the click.
  ML.currentChoiceLayout = function (ctx) {
    ML.freshVisibilityCache();
    const fresh = { choiceLayout: [] };
    for (const { container, primary, alternative } of (ctx.choiceCandidates || [])) {
      if (container.isConnected) recordChoiceLayout(fresh, container, primary, alternative, clickables(container));
    }
    return fresh.choiceLayout;
  };
  function classify(el, cfg) {
    const t = textOf(el).replace(/[’]/g, "'").replace(/[^a-z0-9' &]/g, ' ').replace(/\s+/g, ' ').trim();
    const short = t.split(' ').length <= 4; // a sentence that mentions "accept" is not an accept button
    const has = (list) => list.some((w) => t === w || (short && (t.startsWith(w + ' ') || t.endsWith(' ' + w) || (w.length > 6 && t.includes(w)))));
    if (has(cfg.rejectWords)) return 'reject';
    if (has(cfg.manageWords)) return 'manage';
    if (has(cfg.acceptWords)) return 'accept';
    return null;
  }
  function visualWeight(el) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fg = ML.parseColor(cs.color); const bg = ML.effectiveBackground(el);
    return { area: ML.rectArea(r), font: parseFloat(cs.fontSize) || 14, solid: ML.hasSolidBackground(el), contrast: ML.contrast(fg, bg) || 21, weight: parseInt(cs.fontWeight, 10) || 400, rect: r };
  }
  // the crossed-out price and the price it sits beside, so a reader can check the pair
  function struckQuote(el, currencyRe) {
    const was = ML.normText(el.textContent); let anc = el.parentElement, depth = 0;
    while (anc && depth++ < 3) {
      const rest = ML.normText(anc.textContent || '').replace(was, ' '); const m = rest.length < 400 && rest.match(currencyRe);
      if (m) return (was + ' → ' + ML.normText(m[0])).slice(0, 120);
      anc = anc.parentElement;
    }
    return was + ' (crossed out)';
  }
  // what an animation changes: a loading shimmer or a fade only touches opacity or background
  function fadeOnlyKeyframes(names) {
    const wanted = new Set(String(names).split(',').map((n) => n.trim())); const props = new Set(); let found = false;
    for (const sheet of Array.from(document.styleSheets).slice(0, 80)) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; } // a cross-origin sheet cannot be read
      for (const r of Array.from(rules || []).slice(0, 4000)) {
        if (r.type !== CSSRule.KEYFRAMES_RULE || !wanted.has(r.name)) continue;
        found = true; for (const kf of Array.from(r.cssRules)) for (let i = 0; i < kf.style.length; i++) props.add(kf.style[i]);
      }
    }
    return found && Array.from(props).every((p) => /^(opacity|background)/.test(p));
  }
  function animationQuote(el) {
    const cs = getComputedStyle(el); const count = cs.animationIterationCount === 'infinite' ? 'repeats forever' : 'repeats ' + cs.animationIterationCount + ' times';
    return ('"' + ML.normText(el.innerText || el.textContent || '').slice(0, 40) + '": animation ' + cs.animationName + ', ' + cs.animationDuration + ', ' + count).slice(0, 140);
  }
  // Compare the "yes" choice against the "no" choice inside one container.
  function asymmetry(accept, reject) {
    const a = visualWeight(accept), b = visualWeight(reject);
    const reasons = [];
    if (b.area < a.area * 0.55) reasons.push('decline is ' + Math.round((1 - b.area / Math.max(a.area, 1)) * 100) + '% smaller');
    if (a.solid && !b.solid) reasons.push('decline styled as plain text, accept as a button');
    if (b.contrast < 3 && a.contrast >= 3) reasons.push('decline text is low-contrast (' + b.contrast.toFixed(1) + ':1)');
    if (b.font < a.font * 0.8) reasons.push('decline uses smaller type');
    return reasons;
  }

  ML.detectors.dom = function (ctx) {
    const cfg = ctx.domConfig, out = [];
    ctx.choiceLayout = [];
    ctx.choiceCandidates = [];
    const add = (f) => out.push(ML.makeFinding(f));
    const vpArea = ML.viewportArea();

    // 1. Pre-checked opt-ins / upsells ---------------------------------------
    const PRECHECK_WORDS = /\b(newsletters?|subscribe|offers?|marketing|promotions?|promotional|partners?|third[- ]part(y|ies)|insurance|protection|warranty|donat(e|ion)|tip|add[- ]?ons?|upgrade|priority|express|trial|premium|share my|contact me|updates?|updated|sms|text me|keep me|remember me|auto[- ]?renew(al|s)?|cover|coverage|guarantee|extended)\b/i;
    const PAID_ADDON = /\b(insurance|protection|warranty|add[- ]?ons?|upgrade|premium|tip|donat(e|ion)|guarantee|coverage|auto[- ]?renew(al|s)?)\b|\+\s?(\$|£|€)\s?\d/i; // a radio group must have a default; only a paid extra is worth flagging
    const prechecked = [];
    document.querySelectorAll('input[type="checkbox"]:checked,input[type="radio"]:checked,[role="checkbox"][aria-checked="true"],[role="switch"][aria-checked="true"]').forEach((inp) => {
      if (!ML.isVisible(inp) && !(inp.closest('label') && ML.isVisible(inp.closest('label')))) return;
      const lt = labelTextFor(inp);
      if (inp.type === 'radio' && !PAID_ADDON.test(lt)) return;
      if (lt && PRECHECK_WORDS.test(lt) && !/remember me|stay (signed|logged) in/i.test(lt)) prechecked.push({ inp, lt });
    });
    if (prechecked.length) add({
      id: 'dark.preselection', category: 'dark_pattern', name: 'Pre-checked opt-in or add-on', severity: 2, confidence: 0.85,
      biases: ['default_effect', 'status_quo_bias', 'sneaking'],
      explain: 'Boxes that arrive already ticked rely on inertia: most people never change a default. GDPR requires consent to be an active choice, and the FTC treats pre-checked add-ons as deceptive.',
      tip: 'Untick everything you did not consciously choose before continuing.',
      evidence: prechecked.slice(0, 4).map((p) => ML.evidenceFor(p.inp.closest('label') || p.inp.parentElement || p.inp, p.lt.slice(0, 140))), count: prechecked.length
    });

    // 2. Strikethrough reference prices ------------------------------------
    const currencyRe = new RegExp(cfg.pricing.currency, 'i');
    const strikes = [];
    try {
      document.querySelectorAll(cfg.pricing.strikeSelectors.join(',')).forEach((el) => {
        if (strikes.length > 40 || !ML.isVisible(el)) return;
        const t = ML.normText(el.textContent);
        const cs = getComputedStyle(el);
        const struck = /line-through/.test(cs.textDecorationLine || cs.textDecoration) || ['S', 'DEL', 'STRIKE'].includes(el.tagName); // a class name like price-list is not a crossed-out price
        if (t.length < 40 && currencyRe.test(t) && struck) strikes.push(el);
      });
    } catch (e) { /* selector issues */ }
    if (strikes.length) add({
      id: 'bias.anchoring_strikethrough', category: 'bias_exploit', name: 'Crossed-out reference prices', severity: 1, confidence: 0.8,
      biases: ['anchoring', 'framing'],
      explain: 'Struck-through "was" prices anchor your sense of value. Reference prices are often inflated or were never actually charged; the UK CMA and US state AGs have acted on exactly this.',
      tip: 'Judge the current price on its own, and check a price-history tool.',
      evidence: strikes.slice(0, 4).map((el) => ML.evidenceFor(el.parentElement || el, struckQuote(el, currencyRe))), count: strikes.length
    });

    // 3. Pricing-tier steering badges ----------------------------------------
    const badgeHits = [];
    const SHORT = Array.from(document.querySelectorAll('span,div,p,em,strong,b,small,label,h3,h4,h5,h6,li,td,th'))
      .filter((el) => el.children.length === 0 && (el.textContent || '').length < 28);
    for (const el of SHORT) {
      const t = ML.lower(el.textContent);
      if (!cfg.pricing.tierBadges.includes(t) || !ML.isVisible(el)) continue;
      let anc = el.parentElement, depth = 0;
      while (anc && depth++ < 6) {
        const matches = (anc.innerText || '').match(new RegExp(cfg.pricing.currency, 'gi')) || [];
        if (matches.length >= 2) { badgeHits.push(el); break; }
        anc = anc.parentElement;
      }
      if (badgeHits.length >= 6) break;
    }
    if ((ctx.index.fullText.match(new RegExp(ctx.domConfig.transaction.planPricePattern, 'gi')) || []).length >= 2 && (badgeHits.length)) add({
      id: 'bias.decoy_tier_badge', category: 'bias_exploit', name: '"Most popular" / "best value" tier steering', severity: 1, confidence: 0.75,
      biases: ['social_proof', 'anchoring', 'default_effect'],
      explain: 'Pricing tables highlight the plan the seller wants you to buy and often include a deliberately poor "decoy" tier that makes the target look reasonable.',
      tip: 'List what you actually need, then pick the cheapest tier that has it.',
      evidence: badgeHits.slice(0, 3).map((el) => ML.evidenceFor(el)), count: badgeHits.length
    });

    // 4. Consent banner asymmetry -------------------------------------------
    const bannerCands = Array.from(document.querySelectorAll('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i],[id*="privacy" i][role="dialog"],[class*="cmp" i],[id*="cmp" i],[id*="onetrust" i],[id*="qc-cmp" i],[id*="sp_message" i],[id*="didomi" i],[id*="usercentrics" i],[class*="cc-window" i],[class*="cookiebanner" i],[role="dialog"],[aria-modal="true"]'))
      .filter((el) => ML.isVisible(el));
    let banner = null;
    for (const el of bannerCands) {
      const t = ML.lower(el.innerText || '').slice(0, 2000);
      if (t.length > 20 && cfg.consent.bannerKeywords.some((k) => t.includes(k)) && el.getBoundingClientRect().height > 30) { banner = el; break; }
    }
    ctx.consentBannerText = banner ? ML.normText(banner.innerText || '').slice(0, 2000) : '';
    if (banner) {
      const btns = clickables(banner);
      const accept = btns.find((b) => classify(b, cfg.consent) === 'accept');
      const reject = btns.find((b) => classify(b, cfg.consent) === 'reject');
      const manage = btns.find((b) => classify(b, cfg.consent) === 'manage');
      if (accept && reject && btns.filter((b) => classify(b, cfg.consent) === 'accept').length === 1 && btns.filter((b) => classify(b, cfg.consent) === 'reject').length === 1) recordChoiceLayout(ctx, banner, accept, reject, btns);
      ML.mark(banner);
      if (accept && !reject) {
        add({
          id: 'surveillance.consent_no_reject', category: 'surveillance', name: 'Cookie consent: no one-click reject', severity: 2, confidence: 0.85, why: manage ? undefined : 'Notice only, no choice offered.',
          biases: ['default_effect', 'obstruction'],
          explain: 'The banner offers "Accept" in one click but hides refusal behind ' + (manage ? '"' + ML.normText(manage.innerText || manage.textContent).slice(0, 30) + '"' : 'nothing at all') + '. EU regulators (CNIL, EDPB) have ruled that refusing must be as easy as accepting.',
          tip: 'Open the settings and reject all, or use a consent-blocking extension.',
          evidence: [ML.evidenceFor(banner, ML.normText(banner.innerText).slice(0, 160)), ML.evidenceFor(accept)], count: 1
        });
      } else if (accept && reject && accept.matches(CONTROL) && reject.matches(CONTROL) && !accept.contains(reject) && !reject.contains(accept)) {
        const reasons = asymmetry(accept, reject);
        if (reasons.length) add({
          id: 'design.consent_asymmetry', category: 'design_psych', name: 'Cookie consent: reject visually subordinate', severity: 2, confidence: 0.8,
          biases: ['default_effect', 'framing'],
          explain: 'Both choices exist but are not equal: ' + reasons.join('; ') + '. Visual hierarchy is used to make the privacy-protective choice feel like the wrong one.',
          tip: 'Click the quiet grey one.',
          evidence: [ML.evidenceFor(accept, '"' + textOf(accept).slice(0, 30) + '" beside "' + textOf(reject).slice(0, 30) + '": ' + reasons.join('; ')), ML.evidenceFor(reject)], count: 1
        });
      }
    }

    // 5. Generic modal choice asymmetry (non-consent) ------------------------
    const DECLINE = ['no thanks', 'no, thanks', 'no thank you', 'no, thank you', 'not now', 'maybe later', 'continue without', 'i\'ll pass', 'remind me later', 'not interested', 'decline']; // words of refusal; a close icon or "skip" is a way out of the box, not a buried no
    const refusalText = (el) => ML.lower(el.innerText || el.textContent || '').replace(/[’]/g, "'").trim(); // visible text only: an icon button with an aria-label never qualifies
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"],dialog[open],[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="overlay" i],[class*="lightbox" i]'))
      .filter((el) => el !== banner && ML.isVisible(el) && ML.rectArea(el.getBoundingClientRect()) > vpArea * 0.08);
    for (const d of dialogs.slice(0, 5)) {
      if (/\b(cookies?|consent)\b/i.test((d.innerText || '').slice(0, 800))) continue; // the consent check covers this banner
      const btns = clickables(d);
      if (btns.length < 2) continue;
      const decline = btns.find((b) => { const t = refusalText(b); return DECLINE.some((w) => t === w || t.startsWith(w + ',') || t.startsWith(w + ' ') || t.startsWith(w + '.')); });
      if (!decline) continue;
      const primary = btns.filter((b) => b !== decline).sort((x, y) => visualWeight(y).area - visualWeight(x).area)[0];
      if (!primary) continue;
      const refusalCount = btns.filter((b) => { const t = refusalText(b); return DECLINE.some((w) => t === w || t.startsWith(w + ',') || t.startsWith(w + ' ') || t.startsWith(w + '.')); }).length;
      if (refusalCount === 1) recordChoiceLayout(ctx, d, primary, decline, btns);
      const reasons = asymmetry(primary, decline);
      if (reasons.length >= 1) {
        add({
          id: 'design.asymmetric_choice', category: 'design_psych', name: 'Pop-up with visually buried decline option', severity: 2, confidence: 0.7,
          biases: ['default_effect', 'framing', 'confirmshaming'],
          explain: 'In this dialog the option the site wants is a big, high-contrast button while declining is ' + reasons.join(', ') + '. Visual weight is doing the persuading.',
          tip: 'Look for the smallest, greyest text in any pop-up. That is usually the way out.',
          evidence: [ML.evidenceFor(primary, '"' + textOf(primary).slice(0, 30) + '" beside "' + textOf(decline).slice(0, 30) + '": ' + reasons.join('; ')), ML.evidenceFor(decline)], count: 1
        });
        break;
      }
    }

    // 6. Disguised ads / sponsored labels -----------------------------------
    const sponsored = [];
    let tinyLabels = 0;
    for (const el of SHORT) {
      const t = ML.lower(el.textContent).replace(/[^a-z ·•|]/g, '').trim();
      if (!t || !ML.isVisible(el)) continue;
      if (cfg.sponsoredLabels.some((s) => t === s || (s.length > 5 && t.startsWith(s)))) {
        sponsored.push(el);
        const cs = getComputedStyle(el);
        const contrast = ML.contrast(ML.parseColor(cs.color), ML.effectiveBackground(el)) || 21;
        if (parseFloat(cs.fontSize) < 10 || contrast < 3) tinyLabels++;
        if (sponsored.length >= 30) break;
      }
    }
    if (tinyLabels > 0) add({ // a clear label is a disclosure; only a tiny or faint one blends the ad into the content
      id: 'dark.disguised_ads', category: 'dark_pattern', name: 'Sponsored units with tiny or faint labels', severity: 2, confidence: 0.8,
      biases: ['authority_bias', 'halo_effect'],
      explain: sponsored.length + ' element(s) are labelled sponsored, promoted or advertisement' + (tinyLabels ? ', and ' + tinyLabels + ' of those labels are tiny or low-contrast, which is how ads get mistaken for editorial content' : '') + '. Native ads are designed to look like the surrounding material.',
      tip: 'Scan for the small "Sponsored" tag before trusting any recommendation or headline in a feed.',
      evidence: sponsored.slice(0, 4).map((el) => ML.evidenceFor(el.parentElement && (el.parentElement.textContent || '').length < 300 ? el.parentElement : el)), count: sponsored.length
    });

    // 7. Trust badge images ----------------------------------------------------
    const badgeWords = new Set();
    const badges = Array.from(document.querySelectorAll('img')).filter((img) => {
      if (!ML.isVisible(img)) return false;
      if (img.closest('[class*="logo" i],[class*="customer" i],[class*="trusted" i],[class*="client" i],[class*="brands" i],[class*="partner" i]')) return false; // a customer logo wall is not a certification claim
      if (img.closest('[class*="product" i],[class*="cover" i],a[href*="/product" i],a[href*="/p/" i],a[href*="/item" i]')) return false; // a product photo or a book cover is not a badge
      const t = ML.lower((img.alt || '') + ' ' + (img.title || ''));
      if (/google play|app store|get it on|download on|\b(visa|mastercard|master card|paypal|jcb|amex|american express|discover|maestro|apple pay|google pay|klarna)\b/.test(t)) return false; // payment marks are payment methods (transaction.js)
      const hits = cfg.trustBadgeWords.filter((w) => new RegExp('\\b' + w + '\\b').test(t));
      if (!hits.length || img.width >= 260 || img.height >= 140) return false;
      hits.forEach((w) => badgeWords.add(w)); return true;
    });
    if (badges.length >= 2 && badgeWords.size >= 2 && ctx.commerce && ctx.commerce.sells) add({
      id: 'claims.trust_badge_images', category: 'deceptive_claims', name: 'Trust-badge graphics', severity: 1, confidence: 0.7,
      biases: ['trust_badges', 'authority_bias'],
      explain: badges.length + ' badge-style images (secure, verified, guarantee, award, "as seen on") were found. Badges raise conversion whether or not anything was certified.',
      tip: 'Click a badge: a real certification links to the certifier. A static image certifies nothing.',
      evidence: badges.slice(0, 4).map((img) => ML.evidenceFor(img, (img.alt || img.title || '').slice(0, 120))), count: badges.length
    });

    // 8. Content gates / blurred text ----------------------------------------
    let gate = null;
    const gateWords = /\b(subscribe|subscription|sign in|log in|register|continue reading|keep reading|members only|premium|paywall|free account|abonn|anmelden)\b/i;
    try { gate = Array.from(document.querySelectorAll(cfg.gates.selectors.join(','))).find((el) => ML.isVisible(el) && ML.rectArea(el.getBoundingClientRect()) > 5000 && gateWords.test(el.innerText || '') && !el.closest('nav,header,footer')); } catch (e) { /* ignore */ }
    if (!gate) {
      const article = document.querySelector('article, main, [class*="article-body" i], [class*="story-body" i]');
      if (article) {
        for (const el of Array.from(article.querySelectorAll('div,section,p')).slice(0, 400)) {
          const cs = getComputedStyle(el);
          if ((/blur\(/.test(cs.filter) || (cs.maskImage && cs.maskImage !== 'none' && /gradient/.test(cs.maskImage))) && gateWords.test((el.parentElement && el.parentElement.innerText) || '')) { gate = el; break; }
        }
      }
    }
    if (gate) add({
      id: 'dark.content_gate', category: 'dark_pattern', name: 'Content gate / blurred text', severity: 2, confidence: 0.75,
      biases: ['forced_action', 'curiosity_gap', 'sunk_cost'],
      explain: 'Part of the content is hidden or blurred behind a registration or subscription wall after you have started reading. The visible teaser is the curiosity gap; the wall is the ask.',
      tip: 'Decide whether the source is worth paying for on its merits. Reader mode and archive copies often bypass soft walls, which tells you how soft the wall is.',
      evidence: [ML.evidenceFor(gate, ML.normText(gate.innerText || '').slice(0, 140))], count: 1
    });

    // 9. Engagement feed (repeated cards with like/comment counters) --------
    const feedRe = new RegExp(cfg.feed.engagementCounterPattern, 'i');
    let feed = null;
    const parents = new Map();
    for (const el of Array.from(document.querySelectorAll('article, li, [class*="card" i], [class*="post" i], [class*="item" i], [class*="tweet" i], [class*="feed" i] > div, [data-testid]')).slice(0, 1500)) {
      if (!el.parentElement) continue;
      const sig = el.parentElement.tagName + '|' + el.tagName + '|' + (el.className && typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 2).join('.') : '');
      const key = el.parentElement;
      const m = parents.get(key) || { sig: {}, count: 0 };
      m.sig[sig] = (m.sig[sig] || 0) + 1; parents.set(key, m);
    }
    for (const [parent, m] of parents) {
      const best = Math.max(...Object.values(m.sig));
      if (best >= cfg.feed.minRepeatedCards) {
        const kids = Array.from(parent.children).slice(0, 40);
        const withCounters = kids.filter((k) => feedRe.test(String(k.innerText || '').slice(0, 2000))).length;
        if (withCounters >= Math.max(3, kids.length * 0.4)) { feed = parent; break; }
      }
    }
    if (feed) add({
      id: 'attention.engagement_feed', category: 'attention', name: 'Engagement-ranked feed', severity: 0, confidence: 0.75,
      biases: ['variable_reward', 'filter_bubble', 'social_proof'],
      explain: 'A long list of repeated cards carrying like/comment/share counters is a feed optimized for engagement. The ordering is chosen by what provokes reactions, and the counters are social proof for each item.',
      tip: 'Sort chronologically or follow specific sources if the platform allows it. Ask why each item was shown to you.',
      evidence: [ML.evidenceFor(feed, ML.normText(feed.innerText || '').slice(0, 140))], count: 1, meta: { cards: feed.children.length }
    });

    // 10. Notification pre-permission prompt ----------------------------------
    const prePerm = Array.from(document.querySelectorAll('div,section,aside,[role="dialog"]')).slice(0, 2500).find((el) => {
      if (!ML.isVisible(el) || el.children.length > 12) return false;
      const t = ML.lower(el.innerText || '');
      if (t.length < 15 || t.length > 400) return false;
      const cs = getComputedStyle(el);
      return cfg.notifications.prePermissionWords.some((w) => t.includes(w)) && (cs.position === 'fixed' || cs.position === 'sticky' || el.getAttribute('role') === 'dialog') && /allow|enable|yes|turn on|subscribe|notify/.test(t);
    });
    if (prePerm) add({
      id: 'surveillance.notification_preprompt', category: 'surveillance', name: 'Custom notification permission prompt', severity: 2, confidence: 0.75,
      biases: ['fomo', 'interruption', 'foot_in_door'],
      explain: 'The site shows its own "Allow notifications?" prompt before the browser\'s. Pre-prompts exist because browsers penalize sites whose real prompts get denied, so the site screens you first.',
      tip: 'Decline. Browser notifications hand the site a channel into your attention that it controls.',
      evidence: [ML.evidenceFor(prePerm, ML.normText(prePerm.innerText).slice(0, 140))], count: 1
    });

    // 11. Subscribe CTA with no visible cancellation path -----------------------
    const allClick = Array.from(document.querySelectorAll('a[href],button')).map((e) => ML.lower(e.innerText || e.textContent || ''));
    const hasSubscribe = allClick.some((t) => /^(subscribe|start (my |your )?(free )?trial|try (it )?free|sign up|join now|get started|upgrade|buy now|start free)/.test(t));
    const hasCancel = allClick.some((t) => /cancel|unsubscribe|manage (your |my )?(subscription|membership|plan)|billing/.test(t)) || /how to cancel|cancel anytime|cancel at any time|cancel online/i.test(ctx.index.fullText);
    const currencyCount = (ctx.index.fullText.match(new RegExp(cfg.pricing.currency, 'gi')) || []).length;
    if (hasSubscribe && !hasCancel && currencyCount >= 2 && ctx.commerce && ctx.commerce.sells && ctx.commerce.planBoxes > 0) add({
      id: 'dark.no_cancel_path', category: 'dark_pattern', name: 'Subscription offered, no cancellation information visible', severity: 0, confidence: 0.55,
      biases: ['roach_motel', 'status_quo_bias'],
      explain: 'The page sells a recurring product without saying how to stop it. The asymmetry between the prominence of "subscribe" and the absence of "cancel" is a weak but real roach-motel signal.',
      tip: 'Search the site for the cancellation procedure before you subscribe. If you cannot find it, assume it is hard.',
      evidence: [], count: 1
    });

    // 12. Large fixed overlays covering content --------------------------------
    const fixedCover = Array.from(document.querySelectorAll('body *')).slice(0, 4000).filter((el) => {
      if (el === banner || !ML.isVisible(el)) return false;
      if (el.matches('[role="dialog"],dialog,[aria-modal="true"],[class*="modal" i],[class*="popup" i],[class*="overlay" i],[class*="lightbox" i],[class*="backdrop" i]') || el.closest('[role="dialog"],dialog,[class*="modal" i],[class*="popup" i],[class*="overlay" i]')) return false; // reported as interruptions instead
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
      const rect = el.getBoundingClientRect(); const a = ML.rectArea(rect);
      if (el.matches('header,nav,[role="banner"],[role="navigation"]') || el.querySelector('nav') || (rect.top <= 4 && rect.height < 220)) return false; // a site header is furniture
      if (el.closest('table,[role="table"],thead') || el.querySelector('table,thead') || ((el.innerText || '').match(/[$£€]\s?\d/g) || []).length >= 2) return false; // a pinned plan-table header is the table, not an overlay
      if (el.closest('[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="onetrust" i]') || /\b(cookies?|consent|privacy (settings|preferences))\b/i.test((el.innerText || '').slice(0, 600))) return false; // the consent checks cover these
      if (!/\b(buy|shop|subscribe|sign up|join|download|get the app|offer|deal|donate|sale|advert|sponsor)\b|[$£€%]/i.test(el.innerText || '') && !el.querySelector('iframe,video')) return false; // a sticky filter sidebar is listing furniture
      return a > vpArea * 0.12 && a < vpArea * 1.5;
    });
    if (fixedCover.length) add({
      id: 'design.sticky_overlays', category: 'design_psych', name: 'Large fixed/sticky elements covering content', severity: 0, confidence: 0.6,
      biases: ['interruption', 'obstruction'],
      explain: fixedCover.length + ' pinned element(s) occupy more than 12% of the viewport each (sticky video, ad rails, app banners, chat bubbles). They shrink the reading area and keep promotional material in view while you scroll.',
      tip: 'Reader mode or an element-hiding extension removes them.',
      evidence: fixedCover.slice(0, 3).map((el) => ML.evidenceFor(el, ML.normText(el.innerText || el.getAttribute('aria-label') || el.tagName).slice(0, 100))), count: fixedCover.length
    });

    // 13. Animated call-to-action buttons ---------------------------------------
    const animated = Array.from(document.querySelectorAll('button,a[class*="btn" i],a[class*="button" i],[role="button"]')).slice(0, 300).filter((el) => {
      if (!ML.isVisible(el)) return false;
      const cs = getComputedStyle(el);
      return cs.animationName && cs.animationName !== 'none' && (cs.animationIterationCount === 'infinite' || parseFloat(cs.animationIterationCount) > 2) && /buy|add|get|claim|start|subscribe|join|shop|order|checkout|sign|download|try|unlock|spin|play/i.test(el.innerText || '') && !fadeOnlyKeyframes(cs.animationName);
    });
    if (animated.length) add({
      id: 'design.animated_cta', category: 'design_psych', name: 'Animated / pulsing call-to-action', severity: 1, confidence: 0.75,
      biases: ['affect_heuristic', 'interruption'],
      explain: 'Motion captures attention involuntarily (the visual system is wired to notice movement). A shaking or pulsing buy button is designed to pull your eye and hand toward it.',
      tip: 'Motion is not information. Decide with the animation covered by your thumb.',
      evidence: animated.slice(0, 3).map((el) => ML.evidenceFor(el, animationQuote(el))), count: animated.length
    });

    return out;
  };
})();
