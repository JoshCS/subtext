/* Scores the shipping policy reader (splitPolicy/scanPolicy from extension/content/detectors/incentives.js, rules from extension/rules/policy-rules.json)
   against CLAUDETTE-142 (Jablonowska et al. 2021; 142 terms of service with expert tags per sentence; research use only, so it is NOT in this repository).
   Per document: does the rule fire where experts tagged the clause (recall), and how often does it fire where they did not (shown as precision)?
   Documents are split in half by a hash of the file name: rules are written on 'dev' and reported on 'test'. Prints counts only, never corpus text.
   Usage: node eval/policy-claudette.js <path to corpus_142 'corpus' folder> [dev|test|all] [rules.json] */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const [corpus, half = 'test', rulesPath] = process.argv.slice(2);
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'extension/content/detectors/incentives.js'), 'utf8');
const body = src.slice(src.indexOf('  function splitPolicy('), src.indexOf('  ML.detectors.incentives ='));
const rules = JSON.parse(fs.readFileSync(rulesPath || path.join(ROOT, 'extension/rules/policy-rules.json'), 'utf8'));
const ctx = { ML: { makeFinding: (o) => o } }; vm.createContext(ctx); vm.runInContext(body + '\nthis.scanPolicy = scanPolicy;', ctx);
const MAP = { // rule -> CLAUDETTE tags that mean the clause is there (2 = potentially unfair, 3 = clearly unfair)
  'policy.arbitration_class_waiver': /^a[23]$/, 'policy.unilateral_changes': /^ch[23]$/, 'policy.contract_by_using': /^use2$/,
  'policy.termination_any_reason': /^ter[23]$/, 'policy.content_removal': /^cr[23]$/, 'policy.far_court': /^j[23]$/, 'policy.liability_cap': /^ltd[23]$/, 'policy.foreign_law': /^law[23]$/ };
const skip = new Set(['Betterpoints_UK.txt', 'Shazam.txt']);
const docs = fs.readdirSync(path.join(corpus, 'tags')).filter((d) => !skip.has(d)).filter((d) => half === 'all' || ((crypto.createHash('md5').update(d).digest()[0] % 2 === 0) === (half === 'dev')));
const st = {}; for (const k of Object.keys(MAP)) st[k] = { gold: 0, hit: 0, fireNoGold: 0, fired: 0 };
for (const d of docs) {
  const T = fs.readFileSync(path.join(corpus, 'tags', d), 'utf8').split(/\r?\n/); const full = fs.readFileSync(path.join(corpus, 'txt', d), 'utf8');
  const fired = new Set(ctx.scanPolicy(full, rules, 'x', 'terms', true).filter((f) => !/\.negated$/.test(f.id)).map((f) => f.id));
  for (const [rid, re] of Object.entries(MAP)) {
    if (!rules.rules.some((r) => r.id === rid)) continue;
    const gold = T.some((t) => t.split(/\s+/).some((x) => re.test(x))); const f = fired.has(rid); const s = st[rid];
    if (f) s.fired++; if (gold) { s.gold++; if (f) s.hit++; } else if (f) s.fireNoGold++;
  }
}
console.log('half', half, 'documents', docs.length);
for (const [k, s] of Object.entries(st)) if (rules.rules.some((r) => r.id === k)) console.log(k.padEnd(34), 'tagged in', String(s.gold).padStart(3), '| found in', String(s.hit).padStart(3), '(recall ' + (s.gold ? (s.hit / s.gold).toFixed(2) : '-') + ') | fired', String(s.fired).padStart(3), 'of which untagged', s.fireNoGold, '(precision ' + (s.fired ? (s.hit / s.fired).toFixed(2) : '-') + ')');
