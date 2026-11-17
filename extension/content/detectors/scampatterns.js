/* Scam-pattern library: runs rules/scam-patterns.json against the page text. Pure matcher (also used by eval/scam-patterns-eval.js in Node)
   plus a detector. Each finding states what the page says and quotes it; it never calls the page a scam. All local. */
(function (root) {
  const cache = new WeakMap();
  function compile(cfg) {
    if (cache.has(cfg)) return cache.get(cfg);
    const c = { ex: (cfg.exclusions || []).map((s) => new RegExp(s, 'i')), pats: (cfg.patterns || []).map((p) => ({ p, req: p.required.map((s) => new RegExp(s, 'i')), sup: ((p.support || {}).of || []).map((s) => new RegExp(s, 'i')), min: (p.support || {}).min || 0 })) };
    cache.set(cfg, c); return c;
  }
  function match(text, cfg) {
    const t = String(text || '').slice(0, 300000); const c = compile(cfg); if (c.ex.some((re) => re.test(t))) return [];
    const out = [];
    for (const { p, req, sup, min } of c.pats) {
      const ms = req.map((re) => re.exec(t)); if (ms.some((m) => !m)) continue;
      const hitSup = sup.filter((re) => re.test(t)).length; if (hitSup < min) continue;
      const m = ms[p.quote || 0]; const quote = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 80).replace(/\s+/g, ' ').trim();
      out.push({ id: p.id, pattern: p, quote, support: hitSup });
    }
    return out;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { match };
  const ML = root && root.ML; if (!ML) return;
  ML.matchScamPatterns = match;
  ML.detectors.scampatterns = function (ctx) {
    if (!ctx.scamPatterns || ctx.outlet || ctx.errorPage || !ctx.index) return [];
    return match(ctx.index.fullText, ctx.scamPatterns).map(({ id, pattern: p, quote, support }) => ML.makeFinding({ id, category: 'deceptive_claims', name: p.label, label: p.label, why: p.why, severity: p.severity, confidence: 0.75, biases: ['greed', 'loss_aversion'].filter(Boolean), explain: p.explain, tip: p.tip, evidence: [{ quote: quote.slice(0, 220), elId: null }], count: 1, meta: { family: p.family, support } }));
  };
})(typeof window !== 'undefined' ? window : globalThis);
