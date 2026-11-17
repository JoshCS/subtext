/* Scores the shipping privacy-policy rules (splitPolicy/scanPolicy from extension/content/detectors/incentives.js) against OPP-115
   (Wilson et al. 2016: 115 website privacy policies annotated by law students; research use only, so it is NOT in this repository).
   A practice counts as present in a policy when at least two annotators marked it. Per policy: recall and precision. Prints counts only.
   Usage: node eval/policy-opp115.js <OPP-115 folder> [dev|test|all] [rules.json] */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const [dir, half = 'all', rulesPath] = process.argv.slice(2); const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'extension/content/detectors/incentives.js'), 'utf8');
const body = src.slice(src.indexOf('  function splitPolicy('), src.indexOf('  ML.detectors.incentives ='));
const rules = JSON.parse(fs.readFileSync(rulesPath || path.join(ROOT, 'extension/rules/policy-rules.json'), 'utf8'));
const ctx = { ML: { makeFinding: (o) => o } }; vm.createContext(ctx); vm.runInContext(body + '\nthis.scanPolicy = scanPolicy;', ctx);
const MAP = { // rule -> [category, attribute, value regex]
  'policy.indefinite_retention': [['Data Retention', 'Retention Period', /^Indefinitely$/]],
  'policy.bankruptcy_transfer': [['Third Party Sharing/Collection', 'Purpose', /^Merger\/Acquisition$/]],
  'policy.third_party_marketing': [['Third Party Sharing/Collection', 'Purpose', /^Marketing$/]],
  'policy.unilateral_changes': [['Policy Change', 'User Choice', /^None$/], ['Policy Change', 'Notification Type', /^No notification$/]],
  'policy.precise_location': [['First Party Collection/Use', 'Personal Information Type', /^Location$/]],
  'policy.biometric_sensitive': [['First Party Collection/Use', 'Personal Information Type', /^Health$/]],
  'policy.dnt_ignored': [['Do Not Track', 'Do Not Track policy', /^Not honored$/]] };
function csvRows(t) { const rows = []; let row = [], cur = '', q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; }
const files = fs.readdirSync(path.join(dir, 'annotations')).filter((f) => f.endsWith('.csv')).filter((f) => half === 'all' || ((crypto.createHash('md5').update(f).digest()[0] % 2 === 0) === (half === 'dev')));
const st = {}; for (const k of Object.keys(MAP)) st[k] = { gold: 0, hit: 0, fired: 0 };
for (const f of files) {
  const who = {}; for (const r of csvRows(fs.readFileSync(path.join(dir, 'annotations', f), 'utf8'))) { let a; try { a = JSON.parse(r[6]); } catch (e) { continue; }
    for (const [rid, conds] of Object.entries(MAP)) for (const [cat, attr, re] of conds) if (r[5] === cat && a[attr] && re.test(a[attr].value || '')) (who[rid] = who[rid] || new Set()).add(r[2]); }
  const html = fs.readFileSync(path.join(dir, 'sanitized_policies', f.replace(/\.csv$/, '.html')), 'utf8');
  const text = html.split('|||').map((s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim()).join('\n');
  const fired = new Set(ctx.scanPolicy(text, rules, 'x', 'privacy', true).filter((x) => !/\.negated$/.test(x.id)).map((x) => x.id));
  for (const rid of Object.keys(MAP)) { if (!rules.rules.some((r) => r.id === rid)) continue; const gold = (who[rid] || new Set()).size >= 2; const s = st[rid]; if (fired.has(rid)) s.fired++; if (gold) { s.gold++; if (fired.has(rid)) s.hit++; } }
}
console.log('half', half, 'policies', files.length);
for (const [k, s] of Object.entries(st)) if (rules.rules.some((r) => r.id === k)) console.log(k.padEnd(30), 'marked in', String(s.gold).padStart(3), '| found in', String(s.hit).padStart(3), '(recall ' + (s.gold ? (s.hit / s.gold).toFixed(2) : '-') + ') | fired', String(s.fired).padStart(3), '(precision ' + (s.fired ? (s.hit / s.fired).toFixed(2) : '-') + ')');
