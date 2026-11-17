#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const list = value => Array.isArray(value) ? value : [];
const domains = { corporate:'Corporate announcements', media:'Media and sponsorship', sales:'Sales and payment terms', comparison:'Comparison sites', social:'Social posts' };
const types = { interpretation:'Interpretation', straightforward:'Straightforward control', insufficient:'Insufficient evidence control' };
const statuses = { complete:'Reading shown', unsupported:'No supported reading', 'review-failed':'Review could not finish', insufficient:'Insufficient page evidence' };
const phaseOf = report => report.evaluationPhase || report.inputs?.evaluationPhase || 'initial';
const phaseLabel = phase => ({ initial:'Initial run', tuning:'Tuning rerun' })[phase] || phase;
const arms = [
  ['inquiry','Inquiry','Plans a question, can read fixture sources, then drafts and reviews.'],
  ['baseline','Page-only baseline','One pass using the synthetic page.'],
  ['baselineWithSources','Same-evidence baseline','One pass with the page and the sources Inquiry retrieved.']
];

function urlLine(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    return '<span class="url">' + esc(url.href) + '</span>';
  } catch (_) { return ''; }
}

function screened(reading) {
  if (!reading) return '<p class="missing">No supported reading to display.</p>';
  const lines = [['Mechanism',reading.mechanism],['What this leaves open',reading.alternative || reading.limit],['What to check',reading.check],['Question examined',reading.question]];
  const evidence = list(reading.evidence).map(e => '<figure><figcaption>' + esc(e.label || e.source || 'Evidence') + '</figcaption><blockquote>' + esc(e.quote) + '</blockquote>' + urlLine(e.url) + '</figure>').join('');
  return '<p class="lead">' + esc(reading.lead) + '</p>' +
    lines.filter(([,text]) => text).map(([label,text]) => '<dl><dt>' + esc(label) + '</dt><dd>' + esc(text) + '</dd></dl>').join('') +
    (evidence ? '<details><summary>Evidence used</summary>' + evidence + '</details>' : '');
}

function raw(requests) {
  if (!requests.length) return '';
  const stageNames = { plan:'Plan', draft:'Draft', review:'Review', baseline:'Single pass' };
  return '<details><summary>Model responses</summary>' + requests.map(request =>
    '<div class="raw"><h5>' + esc(stageNames[request.stage] || request.stage) + (request.model ? ' · ' + esc(request.model) : '') + '</h5>' +
    (request.parsed ? '<pre>' + esc(JSON.stringify(request.parsed,null,2)) + '</pre>' : '<p class="missing">' + esc(request.error || 'No saved response.') + '</p>') + '</div>').join('') + '</details>';
}

function retrieved(result) {
  const sources = list(result?.sources);
  if (!sources.length) return '';
  return '<details><summary>Sources retrieved (' + sources.length + ')</summary><ul>' + sources.map(source =>
    '<li>' + esc(source.title || 'Source') + urlLine(source.url) + '</li>').join('') + '</ul></details>';
}

function renderArm(testCase, key, title, description) {
  const result = testCase[key];
  const requests = list(testCase.requests).filter(request => request.arm === key);
  const error = list(testCase.errors).find(error => error.arm === key);
  if (!result && !requests.length && !error) return '';
  const reused = result?.reusedFrom === 'baseline';
  const reading = reused ? testCase.baseline?.reading : result?.reading;
  const status = reused ? 'Page-only result reused' : result?.skipped ? 'Skipped' : statuses[result?.status] || (error ? 'Request failed' : reading ? 'Reading shown' : 'No supported reading');
  return '<section class="arm"><h4>' + esc(title) + '</h4><p class="arm-note">' + esc(description) + '</p><p class="status">' + esc(status) + '</p>' +
    (result?.reason ? '<p class="arm-note">' + esc(result.reason) + '</p>' : '') +
    (error ? '<p class="missing">' + esc(error.error) + '</p>' : screened(reading)) + retrieved(result) + raw(requests) + '</section>';
}

function renderFixture(testCase) {
  const { page, documents } = testCase.fixture || {};
  const criteria = testCase.criteria || {};
  const docs = list(documents).map(doc => '<figure><figcaption>' + esc(doc.title) + '</figcaption>' + urlLine(doc.url) + list(doc.passages).map(p => '<blockquote>' + esc(p) + '</blockquote>').join('') + '</figure>').join('');
  const expected = [['Useful distinctions',criteria.useful],['Overreach to flag',criteria.overreach]].map(([label,items]) => list(items).length ? '<h5>' + esc(label) + '</h5><ul>' + items.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>' : '').join('');
  return '<details class="fixture"><summary>Synthetic page, source excerpts, and grading criteria</summary>' +
    urlLine(page?.url) + '<p>' + esc(page?.mainText) + '</p>' +
    [['Headings',page?.headings],['Page controls',page?.ctas],['Credits',page?.credits]].filter(([,values]) => list(values).length).map(([label,values]) => '<dl><dt>' + esc(label) + '</dt><dd>' + esc(values.join(' · ')) + '</dd></dl>').join('') +
    (docs ? '<h5>Available fixture sources</h5>' + docs : '<p>No source excerpt was provided.</p>') + expected + '</details>';
}

function renderCase(testCase, runLabel) {
  return '<article data-type="' + esc(testCase.caseType) + '" class="case"><div class="case-top"><span>' + esc(types[testCase.caseType] || testCase.caseType) + '</span>' +
    (runLabel ? '<span>' + esc(runLabel) + '</span>' : '') + '</div><h3>' + esc(testCase.fixture?.page?.title || testCase.id) + '</h3>' +
    renderFixture(testCase) + '<div class="arms">' + arms.map(arm => renderArm(testCase,...arm)).join('') + '</div></article>';
}

function render(reports) {
  const nonce = randomBytes(18).toString('base64');
  const groups = new Map(Object.keys(domains).map(domain => [domain, []]));
  for (const [index,report] of reports.entries()) {
    for (const testCase of report.cases.filter(Boolean)) {
      const group = groups.get(testCase.domain);
      if (!group) throw new Error('Unrecognized domain for ' + testCase.id);
      group.push(renderCase(testCase,reports.length > 1 ? 'Run ' + (index + 1) : ''));
    }
  }
  const count = reports.reduce((sum,report) => sum + report.cases.filter(Boolean).length,0);
  if (!count) throw new Error('No saved results found.');
  const tuning = reports.some(report => phaseOf(report) === 'tuning');
  const choices = labels => Object.entries(labels).map(([id,label]) => '<option value="' + esc(id) + '">' + esc(label) + '</option>').join('');
  const runs = reports.map((report,index) => {
    const models = [...new Set(report.models || report.cases.filter(Boolean).flatMap(c => list(c.models)))];
    return '<li>Run ' + (index + 1) + ' · ' + esc(phaseLabel(phaseOf(report))) + ' · ' + esc(report.backend === 'codex' ? 'Codex CLI' : report.backend) + (models.length ? ' · ' + esc(models.join(', ')) : '') +
      (report.requestedReasoning ? ' · ' + esc(report.requestedReasoning) + ' reasoning' : '') + ' · ' + report.cases.filter(Boolean).length + ' saved cases' + (report.finished ? '' : ' · partial run') + '</li>';
  }).join('');
  const sections = [...groups].filter(([,cards]) => cards.length).map(([domain,cards]) => '<section data-domain="' + esc(domain) + '"><h2>' + esc(domains[domain]) + '</h2>' + cards.join('') + '</section>').join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Subtext inquiry evaluation</title>
<style>
:root{color-scheme:light;--paper:#f5f4ef;--panel:#fff;--ink:#202823;--muted:#56655e;--line:#d9ddd3;--accent:#145c48;font:15px/1.55 system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink)}
main{max-width:1260px;margin:auto;padding:40px clamp(16px,4vw,48px) 64px}
header{max-width:730px;margin-bottom:26px}
.eyebrow,.case-top,.status{color:var(--accent);font-size:.76rem;font-weight:700;letter-spacing:.07em;text-transform:uppercase}
h1,h2,h3,h4,h5,p{margin:0}
h1{font-family:Georgia,serif;font-size:clamp(2rem,5vw,3.65rem);line-height:1.1;letter-spacing:-.04em;margin:5px 0 12px}
h2{font-family:Georgia,serif;font-size:1.65rem;margin:26px 0 12px}
h3{font-size:1.2rem;line-height:1.25;margin:5px 0 10px}
h4{font-size:1rem;line-height:1.25;margin-bottom:4px}
h5{font-size:.86rem;margin:10px 0 3px}
.intro,.arm-note,.missing,.runs{color:var(--muted)}
.phase{font-weight:650;margin:0 0 5px}
.runs{font-size:.86rem;margin:12px 0;padding-left:18px}
.filters{display:flex;flex-wrap:wrap;align-items:end;gap:12px;padding:12px 0;border-block:1px solid var(--line)}
label{display:grid;font-weight:650;gap:4px}
select{font:inherit;background:var(--panel);color:var(--ink);border:1px solid #aebbb0;border-radius:6px;padding:6px 8px}
summary{cursor:pointer;color:var(--accent);font-size:.87rem;font-weight:650}
summary:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
#count{margin-left:auto;color:var(--muted);font-size:.87rem}
.case{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:clamp(13px,2.5vw,21px);margin:0 0 14px;overflow-wrap:anywhere}
.case-top{display:flex;gap:12px;justify-content:space-between}
.fixture{padding:5px 0 12px}
.fixture p{margin:6px 0}
.arms{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(245px,100%),1fr));gap:10px}
.arm{min-width:0;background:#fafbf8;border:1px solid var(--line);border-radius:9px;padding:13px}
.arm:first-child{border-top:3px solid var(--accent);padding-top:11px}
.arm-note,.missing{font-size:.86rem}
.status{display:inline-block;background:#e5eee6;padding:2px 6px;border-radius:4px;margin:8px 0}
.lead{font-weight:650}
dl{margin:7px 0;font-size:.91rem}
dt{font-weight:700}
dd{margin:0}
details:not(.fixture){margin:7px 0}
figure{margin:8px 0 10px;padding:0 0 0 10px;border-left:2px solid #a8c0b0}
figcaption{font-size:.83rem;font-weight:700}
blockquote{margin:2px 0 6px;font-size:.91rem}
.url{display:block;color:var(--muted);font-size:.8rem;overflow-wrap:anywhere}
pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.78rem;background:#eff2eb;padding:8px;border-radius:5px}
li+li{margin-top:3px}
[hidden]{display:none!important}
</style></head><body><main><header><div class="eyebrow">Subtext · model evaluation</div><h1>Inquiry casebook</h1>
${tuning ? '<p class="phase">Tuning rerun on previously examined cases</p>' : ''}
<p class="intro">Compare the saved model responses with the readings that passed screening. The pages and source excerpts are fictional. Runs used the listed model backend with local fixture retrieval. Live source retrieval and the production provider integration require separate validation. Review the cases individually against their criteria.</p><ul class="runs">${runs}</ul></header>
<div class="filters"><label>Domain<select id="domain"><option value="">All domains</option>${choices(domains)}</select></label><label>Case type<select id="case-type"><option value="">All case types</option>${choices(types)}</select></label><span id="count" role="status">${count} saved cases</span></div>
${sections}<p id="empty" class="missing" hidden>No saved cases match those filters.</p></main>
<script nonce="${nonce}">
const domain = document.getElementById('domain');
const type = document.getElementById('case-type');
function update() {
  let count = 0;
  for (const section of document.querySelectorAll('[data-domain]')) {
    const matches = !domain.value || domain.value === section.dataset.domain;
    let visible = 0;
    for (const card of section.querySelectorAll('[data-type]')) {
      card.hidden = !matches || Boolean(type.value && type.value !== card.dataset.type);
      if (!card.hidden) visible++;
    }
    section.hidden = !visible;
    count += visible;
  }
  document.getElementById('count').textContent = count + (count === 1 ? ' saved case' : ' saved cases');
  document.getElementById('empty').hidden = count > 0;
}
domain.addEventListener('change',update);
type.addEventListener('change',update);
update();
</script></body></html>`;
}

function main(args) {
  if (!args.length || args.includes('--help')) {
    console.log('Usage: node eval/inquiry-report.js eval/out-inquiry/RUN/result.json [MORE_RESULT_JSON...]');
    return;
  }
  const reports = args.map(file => {
    const report = JSON.parse(fs.readFileSync(file,'utf8'));
    if (!report || !Array.isArray(report.cases)) throw new Error('Invalid inquiry result: ' + file);
    return report;
  });
  const output = path.join(__dirname,'out-inquiry','report.html');
  const html = render(reports);
  fs.mkdirSync(path.dirname(output),{ recursive:true,mode:0o700 });
  fs.writeFileSync(output,html,{ mode:0o600 });
  console.log(output);
}

try { main(process.argv.slice(2)); }
catch (error) { console.error('Inquiry report failed. ' + error.message); process.exitCode = 1; }
