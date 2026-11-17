#!/usr/bin/env node
/* Writes the public copy of this repository into an empty folder outside it. See docs/PUBLISHING.md.

   node scripts/export-public.js OUT_DIR             copy the allowlisted files, apply the hold-outs, then scan OUT_DIR
   node scripts/export-public.js OUT_DIR --replace   the same, into a folder that holds an earlier export (its .git folder is kept)
   node scripts/export-public.js --scan OUT_DIR      scan only: copy nothing, check what is there

   Rules:
   - Deny by default. Only the paths in scripts/public-allowlist.txt are copied. Every other file is printed as skipped.
   - Nothing is ever written inside this repository, and nothing is read from .git except author e-mail addresses for the scan.
   - The scan ends the run with exit code 1 if OUT_DIR holds a file that is not on the allowlist, a held file, a symbolic link,
     a file over 5 MB, a secret pattern or an identity pattern.
   - Identity words (names, account names, private project names) are not written in this file, because this file is published.
     They come from the machine at run time and from a private file, .export-private-patterns.json, which is never copied.
     Without that file the script stops, unless --generic-scan-only is given.
   No dependencies. Node 18 or newer. */
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_FILE = path.join(ROOT, 'scripts', 'public-allowlist.txt');
const PRIVATE_PATTERNS = process.env.SUBTEXT_EXPORT_PRIVATE_PATTERNS || path.join(ROOT, '.export-private-patterns.json');
const MAX_BYTES = 5 * 1024 * 1024;

// Held out of the public copy. A path here is never copied, even if someone adds it to the allowlist, and its presence in OUT_DIR fails the scan.
// Entries that end in / are folders. Reasons are in docs/PUBLISHING.md.
const HELD = [
  'extension/data/operators.json', 'extension/data/tracker-lists.json', 'extension/data/known-bad.json', 'extension/data/GPL-3.0.txt',
  'extension/data/COI-open-data-licence.txt', 'extension/data/NOTICE-lists.md', 'extension/data/buyouts.json', 'extension/data/owner-interests.json', 'extension/data/story-patterns.json',
  'data/owners-overrides.json',
  'CLAUDE.md', 'HANDOFF.md', 'docs/reference-readings.json', 'docs/category-playbook.json', 'eval/real/context-cases.json', 'eval/real/context-cases-b.json',
  'eval/pool/frozen-pool-2026-11-05.json', 'eval/pool/recorded.json', 'eval/pool/pages.json', '.export-private-patterns.json', '.DS_Store', 'Open Subtext Demo.command',
  'reports/', 'research_notes/', 'site/', 'dist/', 'node_modules/', 'test/out/', 'eval/pool/har/', 'eval/pool/label-kit/', 'eval/pool/labels/', 'eval/external/', '.git/'
];
const HELD_DIR_PATTERNS = [/^eval\/corpus[^/]*\//, /^eval\/out[^/]*\//]; // every recording and run-output folder, whatever its suffix
// A held data file is also refused under any other folder name, so a copy placed elsewhere cannot slip through.
const HELD_BASENAMES = new Set(['operators.json', 'tracker-lists.json', 'known-bad.json', 'buyouts.json', 'owner-interests.json', 'story-patterns.json', 'owners-overrides.json', 'reference-readings.json', 'context-cases.json', 'context-cases-b.json', 'recorded.json', '.DS_Store']);
const isHeld = (rel) => HELD.some((h) => (h.endsWith('/') ? (rel + '/').startsWith(h) : rel === h)) || HELD_DIR_PATTERNS.some((re) => re.test(rel)) || HELD_BASENAMES.has(path.posix.basename(rel)) || /\.har$/i.test(rel);

// The five outlet rows whose notes are emptied in the public copy (docs/PUBLISHING.md). The rows stay.
const NOTES_EMPTIED = ['ZeroHedge', 'Infowars', 'Occupy Democrats', 'Palmer Report', 'The Grayzone'];

const out = []; const say = (s) => { out.push(s); console.log(s); };
const die = (s) => { console.error('export-public: ' + s); process.exit(1); };

// ---- arguments -------------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2); const flags = new Set(args.filter((a) => a.startsWith('--'))); const rest = args.filter((a) => !a.startsWith('--'));
for (const f of flags) if (!['--scan', '--replace', '--generic-scan-only'].includes(f)) die('unknown option ' + f);
if (rest.length !== 1) die('usage: node scripts/export-public.js OUT_DIR [--replace] [--generic-scan-only]   or   node scripts/export-public.js --scan OUT_DIR');
const SCAN_ONLY = flags.has('--scan');

// The real location of a path that may not exist yet: resolve the deepest folder that exists, then add the rest back.
function realTarget(p) { let cur = path.resolve(p); const tail = []; while (!fs.existsSync(cur)) { tail.unshift(path.basename(cur)); const up = path.dirname(cur); if (up === cur) break; cur = up; } return path.join(fs.realpathSync(cur), ...tail); }
const OUT = realTarget(rest[0]); const REAL_ROOT = fs.realpathSync(ROOT);
const inside = (child, parent) => child === parent || child.startsWith(parent + path.sep);
if (inside(OUT, REAL_ROOT)) die('OUT_DIR is inside this repository (' + OUT + '). Choose a folder outside it.');
if (inside(REAL_ROOT, OUT)) die('OUT_DIR contains this repository (' + OUT + '). Choose another folder.');

// ---- allowlist -------------------------------------------------------------------------------------------------------------
function readAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) die('scripts/public-allowlist.txt is missing');
  const list = fs.readFileSync(ALLOWLIST_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const seen = new Set();
  for (const rel of list) {
    if (seen.has(rel)) die('the allowlist names ' + rel + ' twice'); seen.add(rel);
    if (/[*?\\]/.test(rel) || rel.startsWith('/') || rel.split('/').includes('..') || rel.endsWith('/')) die('the allowlist takes plain file paths only, not: ' + rel);
    if (isHeld(rel)) die('the allowlist names a held file: ' + rel + '. Held files are never published (docs/PUBLISHING.md).');
  }
  return seen;
}
const ALLOW = readAllowlist();

// ---- walking ---------------------------------------------------------------------------------------------------------------
// Every file under dir, as paths relative to it with forward slashes. Symbolic links are reported, never followed. skipDir(rel) stops the descent.
function walk(dir, skipDir) {
  const files = []; const links = []; const skipped = [];
  (function go(abs, rel) {
    for (const e of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? rel + '/' + e.name : e.name; const a = path.join(abs, e.name);
      if (e.isSymbolicLink()) links.push(r);
      else if (e.isDirectory()) { if (skipDir && skipDir(r)) skipped.push(r); else go(a, r); }
      else files.push(r);
    }
  })(dir, '');
  return { files, links, skipped };
}
function countFiles(dir) { let n = 0; (function go(abs) { let list; try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; } for (const e of list) { if (e.isDirectory() && !e.isSymbolicLink()) go(path.join(abs, e.name)); else n++; } })(dir); return n; }

// ---- export ----------------------------------------------------------------------------------------------------------------
function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function exportTree() {
  // 1. the target folder: new, empty, or (with --replace) an earlier export
  if (fs.existsSync(OUT)) {
    const entries = fs.readdirSync(OUT).filter((n) => n !== '.git');
    if (entries.length) {
      if (!flags.has('--replace')) die(OUT + ' is not empty. Choose a new folder, or pass --replace to overwrite an earlier export there.');
      const looksLikeExport = fs.existsSync(path.join(OUT, 'extension', 'manifest.json')) && fs.existsSync(path.join(OUT, 'scripts', 'export-public.js')) && fs.existsSync(path.join(OUT, 'LICENSE'));
      if (!looksLikeExport) die(OUT + ' does not look like an earlier export of this project. Nothing was removed.');
      for (const n of entries) fs.rmSync(path.join(OUT, n), { recursive: true, force: true });
      say('replaced an earlier export in ' + OUT + ' (its .git folder, if any, was kept)');
    }
  }
  fs.mkdirSync(OUT, { recursive: true });

  // 2. walk the repository. A folder with no allowlisted file under it is printed as one line; elsewhere every file that is not copied is printed.
  const allowDirs = new Set(); for (const rel of ALLOW) { const parts = rel.split('/'); for (let i = 1; i < parts.length; i++) allowDirs.add(parts.slice(0, i).join('/')); }
  const { files, links, skipped } = walk(ROOT, (r) => !allowDirs.has(r));
  say('\n== Skipped (not on the allowlist, so not copied) ==');
  for (const d of skipped) say('skipped folder: ' + d + '/' + (d === '.git' || d === 'node_modules' ? '' : ' (' + countFiles(path.join(ROOT, d)) + ' files)') + (isHeld(d + '/x') ? '  [held]' : ''));
  for (const l of links) say('skipped link: ' + l);
  const copied = [];
  for (const rel of files) {
    if (!ALLOW.has(rel)) { say('skipped file: ' + rel + (isHeld(rel) ? '  [held]' : '')); continue; }
    const to = path.join(OUT, ...rel.split('/')); fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...rel.split('/')), to); fs.chmodSync(to, fs.statSync(path.join(ROOT, ...rel.split('/'))).mode & 0o777); copied.push(rel);
  }
  const missing = Array.from(ALLOW).filter((rel) => !copied.includes(rel));
  if (missing.length) die('on the allowlist but not in the repository: ' + missing.join(', ') + '. Fix scripts/public-allowlist.txt.');

  // 3. transforms
  say('\n== Changed in the public copy ==');
  { // owner rows that came from the hand-written overrides file are removed; each removal is proved against that file
    const file = path.join(OUT, 'extension', 'data', 'owners.json'); const data = JSON.parse(fs.readFileSync(file, 'utf8')); const before = Object.keys(data.rows).length;
    const ovrFile = path.join(ROOT, 'data', 'owners-overrides.json'); const removed = [];
    if (fs.existsSync(ovrFile)) {
      const ovr = JSON.parse(fs.readFileSync(ovrFile, 'utf8')).entries || {};
      for (const [domain, entry] of Object.entries(ovr)) {
        if (entry.remove) { if (data.rows[domain]) die('owners.json still has ' + domain + ', which the overrides file removes. Rebuild owners.json first.'); continue; }
        if (!data.rows[domain]) die('owners.json has no row for the override ' + domain + '. Rebuild owners.json first.');
        if (!sameJson(data.rows[domain], entry)) die('owners.json row for ' + domain + ' differs from its override. Rebuild owners.json first.');
        delete data.rows[domain]; removed.push(domain);
      }
      const left = Object.entries(data.rows).filter(([, r]) => !r.q || r.source || r.url || r.owner).map(([d]) => d);
      if (left.length) die('owners.json rows that did not come from Wikidata and are not in the overrides file: ' + left.join(', '));
      data.source = 'Wikidata (CC0). Hand-written corrections are not in this copy.';
      fs.writeFileSync(file, JSON.stringify(data));
      say('extension/data/owners.json: ' + before + ' rows in the repository, ' + removed.length + ' removed because they came from data/owners-overrides.json (each one equal to its override entry), ' + Object.keys(data.rows).length + ' left, all with a Wikidata id');
      say('  removed: ' + removed.sort().join(', '));
    } else say('extension/data/owners.json: data/owners-overrides.json is not here, so no row was removed (' + before + ' rows); the scan below checks that every row has a Wikidata id');
  }
  { // five outlet rows keep everything but their notes
    const file = path.join(OUT, 'extension', 'data', 'outlets.json'); const text = fs.readFileSync(file, 'utf8'); const data = JSON.parse(text);
    if (JSON.stringify(data, null, 2) + '\n' !== text && JSON.stringify(data, null, 2) !== text) die('outlets.json is no longer written with two-space indents; update the export so it keeps the file format');
    for (const name of NOTES_EMPTIED) {
      const rows = data.outlets.filter((o) => o.name === name); if (rows.length !== 1) die('outlets.json: expected one row named ' + name + ', found ' + rows.length);
      if (rows[0].notes) say('extension/data/outlets.json: notes emptied for ' + name + ' (confidence ' + rows[0].confidence + '). Removed text: ' + JSON.stringify(rows[0].notes)); else say('extension/data/outlets.json: notes for ' + name + ' were already empty');
      rows[0].notes = '';
    }
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + (text.endsWith('\n') ? '\n' : ''));
  }
  say('\ncopied ' + copied.length + ' files to ' + OUT);
}

// ---- scan ------------------------------------------------------------------------------------------------------------------
// Secret shapes. Each is written so that this file does not match itself.
const SECRETS = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{16,}/g],
  ['OpenAI key', /(?<![A-Za-z0-9_-])sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['Google key', /AIza[0-9A-Za-z_-]{35}/g],
  ['GitHub token', /(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g],
  ['AWS key id', /(?<![A-Z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Z0-9])/g],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['Stripe key', /(?<![A-Za-z0-9])(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY/g],
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g],
  ['api_key with a value', /api_key["']?\s*[=:]\s*["']?[A-Za-z0-9]{16,}/gi],
  ['bearer token', /bearer\s+[A-Za-z0-9_\-.=]{20,}/gi],
  ['cookie header', /^\s*(?:set-)?cookie:\s*\S{8,}/gim],
  // a quoted literal assigned to a key-like name. The name of an environment variable (capitals and underscores) is not a secret.
  ['secret assigned in code', /(?:api[_-]?key|secret|token|password|passwd|authorization)["']?\s*[:=]\s*["'](?![A-Z][A-Z0-9_]*["'])[^"'\s<>{}$]{12,}["']/gi]
];
// Paths that only exist on one person's machine.
const LOCAL_PATHS = [
  ['home folder path', new RegExp('(?:/|\\\\/|%2F)Users(?:/|\\\\/|%2F)[A-Za-z0-9._-]+', 'g')],
  ['temporary folder path', new RegExp('(?:/|\\\\/)private(?:/|\\\\/)(?:tmp|var)|/var/' + 'folders/', 'gi')],
  ['path under the home folder', new RegExp('~/(?:\\.config|\\.claude|Desktop|Documents|Downloads|Code|Library)[A-Za-z0-9._/-]*', 'g')]
];
// E-mail addresses: only invented ones (reserved example domains) and the ones listed here may appear.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const EMAIL_OK = [/@(?:[a-z0-9-]+\.)*example(?:\.(?:com|org|net|test))?$/i, /\.(?:test|example|invalid)$/i, /^noreply@anthropic\.com$/i];
const EMAIL_LISTED = { // file -> addresses in it that have been read and are not a person's private address
  'test/fixtures/article.html': ['citizens4truth.tips@gmail.com'], // invented contact of the fictional institute; the webmail-only check needs a webmail domain
  'test/public-records.js': ['p@doi.org'], // part of a test address with a password in it (https://u:p@doi.org/...), not a mailbox
  'scripts/export-public.js': ['citizens4truth.tips@gmail.com', 'p@doi.org'] // this list
};

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (w) => new RegExp('(?<![A-Za-z0-9])' + esc(w) + '(?![A-Za-z0-9])', 'gi');

// Identity patterns from this machine: the account name, the machine name, the home folder, and the e-mail addresses in the git history.
function machinePatterns() {
  const pats = []; const add = (label, w) => { if (w && String(w).length >= 4) pats.push([label, word(w)]); };
  try { add('this machine\'s account name', os.userInfo().username); } catch (e) { /* no account info */ }
  add('this machine\'s name', os.hostname()); add('this machine\'s name', os.hostname().replace(/\.(local|lan|home)$/i, ''));
  pats.push(['this machine\'s home folder', new RegExp(esc(os.homedir()), 'g')]);
  try {
    const log = execFileSync('git', ['-C', ROOT, 'log', '--all', '--format=%ae%n%ce'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 });
    const PUBLIC_HOSTS = /^(gmail\.com|googlemail\.com|outlook\.com|hotmail\.com|yahoo\.com|icloud\.com|proton\.me|protonmail\.com|anthropic\.com|github\.com|users\.noreply\.github\.com)$/i;
    for (const mail of new Set(log.split('\n').map((l) => l.trim()).filter(Boolean))) {
      const at = mail.lastIndexOf('@'); if (at < 1) continue; const local = mail.slice(0, at), host = mail.slice(at + 1);
      if (!/^(noreply|no-reply|\d+\+.*)$/i.test(local)) add('an e-mail name from the git history', local.replace(/^\d+\+/, ''));
      if (!PUBLIC_HOSTS.test(host)) { add('a host name from the git history', host); add('a host name from the git history', host.replace(/\.(local|lan|home)$/i, '')); }
    }
  } catch (e) { /* not a git working copy, or git is not installed */ }
  return pats;
}
// Identity patterns from the private file. Format, all keys optional:
//   { "never":  ["regular expression", ...],                                   a match anywhere fails the scan
//     "listed": [{ "pattern": "regular expression", "why": "...",              a match fails the scan unless its file is listed in "allow";
//                  "allow": { "path/in/the/tree": "context regex or empty" } }] with a context regex, the 60 characters around the match must fit it }
function privatePatterns() {
  if (flags.has('--generic-scan-only')) { say('identity scan: generic patterns only (--generic-scan-only): private names are NOT checked'); return { never: [], listed: [] }; }
  if (!fs.existsSync(PRIVATE_PATTERNS)) die('the private pattern file is missing (' + path.basename(PRIVATE_PATTERNS) + ' in the repository root, or the file named in SUBTEXT_EXPORT_PRIVATE_PATTERNS). It holds the names the scan must not find. Create it (docs/PUBLISHING.md), or pass --generic-scan-only to scan without it.');
  if (inside(realTarget(PRIVATE_PATTERNS), OUT)) die('the private pattern file is inside OUT_DIR');
  const j = JSON.parse(fs.readFileSync(PRIVATE_PATTERNS, 'utf8'));
  return { never: (j.never || []).map((p) => new RegExp(p, 'gi')), listed: (j.listed || []).map((l) => ({ re: new RegExp(l.pattern, 'gi'), why: l.why || '', allow: Object.fromEntries(Object.entries(l.allow || {}).map(([f, c]) => [f, c ? new RegExp(c, 'i') : null])) })) };
}

function scanTree() {
  say('\n== Scan of ' + OUT + ' ==');
  if (!fs.existsSync(OUT)) die(OUT + ' does not exist');
  const problems = []; const bad = (s) => { problems.push(s); };
  const { files, links } = walk(OUT, (r) => r === '.git');
  for (const l of links) bad('symbolic link: ' + l + ' (a link is committed with its target path; remove it)');
  for (const rel of files) { if (isHeld(rel)) bad('held file present: ' + rel); else if (!ALLOW.has(rel)) bad('not on the allowlist: ' + rel); }
  const machine = machinePatterns(); const priv = privatePatterns();
  let bytes = 0; const listedHits = new Map(); const emails = new Map(); const sizes = [];
  for (const rel of files) {
    const abs = path.join(OUT, ...rel.split('/')); const st = fs.statSync(abs); bytes += st.size; sizes.push([rel, st.size]);
    if (st.size > MAX_BYTES) bad('over 5 MB: ' + rel + ' (' + st.size + ' bytes)');
    const text = fs.readFileSync(abs).toString('latin1'); // every byte kept, so binary files are searched too
    const where = (i) => rel + ':' + (text.slice(0, i).split('\n').length);
    const hay = [['', text], ['file name ', rel]];
    for (const [pre, h] of hay) {
      for (const [label, re] of SECRETS) { re.lastIndex = 0; let m; while ((m = re.exec(h))) { bad('secret pattern (' + label + '): ' + pre + where(m.index) + ' starts ' + JSON.stringify(m[0].slice(0, 4))); if (!re.global) break; } }
      for (const [label, re] of LOCAL_PATHS.concat(machine)) { re.lastIndex = 0; let m; while ((m = re.exec(h))) { bad('identity pattern (' + label + '): ' + pre + where(m.index)); if (m[0] === '') re.lastIndex++; } }
      for (const re of priv.never) { re.lastIndex = 0; let m; while ((m = re.exec(h))) { bad('identity pattern (private list): ' + pre + where(m.index)); if (m[0] === '') re.lastIndex++; } }
      for (const l of priv.listed) {
        l.re.lastIndex = 0; let m;
        while ((m = l.re.exec(h))) {
          if (m[0] === '') { l.re.lastIndex++; continue; }
          const ctx = h.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30); const rule = Object.prototype.hasOwnProperty.call(l.allow, rel) ? l.allow[rel] : undefined;
          if (pre || rule === undefined || (rule && !rule.test(ctx))) bad('identity pattern (private list, not a listed exception): ' + pre + where(m.index));
          else { const k = rel + ' | ' + l.why; listedHits.set(k, (listedHits.get(k) || 0) + 1); }
        }
      }
    }
    EMAIL.lastIndex = 0; let m;
    while ((m = EMAIL.exec(text))) {
      const a = m[0]; if (EMAIL_OK.some((re) => re.test(a))) continue;
      if ((EMAIL_LISTED[rel] || []).includes(a)) { emails.set(rel + ' | ' + a, 1); continue; }
      bad('e-mail address that is not listed in this script: ' + where(m.index) + ' ' + a.slice(0, 3) + '…@' + a.split('@')[1]);
    }
  }
  // what the transforms promise
  const ownersFile = path.join(OUT, 'extension', 'data', 'owners.json');
  if (fs.existsSync(ownersFile)) {
    const o = JSON.parse(fs.readFileSync(ownersFile, 'utf8')); const odd = Object.entries(o.rows).filter(([, r]) => !r.q || r.source || r.url || r.owner).map(([d]) => d);
    if (odd.length) bad('owners.json has ' + odd.length + ' rows that did not come from Wikidata: ' + odd.slice(0, 5).join(', '));
    if (/overrides/.test(String(o.source))) bad('owners.json still says it includes the overrides file');
    say('owners.json: ' + Object.keys(o.rows).length + ' rows, every one with a Wikidata id: ' + (odd.length ? 'NO' : 'yes'));
  }
  const outletsFile = path.join(OUT, 'extension', 'data', 'outlets.json');
  if (fs.existsSync(outletsFile)) {
    const d = JSON.parse(fs.readFileSync(outletsFile, 'utf8'));
    for (const name of NOTES_EMPTIED) { const r = d.outlets.filter((x) => x.name === name); if (r.length !== 1) bad('outlets.json: no single row named ' + name); else if (r[0].notes) bad('outlets.json: notes for ' + name + ' are not empty'); }
    say('outlets.json: ' + d.outlets.length + ' rows; notes empty for ' + NOTES_EMPTIED.join(', '));
  }
  const absent = Array.from(ALLOW).filter((rel) => !files.includes(rel));
  if (absent.length) say('note: ' + absent.length + ' allowlisted files are not in OUT_DIR: ' + absent.slice(0, 8).join(', ') + (absent.length > 8 ? ' …' : ''));
  say('files: ' + files.length + ', total ' + bytes + ' bytes (' + (bytes / 1048576).toFixed(2) + ' MB); largest: ' + sizes.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f, n]) => f + ' ' + n).join(', '));
  say('patterns: ' + SECRETS.length + ' secret shapes, ' + LOCAL_PATHS.length + ' local-path shapes, ' + machine.length + ' from this machine and its git history, ' + priv.never.length + ' + ' + priv.listed.length + ' from the private file');
  if (listedHits.size) { say('listed exceptions (a private-list word in an unrelated use; each file is named in the private file):'); for (const [k, n] of Array.from(listedHits).sort()) say('  ' + n + ' × ' + k); }
  if (emails.size) { say('listed e-mail addresses:'); for (const k of Array.from(emails.keys()).sort()) say('  ' + k); }
  if (problems.length) { say('\nSCAN FAILED: ' + problems.length + ' problem(s)'); for (const p of problems.slice(0, 200)) say('  ' + p); if (problems.length > 200) say('  … and ' + (problems.length - 200) + ' more'); process.exitCode = 1; }
  else say('\nscan passed: no held file, no file off the allowlist, no link, no file over 5 MB, no secret pattern, no identity pattern');
}

if (!SCAN_ONLY) exportTree();
scanTree();
