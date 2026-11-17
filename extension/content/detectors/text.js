/* Text-rule detector: runs every regex rule in rules/text-rules.json over the visible text index. */
(function () {
  const ML = window.ML;
  const compiledCache = new Map();
  function compile(rule) {
    let c = compiledCache.get(rule.id);
    if (!c) {
      c = {
        re: new RegExp(rule.pattern, rule.flags || 'gi'),
        near: rule.nearPattern ? new RegExp(rule.nearPattern, 'i') : null,
        notNear: rule.notNearPattern ? new RegExp(rule.notNearPattern, 'i') : null,
        absent: rule.absentPattern ? new RegExp(rule.absentPattern, 'i') : null
      };
      if (!c.re.global) c.re = new RegExp(rule.pattern, (rule.flags || '') + 'g');
      compiledCache.set(rule.id, c);
    }
    return c;
  }

  ML.detectors.text = function (ctx) {
    const idx = ctx.index, out = [];
    const full = idx.fullText;
    const maxEx = (ctx.domConfig.scanning && ctx.domConfig.scanning.maxExamplesPerRule) || 4;
    let redUrgency = 0; const redEls = [];
    const lex = ctx.domConfig.lexical || {}; const cm = ctx.commerce || {}; const canSell = !cm.editorial && !!(cm.sells || cm.fundraises); // a page narrating offers is not making them

    for (const rule of ctx.rules.rules) {
      if (ctx.disabled.has(rule.category)) continue;
      if (rule.requiresSale && !canSell) continue;
      const allowed = rule.regions || (lex.regions || {})[rule.category] || null;
      const c = compile(rule);
      if (c.absent && c.absent.test(full)) continue;
      c.re.lastIndex = 0;
      let m, count = 0, guard = 0; const examples = []; const seenBlocks = new Set(); let headingHit = false;
      while ((m = c.re.exec(full)) !== null && guard++ < 3000) {
        if (m[0].length === 0) { c.re.lastIndex++; continue; }
        const bi = idx.blockAt(m.index); const b = idx.blocks[bi];
        if (!b) continue;
        if (rule.scope === 'heading' && !b.isHeading) continue;
        if (rule.scope === 'notHeading' && (b.isHeading || (b.el && b.el.closest && b.el.closest('h1,h2,h3,h4')))) continue;
        if (rule.scope === 'title' && !(b.synthetic || (b.el && b.el.closest && b.el.closest('h1')))) continue;
        if (rule.maxBlock && b.text.length > rule.maxBlock) continue; // a badge is a few words on its own, not a phrase inside a sentence
        if (c.notNear && c.notNear.test(b.text)) continue;
        if (rule.scope === 'cta' && !b.hasCta) continue;
        if (rule.requiresUnsourced && b.hasLink) continue;
        if (allowed && !allowed.includes(b.region)) continue;
        if (b.region === 'teaser' && (rule.category === 'urgency_scarcity' || rule.category === 'social_proof') && !cm.strongShop) continue; // a headline list is not a shop shelf
        if (c.near && !c.near.test(b.text)) continue;
        count++;
        if (b.isHeading) headingHit = true;
        if (examples.length < maxEx && !seenBlocks.has(bi)) {
          seenBlocks.add(bi);
          const local = m.index - b.start;
          examples.push(ML.evidenceFor(b.el, ML.snippet(b.text, local, local + m[0].length), { match: m[0] }));
        }
      }
      // charged or rhetorical words are a technique only when the page leans on them: a few in a very long page are incidental (dom-config lexical.charsPerHit)
      const densityFloor = (lex.densityCategories || []).includes(rule.category) ? Math.ceil((idx.chars || 0) / (lex.charsPerHit || 12000)) : 1;
      if (count < Math.max(rule.minCount || 1, densityFloor)) continue;
      let confidence = rule.confidence == null ? 0.7 : rule.confidence;
      if (headingHit) confidence = Math.min(1, confidence + 0.1);
      out.push(ML.makeFinding({
        id: rule.id, category: rule.category, name: rule.name, severity: rule.severity, confidence,
        biases: rule.biases || [], explain: rule.explain, tip: rule.tip, evidence: examples, count, source: 'heuristic', meta: { lexical: true }
      }));
      // colour psychology: urgency copy rendered in red
      if (rule.category === 'urgency_scarcity') {
        for (const e of examples) {
          const el = e.elId && ML.elById(e.elId);
          if (!el) continue;
          try {
            const cs = getComputedStyle(el);
            if (ML.isReddish(ML.parseColor(cs.color)) || ML.isReddish(ML.parseColor(cs.backgroundColor))) { redUrgency++; redEls.push(el); }
          } catch (err) { /* ignore */ }
        }
      }
    }
    if (redUrgency > 0) {
      out.push(ML.makeFinding({
        id: 'design.red_urgency', category: 'design_psych', name: 'Urgency copy styled in red', severity: 1, confidence: 0.75,
        biases: ['scarcity', 'affect_heuristic'],
        explain: 'Red raises arousal and is associated with warnings and errors. Urgency and scarcity messages are deliberately coloured red so that they register as alarms rather than as advertising copy.',
        tip: 'Notice the colour, then read the words as if they were grey.',
        evidence: redEls.slice(0, 4).map((el) => ML.evidenceFor(el)), count: redUrgency
      }));
    }
    return out;
  };
})();
