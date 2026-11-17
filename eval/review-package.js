#!/usr/bin/env node
/* Real-page review package (ChatGPT review, 16 Nov 2026). Puts the arms side by side for every page in the review set:
   the rules-only line, the current Investigate, a one-pass reading with the same evidence, the proposed Investigate, and
   (dev half) the proposed Investigate on Sonnet. Shows each lead with the quotes that support it, plus measured cost and time.
   No scores and no AI verdicts: the reader judges. Writes eval/out-inquiry-real/review-package.html, which is git-ignored and
   holds third-party page text, so it stays on this machine. Usage: node eval/review-package.js */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const OUT=path.join(__dirname,'out-inquiry-real');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const unent=v=>String(v??'').replace(/&(#39|quot|amp|lt|gt|#x27);/g,(m,k)=>({'#39':"'",'#x27':"'",quot:'"',amp:'&',lt:'<',gt:'>'})[k]);
const words=s=>(s||'').trim()?s.trim().split(/\s+/).length:0;
const median=a=>{const s=a.filter(x=>x!=null).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const ARMS=[
  {key:'baseline',title:'Current Investigate',note:'The committed code: plan, read, draft, review. Page text only. Claude Haiku 5.5.'},
  {key:'onepass',title:'One pass, same evidence',note:'One model call with the proposed instructions, the same Subtext facts and the same documents the proposed run read. Claude Haiku 5.5.'},
  {key:'final',title:'Proposed Investigate',note:'Plan with 2-3 candidate points, read, draft, review, with the facts Subtext already had (scoped). Claude Haiku 5.5.'},
  {key:'sonnet',title:'Proposed on Sonnet',note:'The proposed Investigate on Claude Sonnet 5.5, development half only, to compare the inexpensive model.'}
];
const START=['rv-news-cnbc-comcast-q3','rv-opinion-fox-hewitt-senate','rv-recipe-foodnetwork-roast-chicken','rv-sponsored-guardian-cystic-fibrosis','rv-affiliate-cnet-vpn','rv-subscription-nyt-offer','rv-research-sciencedaily-supplement','rv-syndicated-npr-kff-measles','rv-political-ccf-work-requirements','rv-news-cnn-skydance-bundle','rv-opinion-fortune-estate-tax','rv-research-cnn-pelacarsen-trial'];
const STATUS={complete:'Reading shown',unsupported:'No supported reading (the screen rejected the draft)','review-failed':'Review could not finish',insufficient:'Page too thin to read',error:'Error'};

function latest(name,arm){
  const re=new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-'+arm+'-\\d+\\.json$');
  const f=fs.readdirSync(OUT).filter(x=>re.test(x)).sort().pop();
  return f?JSON.parse(fs.readFileSync(path.join(OUT,f),'utf8')):null;
}
function outcome(run,arm){
  if(!run)return null;
  const staged=arm!=='onepass';
  const reading=staged?run.inquiry?.reading:run.reading;
  const status=staged?(run.inquiry?.status||(run.error?'error':'error')):run.status;
  const cost=(run.requests||[]).reduce((s,q)=>s+(q.cost||0),0);
  const ms=staged?(run.inquiry?.elapsedMs ?? (run.finished&&run.started?Date.parse(run.finished)-Date.parse(run.started):null)):run.elapsedMs;
  return {status,error:run.error||'',reading,cost,seconds:ms!=null?ms/1000:null,
    candidates:staged?(run.inquiry?.plan?.candidates||[]):[],
    reads:staged?(run.reads||[]).map(r=>({url:r.url,status:r.status})):(run.documents||[]).map(u=>({url:u,status:'read'})),
    observations:run.observations||[],model:staged?(run.backend||'').replace('production:',''):run.model};
}
function receipts(ev){
  if(!ev||!ev.length)return '';
  return '<ul class="rc">'+ev.map(e=>'<li><span class="src">'+esc(e.label||e.source)+'</span> &ldquo;'+esc(e.quote)+'&rdquo;</li>').join('')+'</ul>';
}
function armCell(o,arm){
  if(!o)return '<div class="arm none"><h4>'+esc(arm.title)+'</h4><p class="muted">Not run on this page.</p></div>';
  const r=o.reading;
  let h='<div class="arm"><h4>'+esc(arm.title)+'</h4><p class="meta">'+esc(STATUS[o.status]||o.status)+(o.error?' &middot; '+esc(o.error):'')+' &middot; $'+o.cost.toFixed(4)+(o.seconds!=null?' &middot; '+o.seconds.toFixed(0)+' s':'')+'</p>';
  if(r&&r.lead){
    h+='<p class="lead">'+esc(r.lead)+' <span class="wc">'+words(r.lead)+' words</span></p>';
    if(r.mechanism)h+='<p><b>How it works:</b> '+esc(r.mechanism)+'</p>';
    if(r.alternative)h+='<p><b>Other reading:</b> '+esc(r.alternative)+'</p>';
    if(r.check)h+='<p><b>To check:</b> '+esc(r.check)+'</p>';
    h+='<details><summary>Quotes behind it ('+(r.evidence||[]).length+')</summary>'+receipts(r.evidence)+'</details>';
    if(r.revisedByReviewer)h+='<p class="muted">The review stage rewrote the draft.</p>';
  }
  if(o.candidates.length)h+='<details><summary>Points it weighed first ('+o.candidates.length+')</summary><ol>'+o.candidates.map(c=>'<li>'+esc(c.insight)+' <span class="muted">(support: '+esc(c.support)+'; easy to miss: '+esc(c.missable)+')</span></li>').join('')+'</ol></details>';
  const read=o.reads.filter(x=>x.status==='read');
  if(read.length)h+='<p class="muted">Read: '+read.map(x=>esc(x.url)).join(', ')+'</p>';
  return h+'</div>';
}
const set=JSON.parse(fs.readFileSync(path.join(OUT,'review-split.json'),'utf8'));
const rows=set.map(p=>{const cap=JSON.parse(fs.readFileSync(path.join(OUT,p.name+'.json'),'utf8'));
  const arms={};for(const a of ARMS)arms[a.key]=outcome(latest(p.name,a.key),a.key);
  return {...p,rules:cap.product?.reading||'',title:unent(cap.title||''),arms};});

function stats(half){
  const rs=rows.filter(r=>r.half===half);
  return ARMS.map(a=>{const os=rs.map(r=>r.arms[a.key]).filter(Boolean);if(!os.length)return null;
    const shown=os.filter(o=>o.status==='complete'&&o.reading);
    return {arm:a.key,pages:os.length,shown:shown.length,meanCost:+(os.reduce((s,o)=>s+o.cost,0)/os.length).toFixed(4),medianSeconds:median(os.map(o=>o.seconds)),
      medianLeadWords:median(shown.map(o=>words(o.reading.lead))),medianLeadPlusHowWords:median(shown.map(o=>words(o.reading.lead)+words(o.reading.mechanism)))};}).filter(Boolean);
}
function summary(half){
  const rs=rows.filter(r=>r.half===half);
  return '<table><thead><tr><th>Arm</th><th>Pages run</th><th>Reading shown</th><th>Other outcomes</th><th>Mean cost per page</th><th>Median time</th><th>Median lead words</th><th>Median lead + how-it-works words</th></tr></thead><tbody>'+
  ARMS.map(a=>{const os=rs.map(r=>r.arms[a.key]).filter(Boolean);if(!os.length)return '';
    const shown=os.filter(o=>o.status==='complete'&&o.reading);
    const other={};os.filter(o=>!(o.status==='complete'&&o.reading)).forEach(o=>{const k=/cut off/.test(o.error)?'answer cut off':(STATUS[o.status]||o.status);other[k]=(other[k]||0)+1;});
    return '<tr><td>'+esc(a.title)+'</td><td>'+os.length+'</td><td>'+shown.length+'</td><td>'+(Object.entries(other).map(([k,v])=>v+' '+esc(k)).join('; ')||'none')+'</td><td>$'+(os.reduce((s,o)=>s+o.cost,0)/os.length).toFixed(4)+'</td><td>'+(median(os.map(o=>o.seconds))??0).toFixed(0)+' s</td><td>'+(median(shown.map(o=>words(o.reading.lead)))??'-')+'</td><td>'+(median(shown.map(o=>words(o.reading.lead)+words(o.reading.mechanism)))??'-')+'</td></tr>';}).join('')+'</tbody></table>';
}
function page(r){
  const o=r.arms.final||r.arms.baseline;
  const obs=(r.arms.final?.observations||[]);
  return '<section id="'+esc(r.name)+'"><h3>'+esc(r.title||r.name)+'</h3><p class="meta">'+esc(r.kind)+' &middot; '+(r.half==='holdout'?'<b>holdout</b>':'development (used while changing the prompts)')+' &middot; <span class="url">'+esc(r.url)+'</span></p>'+
    '<p><b>Why it was picked</b> (note written when the set was built): '+esc(r.why)+'</p>'+
    '<p><b>Rules only, no AI:</b> '+esc(r.rules||'(none)')+'</p>'+
    (obs.length?'<details><summary>Facts Subtext passed to the proposed run ('+obs.length+')</summary><ul>'+obs.map(x=>'<li><span class="src">'+esc(x.label)+'</span> '+esc(x.text)+'</li>').join('')+'</ul></details>':'')+
    '<div class="arms">'+ARMS.map(a=>armCell(r.arms[a.key],a)).join('')+'</div></section>';
}
const byName=Object.fromEntries(rows.map(r=>[r.name,r]));
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Investigate review package</title><style>'+
':root{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a64;--line:#dedbd2;--card:#fff;--acc:#2f5d8a}@media (prefers-color-scheme:dark){:root{--bg:#1a1a18;--fg:#ecebe6;--mut:#a3a199;--line:#3a3935;--card:#232321;--acc:#8db4dc}}'+
'body{background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:1400px;padding:16px}h1{font-size:24px}h2{margin-top:32px;border-bottom:1px solid var(--line)}h3{margin:0 0 4px}section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;margin:16px 0}'+
'.arms{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:10px}.arm{border-top:3px solid var(--line);padding-top:6px}.arm h4{margin:0}.lead{font-weight:600}.wc,.muted,.meta{color:var(--mut);font-size:13px;font-weight:400}.url{word-break:break-all}.src{color:var(--acc);font-size:12px;text-transform:uppercase;letter-spacing:.03em}'+
'table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}ul.rc{padding-left:18px}a{color:var(--acc)}</style></head><body>'+
'<h1>Investigate: current versus proposed, on real pages</h1><p>'+rows.length+' real pages captured on 16 November 2026. Every AI run used the extension\'s own request code against the Anthropic API. Costs use the published prices (Haiku 5.5: $0.10 in, $0.50 out per million tokens; Sonnet 5.5: $2 in, $10 out). Times are wall-clock from this Mac. Nothing here is scored; read the leads and the quotes behind them.</p>'+
'<h2>Arms</h2><ul><li><b>Rules only</b>: the line Subtext shows with no AI.</li>'+ARMS.map(a=>'<li><b>'+esc(a.title)+'</b>: '+esc(a.note)+'</li>').join('')+'</ul>'+
'<h2>Holdout ('+rows.filter(r=>r.half==='holdout').length+' pages)</h2><p class="muted">Not seen while changing the prompts up to the proposed arm\'s first run (16 of 17 shown, $0.0060 a page, median 21 s, median lead 33.5 words). Two later changes came from holdout pages (the retry after a cut-off answer; the support grades and script wording after the Food Network lead), and the rows below are the committed code, so this half is no longer untouched.</p>'+summary('holdout')+
'<h2>Development ('+rows.filter(r=>r.half==='dev').length+' pages)</h2>'+summary('dev')+
'<h2>Start here: 12 pages</h2><ol>'+START.filter(n=>byName[n]).map(n=>'<li><a href="#'+esc(n)+'">'+esc(byName[n].title||n)+'</a> <span class="muted">'+esc(byName[n].kind)+', '+esc(byName[n].half)+'</span></li>').join('')+'</ol>'+
START.filter(n=>byName[n]).map(n=>page(byName[n])).join('')+
'<h2>All other pages</h2>'+rows.filter(r=>!START.includes(r.name)).sort((a,b)=>(a.half===b.half?0:a.half==='holdout'?-1:1)).map(page).join('')+
'</body></html>';
const dest=path.join(OUT,'review-package.html');fs.writeFileSync(dest,html,{mode:0o600});
console.log(dest,rows.length,'pages');
console.log(JSON.stringify({holdout:stats('holdout'),dev:stats('dev')},null,1));
