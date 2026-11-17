/* Subtext — shared report view. Renders the breakdown (glance strip, source card, AI reading, categories with
   their findings) into any container: the toolbar popup document or the in-page panel's shadow root.
   One renderer, two hosts, so the two surfaces never drift. No chrome.* calls here; hosts pass callbacks in `on`. */
(function (root) {
  const V = {};
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  V.esc = esc;
  // links from AI output and web results are only ever http(s)
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  // a link's text names the site it goes to; a row of links all called "source" tells a screen reader nothing
  const linkSite = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'source'; } };
  // a div that acts as a button: focusable, Enter and Space
  function btnize(el, fn, expandedOf) {
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    const sync = () => { if (expandedOf) el.setAttribute('aria-expanded', String(expandedOf())); }; sync();
    el.addEventListener('click', (ev) => { fn(ev); sync(); });
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.stopPropagation(); fn(ev); sync(); } });
  }
  V.SEV_VAR = (s) => (s >= 3 ? 'var(--sev3)' : s === 2 ? 'var(--sev2)' : s === 1 ? 'var(--sev1)' : 'var(--sev0)');
  // Icons: inline SVG on a 16 px grid, 1.5 px stroke, in the text colour. No emoji and no icon font; hosts reuse these (content/ui.js, popup).
  const ic = (name, body) => '<svg class="ic ic--' + name + '" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' + body + '</svg>';
  const ICON = V.ICON = {
    check: ic('check', '<path d="M3.5 8.5l3 3 6-7"/>'),
    cross: ic('cross', '<path d="M4.5 4.5l7 7m0-7l-7 7"/>'),
    dash: ic('dash', '<path d="M5 8h6"/>'),
    ext: ic('ext', '<path d="M6 3.5h6.5V10M12.5 3.5L4 12"/>'),
    alert: ic('alert', '<circle cx="8" cy="8" r="6.25"/><path d="M8 4.75v3.75M8 11v.25"/>'),
    close: ic('close', '<path d="M4 4l8 8m0-8l-8 8"/>'),
    rescan: ic('rescan', '<path d="M12.33 5.5A5 5 0 1 0 13 8"/><path d="M12.5 2.5v3h-3"/>'),
    settings: ic('settings', '<path d="M2.5 5h5m4 0h2m-11 6h2m4 0h5"/><circle cx="9.5" cy="5" r="1.75"/><circle cx="6.5" cy="11" r="1.75"/>'),
    marks: ic('marks', '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.75" fill="currentColor" stroke="none"/>')
  };
  // Severity is a shape and a colour (docs/UX.md section 5): filled triangle, filled circle, ring, small dot. Never green.
  const SEV_NAME = ['Info', 'Minor', 'Notable', 'Severe'];
  V.sevGlyph = function (sev) {
    const n = sev >= 3 ? 3 : sev === 2 ? 2 : sev === 1 ? 1 : 0;
    const shape = n === 3 ? '<path d="M6 1.6l4.7 8.4H1.3z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' : n === 2 ? '<circle cx="6" cy="6" r="4.4" fill="currentColor"/>' : n === 1 ? '<circle cx="6" cy="6" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/>' : '<circle cx="6" cy="6" r="2" fill="currentColor"/>';
    return '<span class="sevg sevg--' + n + '"><svg viewBox="0 0 12 12" role="img" aria-label="' + SEV_NAME[n] + '" focusable="false">' + shape + '</svg></span>';
  };
  // a quiet key-value row: label, value, and an optional note under the value. `value` and `note` are HTML the caller has escaped.
  const kv = (label, value, note) => '<div class="kvr"><div class="kvr__k">' + esc(label) + '</div><div class="kvr__v">' + value + (note ? '<span class="kv__note">' + note + '</span>' : '') + '</div></div>';

  V.insightStatus = function(state) {
    if (state?.ai?.reading) return 'Reading ready';
    const meta=state?.report?.meta || {};
    return state?.investigation ? 'Source comparison ready' : meta.choiceRead ? 'Offer explained' : meta.postRead ? 'Post explained' : meta.citations?.length ? 'Public record available' : '';
  };
  V.updateAnalyzeButton = function (button, state, { hasKey, provider, estimate, investigation, pending, onCancel }) {
    const progress = state?.aiProgress;
    // a running investigation can be stopped; Escape only closes the panel
    let stop = button.parentNode && button.parentNode.querySelector('.ai-cancel');
    if (onCancel && progress) { if (!stop) { stop = document.createElement('button'); stop.type = 'button'; stop.className = 'ai-cancel'; stop.textContent = 'Cancel'; stop.title = 'Stop this investigation. Requests already sent may still be billed.'; stop.addEventListener('click', () => { stop.disabled = true; stop.textContent = 'Stopping…'; onCancel(); }); button.after(stop); } stop.hidden = false; }
    else if (stop) stop.remove();
    button.disabled = !!(pending || progress);
    let live = button.nextElementSibling;
    if (!live?.classList.contains('ai-progress-announcement')) {
      live = document.createElement('span');
      live.className = 'ai-progress-announcement';
      live.setAttribute('role', 'status');
      button.after(live);
    }
    const message = button.disabled ? progress?.message || 'Analyzing…' : '';
    if (button.disabled) {
      if (live.textContent !== message) {
        live.textContent = message;
        button.innerHTML = '<span class="spinner" aria-hidden="true"></span>' + esc(message);
      }
      return;
    }
    if (live.textContent) live.textContent = '';
    button.textContent = MLCommon.deepAnalyzeLabel(hasKey, !!state?.ai, provider, estimate, investigation);
    button.title = !hasKey ? 'Open AI settings' : investigation === false
      ? 'Send page text and charts to your selected AI provider'
      : 'Investigate this page with your selected AI provider and up to two public sources';
  };
  // heuristic + dataset + AI findings, each with its tier-1 label and tier-2 why, strongest first
  V.composite = function (state, labels) {
    const list = ((state.report && state.report.findings) || []).concat(state.outletFindings || [], (state.ai && state.ai.findings) || []);
    return MLCommon.oneFactEach(list).map((f) => Object.assign({}, f, MLCommon.labelFor(f, labels), { weight: MLCommon.findingWeight(f) })).sort(MLCommon.flagOrder);
  };
  V.catMeta = (c, rules, labels) => Object.assign({ name: c, color: '#777', description: '' }, ((rules && rules.categories) || {})[c] || {}, ((labels && labels.categories) || {})[c] || {});

  // which categories / findings / card folds ("Show the checks", "Show the notes") the user has expanded, so a re-render keeps them open
  V.openState = function (container) {
    return {
      cats: Array.from(container.querySelectorAll('.cat.open')).map((c) => c.dataset.cat),
      findings: Array.from(container.querySelectorAll('.f.open')).map((f) => f.dataset.id),
      folds: Array.from(container.querySelectorAll('.card__more[data-fold][aria-expanded="true"]')).map((b) => b.dataset.fold)
    };
  };
  // a fold button: <button class="card__more" data-fold="checks" data-show="Show the checks" data-hide="Hide the checks"> followed by its .card__fold
  const foldBtn = (key, noun) => '<button type="button" class="card__more" data-fold="' + key + '" data-show="Show the ' + noun + '" data-hide="Hide the ' + noun + '" aria-expanded="false">Show the ' + noun + '</button>';
  function wireFolds(card, open) {
    card.querySelectorAll('.card__more[data-fold]').forEach((btn) => {
      const fold = btn.nextElementSibling; if (!fold || !fold.classList.contains('card__fold')) return;
      const set = (on) => { fold.hidden = !on; btn.textContent = on ? btn.dataset.hide : btn.dataset.show; btn.setAttribute('aria-expanded', String(on)); };
      set(((open && open.folds) || []).includes(btn.dataset.fold));
      btn.addEventListener('click', () => set(fold.hidden));
    });
  }

  /* opts: { state, rules, labels, findings?, on: { locate(elId), hover(finding, entering), openOptions() }, open: openState, hasKey, provider, aiBusy } */
  V.render = function (container, opts) {
    const { state, rules, labels } = opts; const on = opts.on || {};
    const findings = opts.findings || V.composite(state, labels);
    const g = MLCommon.glance(findings, state.report && state.report.meta); // the one list: chips, "+N more" and the category folds all read it
    const open = opts.open || { cats: [], findings: [], folds: [] };
    container.innerHTML = '';
    container.classList.add('report');
    const critical = findings.some(f => (f.id==='source.listed_warning' || /^scam\./.test(f.id)) && f.severity>=2);
    const inquiryStatus = renderInquiryStatus(state); if (inquiryStatus) container.appendChild(inquiryStatus);
    const sourceCheck = renderInvestigation(container, state, open, on);
    if (sourceCheck && !critical && !state.ai?.reading && (state.investigation || !(state.report?.meta?.choiceRead || state.report?.meta?.postRead))) container.appendChild(sourceCheck);
    const reading = renderReading(findings, state, g, open); if (reading) container.appendChild(reading); // a source comparison is shown beside the summary, not instead of it
    if (sourceCheck && !container.contains(sourceCheck)) container.appendChild(sourceCheck);
    let saveBtn = null; // 'Save this page' sits at the end of the report, after the findings
    if(state.report && on.openCasebook) {
      const b=document.createElement('button');b.type='button';b.className='casebook-button';b.textContent='Save this page';
      b.title='Save what this page shows now into your local casebook, to compare with other pages later. Stays in this browser.';
      b.addEventListener('click',async()=>{b.disabled=true;try{const r=await on.openCasebook();if(r?.error)throw new Error(r.error);}catch(e){b.textContent=e.message;}finally{b.disabled=false;}});
      saveBtn=b;
    }
    const glance = renderGlance(g, rules, labels); if (glance) container.appendChild(glance);
    const context = renderContext(state, open, on); if (context) container.appendChild(context);
    const src = renderSource(state, open); if (src) container.appendChild(src);
    const ai = renderAI(state, open); if (ai) container.appendChild(ai);
    renderCategories(container, findings, g, rules, labels, on, open);
    if (saveBtn) container.appendChild(saveBtn);
    if (!findings.length && !state.ai && !state.aiProgress && !state.investigation && !state.report?.meta?.choiceRead && !state.report?.meta?.postRead) { const e = document.createElement('section'); e.className = 'empty'; e.innerHTML = '<p><strong>Nothing detected by Subtext\'s rules.</strong> That is not a clean bill: rules catch common patterns, not all of them. Try <em>Deep analyze</em>.</p>'; container.appendChild(e); }
    container.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    return { findings, glance: g };
  };

  // State per host survives scan re-renders; a slow request on the old route cannot
  // relabel a new page. The worker independently rechecks the link and passage.
  const sourceStatus = new WeakMap();
  function renderInvestigation(container, state, open, on) {
    const cites = state.report?.meta?.citations || [];
    if (!cites.length || !on.compareRecord) return null;
    const box = document.createElement('section'); box.className = 'investigation';
    const r = state.investigation;
    const status = sourceStatus.get(container);
    const current = status && status.route===state.report.url ? status : {};
    if (status && status!==current) sourceStatus.delete(container);
    const target = c=>c.kind==='sec'?'SEC filing':c.kind==='trial'?'trial registration':'study abstract';
    const ev = (label,quote)=>'<blockquote class="reading__quote"><small>'+esc(label)+'</small>'+esc(quote)+'</blockquote>';
    if (r) {
      box.innerHTML = '<div class="investigation__kicker">Source comparison</div><h2>'+esc(r.heading)+'</h2><p class="investigation__lead">'+esc(r.lead)+'</p>'+
        '<button type="button" class="card__more" data-fold="source-comparison" data-show="See the two sides" data-hide="Hide comparison" aria-expanded="false">See the two sides</button><div class="card__fold" hidden>'+
        ev(r.discovery==='related'?'In this article':r.anchor && r.passage!==r.anchor?'Claim near the citation':'Beside the link',r.passage)+r.evidence.map(e=>ev(e.label,e.quote)).join('')+'<p><b>What to check:</b> '+esc(r.check)+'</p></div>'+
        '<a class="investigation__source" href="'+esc(safeUrl(r.url))+'">'+esc(r.title && r.title.length>5?r.title:target(r))+ICON.ext+'</a>';
      if (r.stake && safeUrl(r.stake.source)) {
        box.insertAdjacentHTML('beforeend','<div class="investigation__stake"><button type="button" class="card__more" data-fold="stake" data-show="'+esc(r.stake.title)+'" data-hide="Hide financial interest" aria-expanded="false">'+esc(r.stake.title)+'</button><div class="card__fold" hidden><p>'+esc(r.stake.text)+'</p><p>'+esc(r.stake.limit)+'</p><a href="'+esc(r.stake.source)+'">'+esc(r.stake.label)+ICON.ext+'</a></div></div>');
      }
      wireFolds(box,open);
    } else {
      box.innerHTML = cites[0].discovery==='related'
        ? '<div class="investigation__kicker">Public record</div><h2>A record behind this event</h2><p>Subtext knows a public record for this event: '+esc(cites[0].label)+'.</p>'
        : '<div class="investigation__kicker">Public record</div><h2>What does the source say?</h2>';
    }
    const remaining = cites.filter(c=>c.key!==r?.key);
    let more=null;
    const visible=r?0:1;
    if (remaining.length>visible) {
      more=document.createElement('details');
      more.innerHTML='<summary>'+ (r?'Compare another citation':'Other citations')+' ('+(remaining.length-visible)+')</summary>';
      more.style.marginTop='8px';
    }
    for (const [index,c] of remaining.entries()) {
      const section = document.createElement('div'); section.className='investigation__option';
      section.innerHTML = ev(c.discovery==='related'?'In this article':'Beside the link',c.passage);
      const b=document.createElement('button'); b.type='button'; b.className='investigation__button'; b.dataset.record=c.key;
      const title='Compare '+target(c);
      b.textContent=current.busy===c.key?'Reading the record…':title; b.disabled=!!current.busy;
      b.setAttribute('aria-label',title+(remaining.length>1?' — '+c.label:''));
      b.addEventListener('click',async ev=>{
        if (!ev.isTrusted || sourceStatus.get(container)?.busy) return;
        const mine={route:state.report.url,busy:c.key}; sourceStatus.set(container,mine);
        section.querySelector('[role="status"]')?.remove();
        box.querySelectorAll('.investigation__button').forEach(x=>x.disabled=true); b.textContent='Reading the record…';
        let err;
        try {const res=await on.compareRecord(c.key,state.report.url); if (!res?.ok) err=res?.error || 'No response.';}
        catch (e) {err=e.message || 'The request failed.';}
        if (sourceStatus.get(container)!==mine) return;
        sourceStatus.delete(container);
        const currentBox=container.querySelector('.investigation');
        const active=currentBox && [...currentBox.querySelectorAll('.investigation__button')].find(x=>x.dataset.record===c.key);
        if (active) {
          currentBox.querySelectorAll('.investigation__button').forEach(x=>x.disabled=false); active.textContent=title;
          if (err) {const n=document.createElement('p'); n.setAttribute('role','status'); n.textContent='Could not read this record. '+MLCommon.plainError(err); active.parentElement.appendChild(n);}
        }
      });
      section.appendChild(b);
      if (safeUrl(c.url)) {
        const original=document.createElement('a'); original.href=c.url; original.innerHTML='Open original'+ICON.ext; original.className='investigation__open';
        original.setAttribute('aria-label','Open original '+target(c)+' in a new tab'); section.appendChild(original);
      }
      (index>=visible && more?more:box).appendChild(section);
    }
    if (more) box.appendChild(more);
    if (remaining.length) {
      const small=document.createElement('p'); small.className='investigation__source';
      const hosts=[...new Set(remaining.map(c=>c.kind==='sec'?'SEC.gov':c.kind==='trial'?'ClinicalTrials.gov':'Europe PMC'))];
      small.textContent='Reads the public record from '+hosts.join(' or ')+'. No AI key needed.'; box.appendChild(small);
    }
    return box;
  }

  // what the background search looked for and found, shown as a record beside the reading, never as a verdict on the page
  const CONTEXT_LABEL = { origin: 'Earliest version found', 'also-ran': 'Also ran', 'fact-check': 'Fact-check', correction: 'Correction', record: 'Earlier record', 'left-out': 'Left out of this item' };
  function inquiryContext(inquiry) {
    const c = inquiry && inquiry.context; if (!c) return '';
    const searched = (c.searched || []).length ? ' Searched: ' + c.searched.map((q) => '&ldquo;' + esc(q) + '&rdquo;').join('; ') + '.' : '';
    if (!(c.items || []).length) return '<p class="reading__more"><b>Background checked.</b>' + searched + ' Nothing turned up that changes this reading. That is not a sign the page is right.</p>';
    return '<p class="reading__more"><b>Background found by web search.</b>' + searched + ' Summaries are the AI\'s, from the linked sources.</p><ul class="reading__points">' +
      c.items.map((i) => '<li>' + (/^(the )?earliest version|^(it|this|the item) (also )?ran/i.test(i.summary || '') ? '' : '<b>' + esc(CONTEXT_LABEL[i.kind] || i.kind) + ':</b> ') + esc(i.summary) + ' ' + (i.sources || []).filter((x) => safeUrl(x.url)).map((x) => '<a href="' + esc(x.url) + '">' + esc(linkSite(x.url)) + '</a>' + (x.date ? ' <span class="muted">(' + esc(x.date) + ')</span>' : '')).join(' ') + '</li>').join('') + '</ul>';
  }
  function inquiryGaps(inquiry) {
    return (inquiry?.failures || []).map(failure => {
      if (failure.stage === 'read') {
        const url = safeUrl(failure.url);
        return url ? '<p class="reading__more">Could not read <a href="' + esc(url) + '">' + esc(linkSite(url)) + '</a>.</p>' : '<p class="reading__more">Could not read one source.</p>';
      }
      if (failure.stage === 'context') return '<p class="reading__more">' + esc(failure.reason || 'The background search was unavailable.') + '</p>';
      if (failure.stage === 'search') {
        const message = failure.reason === 'No matching public record found.' ? 'No matching public record was found.' : 'Public record search was unavailable.';
        return '<p class="reading__more">' + message + '</p>';
      }
      return '';
    }).join('');
  }

  function inquiryEvidence(reading) {
    const list=[],index=new Map();
    const refs=es=>(es || []).map(e=>{const key=e.id+'\n'+e.quote+'\n'+(e.url || '');if(!index.has(key)){list.push(e);index.set(key,list.length);}return '['+index.get(key)+']';}).join(' ');
    refs(reading.evidence);
    // each further point lists the receipts behind it, numbered with the rest
    const pointsHtml=(reading.more || []).map(m=>'<p><b>'+esc(m.point)+'</b> <sup>'+refs(m.evidence)+'</sup></p>').join('');
    const b=reading.investigation;
    const brief=b?'<p><b>The key dependency.</b> '+esc(b.hinge.observed)+' '+esc(b.hinge.dependency)+' <sup>'+refs(b.hinge.evidence)+'</sup></p>'+
      b.actors.map(a=>'<p><b>'+esc(a.name)+'.</b> '+esc(a.role)+' <sup>'+refs(a.evidence)+'</sup></p>').join('')+
      '<p><b>Competing explanations.</b></p>'+b.explanations.map(e=>'<p>'+esc(e.account)+' '+esc(e.support)+' <sup>'+refs(e.evidence)+'</sup></p>').join('')+
      '<p><b>What distinguishes them.</b> '+esc(b.discriminator)+'</p>':'';
    return brief+(pointsHtml?'<p><b>The other points and their quotes.</b></p>'+pointsHtml:'')+list.map((e,k)=>'<blockquote class="reading__quote"><small>['+(k+1)+'] '+esc(e.label)+'</small>'+esc(e.quote)+(safeUrl(e.url)?' <a href="'+esc(e.url)+'">'+esc(linkSite(e.url))+'</a>':'')+'</blockquote>').join('');
  }

  function renderInquiryStatus(state) {
    const inquiry = state.ai?.inquiry;
    if (state.aiProgress || !inquiry || state.ai.reading) return null;
    const box = document.createElement('section'); box.className = 'reading'; box.setAttribute('role', 'status');
    const message = {
      insufficient: 'There was too little page evidence to investigate.',
      'review-failed': 'The review step could not finish. There is no conclusion to show.',
      unsupported: 'The evidence did not support a conclusion.'
    }[inquiry.status] || 'There is no conclusion to show.';
    box.innerHTML = '<h2 class="reading__hd">AI inquiry</h2><p class="reading__more">' + esc(message) + '</p>' + inquiryGaps(inquiry);
    return box;
  }

  // A reading has receipts from the exact request. Never promote an unchecked summary to the lead.
  function renderReading(findings, state, g, open) {
    if (!state.report) return null;
    const box = document.createElement('section'); box.className = 'reading';
    const a = state.ai && state.ai.reading;
    if (a) {
      const inquiry = !!state.ai.inquiry;
      const limit = a.alternative || a.limit;
      const limitLine = limit ? '<p class="reading__more"><b>What this leaves open.</b> ' + esc(limit) + '</p>' : '';
      const checkLine = a.check ? '<p class="reading__more"><b>What to check.</b> ' + esc(a.check) + '</p>' : '';
      box.innerHTML = '<h2 class="reading__hd">' + (a.kind === 'straightforward' ? 'What this says' : 'A likely reading') + '</h2><p class="reading__t">' + esc(a.lead) + '</p>' +
        ((a.more || []).length ? '<ul class="reading__points">' + a.more.map((m) => '<li>' + esc(m.point) + '</li>').join('') + '</ul>' : '') +
        (!inquiry && a.mechanism ? '<p class="reading__more">' + esc(a.mechanism) + '</p>' : '') +
        '<button type="button" class="card__more" data-fold="evidence" data-show="Why this reading?" data-hide="Hide evidence" aria-expanded="false">Why this reading?</button><div class="card__fold" hidden>' +
        (inquiry && a.mechanism ? '<p><b>How it works.</b> ' + esc(a.mechanism) + '</p>' : '') + (inquiry ? checkLine : '') +
        (a.question ? '<p><b>Question examined.</b> ' + esc(a.question) + '</p>' : '') +
        inquiryEvidence(a) +
        (inquiry ? limitLine + inquiryContext(state.ai.inquiry) + inquiryGaps(state.ai.inquiry) : limitLine + checkLine) + '</div>' + (() => { const rr = MLCommon.reading(findings, state); return rr && rr.text ? '<button type="button" class="card__more card__more--gap" data-fold="plain" data-show="What the page shows, without AI" data-hide="Hide" aria-expanded="false">What the page shows, without AI</button><div class="card__fold" hidden><p>' + esc(rr.text) + '</p></div>' : ''; })() + '<div class="reading__src">' + (inquiry ? (a.revisedByReviewer ? 'AI inquiry · rewritten by the reviewing pass; its quotes and names were checked against the evidence.' : 'AI inquiry · reviewed by a second pass; its quotes and names were checked against the evidence.') : 'AI reading · based on the supplied page and context.') + '</div>';
      wireFolds(box, open);
      return box;
    }
    // the rules' summary line always stays visible: an offer, post or record reading is added to it, never put in its place
    const ruleLine = () => { const rr = MLCommon.reading(findings, state); return rr && rr.text ? '<p class="reading__more"><b>What\'s going on.</b> ' + esc(rr.text) + '</p>' : ''; };
    const choice = state.report.meta && (state.report.meta.choiceRead || state.report.meta.postRead);
    if (choice && !findings.some(f=>(f.id==='source.listed_warning' || /^scam\./.test(f.id)) && f.severity>=2)) {
      box.innerHTML='<h2 class="reading__hd">'+esc(choice.heading)+'</h2><p class="reading__t">'+esc(choice.lead)+'</p>'+ruleLine()+
        '<button type="button" class="card__more" data-fold="choice-terms" data-show="See the evidence" data-hide="Hide evidence" aria-expanded="false">See the evidence</button><div class="card__fold" hidden>'+
        choice.evidence.map(e=>'<blockquote class="reading__quote"><small>'+esc(e.label)+'</small>'+esc(e.quote)+'</blockquote>').join('')+'<p>'+esc(choice.check)+'</p></div>';
      wireFolds(box,open); return box;
    }
    const records = state.report.meta && state.report.meta.claimRecords;
    if (records && records.length && !findings.some(f => (f.id === 'source.listed_warning' || /^scam\./.test(f.id)) && f.severity >= 2)) {
      box.innerHTML = '<h2 class="reading__hd">Behind this claim</h2>' + recordLinks(records) + ruleLine() + '<div class="reading__src">Dated records for the quoted forecast.</div>';
      return box;
    }
    const r = MLCommon.reading(findings, state);
    if (!r || !r.text) return null;
    // one short lead, the remaining clauses one click away: the top of the report never reads as a list
    const clauses = String(r.text).replace(/\.$/, '').split('; '); let lead = clauses[0], used = 1;
    while (used < clauses.length && (lead + '; ' + clauses[used]).split(/\s+/).length <= 30) { lead += '; ' + clauses[used]; used++; }
    const rest = clauses.slice(used);
    const caption = state.ai?.inquiry ? 'Page observations.' : state.ai ? 'Page observations. No supported AI reading to show.' : 'Page observations. Investigate (optional AI) interprets the argument and incentives.';
    box.innerHTML = '<h2 class="reading__hd">What\'s going on</h2><p class="reading__t">' + esc(lead) + (rest.length ? '' : '.') + '</p>' + (rest.length ? '<button type="button" class="card__more" data-fold="reading" data-show="More" data-hide="Less" aria-expanded="false">More</button><div class="card__fold" hidden><p class="reading__more">' + esc(rest.join('; ').replace(/^./, (c) => c.toUpperCase())) + '.</p></div>' : '') + '<div class="reading__src">' + (r.concern === true && g.count > 0 ? 'Some of these also appear on honest small sellers. ' : '') + caption + '</div>';
    wireFolds(box, open);
    return box;
  }
  // Tier 1 + 2: at most five chips, at most two per category, each with its one-line why
  function renderGlance(g, rules, labels) {
    const perCat = {}; const top = [];
    const inSourceCard = new Set(['source.unknown_operator', 'source.thin_shop', 'source.named_operator']); // the Who is behind card says these; one place, not two
    for (const f of g.flags) { if (inSourceCard.has(f.id)) continue; perCat[f.category] = (perCat[f.category] || 0) + 1; if (perCat[f.category] > 2) continue; top.push(f); if (top.length >= 5) break; }
    if (!top.length) return null;
    const box = document.createElement('section'); box.className = 'glance';
    const h = document.createElement('h2'); h.className = 'glance__hd'; h.textContent = 'What to know'; box.appendChild(h);
    for (const f of top) {
      const m = V.catMeta(f.category, rules, labels);
      const row = document.createElement('div'); row.className = 'sig'; row.dataset.id = f.id;
      // severity as a shape, the label, the category in quiet text (it used to be an emoji), then the reason on its own line
      row.innerHTML = V.sevGlyph(f.severity) + '<span class="sig__label">' + esc(f.label) + '</span><span class="sig__cat">' + esc(m.short || m.name) + '</span><span class="sig__why">' + esc(f.why) + '</span>';
      btnize(row, () => V.openFinding(box.parentNode, f.id));
      box.appendChild(row);
    }
    const rest = g.count - top.length;
    if (rest) { const more = document.createElement('div'); more.className = 'glance__more'; more.textContent = '+ ' + rest + ' more below'; box.appendChild(more); }
    return box;
  }
  V.openFinding = function (container, id) {
    const el = container.querySelector('.f[data-id="' + CSS.escape(id) + '"]'); if (!el) return;
    el.closest('.cat').classList.add('open'); el.classList.add('open'); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* ---------- context from public data: one question, one chart or dated list, a few dated facts ----------
     Shapes: docs/CONTEXT-CONTRACT.md. Everything is drawn from numbers coerced here and strings escaped here, never from markup.
     - Placed by date, not by position in the list: a period that is absent leaves an empty slot, `v: null` breaks the line and
       leaves no bar. A zero bar is a 2-unit stub on the baseline, so "zero" and "no value" look different.
     - Zero baseline for every unit: counts, money, an index and a percent alike. Subtext flags truncated axes on other sites,
       so its own chart must pass that check; a small change on a large level then looks small, which is what it is. The sentence
       above the chart carries the exact comparison. A negative value (a net loss) draws below the zero line.
     - The SVG holds marks only and stretches to the column (preserveAspectRatio none, non-scaling strokes). Every label is HTML
       outside the plot: the unit above, the reference mark's label in its own strip, two values in a gutter on the right
       (the latest, and one other: the highest, or the lowest when the latest is the highest), two dates below. So no label can
       touch a mark or another label at any panel width, and text is never stretched.
     - Ink only: no severity colour and no green on a chart. aria-label repeats the sentence; the values are a table in the fold. */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const RES = ['day', 'week', 'month', 'quarter', 'year', 'cycle'];
  // 'YYYY', 'YYYY-MM', 'YYYY-MM-DD' (and 'YYYY-Qn') -> the start of that period in UTC, or null
  function parseT(t) {
    const s = String(t == null ? '' : t).trim(); let m = /^(\d{4})-Q([1-4])$/.exec(s);
    if (m) return { ms: Date.UTC(+m[1], (+m[2] - 1) * 3, 1), grain: 'quarter' };
    m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s); if (!m) return null;
    const y = +m[1], mo = m[2] ? +m[2] : 1, d = m[3] ? +m[3] : 1;
    if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { ms: Date.UTC(y, mo - 1, d), grain: m[3] ? 'day' : m[2] ? 'month' : 'year' };
  }
  function addPeriod(ms, res) {
    if (res === 'day') return ms + 864e5; if (res === 'week') return ms + 7 * 864e5;
    const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (res === 'month' ? 1 : res === 'quarter' ? 3 : res === 'cycle' ? 24 : 12), d.getUTCDate());
  }
  function fmtDate(ms, grain) { const d = new Date(ms); const y = d.getUTCFullYear(); return grain === 'year' || grain === 'cycle' ? String(y) : grain === 'quarter' ? 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1) + ' ' + y : grain === 'month' ? MON[d.getUTCMonth()] + ' ' + y : d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + y; }
  // the ways a source's own sentence or note may already name a period ("Oct 2025", "October 2025", "Q3 2026", "third quarter of 2026")
  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function dateNames(ms, grain) {
    const d = new Date(ms); const y = d.getUTCFullYear(), mo = d.getUTCMonth(); const out = [fmtDate(ms, grain)];
    if (grain === 'month') out.push(MONTH[mo] + ' ' + y);
    else if (grain === 'quarter') out.push(['first', 'second', 'third', 'fourth'][Math.floor(mo / 3)] + ' quarter of ' + y);
    else if (grain === 'day' || grain === 'week') out.push(d.getUTCDate() + ' ' + MONTH[mo] + ' ' + y);
    return out;
  }
  const dateLabel = (t) => { const p = parseT(t); return p ? fmtDate(p.ms, p.grain) : String(t == null ? '' : t); };
  const trimNum = (x, d) => String(Number(x.toFixed(d)));
  // a value as the gutter prints it: "$3.1M", "−$4.6M", "4.4%", "296k"
  function fmtValue(v, unit) {
    const u = String(unit || ''); const a = Math.abs(v);
    const money = /dollar|usd|\$/i.test(u), pct = /percent|%/i.test(u);
    // a percent always prints one decimal (3.7 never becomes 4) and a second one when the figure has it (a 3.75% policy rate, a 6.23% mortgage rate):
    // the same rule as the statistics source's own sentence (context-stats.js `pc`), so the label and the sentence agree. Small money prints cents.
    const s = a >= 999.5e6 ? trimNum(a / 1e9, 1) + 'B' : a >= 999.5e3 ? trimNum(a / 1e6, 1) + 'M' : a >= 99950 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? trimNum(a / 1e3, 1) + 'k' : pct ? a.toFixed(a < 10 && Math.abs(a * 10 - Math.round(a * 10)) > 1e-9 ? 2 : 1) : money && a < 100 ? a.toFixed(2) : trimNum(a, a < 10 ? 2 : 1);
    return (v < 0 ? '\u2212' : '') + (money ? '$' : '') + s + (pct ? '%' : '');
  }
  const num2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : 0);
  // the geometry both the SVG and the HTML labels read: x in 0..1000 by date, y in 0..100 with zero always inside
  function chartModel(chart) {
    const raw = [];
    for (const p of (chart && chart.points) || []) {
      const t = parseT(p && p.t); if (!t) continue;
      const v = p.v == null || p.v === '' ? null : Number(p.v);
      raw.push({ ms: t.ms, grain: t.grain, v: Number.isFinite(v) ? v : null });
    }
    raw.sort((a, b) => a.ms - b.ms);
    const pts = raw.filter((p, i) => i === raw.length - 1 || raw[i + 1].ms !== p.ms);
    const live = pts.filter((p) => p.v != null);
    if (live.length < 2) return null;
    let res = RES.includes(chart.resolution) ? chart.resolution : pts[0].grain;
    if (!RES.includes(chart.resolution) && res === 'day') { const gaps = pts.slice(1).map((p, i) => p.ms - pts[i].ms).sort((a, b) => a - b); const med = gaps[gaps.length >> 1]; if (med >= 6 * 864e5 && med <= 8 * 864e5) res = 'week'; }
    for (const p of pts) p.end = addPeriod(p.ms, res);
    const x0 = pts[0].ms, x1 = pts[pts.length - 1].end; if (!(x1 > x0)) return null;
    let lo = 0, hi = 0; for (const p of live) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; } if (hi === lo) hi = lo + 1;
    const top = 8, bot = lo < 0 ? 8 : 1.5;
    const X = (ms) => (1000 * (ms - x0)) / (x1 - x0), Y = (v) => top + ((hi - v) / (hi - lo)) * (100 - top - bot);
    const kind = chart.kind === 'bars' || chart.kind === 'steps' ? chart.kind : 'line';
    const end = live[live.length - 1];
    // one other value beside the latest: the highest, or the lowest when the latest is the highest. Dropped when the two labels would touch.
    const rest = live.slice(0, -1); let maxP = rest[0], minP = rest[0]; for (const p of rest) { if (p.v > maxP.v) maxP = p; if (p.v < minP.v) minP = p; }
    const labelY = (v) => Math.min(93, Math.max(8, Y(v))); const clear = (p) => Math.abs(labelY(p.v) - labelY(end.v)) >= 16;
    const other = maxP.v > end.v && clear(maxP) ? maxP : minP.v < end.v && clear(minP) ? minP : null;
    // periods inside the window with no value: listed under the chart when the note does not already name them
    const gaps = []; const have = new Set(live.map((p) => p.ms));
    for (let t = x0, i = 0; t < end.ms && i < 600; t = addPeriod(t, res), i++) if (!have.has(t) && !live.some((p) => Math.abs(p.ms - t) < (addPeriod(t, res) - t) / 2)) gaps.push(t);
    let mark = null; const mt = chart.mark && parseT(chart.mark.t);
    if (mt) {
      // a day is placed on that day; a month or a year is placed at the middle of the chart period that holds it (the centre of its bar)
      const holder = mt.grain === 'day' ? null : pts.find((p) => mt.ms >= p.ms && mt.ms < p.end);
      const at = holder ? (holder.ms + holder.end) / 2 : (mt.ms + addPeriod(mt.ms, mt.grain)) / 2; if (at >= x0 && at <= x1) mark = { x: X(at), label: String(chart.mark.label == null ? '' : chart.mark.label), date: fmtDate(mt.ms, mt.grain) };
    }
    return { kind, res, pts, live, end, other, gaps, mark, X, Y, labelY, y0: Y(0), xMid: (p) => X((p.ms + p.end) / 2), endX: kind === 'steps' ? X(end.end) : X((end.ms + end.end) / 2) };
  }
  // The marks. A pure string function (test/context-data.js runs it in Node): '' when fewer than two values can be drawn,
  // one <rect> per bar and no other <rect>, no NaN in the output.
  V.chartSvg = function (chart) {
    const m = chartModel(chart); if (!m) return '';
    const stroke = ' fill="none" stroke="currentColor" vector-effect="non-scaling-stroke"';
    let marks = '';
    if (m.kind === 'bars') {
      const wide = m.pts.length > 45 ? 0.84 : 0.7;
      for (const p of m.pts) {
        if (p.v == null) continue;
        const slot = m.X(p.end) - m.X(p.ms); const w = Math.min(slot, Math.max(slot * wide, 2)); const h = Math.max(Math.abs(m.Y(p.v) - m.y0), 2);
        marks += '<rect class="cx-bar' + (p === m.end ? ' cx-bar--end' : '') + '" x="' + num2(m.X(p.ms) + (slot - w) / 2) + '" y="' + num2(p.v < 0 ? m.y0 : m.y0 - h) + '" width="' + num2(w) + '" height="' + num2(h) + '" fill="currentColor"/>';
      }
    } else {
      // runs of neighbouring values; a null or an absent period ends the run. A step holds its value for its own period.
      const runs = []; let run = null;
      for (const p of m.pts) {
        if (p.v == null) { run = null; continue; }
        if (run && p.ms > run[run.length - 1].end + (p.end - p.ms) / 2) run = null;
        if (!run) { run = []; runs.push(run); } run.push(p);
      }
      let d = '', dots = '';
      for (const r of runs) {
        if (m.kind === 'steps') r.forEach((p, i) => { d += (i ? 'V' + num2(m.Y(p.v)) : 'M' + num2(m.X(p.ms)) + ' ' + num2(m.Y(p.v))) + 'H' + num2(m.X(r[i + 1] ? r[i + 1].ms : p.end)); });
        else if (r.length === 1) dots += 'M' + num2(m.xMid(r[0])) + ' ' + num2(m.Y(r[0].v)) + 'h0';
        else d += r.map((p, i) => (i ? 'L' : 'M') + num2(m.xMid(p)) + ' ' + num2(m.Y(p.v))).join('');
      }
      marks = (d ? '<path class="cx-line" d="' + d + '"' + stroke + ' stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>' : '') +
        (dots ? '<path class="cx-pt" d="' + dots + '"' + stroke + ' stroke-width="4.5" stroke-linecap="round"/>' : '');
    }
    return '<svg class="ctx__svg" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" focusable="false" aria-label="' + esc(chart.sentence || chart.title) + '">' +
      (m.other ? '<path class="cx-grid" d="M0 ' + num2(m.Y(m.other.v)) + 'H1000"' + stroke + ' stroke-width="1"/>' : '') + marks +
      '<path class="cx-zero" d="M0 ' + num2(m.y0) + 'H1000"' + stroke + ' stroke-width="1"/>' +
      (m.mark ? '<path class="cx-rule" d="M' + num2(m.mark.x) + ' 0V100"' + stroke + ' stroke-width="1"/>' : '') + '</svg>';
  };
  // The figure: unit, mark label, plot with its two values, first and last date. Positions travel as data-* numbers and are
  // applied through the CSSOM by placeCharts, so no inline style attribute is needed (a page's style-src cannot break the layout).
  function chartFigure(chart) {
    const m = chartModel(chart); if (!m) return '';
    const unit = String(chart.unit || '').trim();
    const unitLine = (unit ? unit.charAt(0).toUpperCase() + unit.slice(1) : '') + (chart.nominal ? (unit ? ', not' : 'Not') + ' adjusted for inflation' : '');
    const pos = (o) => Object.keys(o).map((k) => ' data-' + k + '="' + num2(o[k]) + '"').join('');
    const val = (p, cls) => '<span class="cx__val ' + cls + '"' + pos({ top: m.labelY(p.v) }) + '>' + esc(fmtValue(p.v, unit)) + '</span>';
    const left = m.mark && m.mark.x < 500;
    // The gutter column is as wide as its labels: hidden copies of both labels size it (max-content), the visible ones are placed by value.
    const labels = (m.other ? val(m.other, 'cx__val--ref') : '') + val(m.end, 'cx__val--end');
    const sizer = (m.other ? '<span class="cx__size">' + esc(fmtValue(m.other.v, unit)) + '</span>' : '') + '<span class="cx__size cx__size--end">' + esc(fmtValue(m.end.v, unit)) + '</span>';
    return '<figure class="cx">' + (unitLine ? '<figcaption class="cx__unit">' + esc(unitLine) + '</figcaption>' : '') +
      (m.mark && m.mark.label ? '<div class="cx__strip"><span class="cx__mark' + (left ? '' : ' cx__mark--r') + '"' + pos(left ? { left: m.mark.x / 10, max: 100 - m.mark.x / 10 } : { right: 100 - m.mark.x / 10, max: m.mark.x / 10 }) + ' title="' + esc(m.mark.label + ', ' + m.mark.date) + '">' + esc(m.mark.label.charAt(0).toUpperCase() + m.mark.label.slice(1)) + '</span></div>' : '') +
      '<div class="cx__plot">' + V.chartSvg(chart) + (m.kind === 'bars' ? '' : '<i class="cx__dot" aria-hidden="true"' + pos({ left: m.endX / 10, top: m.Y(m.end.v) }) + '></i>') + '</div>' +
      '<div class="cx__gutter" aria-hidden="true">' + labels + sizer + '</div>' +
      '<div class="cx__axis" aria-hidden="true"><span>' + esc(fmtDate(m.pts[0].ms, m.res)) + '</span><span>' + esc(fmtDate(m.pts[m.pts.length - 1].ms, m.res)) + '</span></div></figure>';
  }
  V.chartFigure = chartFigure; V.fmtValue = fmtValue; V.chartModel = chartModel;
  V.placeCharts = function (rootEl) {
    rootEl.querySelectorAll('.cx [data-top], .cx [data-left], .cx [data-right]').forEach((el) => {
      const d = el.dataset; const pct = (k) => (d[k] != null && Number.isFinite(Number(d[k])) ? Number(d[k]) + '%' : '');
      if (d.top != null) el.style.top = pct('top'); if (d.left != null) el.style.left = pct('left'); if (d.right != null) el.style.right = pct('right'); if (d.max != null) el.style.maxWidth = pct('max');
    });
  };
  const BASIS = { records: 'Public records', statistic: 'Official statistics', coverage: 'Coverage of this story', topic: 'Attention to the subject', site: 'Attention to this site' };
  const link = (url, text) => (safeUrl(url) ? '<a href="' + esc(safeUrl(url)) + '">' + esc(text) + '</a>' : esc(text));
  // periods with no value, in words, unless the source's own note already names each of them
  function gapLine(c) {
    const m = chartModel(c); if (!m || !m.gaps.length) return '';
    const names = m.gaps.map((t) => fmtDate(t, m.res)); const said = String(c.note || '') + ' ' + String(c.sentence || '');
    if (m.gaps.every((t) => dateNames(t, m.res).some((n) => said.includes(n)))) return '';
    return names.length <= 4 ? 'No value for ' + (names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0]) + '.' : names.length + ' periods in this window have no value.';
  }
  function chartBlock(c, r, primary) {
    const name = (c.source && c.source.name) || (safeUrl(c.source && c.source.url) ? linkSite(c.source.url) : '');
    const about = c.about || (c.basis === 'site' ? 'site' : ''); const article = !r.group || r.group === 'news' || r.group === 'evergreen';
    const who = String(about === 'page' ? '' : c.aboutLabel || (about === 'subject' && r.subject && r.subject.label) || '');
    const whoShown = who && !String(c.title || '').toLowerCase().includes(who.toLowerCase()); // the title usually names it already
    const rows = (c.rows || []).filter((x) => x && (x.text || x.t)).slice(0, 6);
    const gap = c.kind === 'list' ? '' : gapLine(c);
    return '<div class="ctx__chart' + (primary ? '' : ' ctx__chart--more') + '">' +
      (BASIS[c.basis] || whoShown ? '<div class="ctx__basis">' + (BASIS[c.basis] ? '<span class="tag">' + BASIS[c.basis] + '</span>' : '') + (whoShown ? '<span class="ctx__who">' + esc(who) + '</span>' : '') + '</div>' : '') +
      (about === 'site' ? '<p class="ctx__about">About the site, not this page.</p>' : '') +
      '<div class="ctx__title">' + esc(c.title) + '</div><p class="ctx__sentence">' + esc(c.sentence) + '</p>' +
      (c.kind === 'list' ? '' : chartFigure(c)) +
      (rows.length && c.rowsLabel ? '<div class="ctx__rowshd">' + esc(c.rowsLabel) + '</div>' : '') +
      (rows.length ? '<ul class="ctx__rows">' + rows.map((x) => '<li><time>' + esc(dateLabel(x.t)) + '</time><span>' + link(x.url, x.text || '') + '</span></li>').join('') + '</ul>' : '') +
      '<p class="ctx__src">' + (name ? 'Source: ' + link(c.source && c.source.url, name) + '. ' : '') + (c.note ? esc(c.note) : '') + (gap ? ' ' + gap : '') + '</p></div>';
  }
  function valuesTable(x) {
    const full = (v) => (v == null || !Number.isFinite(Number(v)) ? 'no value' : Number(v).toLocaleString('en-US').replace('-', '\u2212'));
    const m = chartModel(x); const rows = m ? m.pts.map((p) => [fmtDate(p.ms, m.res), full(p.v)]) : (x.points || []).map((p) => [String(p.t), full(p.v)]);
    return rows.length ? '<details class="ctx__values"><summary>Values: ' + esc(x.title) + '</summary><div class="ctx__vals">' + rows.map((r) => '<span><span>' + esc(r[0]) + '</span><span>' + esc(r[1]) + '</span></span>').join('') + '</div></details>' : '';
  }
  function renderContext(st, open, on) {
    if (!st.report || (!st.context && !on.loadContext)) return null;
    const c = st.context; const box = document.createElement('section'); box.className = 'ctx';
    const kicker = '<h2 class="ctx__kicker">Context from public data</h2>';
    if (!c || c.status === 'error' || c.status === 'stale') {
      box.innerHTML = kicker + (c && c.status === 'error' ? '<p class="status status--err" role="status">' + ICON.alert + '<span>Could not load context: ' + esc(c.error || 'no response') + '</span></p>' : '') +
        '<p class="ctx__lead">Look up public records and official statistics about what this page is about: filings, a statistic the page names, coverage of the story.</p>' +
        '<button type="button" class="ctx__button">Show context</button><p class="ctx__small">Free public sources (IRS and SEC filings, statistical agencies, Google News, Wikipedia and others). No AI key needed. Sends an identifier, a name or a few headline words, never the page address; "What was looked up" lists each request.</p>';
      const b = box.querySelector('.ctx__button');
      const idle = () => { b.disabled = false; b.textContent = 'Show context'; };
      if (on.loadContext) b.addEventListener('click', async (ev) => { if (!ev.isTrusted) return; b.disabled = true; b.innerHTML = '<span class="spinner" aria-hidden="true"></span>Looking up…'; try { const r = await on.loadContext(); if (r && r.error) idle(); } catch (e) { idle(); } });
      else b.remove();
      return box;
    }
    if (c.status === 'busy') {
      box.innerHTML = kicker + '<p class="status" role="status"><span class="spinner" aria-hidden="true"></span><span>Looking up public data for this page…</span></p>' +
        '<div class="sk" aria-hidden="true"><i class="sk__l sk__l--s"></i><i class="sk__l"></i><i class="sk__l sk__l--m"></i><i class="sk__plot"></i><i class="sk__l sk__l--s"></i></div>';
      return box;
    }
    // `charts` may lead (records, statistics, real coverage); `other` holds ordinary attention charts, which never lead and stay folded
    const r = c.result || {}; const charts = (r.charts || []).filter(Boolean); const other = (r.other || []).filter(Boolean); const facts = (r.facts || []).filter(Boolean);
    let h = kicker;
    // a source that fits the page but could not answer (a daily limit, a missing key) is said up front, not left in the lookup list
    const blocked = !charts.length ? (r.ran || []).filter((x) => x && !x.ok && x.error && !/budget|stopped/i.test(x.error))[0] : null;
    if (charts.length) h += chartBlock(charts[0], r, true);
    else if (other.length) h += '<p class="ctx__lead ctx__empty"><b>No public record or official statistic was found for this page\'s subject' + (r.subject && r.subject.label ? ', ' + esc(r.subject.label) : '') + '.</b> Attention data is folded below; it shows interest, not what the records say.</p>';
    if (blocked) h += '<p class="ctx__lead" role="status"><b>' + esc(blocked.label || 'One source') + ' could not be read.</b> ' + esc(blocked.error) + '</p>';
    if (charts.length) { /* the lead is shown above */ }
    else if (!other.length) h += '<p class="ctx__lead ctx__empty">' + (r.subject === null ? '<b>Nothing to show for this page.</b> No public record or data series matched what the page is about. Subtext shows no chart rather than one about something else.'
      : r.subject && r.subject.label ? 'No chart for ' + esc(r.subject.label) + ': none of the sources that fit it had enough data.' : 'No chart for this page: none of the sources that fit it had enough data.') + '</p>';
    if (facts.length) h += '<div class="kvs ctx__facts">' + facts.map((f) => { const links = (f.links || []).filter((l) => l && safeUrl(l.url)).slice(0, 5); return kv(f.label, esc(f.text) + (links.length ? '<span class="kv__links">' + links.map((l) => link(l.url, l.text)).join(' · ') + '</span>' : ''), f.note ? esc(f.note) : ''); }).join('') + '</div>';
    const more = charts.length - 1; const moreLabel = more + ' more chart' + (more > 1 ? 's' : '');
    if (more > 0) h += '<button type="button" class="card__more" data-fold="ctx-charts" data-show="' + moreLabel + '" data-hide="Hide the other charts" aria-expanded="false">' + moreLabel + '</button><div class="card__fold" hidden>' + charts.slice(1).map((x) => chartBlock(x, r, false)).join('') + '</div>';
    if (other.length) h += '<button type="button" class="card__more" data-fold="ctx-other" data-show="Attention data (' + other.length + ')" data-hide="Hide attention data" aria-expanded="false">Attention data (' + other.length + ')</button><div class="card__fold" hidden>' + other.map((x) => chartBlock(x, r, false)).join('') + '</div>';
    const ran = (r.ran || []).filter(Boolean); const byId = {}; for (const x of charts.concat(other)) if (x.id) byId[x.id] = x;
    const outcome = (x) => (x.ok ? (x.chart ? (byId[x.id] && byId[x.id].kind === 'list' ? 'List' : 'Chart') : 'Found') : x.error ? 'Failed' : 'Not enough data');
    const at = String(r.at || '').slice(0, 16).replace('T', ' ');
    const summary = [['Page type', r.group || 'page'], r.subject && r.subject.label ? ['Subject', r.subject.label + (r.subject.kind ? ' (' + r.subject.kind + ')' : '')] : null, r.terms && r.terms.keyword ? ['Topic words', '"' + r.terms.keyword + '"'] : null, ['Requests', String(r.requests || 0)], at ? ['Looked up', at + ' UTC'] : null].filter(Boolean);
    h += '<button type="button" class="card__more" data-fold="ctx-sent" data-show="What was looked up" data-hide="Hide what was looked up" aria-expanded="false">What was looked up</button><div class="card__fold" hidden>' +
      '<div class="kvs kvs--tight">' + summary.map((s) => kv(s[0], esc(s[1]))).join('') + '</div>' +
      (ran.length ? '<ul class="ran">' + ran.map((x) => '<li><div class="ran__top"><span class="ran__name">' + esc(x.label || x.id) + '</span><span class="tag">' + outcome(x) + '</span></div>' +
        (byId[x.id] && byId[x.id].question ? '<div class="ran__line">Question: ' + esc(byId[x.id].question) + '</div>' : '') +
        '<div class="ran__line">' + (x.sends ? 'Sent ' + esc(x.sends) + '.' : '') + (!x.ok && x.error ? ' The request failed: ' + esc(x.error) + '.' : '') + '</div></li>').join('') + '</ul>' : '') +
      charts.concat(other).map(valuesTable).join('') +
      '<p class="muted">Each source is shown as it reported. A chart or a list here is context; it says nothing on whether this page is right.</p></div>';
    box.innerHTML = h; V.placeCharts(box); wireFolds(box, open);
    return box;
  }

  // what the public records say: owner and ad sellers, each with where it came from, so a reader can check it
  function recordLinks(records) {
    return (records || []).filter(r => r && safeUrl(r.source)).map(r => '<p>' + esc(r.text.replace(/[.]$/, '')) + '. <a href="' + esc(r.source) + '">' + esc(linkSite(r.source)) + '</a></p>').join('');
  }
  function recordsHtml(st) {
    const rows = []; const host = st.report.hostname.replace(/^www\./, ''); const f = MLCommon.ownerFacts(st, st.report.hostname); const r = st.owner && st.owner.row;
    const peSame = st.buyout && st.buyout.firm && f && f.text && f.text.includes(st.buyout.firm); // the private-equity line below says the same, with more
    if (f && f.text && !st.outlet && !peSame) rows.push(kv(f.operator ? 'Run by' : 'Owner', esc((f.operator ? f.operator : f.text).replace(/^./, (c) => c.toUpperCase())) + '.', 'Source: ' + (r && r.q && f.via === 'Wikidata' ? '<a href="https://www.wikidata.org/wiki/' + esc(r.q) + '">Wikidata</a>' + (r.as_of ? ', checked ' + esc(r.as_of) : '') : (f.url ? '<a href="' + esc(f.url) + '">' + esc(f.via) + '</a>' : esc(f.via || 'public record')) + (f.asOf && f.via !== 'Wikidata' ? ', ' + esc(f.asOf) : '')) + '. ' + (r && !r.source && f.via === 'Wikidata' ? 'Public wiki data, often out of date after a sale; check before relying on it.' : 'This record can be out of date.')));
    const op = st.operator; if (op && op.name && !st.outlet && !(f && f.operator)) rows.push(kv('Run by', esc(op.name) + '.', 'Source: the sellers.json files of the ad exchanges that pay it (' + op.count + (op.count === 1 ? ' listing' : ' listings') + ', fetched ' + esc(op.built || '') + '). The company that runs the site day to day; its owner may be a parent company.'));
    const b = st.buyout; // a lead from Wikidata, shown as one and never in the summary line
    if (b && b.firm) rows.push(kv('Private equity', esc(b.firm) + ', a private equity firm, is listed as its top owner' + (b.year ? ' since ' + esc(b.year) : '') + '.', 'Source: ' + (b.q ? '<a href="https://www.wikidata.org/wiki/' + esc(b.q) + '">Wikidata</a>' : 'Wikidata') + (b.year ? '' : ', with no date') + '; not yet checked against an announcement of the deal. Studies of other buyouts find effects that differ by industry, for example on prices, staff and service.'));
    const a = st.adsTxt;
    if (a && a.records) rows.push(kv('Ad space', (a.managerName ? esc(a.managerName) + ' sells its ads. ' : '') + 'Its ads.txt lists ' + a.records + ' selling record' + (a.records > 1 ? 's' : '') + ' across ' + a.systems + ' ad system' + (a.systems > 1 ? 's' : '') + ': ' + a.direct + ' direct, ' + a.reseller + ' through resellers.', 'This says the site sells ad space, not that this page shows ads. <a href="https://' + esc(MLCommon.registrableDomain(host)) + '/ads.txt">Open the file</a>'));
    return rows.join('');
  }
  // the card's tag: a severity glyph beside the words, never a coloured fill; severity 0 carries no glyph
  const kindTag = (sev, html) => '<span class="kind sev' + sev + '">' + (sev > 0 ? V.sevGlyph(sev) : '') + html + '</span>';
  function renderSource(st, open) {
    if (!st.report) return null;
    const host = st.report.hostname.replace(/^www\./, '');
    const card = document.createElement('section'); card.className = 'card';
    if (st.outlet) {
      const e = st.outlet.entry; const kinds = st.outlet.kinds || {}; const primary = e.owners[0]; const k = kinds[primary.kind] || { name: primary.kind, severity: 1, why: '' };
      // Ownership earns prominence only when it connects to this item: the article names an owner, funder or owner business, or an
      // AI reading relied on the ownership record. Otherwise one quiet line, with the details folded (a recipe does not inherit its publisher's owner).
      const meta = st.report.meta || {}; const mentions = meta.ownerLinks || (meta.ownerMentions || []).map((m) => ({ via: 'named', label: m, why: 'This page names ' + m + ', named in the outlet\'s ownership or funding record.' }));
      // the reading's own points count too: an owner point the AI found must not sit above a card saying no link was found
      const usedByReading = !!(st.ai && st.ai.reading && (st.ai.reading.evidence || []).concat(...(st.ai.reading.more || []).map((m) => m.evidence || [])).some((r) => r.source === 'context' && /owner|outlet record/i.test(String(r.label || '') + ' ' + String(r.quote || ''))));
      const relevant = mentions.length > 0 || usedByReading;
      const sev = e.type === 'satire' || !relevant ? 0 : k.severity;
      const ownerShort = String(primary.name || '').split(/[,(;→]/)[0].trim();
      const details = kv('Ownership', e.owners.map((o) => esc(o.name)).join(' · ')) + kv('Funding', esc((e.funding || []).join(', ')));
      const lean = e.lean && e.lean !== 'n/a' ? kv('Commonly rated', esc(e.lean.replace('-', ' ')), 'Summary of third-party raters; check them below.') : '';
      const confidence = kv('Dataset confidence', esc(e.confidence), (e.sources || []).map((src) => '<a href="' + esc(src) + '">' + esc(linkSite(src)) + '</a>').join(' · '));
      const lookups = '<div class="chips">' + MLCommon.raterLinks(e.name, host).map((l) => '<a class="chip chip--link" href="' + esc(l.url) + '">' + esc(l.label) + '</a>').join('') + '</div>';
      const whyHere = mentions.length ? '<p><b>Possible connection to the owner:</b> ' + mentions.map((l) => esc(l.why) + (l.source ? ' <a href="' + esc(l.source) + '">' + esc(linkSite(l.source)) + '</a>' : '')).join(' ') + '</p>' : '';
      if (!relevant) {
        card.innerHTML = '<h3>' + esc(e.name) + '</h3><p>Owned by ' + esc(ownerShort) + '. <span class="muted">Subtext\'s checks found no link between this page and its owner\'s listed businesses, causes or wealth.</span></p>' + foldBtn('outlet', 'ownership and funding') +
          '<div class="card__fold" hidden>' + details + lean +
          ((e.funders || []).length ? kv('Named funders', e.funders.map((f) => esc(f.name) + (f.what ? ' (' + esc(f.what) + ')' : '')).join(' · ')) : '') + recordsHtml(st) +
          confidence + renderDossier(st) + lookups + '</div>';
        wireFolds(card, open);
        return card;
      }
      card.innerHTML = '<h3>' + esc(e.name) + ' ' + kindTag(sev, esc(k.name)) + '</h3>' + whyHere +
        '<p class="muted">' + esc(k.why) + (e.notes ? ' ' + esc(e.notes) : '') + '</p>' + details + lean +
        ((e.funders || []).length ? kv('Named funders', e.funders.map((f) => esc(f.name) + (f.what ? ' (' + esc(f.what) + ')' : '') + (f.source ? ' <a href="' + esc(f.source) + '">' + esc(linkSite(f.source)) + '</a>' : '')).join(' · ')) : '') +
        recordsHtml(st) + confidence + recordLinks(Object.values(MLCommon.outletContext(e, st.report.url))) +
        renderDossier(st) + lookups;
      wireFolds(card, open);
      return card;
    }
    const P = st.report.provenance;
    if (P && P.institution) {
      card.innerHTML = '<h3>Who is behind ' + esc(host) + '? <span class="kind sev0">institution</span></h3><p>' + esc(P.institution.replace(/^./, (c) => c.toUpperCase())) + '.' + (P.rdap && P.rdap.registrar ? ' Registrar: ' + esc(P.rdap.registrar) + '.' : '') + '</p><p class="muted">The domain registry, not this page, establishes that. What the page itself shows is behind "Show the checks".</p>' +
        foldBtn('checks', 'checks') + '<div class="card__fold" hidden>' + renderChecklist(P) + '</div>';
      wireFolds(card, open);
      return card;
    }
    if (P || (st.report.meta && st.report.meta.isArticle)) {
      const named = P ? operatorOf(P) : null; const sig = (P && P.signals) || [];
      const badge = !P ? 'not checked' : named ? 'named on page' : 'not named';
      const tone = named || !P ? 0 : sig.some((x) => x.severity >= 2) ? 2 : sig.some((x) => x.severity >= 1) ? 1 : 0;
      card.innerHTML = '<h3>Who is behind ' + esc(host) + '? ' + kindTag(tone, badge) + '</h3>' +
        recordsHtml(st) + '<p>' + esc(P ? sourceLine(P, named) : 'Not in the ownership dataset.') + '</p>' +
        foldBtn('checks', 'checks') +
        '<div class="card__fold" hidden>' + (P ? renderChecklist(P) : '') + '<div class="chk__grp">One-click lookups</div><div class="chips">' + MLCommon.raterLinks('', host).map((l) => '<a class="chip chip--link" href="' + esc(l.url) + '">' + esc(l.label) + '</a>').join('') + '</div></div>';
      wireFolds(card, open);
      return card;
    }
    return null;
  }
  // Who the page names, or null. An address says where, a registration number says which file: neither is a name, and the badge and sentence both read only this.
  function operatorOf(P) {
    const legal = P.entity || P.orgSchema || P.parent; if (legal) return { name: legal, via: P.entity && P.entityVia ? P.entityVia : '' };
    return (P.identity || P.namedOperator) && P.copyright ? { name: P.copyright, via: '', copyrightOnly: !P.copyrightEntity } : null;
  }
  // what the fold's checklist shows, in a clause: the same fields as renderChecklist's Pages and Reach them rows, so the sentence cannot disagree with it
  function pageFacts(P) {
    const pages = [P.pages.privacy && 'a privacy policy', P.pages.terms && 'terms', P.pages.imprint && 'a legal notice'].filter(Boolean);
    const contact = (P.emails && P.emails.length) || P.phone || P.pages.contact;
    const items = pages.concat(contact ? ['a contact route'] : []);
    const list = items.length > 1 ? items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1] : items[0];
    return pages.length ? 'It links ' + list + '.' : items.length ? 'No legal pages found here, but it has a contact route.' : 'No legal pages or contact route found here.';
  }
  function sourceLine(P, named) {
    const sig = (P.signals || []).slice().sort((a, b) => b.severity - a.severity);
    if (named) {
      const who = named.via ? 'Its ' + named.via + ' page names ' : named.copyrightOnly ? 'The copyright line names ' : 'The page names ';
      const failed = sig.filter((x) => x.severity >= 1 && x.id !== 'named_only').map((x) => x.short);
      return 'Not in the ownership dataset. ' + who + String(named.name).replace(/[.,\s]+$/, '') + '. ' + pageFacts(P) + (failed.length ? ' Also: ' + failed.join(', ') + '.' : '');
    }
    const why = sig.filter((x) => x.id !== 'platform').map((x) => x.short);
    if (P.address && !why.length) return 'Gives an address but no company name on this page.';
    return why.length ? 'Does not say who runs it: ' + why.join(', ') + '.' : 'Does not say who runs it on this page.';
  }
  // insider notes from the opt-in web check: one line, the sourced items folded
  function renderDossier(st) {
    const w = st.ai && st.ai.web; if (!w || (!(w.funding || []).length && !(w.practices || []).length)) return '';
    const consumer = (w.practices || []).filter((x) => ['cancellation', 'pricing', 'data'].includes(x.kind));
    const line = consumer.length ? consumer[0].claim : (w.funding[0] || w.practices[0]).claim;
    const row = (x, tag) => '<div class="chk chk--na"><span class="chk__i">' + ICON.dash + '</span><span class="chk__t">' + esc(x.claim) + ' <span class="muted">' + esc(tag) + ' · ' + (safeUrl(x.url) ? '<a href="' + esc(safeUrl(x.url)) + '">' + esc(x.site) + '</a>' : esc(x.site)) + (x.quote ? ': “' + esc(String(x.quote).slice(0, 140)) + '”' : '') + '</span></span></div>';
    return kv('Insider notes', esc(line), w.cached ? 'Cached.' : '') +
      foldBtn('notes', 'notes') + '<div class="card__fold" hidden>' +
      ((w.funding || []).length ? '<div class="chk__grp">Funding</div>' + w.funding.map((x) => row(x, 'funding')).join('') : '') +
      ((w.practices || []).length ? '<div class="chk__grp">Documented practices</div>' + w.practices.map((x) => row(x, x.kind)).join('') : '') +
      '<p class="muted">Collected by the AI web check from the linked sources; read them. Not a verdict on the outlet.</p></div>';
  }
  // the provenance checklist: each row states what was found or not found, never a verdict
  function renderChecklist(P) {
    const row = (ok, label, note) => '<div class="chk ' + (ok === null ? 'chk--na' : ok ? 'chk--ok' : 'chk--no') + '"><span class="chk__i">' + (ok === null ? ICON.dash : ok ? ICON.check : ICON.cross) + '<span class="vh">' + (ok === null ? 'Not checked: ' : ok ? 'Found: ' : 'Not found: ') + '</span></span><span class="chk__t">' + esc(label) + (note ? ' <span class="muted">' + esc(note) + '</span>' : '') + '</span></div>';
    let h = '<div class="chk__grp">Pages</div>';
    h += row(P.pages.privacy, 'Privacy policy') + row(P.pages.terms, 'Terms') + row(P.pages.imprint, 'Legal notice / imprint') + row(P.pages.about, 'About') + row(P.pages.contact, 'Contact') + (P.pages.corrections ? row(true, 'Corrections / standards') : '');
    h += '<div class="chk__grp">Who</div>';
    h += row(!!P.address, 'Postal address', P.address || 'none found') + row(!!(P.entity || P.registration || P.orgSchema), 'Legal entity / registration number', P.entity || P.registration || P.orgSchema || 'none found') +
      row(P.copyright ? P.copyrightEntity : false, 'Copyright holder', P.copyright ? '© ' + P.copyright + (P.copyrightEntity ? '' : ' (not a legal entity)') : 'no copyright line') + row(!!P.author, 'Named author');
    h += '<div class="chk__grp">Reach them</div>';
    const em = P.emails && P.emails.length ? (P.webmailOnly ? row(false, 'Email', P.emails[0] + ' (free webmail)') : row(true, 'Email', P.emails[0])) : row(false, 'Email', 'none on the page');
    h += em + row(!!P.phone, 'Phone') + (P.contactForm ? row(null, 'Contact form', 'a form, no address') : '');
    if (P.platform) h += '<div class="chk__grp">Hosting</div>' + row(null, 'Free platform', P.platform + ' (the account holder is the publisher)');
    h += '<div class="chk__grp">Registration record</div>';
    const r = P.rdap;
    if (!r) h += row(null, 'Not looked up', 'turn on the registration lookup in Settings (sends only the domain to the registry)');
    else if (r.error) h += row(null, 'Could not read the record', 'the registry did not answer; try again later');
    else if (r.notFound) h += row(null, 'No public record', 'this registry publishes none for ' + (r.domain || 'the domain'));
    else h += row(r.ageDays != null ? r.ageDays >= 730 : null, 'Registered', r.registered ? r.registered.slice(0, 10) + (r.ageDays != null ? ' (' + ageText(r.ageDays) + ' ago)' : '') : 'date not published') + row(r.registrantUnknown ? null : !r.redacted, 'Registrant', r.registrant || (r.registrantUnknown ? 'not published by this registry' : 'redacted / privacy service (the default for most registrars)')) + (r.registrar ? row(null, 'Registrar', r.registrar) : '');
    h += '<p class="muted chk__note">Found means a link or line exists on this page, not that it was verified. Not found means not found here: footers behind cookie walls or in other languages can hide it.</p>';
    return h;
  }
  function ageText(days) { if (days < 60) return days + ' days'; if (days < 730) return Math.round(days / 30) + ' months'; return (days / 365).toFixed(1).replace(/\.0$/, '') + ' years'; }

  function renderAI(st, open) {
    if (!st.ai) return null; const a = st.ai;
    const box = document.createElement('section'); box.className = 'ai';
    const details = recordLinks((a.records || []).filter(r => !st.outlet || !Object.values(MLCommon.outletContext(st.outlet.entry, st.report.url)).some(o => o && o.source === r.source))) +
      (a.businessType ? '<p><b>Type of business: ' + esc(a.businessType.name) + '.</b> ' + esc(a.businessType.earns) + ' ' + esc(a.businessType.insider) + ' <span class="muted">About this kind of business, not this page. ' + a.businessType.sources.map((u) => '<a href="' + esc(u) + '">' + esc(linkSite(u)) + '</a>').join(' ') + '</span></p>' : '') + (a.dropped ? '<p class="muted">' + a.dropped + ' AI finding' + (a.dropped === 1 ? '' : 's') + ' dropped: the quote is not on this page.</p>' : '') + (a.web ? '<p><b>Online:</b> ' + esc(a.web.summary) + (a.web.items && a.web.items.length ? ' <span class="muted">(' + a.web.items.length + ' sources, under Source, ownership &amp; funding)</span>' : '') + '</p>' : a.webError ? '<p class="muted">Web check failed: ' + esc(a.webError) + '</p>' : '') + '<p class="muted">' + (a.inquiry ? '' : a.findings.length + ' AI findings · ') + esc(a.provider === 'openai' ? 'ChatGPT' : 'Claude') + ' · ' + esc(a.model) + ' · ' + ((a.usage && a.usage.input) || 0) + ' in / ' + ((a.usage && a.usage.output) || 0) + ' out tokens · ≈ $' + (a.cost || 0).toFixed(3) + '</p>';
    // one line first: cost and model are detail, folded until asked for
    box.innerHTML = '<button type="button" class="card__more" data-fold="aidetails" data-show="Analysis details · about $' + (a.cost || 0).toFixed(3) + '" data-hide="Hide analysis details" aria-expanded="false">Analysis details · about $' + (a.cost || 0).toFixed(3) + '</button><div class="card__fold" hidden>' + details + '</div>';
    wireFolds(box, open);
    return box;
  }

  function renderCategories(wrap, findings, g, rules, labels, on, open) {
    // information-only findings (severity 0) never sit under a warning heading or count toward it: one fold at the end
    const info = findings.filter((f) => f.severity <= 0);
    const byCat = {}; for (const f of g.flags) (byCat[f.category] = byCat[f.category] || []).push(f);
    const order = Object.keys(byCat); // the order of the one list: the category holding the strongest flag first
    for (const cat of order) {
      const meta = V.catMeta(cat, rules, labels); const list = byCat[cat];
      const el = document.createElement('section'); el.className = 'cat' + (open.cats.includes(cat) ? ' open' : ''); el.dataset.cat = cat;
      // the row leads with the strongest severity found in the category: a mark that means something, where a colour swatch and an emoji used to be
      el.innerHTML = '<div class="cat__hd">' + V.sevGlyph(Math.max.apply(null, list.map((f) => f.severity))) + '<span class="cat__name">' + esc(meta.short || meta.name) + '</span><span class="cat__count">' + list.length + '</span></div>' +
        '<div class="cat__body"><div class="cat__desc">' + esc(meta.description) + '</div></div>';
      btnize(el.querySelector('.cat__hd'), () => el.classList.toggle('open'), () => el.classList.contains('open'));
      const body = el.querySelector('.cat__body'); for (const f of list) body.appendChild(renderFinding(f, rules, on, open.findings.includes(f.id)));
      wrap.appendChild(el);
    }
    if (info.length) {
      const el = document.createElement('section'); el.className = 'cat cat--info' + (open.cats.includes('__info') ? ' open' : ''); el.dataset.cat = '__info';
      el.innerHTML = '<div class="cat__hd">' + V.sevGlyph(0) + '<span class="cat__name">Also noticed</span><span class="cat__count">' + info.length + '</span></div><div class="cat__body"><div class="cat__desc">Facts about this page that are not warnings.</div></div>';
      btnize(el.querySelector('.cat__hd'), () => el.classList.toggle('open'), () => el.classList.contains('open'));
      const body = el.querySelector('.cat__body'); for (const f of info) body.appendChild(renderFinding(f, rules, on, open.findings.includes(f.id)));
      wrap.appendChild(el);
    }
  }

  function renderFinding(f, rules, on, isOpen) {
    const d = document.createElement('div'); d.className = 'f' + (isOpen ? ' open' : ''); d.dataset.id = f.id;
    const tag = f.source && f.source !== 'heuristic' ? '<span class="tag ' + esc(f.source) + '">' + esc(f.source) + '</span>' : '';
    d.innerHTML = '<div class="f__hd">' + V.sevGlyph(f.severity) + '<span class="f__name"><b>' + esc(f.label) + '</b>' + (f.why ? ' <span class="f__why">' + esc(f.why) + '</span>' : '') + '</span><span class="f__meta">' + tag + (f.count > 1 ? '<span class="f__count">×' + f.count + '</span>' : '') + '</span></div><div class="f__body"></div>';
    const body = d.querySelector('.f__body');
    let html = '<p class="f__tech">' + esc(f.name) + '</p><p>' + esc(f.explain) + '</p>';
    if (f.mechanism) html += '<p class="lbl">Mechanism</p><p>' + esc(f.mechanism) + '</p>';
    const biases = (rules && rules.biases) || {};
    if (f.biases && f.biases.length) html += '<p class="lbl">Why it works on you</p>' + f.biases.map((b) => { const g = biases[b]; return g ? '<div class="bias"><b>' + esc(g.name) + '.</b> ' + esc(g.description) + '</div>' : ''; }).join('');
    if (f.tip) html += '<p class="lbl">What to do</p><p>' + esc(f.tip) + '</p>';
    if (f.evidence && f.evidence.length) {
      html += '<p class="lbl">Evidence' + (f.evidence.some((e) => e.elId) ? ' <span class="lbl__note">(click to locate on page)</span>' : '') + '</p>';
      html += f.evidence.map((e) => { let q = esc(e.quote); if (e.match) { const m = esc(e.match); q = q.split(m).join('<mark>' + m + '</mark>'); } return '<span class="q' + (e.elId ? '' : ' noel') + '" data-el="' + esc(e.elId || '') + '">' + q + (safeUrl(e.url) ? ' <a class="q__src" href="' + esc(safeUrl(e.url)) + '">' + esc(linkSite(e.url)) + '</a>' : '') + '</span>'; }).join('');
    }
    body.innerHTML = html;
    btnize(d.querySelector('.f__hd'), () => d.classList.toggle('open'), () => d.classList.contains('open'));
    if (f.severity > 0 && (on.feedback || on.muteRule)) {
      const act = document.createElement('div'); act.className = 'f__act';
      if (on.feedback) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Not accurate'; b.title = 'Saved only on this device. Nobody else sees it.'; b.addEventListener('click', (ev) => { ev.stopPropagation(); on.feedback(f); b.textContent = 'Noted'; b.disabled = true; }); act.appendChild(b); }
      if (on.muteRule && !/^ai\./.test(f.id)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = "Don't flag this again"; b.addEventListener('click', (ev) => { ev.stopPropagation(); on.muteRule(f); }); act.appendChild(b); }
      body.appendChild(act);
    }
    body.querySelectorAll('.q[data-el]').forEach((q) => { if (q.dataset.el) { q.tabIndex = 0; q.setAttribute('role', 'button'); q.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && on.locate) { ev.preventDefault(); on.locate(q.dataset.el, f); } }); } });
    body.querySelectorAll('.q[data-el]').forEach((q) => q.addEventListener('click', (ev) => { if (ev.target.classList.contains('q__src')) return; const id = q.dataset.el; if (id && on.locate) on.locate(id, f); }));
    if (on.hover && f.evidence && f.evidence.some((e) => e.elId)) { d.addEventListener('mouseenter', () => on.hover(f, true)); d.addEventListener('mouseleave', () => on.hover(f, false)); }
    return d;
  }

  /* Styles shared by both hosts. `:root` applies in the popup document, `:host` inside the panel's shadow root.
     One system: three type sizes (12 meta, 13 body, 15 lead), two weights (400, 600), spacing steps 4/8/12/16/24, flat sections
     divided by one hairline, radius 6 for controls and wells and 4 for tags. Severity colour appears only on a finding's glyph.
     No url() anywhere (a page's img-src policy would block it): icons are inline SVG, chevrons are CSS borders. No CSS nesting
     and no color-mix(): the floor is Chrome 110. */
  V.CSS = `
:root, :host { --bg: #ffffff; --card: #f5f6f8; --line: #e4e7eb; --line2: #c5cbd3; --fg: #16181d; --fg2: #48515e; --muted: #636d7a; --accent: #1c5d99; --fill: #1c5d99; --fill-hover: #174f83; --ai: #1c5d99; --ai-btn: #1c5d99; --sev3: #cf3a3a; --sev2: #c96a0b; --sev1: #a47d00; --sev0: #7d8794; --err: #cf3a3a; --hl: rgba(201,106,11,0.2); }
/* --accent is text on the background (light on dark in dark mode); --fill is a background under white text, so it stays deep in both schemes */
@media (prefers-color-scheme: dark) { :root, :host { --bg: #16181c; --card: #1e2126; --line: #2b2f36; --line2: #434955; --fg: #eef0f3; --fg2: #b7bec8; --muted: #939ca8; --accent: #8cbcf0; --fill: #25629e; --fill-hover: #2c70b3; --ai: #8cbcf0; --ai-btn: #25629e; --sev3: #f0736e; --sev2: #f0a04b; --sev1: #dcb93c; --sev0: #8d97a3; --err: #f0736e; --hl: rgba(240,160,75,0.26); } }
.report, .report * { box-sizing: border-box; }
.report { font: 13px/19px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--fg); text-align: left; font-variant-numeric: tabular-nums; overflow-wrap: break-word; container: report / inline-size; }
.report p { margin: 0 0 8px; } .report p:last-child { margin-bottom: 0; }
.report b, .report strong { font-weight: 600; }
.report h2, .report h3 { margin: 0; font-size: 13px; line-height: 19px; font-weight: 600; }
.report a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 2px; }
.report .muted { color: var(--fg2); font-size: 12px; line-height: 17px; }
.report svg { flex: none; }
.vh, .ai-progress-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.report :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* sections: flat, one hairline between them, one header style */
.report > section { margin: 0; padding: 16px 0; border-top: 1px solid var(--line); }
.report > section:first-child, .report > .notice + section { border-top: 0; padding-top: 12px; }
.report .reading__hd, .report .glance__hd, .report .ctx__kicker, .investigation__kicker, .chk__grp, .f__body .lbl, .ctx__rowshd { margin: 0 0 6px; font-size: 12px; line-height: 17px; font-weight: 600; color: var(--fg2); text-transform: none; letter-spacing: 0; }

/* tags */
.kind, .tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 4px; background: var(--card); color: var(--fg2); font-size: 12px; line-height: 16px; font-weight: 400; white-space: nowrap; }
.kind { color: var(--fg); }
.sevg { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 19px; flex: none; color: var(--sev0); }
.sevg svg { width: 12px; height: 12px; display: block; }
.sevg--3 { color: var(--sev3); } .sevg--2 { color: var(--sev2); } .sevg--1 { color: var(--sev1); }
.kind .sevg { width: 12px; height: 12px; }
.ic { width: 16px; height: 16px; display: inline-block; vertical-align: -3px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ic--ext { width: 12px; height: 12px; vertical-align: -1px; margin-left: 2px; }

/* buttons: secondary by default, quiet for disclosures; the one primary button lives in the host's toolbar */
.ctx__button, .investigation__button, .casebook-button, .f__act button, .ai-cancel { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 28px; padding: 4px 12px; border: 1px solid var(--line2); border-radius: 6px; background: var(--bg); color: var(--fg); font: inherit; font-weight: 600; line-height: 18px; text-decoration: none; cursor: pointer; }
.ctx__button:hover, .investigation__button:hover, .casebook-button:hover, .f__act button:hover:not(:disabled), .ai-cancel:hover { background: var(--card); border-color: var(--muted); }
.ctx__button:disabled, .investigation__button:disabled, .casebook-button:disabled, .f__act button:disabled { color: var(--fg2); cursor: default; }
.f__act button { min-height: 24px; padding: 2px 8px; font-size: 12px; font-weight: 400; }
.casebook-button { margin: 16px 0 4px; }
.ai-cancel { margin-left: 8px; }
.card__more, .ctx__values > summary, .investigation details > summary { display: flex; align-items: center; gap: 6px; width: fit-content; max-width: 100%; min-height: 24px; margin: 8px 0 0 -6px; padding: 3px 8px 3px 6px; border: 0; border-radius: 6px; background: transparent; color: var(--fg2); font: inherit; font-size: 12px; line-height: 17px; font-weight: 600; text-align: left; text-decoration: none; cursor: pointer; list-style: none; }
.ctx__values > summary::-webkit-details-marker, .investigation details > summary::-webkit-details-marker { display: none; }
.card__more::before, .ctx__values > summary::before, .investigation details > summary::before, .cat__hd::before, .f__hd::after, .tip__more::before { content: ''; flex: none; width: 6px; height: 6px; margin: 0 4px 0 2px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 0.12s; }
.card__more[aria-expanded="true"]::before, .ctx__values[open] > summary::before, .investigation details[open] > summary::before, .cat.open > .cat__hd::before, .f.open > .f__hd::after, .tip__more[aria-expanded="true"]::before { transform: translateY(-2px) rotate(45deg); }
.card__more:hover, .ctx__values > summary:hover, .investigation details > summary:hover { background: var(--card); color: var(--fg); }
.card__more--gap { margin-left: -6px; }
.card__fold { margin: 6px 0 4px 3px; padding: 2px 0 2px 12px; border-left: 2px solid var(--line); }
.card__fold > :first-child { margin-top: 0; }

/* the reading: the lead of the report */
.reading__t { margin: 0; font-size: 15px; line-height: 21px; font-weight: 600; }
.reading__points { margin: 8px 0 0; padding-left: 18px; }
.reading__points li { margin: 4px 0; }
.report .reading__more { margin: 8px 0 0; }
.report .card__fold > .reading__more { margin: 0 0 8px; }
.reading__src { margin-top: 8px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.reading__quote, .q { display: block; margin: 0 0 6px; padding: 8px 10px; border: 0; border-radius: 6px; background: var(--card); overflow-wrap: anywhere; }
.reading__quote { margin: 8px 0; }
.reading__quote small { display: block; margin-bottom: 2px; color: var(--fg2); font-size: 12px; line-height: 17px; font-weight: 600; }

/* what to know: severity glyph, label, category, reason */
.sig { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 8px; align-items: start; margin: 0 -8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.sig:hover, .cat__hd:hover, .f__hd:hover { background: var(--card); }
.sig__label { font-weight: 600; }
.sig__cat { color: var(--muted); font-size: 12px; white-space: nowrap; }
.sig__why { grid-column: 2 / -1; color: var(--fg2); }
.glance__more { padding: 4px 0 0 24px; color: var(--fg2); font-size: 12px; line-height: 17px; }

/* source card */
.card h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin: 0 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 0 14px; margin-top: 2px; }
.report a.chip { display: inline-flex; align-items: center; min-height: 24px; font-size: 12px; line-height: 16px; text-decoration: none; }
.report a.chip:hover { text-decoration: underline; }
.chk__grp { margin: 12px 0 4px; }
.chk { display: grid; grid-template-columns: 16px minmax(0, 1fr); column-gap: 8px; align-items: start; padding: 2px 0; }
.chk__i { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 19px; color: var(--fg); }
.chk--no .chk__i { color: var(--fg2); } .chk--na .chk__i { color: var(--muted); }
.chk__t { min-width: 0; overflow-wrap: anywhere; }
.report .chk__note { margin-top: 10px; }

/* key-value rows */
.kvs { margin-top: 12px; }
.kvr { display: grid; grid-template-columns: minmax(88px, 34%) minmax(0, 1fr); column-gap: 12px; padding: 7px 0; border-top: 1px solid var(--line); }
.kvr__k { color: var(--fg2); font-size: 12px; }
.kvr__v { min-width: 0; }
.kv__links, .kv__note { display: block; margin-top: 2px; font-size: 12px; line-height: 17px; }
.kv__note { color: var(--fg2); }
.kvs--tight { margin-top: 0; } .kvs--tight .kvr { padding: 2px 0; border-top: 0; }
.kvr + p, p + .kvr, .kvr + .chips { margin-top: 8px; }
@container report (max-width: 300px) {
  .kvr { grid-template-columns: minmax(0, 1fr); }
  .kvs--tight .kvr { padding: 3px 0; }
}

/* context from public data */
.ctx { overflow-wrap: anywhere; }
.ctx__lead { margin: 0 0 10px; }
.report .ctx__small { margin: 10px 0 0; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ctx__basis { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px; margin: 2px 0 6px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ctx__basis .tag { color: var(--fg); font-weight: 600; }
.report .ctx__about { margin: -2px 0 6px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ctx__title { font-weight: 600; }
.report .ctx__sentence { margin: 2px 0 0; }
.report .ctx__src { margin: 8px 0 0; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ctx__chart--more { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.card__fold > .ctx__chart--more:first-child { padding-top: 0; border-top: 0; }
.cx { display: grid; grid-template-columns: minmax(0, 1fr) max-content; margin: 12px 0 0; padding: 0; }
.cx__unit, .cx__strip, .cx__axis, .cx__val, .cx__size { font-size: 12px; line-height: 16px; }
.cx__unit { grid-column: 1 / -1; margin: 0 0 6px; color: var(--fg2); }
.cx__strip { grid-column: 1; position: relative; height: 18px; color: var(--fg2); }
.cx__mark { position: absolute; top: 0; padding-left: 5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cx__mark--r { padding: 0 5px 0 0; text-align: right; }
.cx__plot { grid-column: 1; position: relative; height: 104px; }
.cx__gutter { grid-column: 2; position: relative; padding-left: 8px; }
.ctx__svg { display: block; width: 100%; height: 100%; overflow: visible; color: var(--fg); }
.cx-bar { fill: var(--muted); } .cx-bar--end { fill: var(--fg); }
.cx-line, .cx-pt { stroke: var(--fg); }
.cx-grid { stroke: var(--line2); stroke-dasharray: 2 3; }
.cx-zero { stroke: var(--muted); }
.cx-rule { stroke: var(--fg2); stroke-dasharray: 3 2; }
.cx__dot { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; border-radius: 50%; background: var(--fg); box-shadow: 0 0 0 2px var(--bg); }
.cx__val { position: absolute; left: 8px; transform: translateY(-50%); color: var(--fg2); white-space: nowrap; }
.cx__val--end, .cx__size--end { color: var(--fg); font-weight: 600; }
.cx__size { display: block; height: 0; overflow: hidden; visibility: hidden; white-space: nowrap; }
.cx__axis { grid-column: 1; display: flex; justify-content: space-between; gap: 8px; margin: 4px 0 0; color: var(--muted); }
.ctx__rowshd { margin: 12px 0 0; }
.ctx__rows { display: grid; grid-template-columns: max-content minmax(0, 1fr); list-style: none; margin: 8px 0 0; padding: 0; }
.ctx__rows li { display: contents; }
.ctx__rows time, .ctx__rows li > span { padding: 5px 0; border-top: 1px solid var(--line); }
.report .ctx__rows a, .report .kv__links a { text-decoration: none; } .report .ctx__rows a:hover, .report .kv__links a:hover { text-decoration: underline; }
.ctx__rows time { padding-right: 12px; color: var(--fg2); font-size: 12px; white-space: nowrap; }
.ran { list-style: none; margin: 10px 0 0; padding: 0; }
.ran li { padding: 8px 0; border-top: 1px solid var(--line); }
.ran__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.ran__name { font-weight: 600; }
.ran__line { margin-top: 2px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ctx__vals { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 2px 16px; margin: 6px 0 4px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.ctx__vals > span { display: flex; justify-content: space-between; gap: 8px; }
.ctx__vals > span > span:last-child { color: var(--fg); }
.card__fold > .muted { margin-top: 10px; }
.status { display: flex; align-items: flex-start; gap: 8px; }
.status .spinner { margin: 3px 0 0; }
.status--err .ic { color: var(--err); margin-top: 1px; }
.sk { margin-top: 12px; }
.sk i { display: block; height: 10px; margin: 0 0 9px; border-radius: 4px; background: var(--card); animation: st-pulse 1.4s ease-in-out infinite; }
.sk .sk__l--s { width: 34%; } .sk .sk__l--m { width: 72%; } .sk .sk__plot { height: 104px; margin: 14px 0 10px; border-radius: 6px; }

/* source comparison */
.investigation { overflow-wrap: anywhere; }
.report .investigation h2 { margin: 0 0 6px; font-size: 15px; line-height: 21px; }
.investigation__lead { margin: 0 0 8px; }
.investigation__stake { margin-top: 10px; padding-top: 2px; border-top: 1px solid var(--line); }
.investigation__open { margin-left: 12px; font-size: 12px; }
.investigation__source { display: block; margin: 8px 0 0; color: var(--fg2); font-size: 12px; line-height: 17px; }
.investigation__option { padding: 4px 0 10px; }
.investigation__option + .investigation__option { border-top: 1px solid var(--line); padding-top: 4px; }

/* categories and findings */
.report > section.cat { padding: 0; }
.report > section.ai { padding: 8px 0; } .ai > .card__more { margin-top: 0; }
.cat__hd { display: flex; align-items: center; gap: 8px; min-height: 40px; margin: 0 -8px; padding: 0 8px; border-radius: 6px; cursor: pointer; user-select: none; }
.cat__hd::before, .f__hd::after { color: var(--muted); margin: 0 3px 0 3px; }
.cat__name { flex: 1; min-width: 0; font-weight: 600; }
.cat__count, .f__count { color: var(--muted); font-size: 12px; }
.cat__body { display: none; padding-bottom: 8px; }
.cat.open .cat__body { display: block; }
.cat__desc { padding: 0 0 10px 24px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.f { margin-left: 24px; border-top: 1px solid var(--line); }
.f__hd { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 12px; column-gap: 8px; align-items: start; margin: 0 -8px 0 -8px; padding: 8px; border-radius: 6px; cursor: pointer; }
.f__hd::after { margin: 6px 0 0; }
.f__name { display: contents; }
.f__hd > .sevg { grid-area: 1 / 1; }
.f__name b { grid-area: 1 / 2; min-width: 0; }
.f__meta { grid-area: 1 / 3; display: inline-flex; align-items: center; gap: 6px; padding-top: 1px; }
.f__hd::after { grid-area: 1 / 4; }
.f__why { grid-area: 2 / 2 / 3 / -1; color: var(--fg2); }
.f__body { display: none; padding: 2px 0 14px 24px; }
.f.open .f__body { display: block; }
.report .f__tech { margin: 0 0 6px; color: var(--fg2); font-size: 12px; line-height: 17px; }
.f__body .lbl { margin: 12px 0 4px; }
.lbl__note { font-weight: 400; }
.bias { margin: 0 0 6px; color: var(--fg2); }
.bias b { color: var(--fg); }
.q { cursor: pointer; }
.q:hover { background: var(--line); }
.q.noel { cursor: default; } .q.noel:hover { background: var(--card); }
.q mark { padding: 0 1px; border-radius: 2px; background: var(--hl); color: inherit; }
.q__src { margin-left: 6px; font-size: 12px; }
.f__act { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
@container report (max-width: 300px) { .f { margin-left: 12px; } .cat__desc { padding-left: 12px; } .f__body { padding-left: 12px; } }

/* notices and states */
.notice { margin: 12px 0 0; padding: 8px 12px; border-radius: 6px; background: var(--card); color: var(--fg); }
.notice.err { box-shadow: inset 2px 0 0 var(--err); }
.empty { color: var(--fg2); }
.spinner { display: inline-block; flex: none; width: 12px; height: 12px; margin-right: 6px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; vertical-align: -2px; opacity: 0.85; animation: st-spin 0.8s linear infinite; }
@keyframes st-spin { to { transform: rotate(360deg); } }
@keyframes st-pulse { 50% { opacity: 0.5; } }
@media (prefers-reduced-motion: reduce) { .spinner, .sk i { animation: none; } .card__more::before, .cat__hd::before, .f__hd::after, .ctx__values > summary::before, .investigation details > summary::before, .tip__more::before { transition: none; } }
`;
  root.SubtextView = V;
})(typeof globalThis !== 'undefined' ? globalThis : this);
