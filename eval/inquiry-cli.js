'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const TIMEOUT_MS = 120_000;
const BACKENDS = ['codex', 'anthropic', 'openai'];

function processResult(program, args, options, prompt) {
  return new Promise((resolve, reject) => {
    const child = execFile(program, args, { ...options, timeout: TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.killed) { reject(new Error('Codex request exceeded its time limit.')); return; }
        if (error.code === 'ENOENT') { reject(new Error('The codex executable is not available.')); return; }
        const details = stderr.split('\n').filter(line => /(?:\bERROR\b|^error:|^Error:)/.test(line)).slice(-2).join('\n');
        reject(new Error('Codex exited with ' + (error.code || error.signal || 'an error') + (details ? ': ' + details.slice(0, 800) : '.')));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.on('error', () => { /* a process failure is reported by the callback above */ });
    child.stdin.end(prompt);
  });
}

function parseObject(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error('Model did not return valid JSON.'); }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Model response must be a JSON object.');
  return parsed;
}

function codexRequest({ model, reasoning }) {
  return async ({ system, blocks, schema }) => {
    if (blocks.some(block => block.type !== 'text')) throw new Error('The Codex inquiry eval accepts text fixtures only.');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'subtext-inquiry-'));
    try {
      const cwd = path.join(temp, 'cwd');
      await fs.mkdir(cwd);
      const schemaPath = path.join(temp, 'schema.json');
      const responsePath = path.join(temp, 'response.json');
      await fs.writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
      // Keep evaluation inputs off the command line and start a fresh, empty local session for every stage.
      const prompt = ['Complete the following structured evaluation task using only the supplied text. Do not use any tools, files, web access or external sources.', system, ...blocks.map(block => block.text)].join('\n\n');
      const args = ['--no-daemon', '-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--cd', cwd, '--color', 'never',
        '-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false', '-c', 'skills.bundled.enabled=false',
        '-c', 'memories.use_memories=false', '-c', 'memories.generate_memories=false', '-c', 'web_search="disabled"',
        '-c', 'forced_login_method="chatgpt"', '-c', 'model_reasoning_effort=' + JSON.stringify(reasoning),
        '--disable', 'shell_tool', '--disable', 'view_image', '--disable', 'apps',
        '--output-schema', schemaPath, '--output-last-message', responsePath];
      if (model) args.push('--model', model);
      args.push('-');
      const { stderr } = await processResult('codex', args, { cwd }, prompt);
      const header = stderr.split('\n--------\n');
      const modelUsed = (header[1] || '').match(/^model: (\S+)$/m);
      const cliVersion = (header[0] || '').match(/^OpenAI Codex v(\S+)$/m);
      if (!modelUsed || !cliVersion) throw new Error('Could not identify the Codex model and CLI version from the execution header.');
      const totals = Array.from(stderr.matchAll(/^tokens used\s*\n([\d,]+)$/gm));
      const total = totals.length ? Number(totals[totals.length - 1][1].replace(/,/g, '')) : null;
      return {
        parsed: parseObject(await fs.readFile(responsePath, 'utf8')),
        model: modelUsed[1], backend: 'codex', usage: total == null ? null : { total }, cost: null,
        transport: { cliVersion: cliVersion[1], auth: 'chatgpt', reasoning, tokenBreakdown: 'total only, includes Codex overhead' }
      };
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  };
}

function apiRequest({ backend, model: modelId, reasoning }) {
  const provider = require('../extension/ai.js').PROVIDERS[backend];
  const keyVariable = backend === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const key = process.env[keyVariable];
  if (!key) throw new Error(keyVariable + ' is unavailable; no requests made.');
  const known = modelId ? provider.models.find(item => item.id === modelId) : provider.models[0];
  const model = { ...(known || { id: modelId }), fallbacks: false };
  return async ({ system, blocks, schema, maxTokens }) => {
    const { url, headers, body } = provider.request(model, system, blocks, key, maxTokens);
    if (backend === 'openai') {
      body.text.format = { type: 'json_schema', name: 'subtext_inquiry', schema, strict: true };
      if (body.reasoning) body.reasoning.effort = reasoning;
      body.store = false;
    } else {
      body.output_config = { effort: reasoning, format: { type: 'json_schema', schema } };
    }
    const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    const json = await resp.json();
    if (!resp.ok) throw new Error(provider.errorMessage(json, resp.status));
    const { text, usage, model: actualModel } = provider.parse(json);
    if (!actualModel) throw new Error('The API response did not identify the model used.');
    const cost = known ? (usage.input * known.inPrice + usage.output * known.outPrice) / 1e6 : null;
    return {
      parsed: parseObject(text), usage, model: actualModel, backend, cost,
      transport: { auth: 'environment API key', requestedModel: model.id, reasoning: body.reasoning?.effort || body.output_config?.effort || null, cost: cost == null ? null : 'estimated from configured per-token prices' }
    };
  };
}

function createRequest({ backend = 'codex', model, reasoning = 'low' } = {}) {
  if (!BACKENDS.includes(backend)) throw new Error('Unknown inquiry eval backend: ' + backend);
  if (!['low', 'medium'].includes(reasoning)) throw new Error('Reasoning must be low or medium.');
  const send = backend === 'codex' ? codexRequest({ model, reasoning }) : apiRequest({ backend, model, reasoning });
  return async request => {
    if (!request.schema || !Array.isArray(request.blocks) || typeof request.system !== 'string') throw new Error('Invalid structured stage request.');
    const started = Date.now();
    const result = await send(request);
    return { ...result, elapsedMs: Date.now() - started };
  };
}

module.exports = { BACKENDS, createRequest };
