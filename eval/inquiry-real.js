#!/usr/bin/env node
/* Explicit local evaluation on public pages. Captures/results stay ignored; never
   copies a personal browser profile, signs in, or bypasses access controls. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'),OUT=path.join(__dirname,'out-inquiry-real');
const Inquiry=require(process.env.INQUIRY_IMPL ? path.resolve(process.env.INQUIRY_IMPL) : '../extension/inquiry'),Sources=require('../extension/inquiry-sources'); // INQUIRY_IMPL: compare another version of the inquiry on the same captures
const {createRequest}=require('./inquiry-cli');
const hash=s=>createHash('sha256').update(s).digest('hex');
const save=(file,data)=>{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n',{mode:0o600});};
async function capture(id,url,postSelector){
 if(!/^[a-z0-9-]+$/.test(id) || !/^https:\/\//.test(url))throw new Error('Use a simple name and a public HTTPS URL.');
 fs.mkdirSync(OUT,{recursive:true,mode:0o700});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'subtext-real-'));let browser;
 const out={id,requestedUrl:url,capturedAt:new Date().toISOString(),extractorHash:hash(fs.readFileSync(path.join(ROOT,'extension/content/engine.js'))),codeHash:hash(['extension/inquiry.js','extension/ai.js','extension/background.js','extension/common.js'].map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('')),mode:postSelector?'visible embedded X post on host page in anonymous browser':'real extension extraction from anonymous browser',notes:[]};
 try{
  browser=await chromium.launchPersistentContext(dir,{headless:true,channel:'chromium',viewport:{width:1440,height:1000},args:['--disable-extensions-except='+path.join(ROOT,'extension'),'--load-extension='+path.join(ROOT,'extension')]});
  const sw=browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  // the same-site lookups a reader gets by default (policy pages, the shop's own legal pages, ads.txt), so the capture holds the evidence the product has
  await sw.evaluate(()=>chrome.storage.local.set({settings:{testHooks:true,policyScan:true,sellerPages:true,adsTxtLookup:true,aiWebCheck:false}}));
  const page=await browser.newPage();
  try{const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});out.httpStatus=r?.status();}catch(e){out.notes.push(e.message.split('\n')[0]);}
  await page.waitForTimeout(9000); // policy pages, the shop's own pages and ads.txt arrive after the first scan
  out.url=page.url();out.title=await page.title();
  if(postSelector){
   const post=page.locator(postSelector);
   if(await post.count()!==1 || !(await post.isVisible()))throw new Error('The post selector must match one visible embed.');
   const selected=await post.evaluate(el=>({
    block:el.innerText.trim(),
    paragraphs:[...el.querySelectorAll(':scope > p')].filter(p=>p.checkVisibility({opacityProperty:true,visibilityProperty:true})).map(p=>p.innerText.trim()).filter(Boolean),
    links:[...el.querySelectorAll('a[href]')].filter(a=>a.checkVisibility({opacityProperty:true,visibilityProperty:true})).map(a=>a.href)
   }));
   const permalinks=selected.links.map(link=>new URL(link)).filter(u=>u.protocol==='https:' && /^(www\.)?(x|twitter)\.com$/i.test(u.hostname) && /^\/[a-z0-9_]+\/status\/\d+\/?$/i.test(u.pathname));
   if(permalinks.length!==1)throw new Error('The visible embed must contain one original X permalink.');
   const [,handle,,status]=permalinks[0].pathname.split('/');
   const attribution=selected.block.split('\n').map(line=>line.trim()).find(line=>line.toLowerCase().includes(`(@${handle.toLowerCase()})`));
   if(!attribution)throw new Error('The embedded attribution must match the X permalink author.');
   const postText=selected.paragraphs.filter(line=>line!==attribution).join('\n\n');
   if(!postText)throw new Error('The visible embed must contain post paragraphs.');
   out.post={selector:postSelector,hostUrl:out.url,permalink:`https://x.com/${handle}/status/${status}`,handle:`@${handle}`,attribution};
   out.page={url:out.url,mainText:postText,credits:[attribution],inquiryLinks:[]};
   out.notes.push('Captured the visible post on its host page. The original X page was not opened.');
  }else{
   const tid=await sw.evaluate(async u=>(await chrome.tabs.query({})).find(t=>t.url===u)?.id,page.url());
   if(tid){
    out.page=await sw.evaluate(id=>chrome.tabs.sendMessage(id,{type:'extractForLLM'}),tid).catch(e=>({error:e.message}));
    out.records=await sw.evaluate(async id=>{const st=await getState(id);if(!st?.report)return [];const s=MLCommon.outletContext(st.outlet?.entry,st.report.url);return [s.ownership,s.policy].filter(Boolean);},tid);
    // what the product itself knows about this page, kept apart from the extraction: findings as shown, the rules' summary line, and the source facts
    // the product object comes from the worker's own productOf, so the eval sees exactly what Investigate is given (a hand-copied
    // version here drifted and dropped the owner links and paid label, 16 Nov 2026); diagnostics the extension does not send are added beside it
    out.product=await sw.evaluate(async id=>{const st=await getState(id);if(!st?.report)return null;const settings=await getSettings();const vis=visibleState(st,settings);const F=MLCommon.oneFactEach((vis.report.findings||[]).concat(vis.outletFindings||[]));
      const pv=st.report.provenance||{};return {...productOf(st,settings),reading:MLCommon.reading(F,vis).text,owner:st.owner?.row||null,buyout:st.buyout||null,
       provenance:{entity:pv.entity||null,entityVia:pv.entityVia||null,copyright:pv.copyright||null,address:pv.address||null,phone:!!pv.phone,platform:pv.platform||null,pages:pv.pages||null},shop:st.report.meta?.shop||null,transaction:st.report.transaction||null};},tid).catch(e=>({error:e.message}));
   }
   // Ordinary anchor metadata helps diagnose source discovery, but is not inquiry evidence.
   out.observedLinks=await page.locator('a[href]').evaluateAll(as=>as.filter(a=>a.checkVisibility?.() && a.innerText.trim()).map(a=>({url:a.href,label:a.innerText.trim().slice(0,160)})).filter(a=>/^https:\/\//.test(a.url)).slice(0,500));
   await page.screenshot({path:path.join(OUT,id+'.png'),fullPage:false});
   if(tid)await sw.evaluate(id=>chrome.tabs.sendMessage(id,{type:'togglePanel',on:true}),tid).catch(()=>{});
   await page.screenshot({path:path.join(OUT,id+'-panel.png'),fullPage:false});
  }
  out.visibleChars=(out.page?.mainText || '').length;
 }finally{try{await browser?.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}}
 save(path.join(OUT,id+'.json'),out);
 console.log(JSON.stringify({id,status:out.httpStatus,url:out.url,title:out.title,chars:out.visibleChars,links:out.page?.inquiryLinks?.length,notes:out.notes}));
 return out;
}
async function run(file,phase){
 if(phase && !/^[a-z0-9-]{1,60}$/.test(phase))throw new Error('Use a simple evaluation phase name.');
 const capture=JSON.parse(fs.readFileSync(file,'utf8'));const page=capture.page;
 if(!page || page.error || !page.mainText?.trim())throw new Error('No readable captured page.');
 const report={id:capture.id,url:capture.url,capturedAt:capture.capturedAt,phase:phase || 'initial',started:new Date().toISOString(),captureMode:capture.mode,...(capture.post?{post:capture.post}:{}),backend:'codex',coreHash:hash(fs.readFileSync(path.join(ROOT,'extension/inquiry.js'))),sourceReaderHash:hash(fs.readFileSync(path.join(ROOT,'extension/inquiry-sources.js'))),captureHash:hash(fs.readFileSync(file)),requests:[],reads:[],searches:[]};
 const dest=path.join(OUT,capture.id+'-'+report.phase+'-'+Date.now()+'.json');
 // INQUIRY_BACKEND=production calls the extension's own transport (SubtextAI.analyze) exactly as background.js does, with
 // ANTHROPIC_API_KEY and INQUIRY_MODEL (default claude-sonnet-5-5, the extension default since 16 Nov 2026). The default stays the local Codex login.
 const backend=process.env.INQUIRY_BACKEND || 'codex';
 const send=backend==='production' ? (()=>{const AI=require('../extension/ai');const key=process.env.ANTHROPIC_API_KEY;if(!key)throw new Error('ANTHROPIC_API_KEY is unavailable; no requests made.');const model=process.env.INQUIRY_MODEL || 'claude-sonnet-5-5';
   return async spec=>{const t0=Date.now();const r=await AI.analyze({...spec,provider:'anthropic',model,key,schemaName:'subtext_'+spec.stage,maxTokens:spec.maxTokens});return {...r,elapsedMs:Date.now()-t0};};})()
  : createRequest({backend:'codex',reasoning:'low'});
 // INQUIRY_OBSERVATIONS=1 passes what the product knew about the page (MLCommon.productObservations) into the inquiry, as the extension now does
 require('../extension/common.js'); report.observations=process.env.INQUIRY_OBSERVATIONS==='1' && capture.product ? globalThis.MLCommon.productObservations(capture.product) : [];
 report.backend=backend==='production'?'production:'+(process.env.INQUIRY_MODEL || 'claude-sonnet-5-5'):'codex';
 const request=async spec=>{let r;try{r=await send(spec);}catch(e){report.requests.push({stage:spec.stage,failed:e.message,usage:e.usage||null,cost:e.cost||0});save(dest,report);throw e;}report.requests.push({stage:spec.stage,...r});save(dest,report);return r;}; // failed calls are billed too: count them
 const read=async(link,options)=>{try{const doc=await Sources.read(link,{...options,pageUrl:page.url});report.reads.push({url:link.url,query:options.query,status:'read',doc});return doc;}catch(e){report.reads.push({url:link.url,status:'failed',error:e.message});throw e;}};
 try{report.inquiry=await Inquiry.run({page,records:capture.records || [],observations:report.observations,request,read,forceContext:process.env.INQUIRY_FORCE_CONTEXT==='1',...(process.env.INQUIRY_CONTEXT==='1' && backend==='production'?{contextSearch:async input=>{const AI=require('../extension/ai');const t0=Date.now();try{const r=await AI.contextSearch({...input,item:{...input.item,outlet:capture.product?.outlet?.name || ''},provider:'anthropic',model:process.env.INQUIRY_MODEL || 'claude-sonnet-5-5',key:process.env.ANTHROPIC_API_KEY});report.requests.push({stage:'context',usage:r.usage,cost:r.cost,searches:r.searches,elapsedMs:Date.now()-t0});report.context=r;save(dest,report);return r;}catch(e){report.requests.push({stage:'context',failed:e.message,cost:0});throw e;}}}:{}),discover:async input=>{try{const found=await Sources.discover(input);report.searches.push({input,found});return found;}catch(e){report.searches.push({input,error:e.message});throw e;}},maxChars:40000});}catch(e){report.error=e.message;}
 report.finished=new Date().toISOString();save(dest,report);
 console.log(JSON.stringify({file:dest,id:capture.id,status:report.inquiry?.status,error:report.error,plan:report.inquiry?.plan,reading:report.inquiry?.reading,reads:report.reads.map(r=>({url:r.url,status:r.status,error:r.error}))},null,2));
 return report;
}
async function main(){
 const [mode,a,b,option,selector]=process.argv.slice(2);fs.mkdirSync(OUT,{recursive:true,mode:0o700});
 if(mode==='capture'){
  if(option && (option!=='--post-selector' || !selector))throw new Error('Use --post-selector with a selector for one visible X embed.');
  await capture(a,b,selector);
 }else if(mode==='run')await run(a,b);
 else console.log('node eval/inquiry-real.js capture NAME HTTPS_URL [--post-selector SELECTOR]\nnode eval/inquiry-real.js run CAPTURE_JSON [initial|tuning]');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={capture,run};
