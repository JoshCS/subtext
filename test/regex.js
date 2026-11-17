/* Times every pattern in the rule files on long worst-case inputs, each in a worker that can be killed. A pattern that goes quadratic on page text freezes the page.
   Limit per pattern and input: 300 ms at 40,000 characters (the scan cap is 200,000, and a quadratic pattern is 25 times slower there). Node's engine, close to Chrome's. */
const fs = require('fs'); const path = require('path'); const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const RULES = path.join(__dirname, '..', 'extension', 'rules'); const LIMIT = 300; const N = 40000;
function collect() {
  const out = []; const push = (where, p, flags) => { if (typeof p !== 'string' || p.length < 4 || !/[\\()[\]|*+?{}]/.test(p)) return; try { new RegExp(p, flags); } catch (e) { return; } out.push({ where, p, flags }); };
  const read = (f) => JSON.parse(fs.readFileSync(path.join(RULES, f), 'utf8'));
  for (const r of read('text-rules.json').rules) { const fl = r.flags || 'gi'; push(r.id, r.pattern, fl.includes('g') ? fl : fl + 'g'); if (r.nearPattern) push(r.id + '.near', r.nearPattern, 'i'); if (r.notNearPattern) push(r.id + '.notNear', r.notNearPattern, 'i'); }
  const pr = read('policy-rules.json'); if (pr.legalFrame) push('legalFrame', pr.legalFrame, 'i'); for (const r of pr.rules) { push(r.id, r.pattern, 'i'); if (r.negation) push(r.id + '.negation', r.negation, 'i'); }
  (function walk(o, pfx) { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, pfx + k + '.'); else if (typeof v === 'string') push(pfx + k, v, 'gi'); } })(read('dom-config.json'), '');
  return out;
}
const rep = (s) => s.repeat(Math.ceil(N / s.length)).slice(0, N);
const INPUTS = ['a', 'a ', '1', '$1 ', '. ', 'Aa ', 'ab-', 'Ab-', 'we accept ', '© ', 'a\n', 'a.', 'a,', 'A ', ' ', 'x@', 'word1 Word2 of The Inc ', '99 ', '$', '%', '-', '(', '0.', 'a-a ', 'only ', 'you ', 'free ', 'copyright 2026 ', 'Sold by X ', 'tel: 1', '1234 ', 'http://a.b/?ref=1&', 'A.B. ', '30-day '];
if (isMainThread) {
  const pats = collect(); const jobs = []; pats.forEach((_, i) => INPUTS.forEach((s) => jobs.push({ i, s }))); let idx = 0; const slow = [];
  const finish = () => { if (slow.length) { console.error(slow.length + ' slow pattern/input pair(s), limit ' + LIMIT + ' ms at ' + N + ' chars:'); for (const x of slow.slice(0, 30)) console.error('  ' + x.ms + ' ' + x.where + ' on ' + JSON.stringify(x.s)); process.exit(1); } console.log(pats.length + ' patterns × ' + INPUTS.length + ' inputs: all under ' + LIMIT + ' ms'); process.exit(0); };
  const spawn = () => {
    if (idx >= jobs.length) return finish();
    const w = new Worker(__filename, { workerData: { pats, jobs, start: idx } }); let timer;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { const j = jobs[idx]; slow.push({ where: pats[j.i].where, s: j.s, ms: 'over 3 s' }); w.terminate(); idx++; spawn(); }, 3000); };
    arm(); w.on('message', (ms) => { const j = jobs[idx]; if (ms > LIMIT) slow.push({ where: pats[j.i].where, s: j.s, ms: Math.round(ms) }); idx++; if (idx >= jobs.length) { clearTimeout(timer); w.terminate(); finish(); } else arm(); });
  };
  spawn();
} else {
  const { pats, jobs, start } = workerData;
  for (let n = start; n < jobs.length; n++) { const j = jobs[n], p = pats[j.i], s = rep(j.s); const re = new RegExp(p.p, p.flags); const t0 = performance.now(); if (re.global) { let m, g = 0; while ((m = re.exec(s)) !== null && g++ < 3000) { if (m[0].length === 0) re.lastIndex++; } } else re.test(s); parentPort.postMessage(performance.now() - t0); }
}
