#!/usr/bin/env node
'use strict';
// Original synthetic tuning cases. Network happens only with the explicit --run command.
// Results go to stdout; this tool never writes result files or loads keys from disk.
const path = require('path');
const suite = require('./reading-cases.json');
function usage() {
  return 'Offline: node eval/readings.js --inspect [--cases id,id]\nLive (billable): node eval/readings.js --run --provider anthropic|openai [--model id] [--cases id,id] [--baseline /absolute/path/old-ai.cjs]\nLive calls use only the selected provider\'s existing environment key. --baseline doubles calls. Human grading only; no automatic quality scores.';
}
function options(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (['--inspect', '--run', '--help'].includes(a)) { out[a.slice(2)] = true; continue; }
    if (['--provider', '--model', '--cases', '--baseline'].includes(a)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + a);
      out[a.slice(2)] = args[++i]; continue;
    }
    throw new Error('Unknown argument: ' + a);
  }
  if (out.inspect && out.run) throw new Error('Choose --inspect or --run.');
  return out;
}
function checkModule(ai, name, current) {
  for (const fn of ['systemPrompt', 'buildUserBlocks', 'analyze']) {
    if (typeof ai[fn] !== 'function') throw new Error(name + ' does not export ' + fn);
  }
  if (current && typeof ai.screenReading !== 'function') throw new Error('Current AI module must export screenReading before running this evaluation.');
}
async function main() {
  const opts = options(process.argv.slice(2));
  if (opts.help || (!opts.inspect && !opts.run)) { console.log(usage()); return; }
  const ids = opts.cases ? opts.cases.split(',') : suite.cases.map(c => c.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate case ids.');
  const cases = ids.map(id => { const c = suite.cases.find(c => c.id === id); if (!c) throw new Error('Unknown case: ' + id); return c; });
  if (opts.inspect) {
    console.log(JSON.stringify({ mode: 'offline inspection; no model calls or credentials used', purpose: suite.purpose, cases }, null, 2)); return;
  }
  if (!['anthropic', 'openai'].includes(opts.provider)) throw new Error('--run requires an explicit --provider anthropic|openai.');
  const current = require('../extension/ai.js');
  checkModule(current, 'Current module', true);
  const modules = [{ name: 'current', ai: current }];
  if (opts.baseline) {
    const baseline = require(path.resolve(opts.baseline));
    checkModule(baseline, 'Baseline module', false);
    modules.push({ name: 'baseline', ai: baseline });
  }
  const model = opts.model || current.PROVIDERS[opts.provider].models[0].id;
  const categories = require('../extension/rules/text-rules.json').categories;
  const playbook = require('../extension/data/category-playbook.json');
  const key = process.env[opts.provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'];
  if (!key) throw new Error('Selected provider environment key is unavailable; no calls made.');
  console.log(JSON.stringify({ purpose: suite.purpose, provider: opts.provider, requestedModel: model, calls: cases.length * modules.length, grading: 'Human review against criteria below; no computed quality score.' }));
  for (const c of cases) {
    console.log(JSON.stringify({ case: c.id, pair: c.pair, variant: c.variant, criteria: c.criteria }));
    for (const entry of modules) {
      const ai = entry.ai;
      const result = await ai.analyze({ provider: opts.provider, model, key, system: ai.systemPrompt(categories, playbook), blocks: ai.buildUserBlocks(c.page, c.opts) });
      const reading = typeof ai.screenReading === 'function' ? ai.screenReading(result.parsed.reading, c.page, c.opts) : null;
      console.log(JSON.stringify({ case: c.id, module: entry.name, model: result.model, usage: result.usage, cost: result.cost,
        screenedReading: reading, lead: reading ? reading.lead : null,
        legacyModelOutput: entry.name === 'baseline' ? (result.parsed.subtext || result.parsed.summary || null) : null,
        legacyNote: entry.name === 'baseline' ? 'Model output, not a literal rendered headline; prior rendering/name gate is not applied.' : undefined,
        parsed: result.parsed }));
    }
  }
}
main().catch(err => { console.error('Reading evaluation failed: ' + err.message); process.exitCode = 1; });
