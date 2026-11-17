#!/usr/bin/env node
/* One-pass control for the real-page review (ChatGPT review, 16 Nov 2026): the same page, the same Subtext observations and the same
   documents the staged inquiry retrieved, read in ONE model call through the extension's own transport, then the same screen.
   Separates the gain from better evidence from the gain from extra model calls. Outputs stay in the ignored eval/out-inquiry-real/.
   Usage: ANTHROPIC_API_KEY=... node eval/inquiry-onepass.js <split.json> <half> <staged arm whose documents to reuse> [model] */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const Inquiry=require('../extension/inquiry'),AI=require('../extension/ai');require('../extension/common.js');
const OUT=path.join(__dirname,'out-inquiry-real');
const [splitFile,half,arm,model='claude-haiku-5-5']=process.argv.slice(2);
const key=process.env.ANTHROPIC_API_KEY; if(!key)throw new Error('ANTHROPIC_API_KEY is unavailable; no requests made.');
(async()=>{
  const pages=JSON.parse(fs.readFileSync(splitFile,'utf8')).filter(r=>r.half===half);
  for(const r of pages){
    const cap=JSON.parse(fs.readFileSync(path.join(OUT,r.name+'.json'),'utf8'));
    const re=new RegExp('^'+r.name+'-'+arm+'-\\d+\\.json$');const staged=fs.readdirSync(OUT).filter(f=>re.test(f)).sort().pop();
    const run=staged?JSON.parse(fs.readFileSync(path.join(OUT,staged),'utf8')):{};
    const documents=(run.reads||[]).filter(x=>x.status==='read').map(x=>x.doc).slice(0,2);
    const observations=globalThis.MLCommon.productObservations(cap.product);
    const opts={maxChars:40000,records:cap.records||[],observations,documents};
    const req=Inquiry.baselineRequest(cap.page,opts);
    const report={id:r.name,arm:'onepass',model,stagedRun:staged||null,maxTokens:req.maxTokens,documents:documents.map(d=>d.url),started:new Date().toISOString()};
    const t0=Date.now();
    try{
      const res=await AI.analyze({...req,provider:'anthropic',model,key,schemaName:'subtext_onepass',maxTokens:req.maxTokens});
      report.requests=[{stage:'onepass',usage:res.usage,cost:res.cost,model:res.model,elapsedMs:Date.now()-t0}];
      const packet=Inquiry.makePacket(cap.page,opts); documents.forEach((d,k)=>Inquiry.withDocument(packet,d,k+1));
      report.reading=Inquiry.screen(res.parsed,packet); report.raw=res.parsed; report.status=report.reading?'complete':'unsupported';
    }catch(e){report.error=e.message;report.status='error';}
    report.elapsedMs=Date.now()-t0;
    fs.writeFileSync(path.join(OUT,r.name+'-onepass-'+Date.now()+'.json'),JSON.stringify(report,null,1));
    console.log(r.name,report.status,report.error||'',(report.reading&&report.reading.lead||'').slice(0,100));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
