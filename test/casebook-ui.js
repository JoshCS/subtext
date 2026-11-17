const A=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('./ui/lib');
const url='https://casebook-fixture.test/offer?private=token';
const offer='Studio access costs 120 dollars prepaid for one year. Cancel anytime.';
const terms='Canceling stops the next annual renewal. The current annual payment is refundable only during the first 14 days.';
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subtext-casebook-'));let session;
 try {
  session=await L.launch(dir);const {context,sw}=session;
  await context.route('https://casebook-fixture.test/**',r=>r.fulfill({contentType:'text/html',body:'<title>Studio access offer</title><main><h1>Studio access offer</h1><p>'+offer+'</p></main>'}));
  const {page}=await L.open(context,url),tabId=await L.tabId(sw,url);
  // Body terms survive many heading/control receipts ahead of them in the packet.
  await page.evaluate(()=>{const nav=document.createElement('section');for(let n=0;n<25;n++){const h=document.createElement('h2');h.textContent='Navigation heading '+n;nav.appendChild(h);}for(let n=0;n<12;n++){const b=document.createElement('button');b.textContent='Choose option '+n;nav.appendChild(b);}document.querySelector('main').prepend(nav);});
  const popup=await context.newPage();await popup.goto(new URL('/popup/popup.html?tabId='+tabId,sw.url()).href);
  const saveButton=()=>popup.getByRole('button',{name:/^(Save this page|Add to a case…)$/});
  const settled=b=>b.waitForFunction(()=>document.querySelector('#case-content')?.getAttribute('aria-busy')==='false');
  const savedTo=(b,title)=>b.locator('#status').filter({hasText:'Saved this page to “'+title+'”.'}).waitFor();
  const opened=context.waitForEvent('page');await saveButton().click();
  const book=await opened;await book.waitForLoadState();
  const rpc=(type,rest={})=>book.evaluate(msg=>chrome.runtime.sendMessage(msg),{type,...rest});
  // (a) Save this page with no cases: one capture, in a new "Saved pages" case, selected, with no further clicks.
  await savedTo(book,'Saved pages');await settled(book);
  await book.locator('#current-title').filter({hasText:'Saved pages'}).waitFor();
  A(!/[?&]save=/.test(book.url()),'save=1 must leave the address after it runs');A.match(book.url(),new RegExp('[?&]sourceTab='+tabId+'(&|$)'));
  let cases=(await rpc('caseList')).data;A.equal(cases.length,1);A.equal(cases[0].title,'Saved pages');const savedId=cases[0].id;
  let record=(await rpc('caseGet',{id:savedId})).data;A.equal(record.snapshots.length,1);A.equal(record.snapshots[0].url,'https://casebook-fixture.test/offer');A(record.snapshots[0].receipts.some(r=>r.quote.includes(offer)),'Actual terms must survive navigation clutter');
  A(!JSON.stringify(record).includes('private=token'));
  // A reload does not save the page a second time, and the manual capture form is still offered.
  await book.reload();await settled(book);await book.locator('#current-title').filter({hasText:'Saved pages'}).waitFor();
  A(await book.locator('#capture-form').isVisible());A.equal(await book.locator('#status').isVisible(),false);
  A.equal((await rpc('caseList')).data.length,1);A.equal((await rpc('caseGet',{id:savedId})).data.snapshots.length,1);
  // (b) With existing cases, the save goes to the most recently updated one; the casebook tab is reused.
  await book.locator('#case-title').fill('Studio purchase decision');await book.locator('#create-form button').click();
  await book.locator('#current-title').filter({hasText:'Studio purchase decision'}).waitFor();await settled(book);
  cases=(await rpc('caseList')).data;A.equal(cases.length,2);const id=cases.find(c=>c.title==='Studio purchase decision').id;
  const pagesBefore=context.pages().length;
  await saveButton().click();await savedTo(book,'Studio purchase decision');await settled(book);
  A.equal(context.pages().length,pagesBefore,'Save this page must reuse the open casebook tab');
  A.equal(await book.locator('#case-list [aria-current="true"]').innerText().then(t=>t.includes('Studio purchase decision')),true);
  A.equal((await rpc('caseGet',{id})).data.snapshots.length,1);A.equal((await rpc('caseGet',{id:savedId})).data.snapshots.length,1);A.equal((await rpc('caseList')).data.length,2);
  // Only the extension-owned notebook can read or modify saved cross-page data.
  for(const type of ['caseList','caseGet','caseDelete','caseCompare','caseCapture']) {
   const err=await sw.evaluate(async({type,id,tabId,url})=>{try{return await handle({type,id,sourceTabId:tabId},{id:chrome.runtime.id,tab:{id:tabId,url},url,frameId:0});}catch(e){return e.message;}},{type,id,tabId,url});
   A.match(err,/Open the Subtext casebook/);
  }
  await page.locator('main p').evaluate((e,t)=>e.textContent=t,terms);
  await book.locator('#capture-form button').click();await book.getByText('2 saved steps',{exact:true}).first().waitFor();
  record=(await rpc('caseGet',{id})).data;A.equal(record.snapshots.length,2);
  const ids=record.snapshots.map(x=>x.id);
  // (c) No AI key: the hint and the refusal both appear beside the Analyze button, and the refusal takes focus.
  for(const checkbox of await book.locator('#steps input[type=checkbox]').all())await checkbox.check();
  const hint=book.locator('.analyze-action #analyze-key');await hint.waitFor();
  A.equal((await hint.innerText()).trim(),'Needs an AI key. Open Settings');
  await book.locator('#analyze').click();
  const inline=book.locator('.analyze-action #analyze-error');await inline.filter({hasText:'Add an AI API key in Subtext settings first.'}).waitFor();
  A.equal(await book.evaluate(()=>document.activeElement?.id),'analyze-error');A.equal(await book.locator('#error').isVisible(),false);
  const [buttonBox,errorBox]=await Promise.all([book.locator('#analyze').boundingBox(),inline.boundingBox()]);
  A(errorBox.y>=buttonBox.y+buttonBox.height && errorBox.y-(buttonBox.y+buttonBox.height)<120,'The refusal must sit just under the Analyze button');
  A(await inline.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight;}),'The refusal must be on screen');
  const settingsPage=context.waitForEvent('page');await hint.getByRole('link',{name:'Open Settings'}).click();
  const options=await settingsPage;await options.waitForLoadState();A.match(options.url(),/\/options\/options\.html/);await options.close();
  await sw.evaluate(async()=>{
   await chrome.storage.local.set({settings:{testHooks:true,anthropicKey:'test-only'}});
   globalThis.caseModelCalls=[];
   SubtextAI.analyze=async o=>{
    const packet=JSON.parse(o.blocks[0].text.split('<page_content>\n')[1].split('\n</page_content>')[0]);caseModelCalls.push(packet);
    const p=packet.evidence.find(e=>e.source==='page' && e.quote.includes('Canceling stops'));
    const h=packet.evidence.find(e=>e.source==='history' && e.quote.includes('120 dollars'));
    const evidence=[p,h].map(e=>({id:e.id,quote:e.quote}));
    const reading={kind:'interpretation',question:'What does cancellation recover?',lead:'Canceling stops the next renewal, but the prepaid year has a 14-day refund window.',mechanism:'Stopping another charge and recovering the current payment are separate actions.',alternative:'The offer accurately discloses an annual prepayment.',check:'Check whether the refund window is still open.',evidence,investigation:null};
    let parsed;
    if(o.schemaName==='subtext_plan')parsed={mode:'investigate',domain:'sales',lenses:['payment_and_exit'],question:reading.question,claim:evidence[0],hypothesis:'Canceling may stop renewal without refunding the current year.',alternative:reading.alternative,source_ids:[],source_questions:[],search:{kind:'none',query:''}};
    else if(o.schemaName==='subtext_draft')parsed=reading;
    else parsed={verdict:'keep',reason:'The two captures distinguish cancellation from refund.',checks:{subject:true,timing:true,scope:true,implication:true,alternatives:true},revised:null};
    if(globalThis.holdCase)await new Promise(resolve=>{globalThis.releaseCase=resolve;});
    return {parsed,model:'test-model',usage:{},cost:0};
   };
  });
  // A key added elsewhere clears the hint when the reader returns to the casebook.
  await book.evaluate(()=>dispatchEvent(new Event('focus')));await hint.waitFor({state:'hidden'});
  for(const checkbox of await book.locator('#steps input[type=checkbox]').all())await checkbox.check();
  await book.locator('#analyze').click();await book.locator('#reading').getByText(/Canceling stops the next renewal/).waitFor();
  record=(await rpc('caseGet',{id})).data;A.deepEqual(record.analysis.snapshotIds,ids);A.equal(record.analysis.reading.reviewed,true);
  A.equal(await sw.evaluate(()=>caseModelCalls.length),3);A(await sw.evaluate(()=>caseModelCalls.every(p=>p.available_sources.length===0 && p.coverage.scope==='selected-saved-excerpts')));
  await book.reload();await book.locator('#reading').getByText(/Canceling stops the next renewal/).waitFor();
  await book.setViewportSize({width:390,height:844});A(await book.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const out=path.resolve('eval/out-investigation');fs.mkdirSync(out,{recursive:true});await book.screenshot({path:path.join(out,'casebook-mobile.png'),fullPage:true});
  // A changed selected case invalidates in-flight model output.
  await sw.evaluate(()=>{globalThis.holdCase=true;});
  const pending=rpc('caseCompare',{id,snapshotIds:ids});
  for(let n=0;n<80 && !await sw.evaluate(()=>!!globalThis.releaseCase);n++)await new Promise(r=>setTimeout(r,25));
  A(await sw.evaluate(()=>!!globalThis.releaseCase));
  await rpc('caseRemoveStep',{id,snapshotId:ids[0]});await sw.evaluate(()=>{holdCase=false;releaseCase();delete globalThis.releaseCase;});
  A.match((await pending).error,/cancelled|changed/i);
  A.equal((await rpc('caseGet',{id})).data.analysis,null);
  // A source that mutates between extraction checks is not saved.
  await sw.evaluate(()=>{const original=chrome.tabs.sendMessage.bind(chrome.tabs);let n=0;globalThis.restoreCaseSend=()=>{chrome.tabs.sendMessage=original;};chrome.tabs.sendMessage=async(...args)=>{const p=await original(...args);if(args[1]?.type==='extractForLLM' && ++n%2===0)return {...p,mainText:p.mainText+' Changed while reading.'};return p;};});
  A.match((await rpc('caseCapture',{id,sourceTabId:tabId})).error,/changed while saving/);await sw.evaluate(()=>restoreCaseSend());
  await sw.evaluate(async()=>{const s=(await chrome.storage.local.get('settings')).settings;await chrome.storage.local.set({settings:{...s,disabledSites:['casebook-fixture.test']}});});
  A.match((await rpc('caseCapture',{id,sourceTabId:tabId})).error,/muted/);
  A.equal((await rpc('caseGet',{id})).data.snapshots.length,1);
  // A refused Save this page shows the plain error, keeps the newest case open and saves nothing.
  const saveURL=new URL('/casebook/casebook.html?sourceTab='+tabId+'&save=1',sw.url()).href;
  await book.goto(saveURL);await book.locator('#error').filter({hasText:/muted/}).waitFor();await settled(book);
  await book.locator('#current-title').filter({hasText:'Studio purchase decision'}).waitFor();A(!/[?&]save=/.test(book.url()));
  A.equal((await rpc('caseGet',{id})).data.snapshots.length,1);A.equal((await rpc('caseGet',{id:savedId})).data.snapshots.length,1);
  A.deepEqual((await rpc('caseDelete',{id})).data,{deleted:true});A.deepEqual((await rpc('caseDelete',{id:savedId})).data,{deleted:true});A.deepEqual((await rpc('caseList')).data,[]);
  // With no cases, a refused save leaves the new "Saved pages" case selected with its manual save button, and nothing saved.
  await book.goto(saveURL);await book.locator('#error').filter({hasText:/muted/}).waitFor();await settled(book);
  await book.locator('#current-title').filter({hasText:'Saved pages'}).waitFor();A(await book.locator('#capture-form').isVisible());
  cases=(await rpc('caseList')).data;A.equal(cases.length,1);A.equal(cases[0].title,'Saved pages');A.equal(cases[0].count,0);
  A.deepEqual((await rpc('caseDelete',{id:cases[0].id})).data,{deleted:true});A.deepEqual((await rpc('caseList')).data,[]);
  console.log('Casebook: Save this page on arrival (new and existing case, no repeat on reload, refusal), inline AI-key message, real extension RPC, local capture, access boundary, saved comparison, mobile layout, stale result and capture races passed.');
 } finally {if(session)await session.close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
