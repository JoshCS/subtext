/* Verifies API keys, model ids and the structured-output request shape for each provider with one tiny request,
   using the extension's own ai.js module. Reads ANTHROPIC_API_KEY and OPENAI_API_KEY from the environment.
   Usage: node scripts/ai-check.js [--anthropic-model id] [--openai-model id] */
const SubtextAI = require('../extension/ai.js');
const rules = require('../extension/rules/text-rules.json');
const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const page = { url: 'https://example.test/offer', title: 'Last chance: 80% off today only', hostname: 'example.test', headings: ['Last chance: 80% off today only'], ctas: ['Claim my discount', 'No thanks, I don\'t want to save money'],
  mainText: 'Hurry! Only 3 left in stock and 27 people are viewing this right now. Experts say this is the best widget ever made. Free trial* (*then billed annually at $119.88 unless you cancel; to cancel, call our retention department). You deserve this. Smart shoppers like you never pay full price.', heuristicFindings: [], charts: [] };
(async () => {
  let any = false;
  for (const provider of ['anthropic', 'openai']) {
    const key = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY;
    if (!key) { console.log(`${provider}: no key in env (${provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}), skipped`); continue; }
    any = true;
    const model = opt(provider + '-model') || SubtextAI.PROVIDERS[provider].models[0].id;
    const t0 = Date.now();
    try {
      const res = await SubtextAI.analyze({ provider, model, key, system: SubtextAI.systemPrompt(rules.categories), blocks: SubtextAI.buildUserBlocks(page, {}), maxTokens: 6000 });
      const findings = SubtextAI.toFindings(res.parsed, []);
      console.log(`${provider} ✓ model=${res.model} pressure=${res.parsed.overall_pressure} findings=${findings.length} tokens=${res.usage.input}/${res.usage.output} cost=$${res.cost} time=${Date.now() - t0}ms`);
      const reading = SubtextAI.screenReading(res.parsed.reading, page, {});
      console.log('   reading: ' + (reading ? reading.lead : '(no supported reading)'));
      for (const f of findings.slice(0, 4)) console.log(`   - [${f.category}] ${f.label}: ${f.why}  ← "${(f.evidence[0] || {}).quote || ''}"`);
    } catch (e) { console.log(`${provider} ✗ ${e.message}`); if (/model/i.test(e.message)) console.log('   Try another model id: node scripts/ai-check.js --' + provider + '-model <id>'); }
  }
  if (!any) { console.log('\nSet at least one key, e.g.\n  export ANTHROPIC_API_KEY=sk-ant-…\n  export OPENAI_API_KEY=sk-…'); process.exit(1); }
})();
