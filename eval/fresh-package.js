#!/usr/bin/env node
/* Fresh-page comparison page (16 Nov 2026). For every page in eval/out-inquiry-real/fresh-set.json: what a careful reader should
   get from it (written before any run), the rules-only line, and each arm as the reader would see it: lead and further points up
   front, the rest folded, plus the background search record. When eval/out-inquiry-real/judge/notes.json exists (a blind check
   against the written expectation), its notes are shown under each arm with their quotes. No scores: counts of what was found,
   missed or unsupported, each with the page it came from. Local only: the output holds third-party page text and is git-ignored.
   Usage: node eval/fresh-package.js */
'use strict';
const fs=require('node:fs'),path=require('node:path');
const OUT=path.join(__dirname,'out-inquiry-real');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const unent=v=>String(v??'').replace(/&(#39|quot|amp|lt|gt|#x27);/g,(m,k)=>({'#39':"'",'#x27':"'",quot:'"',amp:'&',lt:'<',gt:'>'})[k]);
const words=s=>(s||'').trim()?s.trim().split(/\s+/).length:0;
const median=a=>{const s=a.filter(x=>x!=null).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const ARMS=[
  {key:'sonnet2',title:'Sonnet 5.5, after this review (round 2)',note:'The default after changes made from round 1: owner connections stated, wire copy named, tool words and withdrawn concerns removed. Tuned on these pages.'},
  {key:'sonnetctx',title:'Sonnet 5.5, with background search',note:'The proposed default: plan, optional web search for origin and record, draft, review.'},
  {key:'sonnetforce',title:'Sonnet 5.5, always searching',note:'Same, with the web search forced on every page (evaluation only), to show what searching adds where the planner skipped it.'},
  {key:'sonnetnoctx',title:'Sonnet 5.5, no background search',note:'Same, without the web search, to show what the search adds.'},
  {key:'haikuctx',title:'Haiku 5.5, with background search',note:'The cheapest model on the same pipeline.'},
  {key:'head',title:'Committed version (a2db5c4), Haiku',note:'What was committed before today\'s changes: one point, no search.'}
];
function latest(name,arm){
  const re=new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'-'+arm+'-\\d+\\.json$');
  const f=fs.readdirSync(OUT).filter(x=>re.test(x)).sort().pop();
  return f?JSON.parse(fs.readFileSync(path.join(OUT,f),'utf8')):null;
}
const set=JSON.parse(fs.readFileSync(path.join(OUT,'fresh-set.json'),'utf8'));
const notesFile=path.join(OUT,'judge','notes.json'), keyFile=path.join(OUT,'judge','key.json');
const notes=fs.existsSync(notesFile)?JSON.parse(fs.readFileSync(notesFile,'utf8')):{};
const key=fs.existsSync(keyFile)?JSON.parse(fs.readFileSync(keyFile,'utf8')):{};
const noteFor=(name,arm)=>{const k=key[name]||{};const L=Object.keys(k).find(l=>k[l]===arm);return L&&notes[name]&&notes[name][L];};
const rows=set.map(p=>{const capF=path.join(OUT,p.name+'.json');const cap=fs.existsSync(capF)?JSON.parse(fs.readFileSync(capF,'utf8')):{};
  const arms={};for(const a of ARMS){const run=latest(p.name,a.key);if(!run)continue;const inq=run.inquiry||{};
    arms[a.key]={status:inq.status||(run.error?'error':'none'),error:run.error||'',reading:inq.reading,context:inq.context||run.context&&{items:[],searched:run.context.searched}||null,
      cost:(run.requests||[]).reduce((s,q)=>s+(q.cost||0),0),seconds:inq.elapsedMs!=null?inq.elapsedMs/1000:(run.finished&&run.started?(Date.parse(run.finished)-Date.parse(run.started))/1000:null),
      searched:(run.requests||[]).some(q=>q.stage==='context')};}
  return {...p,title:unent(cap.title||p.name),rules:(cap.product||{}).reading||'',arms};});
const visibleWords=r=>r?words(r.lead)+(r.more||[]).reduce((s,m)=>s+words(m.point),0):0;
function stats(){
  return '<table><thead><tr><th>Arm</th><th>Pages</th><th>Reading shown</th><th>Background search ran</th><th>Mean cost</th><th>Median time</th><th>Median words shown first</th>'+(Object.keys(notes).length?'<th>Expected point found up front</th><th>Only in the fold</th><th>Missed</th><th>Unsupported claims</th><th>Distracting or repeated sentences</th><th>Leads on an absence the capture may have missed</th>':'')+'</tr></thead><tbody>'+
  ARMS.map(a=>{const os=rows.map(r=>({r,o:r.arms[a.key]})).filter(x=>x.o);if(!os.length)return '';const shown=os.filter(x=>x.o.status==='complete'&&x.o.reading);
    let extra='';if(Object.keys(notes).length){const ns=os.map(x=>noteFor(x.r.name,a.key)).filter(Boolean);const c=f=>ns.filter(f).length;const n=k=>ns.reduce((s,x)=>s+((x[k]||[]).length),0);
      extra='<td>'+c(x=>x.expected==='up front')+'</td><td>'+c(x=>x.expected==='fold only')+'</td><td>'+c(x=>x.expected==='missed')+'</td><td>'+n('unsupported')+'</td><td>'+n('distracting')+'</td><td>'+n('absence')+'</td>';}
    return '<tr><td>'+esc(a.title)+'</td><td>'+os.length+'</td><td>'+shown.length+'</td><td>'+os.filter(x=>x.o.searched).length+'</td><td>$'+(os.reduce((s,x)=>s+x.o.cost,0)/os.length).toFixed(4)+'</td><td>'+(median(os.map(x=>x.o.seconds))||0).toFixed(0)+' s</td><td>'+(median(shown.map(x=>visibleWords(x.o.reading)))??'-')+'</td>'+extra+'</tr>';}).join('')+'</tbody></table>';
}
const LABEL={origin:'Earliest version found','also-ran':'Also ran','fact-check':'Fact-check',correction:'Correction',record:'Earlier record','left-out':'Left out of this item'};
function armCell(o,a,name){
  if(!o)return '<div class="arm"><h4>'+esc(a.title)+'</h4><p class="muted">Not run.</p></div>';
  const r=o.reading;let h='<div class="arm"><h4>'+esc(a.title)+'</h4><p class="meta">'+esc(o.status)+(o.error?' · '+esc(o.error):'')+' · $'+o.cost.toFixed(4)+(o.seconds!=null?' · '+o.seconds.toFixed(0)+' s':'')+'</p>';
  if(r&&r.lead){h+='<p class="lead">'+esc(r.lead)+'</p>';if((r.more||[]).length)h+='<ul>'+r.more.map(m=>'<li>'+esc(m.point)+'</li>').join('')+'</ul>';
    h+='<details><summary>On request: how it works, other reading, quotes</summary>'+(r.mechanism?'<p><b>How it works.</b> '+esc(r.mechanism)+'</p>':'')+(r.alternative?'<p><b>Other reading.</b> '+esc(r.alternative)+'</p>':'')+(r.check?'<p><b>To check.</b> '+esc(r.check)+'</p>':'')+
      '<ul class="q">'+(r.evidence||[]).concat(...(r.more||[]).map(m=>m.evidence||[])).map(e=>'<li><span class="src">'+esc(e.label)+'</span> “'+esc(e.quote)+'”'+(e.url?' <span class="url">'+esc(e.url)+'</span>':'')+'</li>').join('')+'</ul></details>';}
  const c=o.context;if(c){h+='<details><summary>Background search: '+((c.items||[]).length?(c.items.length+' item(s)'):'nothing that changes the reading')+'</summary>'+((c.searched||[]).length?'<p class="muted">Searched: '+c.searched.map(esc).join('; ')+'</p>':'')+(c.items||[]).map(i=>'<p><b>'+esc(LABEL[i.kind]||i.kind)+':</b> '+esc(i.summary)+' '+(i.sources||[]).map(s=>'<span class="url">'+esc(s.url)+'</span>'+(s.date?' ('+esc(s.date)+')':'')).join(' ')+'</p>').join('')+'</details>';}
  const n=noteFor(name,a.key);
  if(n){h+='<div class="note"><p><b>Blind check:</b> expected point '+esc(n.expected)+(n.where?' — “'+esc(n.where)+'”':'')+'</p>'+['unsupported','distracting','absence','better'].map(k=>(n[k]||[]).length?'<p><b>'+({unsupported:'Unsupported',distracting:'Distracting or repeated',absence:'Absence the capture may have missed',better:'Found something more consequential'})[k]+':</b> '+n[k].map(x=>'“'+esc(x.quote)+'” '+esc(x.why||'')).join(' · ')+'</p>':'').join('')+'</div>';}
  return h+'</div>';
}
const page=r=>'<section id="'+esc(r.name)+'"><h3>'+esc(r.title)+'</h3><p class="meta">'+esc(r.kind)+' · <span class="url">'+esc(r.url)+'</span></p><p><b>Written before any run:</b> '+esc(r.why)+' <i>Expected: '+esc(r.expect)+'</i></p><p><b>Rules only, no AI:</b> '+esc(r.rules)+'</p><div class="arms">'+ARMS.map(a=>armCell(r.arms[a.key],a,r.name)).join('')+'</div></section>';
const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fresh page comparison</title><style>'+
':root{--bg:#fbfaf7;--fg:#1d1d1b;--mut:#6b6a64;--line:#dedbd2;--card:#fff;--acc:#2f5d8a;--note:#f3efe4}@media (prefers-color-scheme:dark){:root{--bg:#1a1a18;--fg:#ecebe6;--mut:#a3a199;--line:#3a3935;--card:#232321;--acc:#8db4dc;--note:#2c2a24}}'+
'body{background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0 auto;max-width:1500px;padding:16px}section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px;margin:16px 0}h3{margin:0 0 4px}'+
'.arms{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:10px}.arm{border-top:3px solid var(--line);padding-top:6px}.arm h4{margin:0}.lead{font-weight:600}.meta,.muted{color:var(--mut);font-size:13px}.url{word-break:break-all;color:var(--mut);font-size:12px}.src{color:var(--acc);font-size:12px;text-transform:uppercase}'+
'.note{background:var(--note);border-radius:6px;padding:6px 8px;font-size:13px;margin-top:6px}table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}</style></head><body>'+
'<h1>Investigate on fresh pages: four ways compared</h1><p>'+rows.length+' real pages captured on 16 November 2026, none used while changing the prompts. For each page, what a careful reader should get from it was written before any run. Every run used the extension\'s own request code; costs at published prices (Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10 per million tokens, web search $10 per 1,000 searches). The rules layer was corrected after a first capture of these pages (paid labels in side columns, first names, month names, "taxing wealth"); the AI arms were not tuned on them.'+
(Object.keys(notes).length?' Round 2 (a separate blind A/B check of the default before and after the round-1 changes, two AI readers): the new version was preferred on 24 pages, the earlier on 14, the same on 5; distracting or repeated sentences fell from 37 to 26, possibly uncaptured absences from 13 to 10; missed points 8 against 9 and unsupported claims 12 against 10 are within run-to-run noise.' + ' The blind check compared each arm\'s output, under a random letter, with the written expectation and the captured page; it is one AI reader\'s notes with quotes, not a grade.':'')+'</p>'+stats()+rows.map(page).join('')+'</body></html>';
const dest=path.join(OUT,'fresh-package.html');fs.writeFileSync(dest,html,{mode:0o600});console.log(dest,rows.length,'pages');
