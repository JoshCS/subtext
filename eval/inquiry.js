#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { BACKENDS, createRequest } = require('./inquiry-cli.js');

function usage() {
  return [
    'Offline: node eval/inquiry.js --inspect [--cases id,id] [--suite path.json] [--core path.js]',
    'Live:    node eval/inquiry.js --run [--cases id,id] [--backend codex|anthropic|openai] [--model id]',
    '         [--reasoning low|medium] [--jobs 1|2|3] [--baseline-with-sources] [--phase initial|tuning]',
    '         [--suite path.json] [--core path.js]',
    '',
    'Uses local inquiry fixtures. Paths are relative to the current working directory.',
    'Defaults: bundled inquiry fixtures, extension core, Codex CLI with ChatGPT login, low reasoning, 3 jobs.',
    'Other backends use the selected provider\'s environment API key. Both live modes can consume credits.',
    'Compares Inquiry with a single-pass page-only prompt. --baseline-with-sources adds a single-pass',
    'control that gets the same fixture evidence Inquiry retrieved. Results are for human review.'
  ].join('\n');
}

function options(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--inspect', '--run', '--help', '--baseline-with-sources'].includes(arg)) { parsed[arg.slice(2)] = true; continue; }
    if (['--cases', '--backend', '--model', '--reasoning', '--jobs', '--phase', '--suite', '--core'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      parsed[arg.slice(2)] = args[++i];
      continue;
    }
    throw new Error('Unknown argument: ' + arg);
  }
  if (parsed.inspect && parsed.run) throw new Error('Choose --inspect or --run.');
  if (parsed.backend && !BACKENDS.includes(parsed.backend)) throw new Error('Unknown backend: ' + parsed.backend);
  if (parsed.jobs && !['1', '2', '3'].includes(parsed.jobs)) throw new Error('--jobs must be 1, 2, or 3.');
  if (parsed.phase && !['initial', 'tuning'].includes(parsed.phase)) throw new Error('--phase must be initial or tuning.');
  return { backend: 'codex', reasoning: 'low', ...parsed, jobs: Number(parsed.jobs || 3) };
}

function selection(cases, input) {
  const byId = new Map(cases.map(testCase => [testCase.id, testCase]));
  if (byId.size !== cases.length || cases.some(testCase => !/^[\w-]+$/.test(testCase.id || ''))) throw new Error('Invalid or duplicate fixture ids.');
  if (!input) return cases;
  const ids = input.split(',').map(id => id.trim());
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate selected fixture ids.');
  return ids.map(id => {
    if (!byId.has(id)) throw new Error('Unknown fixture: ' + id);
    return byId.get(id);
  });
}

function fixtureMetadata(testCase) {
  return { id: testCase.id, domain: testCase.domain, caseType: testCase.caseType, ...(testCase.variant ? { variant: testCase.variant } : {}), documentCount: (testCase.documents || []).length };
}

function localInput(input, defaultPath, extension) {
  const frozenPool = path.join(__dirname, 'pool');
  const check = filename => {
    if (filename === frozenPool || filename.startsWith(frozenPool + path.sep)) throw new Error('The frozen test pool cannot be used for inquiry evaluation.');
    if (path.extname(filename) !== extension) throw new Error('Expected a local ' + extension + ' file: ' + filename);
  };
  const filename = input ? path.resolve(input) : path.resolve(__dirname, defaultPath);
  check(filename);
  const resolved = fs.realpathSync(filename);
  check(resolved);
  if (!fs.statSync(resolved).isFile()) throw new Error('Expected a local file: ' + resolved);
  const bytes = fs.readFileSync(resolved);
  return { path: resolved, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function makeFixtureReader(docs) {
  const links = docs.map(doc => ({ id: doc.id, url: doc.url, label: doc.title, kind: 'record' }));
  const byId = new Map(links.map((link, index) => [link.id, docs[index]]));
  const retrieved = new Map();
  const reads = [];
  return {
    links, reads, retrieved,
    async read(candidate, { query } = {}) {
      const doc = byId.get(candidate.id);
      if (!doc || candidate.url !== doc.url) {
        reads.push({ id: candidate.id, url: candidate.url, query, status: 'missing' });
        throw new Error('Fixture evidence was not supplied.');
      }
      reads.push({ id: candidate.id, url: candidate.url, query, status: 'read' });
      retrieved.set(candidate.id, doc);
      return doc;
    }
  };
}

async function evaluate(Inquiry, testCase, send, opts) {
  const documents = testCase.documents || [];
  const reader = makeFixtureReader(documents);
  const records = testCase.records || [];
  const result = { ...fixtureMetadata(testCase), criteria: testCase.criteria, fixture: { page: testCase.page, documents, records }, requests: [], reads: reader.reads, errors: [] };
  const request = async (spec, arm = 'inquiry') => {
    const event = { arm, stage: spec.stage, status: 'started' };
    result.requests.push(event);
    try {
      const response = await send(spec);
      Object.assign(event, { ...response, status: 'ok' });
      return response;
    } catch (error) {
      Object.assign(event, { status: 'error', error: error.message });
      throw error;
    }
  };
  async function arm(name, run) {
    try { result[name] = await run(); }
    catch (error) { result.errors.push({ arm: name, error: error.message }); }
  }
  async function baseline(name, options = {}) {
    const input = { ...options, maxChars: testCase.maxChars };
    const response = await request(Inquiry.baselineRequest(testCase.page, input), name);
    const packet = Inquiry.makePacket(testCase.page, input);
    (options.documents || []).forEach((document, index) => Inquiry.withDocument(packet, document, index + 1));
    return { ...response, reading: Inquiry.screen(response.parsed, packet) };
  }
  await arm('inquiry', () => Inquiry.run({ page: testCase.page, records, links: reader.links, request, read: reader.read, maxChars: testCase.maxChars }));
  await arm('baseline', () => baseline('baseline'));
  if (opts['baseline-with-sources']) {
    const accepted = new Set((result.inquiry?.sources || []).map(source => source.url));
    const sourceDocs = Array.from(reader.retrieved).filter(([, document]) => accepted.has(document.url));
    if (!result.inquiry) {
      result.baselineWithSources = { skipped: true, reason: 'Inquiry did not complete enough to identify its evidence.' };
    } else if (sourceDocs.length || records.length) {
      await arm('baselineWithSources', () => baseline('baselineWithSources', { documents: sourceDocs.map(([, document]) => document), records }));
    } else {
      result.baselineWithSources = { reusedFrom: 'baseline', reason: 'Inquiry retrieved no additional evidence.' };
    }
    result.baselineWithSourcesInput = { documents: sourceDocs.map(([id]) => id), records: records.length };
  }
  result.models = [...new Set(result.requests.filter(stage => stage.model).map(stage => stage.model))];
  return result;
}

async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help || (!opts.inspect && !opts.run)) { console.log(usage()); return; }
  const suiteInput = localInput(opts.suite, 'inquiry-cases.json', '.json');
  const coreInput = localInput(opts.core, '../extension/inquiry.js', '.js');
  const inputs = {
    inquiryCorePath: coreInput.path, inquiryCoreSha256: coreInput.sha256,
    fixtureSuitePath: suiteInput.path, fixtureSuiteSha256: suiteInput.sha256,
    ...(fs.existsSync(path.join(path.dirname(coreInput.path),'investigation-guides.js'))?{guideSha256:createHash('sha256').update(fs.readFileSync(path.join(path.dirname(coreInput.path),'investigation-guides.js'))).digest('hex')}: {})
  };
  const suite = JSON.parse(suiteInput.bytes.toString('utf8'));
  const cases = selection(suite.cases, opts.cases);
  if (opts.inspect) {
    console.log(JSON.stringify({ mode: 'offline; no credentials or model requests', purpose: suite.purpose, inputs, cases: cases.map(fixtureMetadata) }, null, 2));
    return;
  }
  const Inquiry = require(coreInput.path);
  for (const name of ['run', 'baselineRequest', 'makePacket', 'withDocument', 'screen']) if (typeof Inquiry[name] !== 'function') throw new Error('Inquiry export is required: ' + name);
  const send = createRequest(opts);
  const started = new Date().toISOString();
  const out = path.join(__dirname, 'out-inquiry');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(out, started.replace(/[:.]/g, '-') + '-'));
  const reportPath = path.join(dir, 'result.json');
  const report = {
    mode: 'live model with local fixture retrieval', purpose: suite.purpose, backend: opts.backend, requestedModel: opts.model || null,
    requestedReasoning: opts.reasoning, started, selected: cases.map(testCase => testCase.id), baselineWithSources: !!opts['baseline-with-sources'],
    ...(opts.phase ? { evaluationPhase: opts.phase } : {}),
    inputs,
    grading: 'Human review against fixture criteria. Status, usage, and time describe execution only.', cases: Array(cases.length).fill(null)
  };
  function save() {
    fs.writeFileSync(reportPath + '.tmp', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(reportPath + '.tmp', reportPath);
  }
  save();
  console.log(`Evaluating ${cases.length} fixture(s) via ${opts.backend}. Results: ${reportPath}`);
  let next = 0;
  async function worker() {
    while (next < cases.length) {
      const index = next++;
      const result = await evaluate(Inquiry, cases[index], send, opts);
      report.cases[index] = result;
      save();
      const errors = result.requests.filter(stage => stage.status === 'error').length;
      console.log(`${result.id}: ${result.inquiry?.status || 'no inquiry status'}, ${result.requests.length} requests, ${errors} request errors${result.errors.length ? ', ' + result.errors.length + ' arm errors' : ''}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.jobs, cases.length) }, worker));
  report.finished = new Date().toISOString();
  report.models = [...new Set(report.cases.flatMap(result => result.models))];
  if (report.models.length > 1) report.comparisonLimit = 'Requests used more than one model. Compare the model provenance before comparing outputs.';
  save();
  if (report.cases.some(result => result.errors.length || result.requests.some(stage => stage.status === 'error'))) process.exitCode = 1;
}

main().catch(error => { console.error('Inquiry evaluation failed: ' + error.message); process.exitCode = 1; });
