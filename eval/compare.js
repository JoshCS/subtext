/* Compares AI findings (from eval/run-ai.js) with heuristic findings per page: category overlap, severity, agreement
   between providers, and whether every AI quote actually occurs in the page text (hallucination check). */
const fs = require('fs'); const path = require('path');
const OUT = path.join(__dirname, 'out'); const FIX = path.resolve(__dirname, '..', 'test', 'fixtures');
const FILES = { shop: 'shop.html', article: 'article.html', clean: 'clean.html' };
const PRESSURE = { low: 'A', moderate: 'C', high: 'D', very_high: 'F' };
function pageText(name) { if (FILES[name]) return fs.readFileSync(path.join(FIX, FILES[name]), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase(); const h = path.join(OUT, name + '-heuristics.json'); return fs.existsSync(h) ? JSON.parse(fs.readFileSync(h, 'utf8')).map((f) => (f.evidence || []).map((e) => e.quote).join(' ')).join(' ').toLowerCase() : ''; }
const rows = [];
const names = Array.from(new Set(fs.readdirSync(OUT).filter((f) => f.endsWith('-heuristics.json')).map((f) => f.replace('-heuristics.json', ''))));
for (const name of names) {
  const hPath = path.join(OUT, name + '-heuristics.json'); if (!fs.existsSync(hPath)) continue;
  const heur = JSON.parse(fs.readFileSync(hPath, 'utf8')); const hCats = new Set(heur.filter((f) => f.severity > 0).map((f) => f.category));
  const text = pageText(name); const perProvider = {};
  for (const provider of ['anthropic', 'openai']) {
    const p = path.join(OUT, `${name}-${provider}.json`); if (!fs.existsSync(p)) continue;
    const ai = JSON.parse(fs.readFileSync(p, 'utf8'));
    const quotes = ai.findings.filter((f) => f.evidence && f.evidence[0] && f.evidence[0].quote && !/^Chart \d/.test(f.evidence[0].quote));
    const grounded = quotes.filter((f) => text.includes(f.evidence[0].quote.toLowerCase().replace(/\s+/g, ' ').slice(0, 60))).length;
    const aCats = new Set(ai.findings.filter((f) => f.severity > 0).map((f) => f.category));
    perProvider[provider] = { aCats, findings: ai.findings.length, grounded: quotes.length ? Math.round(100 * grounded / quotes.length) : null, pressure: ai.parsed.overall_pressure, cost: ai.cost };
    rows.push({ page: name, provider, aiFindings: ai.findings.length, quotesGrounded: perProvider[provider].grounded == null ? '-' : perProvider[provider].grounded + '%', catOverlapWithHeuristics: [...aCats].filter((c) => hCats.has(c)).length + '/' + aCats.size, aiOnlyCats: [...aCats].filter((c) => !hCats.has(c)).join(','), pressure: ai.parsed.overall_pressure + ' (' + PRESSURE[ai.parsed.overall_pressure] + ')', cost: '$' + ai.cost });
  }
  if (perProvider.anthropic && perProvider.openai) { const a = perProvider.anthropic.aCats, b = perProvider.openai.aCats; const inter = [...a].filter((c) => b.has(c)).length; rows.push({ page: name, provider: 'claude∩chatgpt', aiFindings: '', quotesGrounded: '', catOverlapWithHeuristics: '', aiOnlyCats: 'category Jaccard ' + (inter / Math.max(1, new Set([...a, ...b]).size)).toFixed(2), pressure: perProvider.anthropic.pressure === perProvider.openai.pressure ? 'agree' : 'differ', cost: '' }); }
}
if (!rows.length) { console.log('No eval output found. Run: node eval/run-ai.js'); process.exit(1); }
console.table(rows);
