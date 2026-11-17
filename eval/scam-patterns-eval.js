/* Scores rules/scam-patterns.json with the extension's own matcher (content/detectors/scampatterns.js):
   - catch: archived scam pages, split dev/test by a hash of the domain (a JSONL of {domain, half, text}; Beyond Phish has no licence, so it stays outside the repo)
   - false alarms: the recorded ordinary pages (eval/corpus/*.har main documents), honest trust-marked shops (eval/corpus-honest) and listed shops (eval/corpus-bad, for reference)
   Usage: node eval/scam-patterns-eval.js <scam pages .jsonl> [dev|test] */
const fs = require('fs'), path = require('path'); const ROOT = path.resolve(__dirname, '..');
const { match } = require(path.join(ROOT, 'extension/content/detectors/scampatterns.js'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/rules/scam-patterns.json'), 'utf8'));
const [jsonl, half = 'test'] = process.argv.slice(2);
const strip = (h) => String(h).replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const tally = (name, docs) => { const c = {}; const ex = {}; for (const [id, t] of docs) for (const m of match(t, cfg)) { c[m.id] = (c[m.id] || 0) + 1; (ex[m.id] = ex[m.id] || []).push(id + ': ' + m.quote.slice(0, 120)); } console.log(name, 'pages', docs.length, JSON.stringify(c)); return ex; };
const scam = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.half === half).map((r) => [r.domain, r.title + ' ' + r.text]);
tally('archived scam pages (' + half + ')', scam);
const corpus = []; for (const f of fs.readdirSync(path.join(ROOT, 'eval/corpus')).filter((f) => f.endsWith('.har'))) { try { const h = JSON.parse(fs.readFileSync(path.join(ROOT, 'eval/corpus', f), 'utf8')); const e = h.log.entries.find((x) => /text\/html/.test((x.response.content || {}).mimeType || '') && x.response.content.text); if (e) corpus.push([f, strip(e.response.content.text)]); } catch (e) { /* skip */ } }
const exC = tally('ordinary recorded pages', corpus);
const dirPages = (d) => fs.existsSync(path.join(ROOT, d)) ? fs.readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.html')).map((f) => [f, strip(fs.readFileSync(path.join(ROOT, d, f), 'utf8'))]) : [];
const exH = tally('honest shops', dirPages('eval/corpus-honest'));
tally('listed shops', dirPages('eval/corpus-bad'));
for (const [k, v] of Object.entries(Object.assign({}, exC, exH))) console.log('  false alarm?', k, v.slice(0, 5));
