// Validates rules/text-rules.json, rules/dom-config.json, rules/trackers.json, data/outlets.json, data/lists/*.json and the built data/known-bad.json. Run after editing any of them.
const fs = require('fs'); const path = require('path');
const ext = path.join(__dirname, '..', 'extension');
let problems = 0;
const warn = (m) => { console.log('PROBLEM:', m); problems++; };
const rules = JSON.parse(fs.readFileSync(path.join(ext, 'rules/text-rules.json'), 'utf8'));
const ids = new Set();
for (const r of rules.rules) {
  if (ids.has(r.id)) warn('duplicate rule id ' + r.id); ids.add(r.id);
  for (const k of ['id', 'category', 'name', 'pattern', 'severity', 'explain', 'tip']) if (r[k] == null) warn(r.id + ' missing ' + k);
  if (!rules.categories[r.category]) warn(r.id + ' unknown category ' + r.category);
  for (const b of r.biases || []) if (!rules.biases[b]) warn(r.id + ' unknown bias ' + b);
  try { new RegExp(r.pattern, r.flags || 'gi'); } catch (e) { warn(r.id + ' bad regex: ' + e.message); }
  if (r.nearPattern) try { new RegExp(r.nearPattern, 'i'); } catch (e) { warn(r.id + ' bad nearPattern'); }
  if (r.absentPattern) try { new RegExp(r.absentPattern, 'i'); } catch (e) { warn(r.id + ' bad absentPattern'); }
  if (![0, 1, 2, 3].includes(r.severity)) warn(r.id + ' severity must be 0-3');
}
const dom = JSON.parse(fs.readFileSync(path.join(ext, 'rules/dom-config.json'), 'utf8'));
new RegExp(dom.pricing.currency, 'i'); new RegExp(dom.feed.engagementCounterPattern, 'i'); new RegExp(dom.timers.pattern);
const tr = JSON.parse(fs.readFileSync(path.join(ext, 'rules/trackers.json'), 'utf8'));
for (const [d, c] of Object.entries(tr.domains)) if (!tr.categoryInfo[c]) warn('tracker ' + d + ' unknown category ' + c);
for (const p of tr.affiliateUrlPatterns) try { new RegExp(p, 'i'); } catch (e) { warn('bad affiliate pattern ' + p); }
const outlets = JSON.parse(fs.readFileSync(path.join(ext, 'data/outlets.json'), 'utf8'));
const seen = new Set();
for (const o of outlets.outlets) {
  for (const d of o.domains) { if (seen.has(d)) warn('duplicate outlet domain ' + d); seen.add(d); }
  for (const ow of o.owners) if (!outlets.ownerKinds[ow.kind]) warn(o.name + ' unknown owner kind ' + ow.kind);
  if (!outlets.leanScale.includes(o.lean)) warn(o.name + ' bad lean ' + o.lean);
  if (!o.sources || !o.sources.length) warn(o.name + ' has no sources');
}
// label copy lint (docs/UX.md rules L1, L4)
const labels = JSON.parse(fs.readFileSync(path.join(ext, 'rules/labels.json'), 'utf8'));
for (const r of rules.rules) if (!labels.labels[r.id]) warn('rule without label copy: ' + r.id);
for (const [id, l] of Object.entries(labels.labels)) {
  if (l.label.split(/\s+/).length > 3) warn('label over 3 words: ' + id + ' (' + l.label + ')');
  if (l.why.split(/\s+/).length > 12) warn('why over 12 words: ' + id);
  if (/\b(fraud|propaganda|scam|against you|that'?s the model)\b/i.test(l.why)) warn('why uses banned judgement word: ' + id);
}
const policy = JSON.parse(fs.readFileSync(path.join(ext, 'rules/policy-rules.json'), 'utf8'));
for (const r of policy.rules) { try { new RegExp(r.pattern, 'i'); if (r.negation) new RegExp(r.negation, 'i'); } catch (e) { warn('bad policy regex ' + r.id); } if ((r.why || '').split(/\s+/).length > 12) warn('policy why over 12 words: ' + r.id); }
// the hand-kept lists, and what the built known-bad list may not contain (docs/LICENSING.md, extension/data/NOTICE-lists.md)
const root = path.join(__dirname, '..');
const domainRe = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const realDate = (s) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const webUrl = (s) => { try { return /^https?:$/.test(new URL(String(s)).protocol); } catch (e) { return false; } };
const cleanDomain = (d) => String(d || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const listsDir = process.env.SUBTEXT_LISTS_DIR || path.join(root, 'data/lists'); // test/regress.js points these at broken copies to prove the checks fire
const manual = JSON.parse(fs.readFileSync(path.join(listsDir, 'manual-list.json'), 'utf8')).entries;
const allow = JSON.parse(fs.readFileSync(path.join(listsDir, 'allowlist.json'), 'utf8')).entries;
const today = new Date().toISOString().slice(0, 10);
const seenManual = new Set();
for (const e of manual) {
  const who = 'manual-list ' + (e.domain || '(no domain)');
  for (const f of ['domain', 'added', 'added_by', 'source_name', 'source_url', 'source_date']) if (!e[f]) warn(who + ' lacks ' + f);
  if (e.domain && !domainRe.test(cleanDomain(e.domain))) warn(who + ' is not a domain name');
  if (seenManual.has(cleanDomain(e.domain))) warn(who + ' appears twice'); seenManual.add(cleanDomain(e.domain));
  if (e.source_url && !webUrl(e.source_url)) warn(who + ' source_url is not a web address');
  for (const f of ['added', 'source_date', 'expires']) if (e[f] && !realDate(e[f])) warn(who + ' ' + f + ' is not a real YYYY-MM-DD date');
  if (realDate(e.added) && e.added > today) warn(who + ' added is in the future');
  if (realDate(e.source_date) && e.source_date > today) warn(who + ' source_date is in the future');
  if (realDate(e.added) && realDate(e.expires) && e.expires <= e.added) warn(who + ' expires on or before the day it was added');
}
for (const e of allow) {
  const who = 'allowlist ' + (e.domain || '(no domain)');
  for (const f of ['domain', 'added', 'added_by', 'reason']) if (!e[f]) warn(who + ' lacks ' + f);
  if (e.added && !realDate(e.added)) warn(who + ' added is not a real YYYY-MM-DD date');
  if (e.source_url && !webUrl(e.source_url)) warn(who + ' source_url is not a web address');
}
// The built list is held out of the public copy (docs/PUBLISHING.md). Without it the checks on the built list cannot run; say so, never pass silently.
const knownBadPath = process.env.SUBTEXT_KNOWN_BAD || path.join(ext, 'data/known-bad.json');
const knownBadHere = fs.existsSync(knownBadPath);
if (!knownBadHere) console.log('skipped: extension/data/known-bad.json is not in this copy (checks on the built warning list)');
const knownBad = knownBadHere ? JSON.parse(fs.readFileSync(knownBadPath, 'utf8')) : { entries: {} };
const listed = Object.keys(knownBad.entries);
for (const e of allow) if (knownBad.entries[cleanDomain(e.domain)]) warn('allowlisted ' + e.domain + ' is still in known-bad.json; run npm run lists');
// a hosting platform's own domain on the Czech list would mark every store on it. The names come from the builder, the app's tenant suffixes and the provenance platform hosts.
const builder = fs.readFileSync(path.join(root, 'scripts/update-known-bad.js'), 'utf8').match(/const PLATFORMS = \[([^\]]*)\]/);
if (!builder) warn('scripts/update-known-bad.js no longer has a PLATFORMS list for this check to read');
require(path.join(ext, 'common.js'));
const platforms = new Set([...(builder ? builder[1].match(/'[^']+'/g) || [] : []).map((s) => s.slice(1, -1)), ...globalThis.MLCommon.PLATFORM_SUFFIXES, ...((dom.provenance && dom.provenance.platformHosts) || []).map((h) => (typeof h === 'string' ? h : h.host || h.domain || '')).filter(Boolean)]);
const parents = new Set(); for (const k of listed) { const parts = k.split('.'); for (let i = 1; i < parts.length - 1; i++) parents.add(parts.slice(i).join('.')); }
for (const [d, rows] of Object.entries(knownBad.entries)) {
  if (!rows.some((r) => r.s === 'coi')) continue;
  if (platforms.has(d)) warn('known-bad.json: Czech list row for the platform ' + d);
  if (parents.has(d)) warn('known-bad.json: Czech list row for ' + d + ', a parent of other listed hosts');
}
console.log(`known-bad: ${knownBadHere ? listed.length + ' domains' : 'not in this copy'} | manual: ${manual.length} | allowlist: ${allow.length}`);
console.log(`labels: ${Object.keys(labels.labels).length} | policy rules: ${policy.rules.length}`);
console.log(`text rules: ${rules.rules.length} | categories: ${Object.keys(rules.categories).length} | biases: ${Object.keys(rules.biases).length} | tracker domains: ${Object.keys(tr.domains).length} | outlets: ${outlets.outlets.length} (${seen.size} domains)`);
if (problems) { console.log(problems + ' problem(s)'); process.exit(1); } else console.log('all rule files valid');
