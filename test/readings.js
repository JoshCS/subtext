/* Browser integration: use the real extractor, service worker and report with a fixture model reply.
   This verifies evidence and what a reader can inspect; it is not a model quality score. */
const assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const L = require('./ui/lib'), AI = require('../extension/ai');
const receipt = (source, quote) => ({ source, quote });
const interpretation = (lead, evidence) => ({ kind: 'interpretation', lead, evidence, limit: 'The partner credit does not establish editorial control.', check: '' });
const standalone = { title: 'Paper', mainText: 'The report recommends a study.\nIt does not endorse the project.', allText: 'We secretly endorse the project.' };
const screened = (evidence, opts) => AI.screenReading(interpretation('The report recommends further study.', evidence), standalone, opts);
assert(screened([receipt('page', 'The report recommends a study.')]));
for (const q of ['We secretly endorse the project.', 'study. It does not endorse', 'The report … endorses', 'Site: https://example.com']) assert.equal(screened([receipt('page', q)]), null);
assert.equal(screened([receipt('page', 'It does not endorse the project.')], {maxChars: 25}), null);
assert.equal(screened([receipt('page', 'The report recommends a study.'), receipt('context', 'Unknown sponsor')]), null);
assert.equal(AI.screenReading({kind:'insufficient'}, standalone, {}), null);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subtext-reading-test-'));
  const { context, sw, close } = await L.launch(dir);
  const url = 'https://layout.example.test/plans';
  const popupURL = new URL('/popup/popup.html', sw.url()).href + '?tabId=';
  const run = async (tabId, reading) => sw.evaluate(async ({tabId, reading}) => {
    SubtextAI.analyze = async o => { globalThis.testLastBlocks = o.blocks.map(b => b.text || '').join('\n'); return {parsed:{reading, business_type:'none', findings:[], chart_findings:[]}, model:'test', cost:0, usage:{input:0,output:0}}; };
    return (await handle({type:'deepAnalyze',tabId}, {})).ai;
  }, {tabId, reading});
  try {
    await sw.evaluate(() => chrome.storage.local.set({settings:{testHooks:true, anthropicKey:'test-only', policyScan:false, adsTxtLookup:false, sellerPages:false, aiWebCheck:false, aiInvestigation:false}}));
    await L.open(context, L.ARTICLE);
    const tid = await L.tabId(sw, L.ARTICLE);
    const r = interpretation('The appeal makes sharing the collapse warning a test of whether you care about your children.', [
      receipt('page', "If you really cared about your children, you would share this before it's too late."),
      receipt('page', 'This series is produced in partnership with Patriot Gold Group')
    ]);
    const ai = await run(tid, r);
    assert.equal(ai.reading.lead, r.lead);
    assert.equal(ai.reading.evidence[1].label, 'Credit or disclosure');
    assert((await sw.evaluate(() => testLastBlocks)).includes(r.evidence[1].quote));
    const popup = await context.newPage(); await popup.goto(popupURL + tid);
    await popup.getByRole('button',{name:'Why this reading?'}).click();
    assert.match(await popup.locator('.reading').innerText(), /Patriot Gold Group/);
    assert.match(await popup.locator('.reading').innerText(), /does not establish editorial control/);
    await popup.close();
    assert.equal((await run(tid, {...r, evidence:[...r.evidence, receipt('page','I invented this evidence.')]})).reading, null);

    // A quotation on a different site: the award is in a bundled filing, not in this page.
    const quoteUrl = 'https://news.example.test/quoted-forecast', quote = 'if we execute well on autonomous transport and Optimus';
    const article = 'In September 2025 Elon Musk discussed a projection that Tesla’s valuation could be $25 trillion. His condition was “' + quote + '”. The speaker was describing a possible outcome for the company, not reporting its current market price.';
    await context.route(quoteUrl, route => route.fulfill({contentType:'text/html',body:'<title>Looking back at a valuation forecast</title><article><p>' + article + '</p></article>'}));
    await L.open(context, quoteUrl); const qid = await L.tabId(sw,quoteUrl);
    const award = require('../extension/claim-context').forPage({mainText:article})[1];
    const local = await context.newPage(); await local.goto(popupURL+qid);
    await local.getByRole('heading',{name:'Behind this claim'}).waitFor();
    assert.equal(await local.locator('.reading a').nth(1).getAttribute('href'),award.source); await local.close();
    const forecast = {kind:'interpretation',lead:'Shareholders were hearing the upside case while being asked to approve the speaker’s performance award.',limit:'The award terms do not establish whether the forecast was realistic.',check:'',evidence:[receipt('page',quote),receipt('context',award.text)]};
    const qr = await run(qid,forecast); assert.equal(qr.reading.evidence[1].url,award.source);
    const qp = await context.newPage(); await qp.goto(popupURL+qid); await qp.getByRole('button',{name:'Why this reading?'}).click();
    assert.equal(await qp.locator('.reading__quote a').getAttribute('href'),award.source); await qp.close();

    const html = '<!doctype html><title>Workspace plans</title><main><h1>Keep editing after November</h1><p>Existing records remain searchable on either plan. Teams can export their lists at any time. The annual plan adds editing and reminders. Owners can switch plans later without moving the workspace. The change affects the way existing work is edited and shared.</p></main><div role="dialog" style="width:650px;height:240px"><h2>Choose a plan</h2><button id="yes" style="width:240px;height:60px">Buy annual editing</button><button id="no" style="width:80px;height:20px">No thanks</button></div>';
    await context.route(url, route => route.fulfill({contentType:'text/html',body:html}));
    const {page} = await L.open(context, url), lid = await L.tabId(sw, url);
    const extract = () => sw.evaluate(id => chrome.tabs.sendMessage(id,{type:'extractForLLM'}), lid);
    const raw = await extract();
    assert.deepEqual(raw.choiceLayout.map(c=>[c.primary,c.alternative,c.primaryArea,c.alternativeArea]), [['Buy annual editing','No thanks',14400,1600]]);
    const size = 'dialog:1:14400x1600';
    const layout = { kind:'interpretation', lead:'The paid editing button takes up nine times as much space as the refusal.', evidence:[receipt('page','Buy annual editing'),receipt('layout',size)], limit:'Button size does not tell us which option people choose.', check:'' };
    const shown = await run(lid,layout);
    assert.equal(shown.reading.lead, layout.lead);
    assert(shown.reading.evidence[1].quote.includes('“No thanks” — 1,600 px²'));
    await page.evaluate(()=>{document.querySelector('#no').style.cssText='width:240px;height:60px';});
    const equal = await extract();
    assert.equal(equal.choiceLayout[0].primaryArea, equal.choiceLayout[0].alternativeArea);
    assert.equal(AI.screenReading(layout,equal,{}),null);
    await page.evaluate(()=>{document.querySelector('#no').hidden=true;});
    assert.deepEqual((await extract()).choiceLayout, []);
    console.log('Readings: real article sidebar, inspected receipts, invented/missing evidence, and large/equal/hidden sales choices passed.');
  } finally { await close(); fs.rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
