/* Real extension extraction, source fetch, staged UI and cancellation. Model replies
   are fixtures here; the separate opt-in eval measures model judgment. */
const A=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const L=require('./ui/lib');
const site='https://subtext-inquiry-fixture.org/options?session=private#secret';
const source='https://subtext-inquiry-fixture.org/methodology';
const next='https://subtext-inquiry-fixture.org/next';
const closing='https://subtext-inquiry-fixture.org/closing';
const claim='Compare the best savings accounts for your next deposit.';
const term='Only providers that pay for completed applications are eligible for this table.';
const html='<title>Savings comparison</title><article><h1>'+claim+'</h1><p>Use this table to select a savings account. Rates and balances vary by provider. The comparison gives a convenient starting point for a decision about where to keep your money.</p><p><a href="/methodology">How our comparison works</a></p><p><a href="/methodology?token=private">Personal terms</a><a hidden href="/about">Hidden</a></p></article>';
async function waitFor(check,message){
 for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,50));}
 A.fail(message);
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subtext-inquiry-ui-'));
 const {context,sw,close}=await L.launch(dir);let reads=0;
 try {
  await sw.evaluate(()=>chrome.storage.local.set({settings:{testHooks:true,policyScan:false,adsTxtLookup:false,sellerPages:false,anthropicKey:'test-only',aiInvestigation:true}}));
  await context.route('https://subtext-inquiry-fixture.org/options*',r=>r.fulfill({contentType:'text/html',body:html}));
  await context.route(next,r=>r.fulfill({contentType:'text/html',body:'<title>Different page</title><main>This page contains a different item and has never been analyzed.</main>'}));
  await context.route(closing,r=>r.fulfill({contentType:'text/html',body:html}));
  await context.route(source,r=>{reads++;A.equal(r.request().headers().referer,undefined);A.equal(r.request().headers().cookie,undefined);return r.fulfill({contentType:'text/html',body:'<title>Comparison methodology</title><main><p>'+term+'</p><p>Within the eligible set, accounts are ordered by the current annual interest rate.</p></main>'});});
  const {page,cdp}=await L.open(context,site),tid=await L.tabId(sw,site);
  const extract=()=>sw.evaluate(id=>chrome.tabs.sendMessage(id,{type:'extractForLLM'}),tid);
  const extracted=await extract();
  A.deepEqual(extracted.inquiryLinks.map(l=>l.url),[source]);A.equal(reads,0);
  await page.evaluate(url=>{
   const base=document.createElement('base');base.href='https://unrelated-inquiry-fixture.org/';base.dataset.inquiryProbe='';document.head.appendChild(base);
   const add=(href,label)=>{const a=document.createElement('a');a.href=href;a.textContent=label;a.dataset.inquiryProbe='';document.querySelector('article').appendChild(a);};
   add(url.replace('/methodology','/folder/../methodology'),'Escaped link');
   add(url,'Absolute methodology link');
  },source);
  A.equal(await page.getByText('How our comparison works',{exact:true}).evaluate(a=>a.href),'https://unrelated-inquiry-fixture.org/methodology');
  A.equal(await page.getByText('Escaped link',{exact:true}).evaluate(a=>a.href),source);
  A.deepEqual((await extract()).inquiryLinks.map(l=>[l.url,l.label]),[[source,'Absolute methodology link']]);
  await page.evaluate(()=>document.querySelectorAll('[data-inquiry-probe]').forEach(el=>el.remove()));
  A.equal(reads,0);
  // A late footer policy must survive the source cap; navigation order is not relevance.
  await page.evaluate(()=>{
   const footer=document.createElement('footer');footer.dataset.inquiryProbe='';
   for(const path of ['about','about-us','how-we-make-money','editorial-guidelines','editorial-standards','advertising','partners','press','investor','investors','investor-relations','disclosures','legal/refund-policy','legal/universal-terms-of-service-agreement']){
    const a=document.createElement('a');a.href='/'+path;a.textContent=path;footer.appendChild(a);
   }
   document.body.appendChild(footer);
  });
  const footerLinks=(await extract()).inquiryLinks;
  A.equal(footerLinks.length,12);
  A.deepEqual(footerLinks.slice(0,2).map(l=>l.url),['https://subtext-inquiry-fixture.org/legal/refund-policy','https://subtext-inquiry-fixture.org/legal/universal-terms-of-service-agreement']);
  A.equal(reads,0);
  await page.evaluate(()=>document.querySelectorAll('[data-inquiry-probe]').forEach(el=>el.remove()));
  await sw.evaluate(({claim,term})=>{
   globalThis.inquiryCalls=[];globalThis.inquiryHold=false;globalThis.inquiryReject=false;
   SubtextAI.analyze=async o=>{
    const stage=o.schemaName.replace('subtext_','');inquiryCalls.push({stage,blocks:o.blocks,schema:o.schema});
    const raw=o.blocks[0].text.split('<page_content>\n')[1].split('\n</page_content>')[0],p=JSON.parse(raw);
    const anchor=p.evidence.find(x=>x.quote===claim);
    if(stage==='plan') {
     if(inquiryHold) await new Promise(resolve=>{globalThis.inquiryHeldSignal=o.signal;globalThis.releaseInquiry=resolve;});
     else await new Promise(resolve=>setTimeout(resolve,250));
     return {parsed:{mode:'investigate',domain:'comparison',question:'Which providers can appear in the table?',claim:{id:anchor.id,quote:claim},hypothesis:'Eligibility may depend on payment.',alternative:'The table may include unpaid providers.',source_ids:[p.available_sources[0].id],search:{kind:'none',query:''}},usage:{input:100,output:50},model:'test-model',cost:0.001};
    }
    const doc=p.evidence.find(x=>x.source==='document' && x.quote.includes(term));
    const reading={kind:'interpretation',lead:'This is a comparison among paying partners. An account outside that pool cannot win, even if its rate is better.',mechanism:'Eligibility is decided before the interest-rate ranking begins.',alternative:'Payment does not establish that the ordering within the eligible set is bought.',check:'Compare the top rate with providers outside this table.',evidence:[{id:anchor.id,quote:claim},{id:doc.id,quote:term}]};
    return {parsed:stage==='draft'?reading:{verdict:inquiryReject?'reject':'keep',reason:inquiryReject?'The implication is unsupported.':'The eligibility condition supports the reading.',checks:{subject:true,timing:true,scope:true,implication:!inquiryReject,alternatives:true},revised:null},usage:{input:100,output:50},model:'test-model',cost:0.001};
   };
  },{claim,term});
  const popup=await context.newPage();await popup.goto(new URL('/popup/popup.html?tabId='+tid,sw.url()).href);
  await popup.locator('#aiBtn').click();
  await popup.getByRole('button',{name:'Choosing the question that matters'}).waitFor();
  A.equal(await popup.locator('#aiBtn').isDisabled(),true);
  await popup.getByText('This is a comparison among paying partners.',{exact:false}).waitFor();
  A.equal(reads,1);
  await popup.getByRole('button',{name:'Why this reading?'}).click();
  A.ok((await popup.locator('.reading').innerText()).includes(term));
  A.equal(await popup.locator('.reading__quote a').getAttribute('href'),source);
  const calls=await sw.evaluate(()=>inquiryCalls);A.deepEqual(calls.map(x=>x.stage),['plan','draft','review']);
  for(const call of calls){A.ok(call.schema);A.doesNotMatch(JSON.stringify(call.blocks),/session=private|#secret|token=private|test-only/);}

  const completedLead=popup.getByText('This is a comparison among paying partners.',{exact:false});
  const analyzedScan=(await L.state(sw,site)).report.meta.ts;
  await page.locator('h1').evaluate(e=>e.firstChild.nodeValue='The comparison has been replaced by a list of account closures.');
  await sw.evaluate(id=>chrome.tabs.sendMessage(id,{type:'rescan'}),tid);
  await waitFor(async()=>{const st=await L.state(sw,site);return st?.report.meta.ts>analyzedScan && !st.ai;},'A fresh same-URL report retained a completed inquiry about changed text.');
  await completedLead.waitFor({state:'hidden',timeout:8000});
  await page.locator('h1').evaluate((e,t)=>e.firstChild.nodeValue=t,claim);
  await sw.evaluate(id=>chrome.tabs.sendMessage(id,{type:'rescan'}),tid);
  await popup.locator('#aiBtn').click();await completedLead.waitFor();

  await page.goto(next,{waitUntil:'domcontentloaded'});
  await waitFor(()=>L.state(sw,next),'The new route did not receive a report.');
  await completedLead.waitFor({state:'hidden',timeout:8000});
  await page.goto(site,{waitUntil:'domcontentloaded'});
  await waitFor(()=>L.state(sw,site),'The original route did not receive a fresh report.');
  await popup.reload();await popup.locator('#aiBtn').click();await completedLead.waitFor();

  // A veto never shows the previous successful lead as the new conclusion.
  await sw.evaluate(()=>{inquiryReject=true;});await popup.locator('#aiBtn').click();
  await popup.getByText('The evidence did not support a conclusion.',{exact:false}).waitFor({timeout:8000});
  A.equal(await popup.getByText('This is a comparison among paying partners.',{exact:false}).count(),0);
  // A text-node edit on the SAME URL cancels before retrieval, even before rescan.
  await sw.evaluate(()=>{inquiryHold=true;inquiryReject=false;globalThis.inquiryCalls=[];});
  const start=()=>sw.evaluate(id=>handle({type:'deepAnalyze',tabId:id},{}).catch(e=>({error:e.message})),tid);
  const pending=start();
  for(let i=0;i<50;i++){if(await sw.evaluate(()=>typeof releaseInquiry==='function'))break;await new Promise(r=>setTimeout(r,20));}
  const duplicate=await start();A.match(duplicate.error,/already running/);
  const before=reads;await page.locator('h1').evaluate(e=>e.firstChild.nodeValue='A different comparison has replaced the page.');
  await sw.evaluate(()=>{releaseInquiry();delete globalThis.releaseInquiry;});
  A.match((await pending).error,/page changed/);A.equal(reads,before);
  A.equal((await L.state(sw,site)).aiProgress,undefined);

  // Closing a tab aborts the active provider request even before the mock replies.
  const {page:closingTab}=await L.open(context,closing),closingId=await L.tabId(sw,closing);
  const pendingClose=sw.evaluate(id=>handle({type:'deepAnalyze',tabId:id},{}).catch(e=>({error:e.message})),closingId);
  try {
   await waitFor(()=>sw.evaluate(()=>typeof releaseInquiry==='function'),'The closing-tab request did not start.');
   await closingTab.close();
   await waitFor(()=>sw.evaluate(()=>inquiryHeldSignal?.aborted===true),'Closing the tab did not abort its provider signal.');
  } finally {await sw.evaluate(()=>{if(typeof releaseInquiry==='function'){releaseInquiry();delete globalThis.releaseInquiry;}});}
  A.match((await pendingClose).error,/cancelled|changed/);A.equal(reads,before);

  // Muting also cancels an in-flight stage and prevents every subsequent source call.
  await page.locator('h1').evaluate((e,t)=>e.firstChild.nodeValue=t,claim);
  const muted=start();for(let i=0;i<50;i++){if(await sw.evaluate(()=>typeof releaseInquiry==='function'))break;await new Promise(r=>setTimeout(r,20));}
  await sw.evaluate(()=>handle({type:'muteSite',hostname:'subtext-inquiry-fixture.org'},{}));
  await sw.evaluate(()=>{releaseInquiry();delete globalThis.releaseInquiry;});
  A.match((await muted).error,/cancelled|muted|changed/);A.equal(reads,before);A.equal(await L.state(sw,site),null);
  console.log('Inquiry UI: progress, receipts, reviewer veto, stale reading removal, route changes, and tab-close/mute cancellation passed.');
 }finally{await close();fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
