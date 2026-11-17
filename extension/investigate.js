/* Compare the sentence beside a citation to the document the reader chose. These are
   readings of named, checkable records, not site warnings or contributions to a score. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubtextInvestigate = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const sentences = s => clean(s).split(/(?<=[.!?])\s+(?=[A-Z(])/).filter(Boolean);
  const stop = new Set('about after before their there would should where within being other which people found study researchers trial research published company companies product results reported study paper shareholder investors during group showed shows these those first launch letter would plans record original filing source according patients placebo percent outcomes reports health financial'.split(' '));
  const tokens = s => new Set((clean(s).toLowerCase().match(/[a-z][a-z-]{3,}/g) || []).filter(w => !stop.has(w)));
  const overlap = (a,b) => { const bs=tokens(b); return [...tokens(a)].filter(w=>bs.has(w)).length; };
  const unique = ls => [...new Set(ls.filter(Boolean))];
  function compare(cite, doc) {
    let at = clean(cite.passage);
    const anchor = at;
    const lines = unique(doc.passages.flatMap(sentences));
    const rank = (xs, bonus = () => 0) => xs.map((s,i) => ({s, n: Math.min(8, overlap(at,s)) + bonus(s), i})).sort((a,b) => b.n-a.n || a.i-b.i).map(x=>x.s);
    const entry = (label, quote) => ({label, quote});
    const result = (heading, lead, check, evidence) => ({
      key:cite.key, url:doc.url, kind:doc.kind, title:clean(doc.title), passage:at, anchor, discovery:cite.discovery, decision:cite.decision, heading, lead, check,
      evidence:evidence.filter(x=>x && x.quote).slice(0,4)
    });
    if (doc.kind === 'sec') {
      const proceeds = lines.find(s=>/\bwe (?:are not selling.{0,100}and )?will not receive any (?:of the )?proceeds from the (?:re)?sale of (?:the )?shares.{0,90}(?:offered by this prospectus supplement|by the selling (?:stock|share|security)holders? (?:hereunder|under this prospectus))\b/i.test(s));
      const seller = lines.find(s=>/^the selling (?:stock|share|security)holders? may (?:offer (?:and|to) )?sell (?:the |up to |their )?shares\b/i.test(s));
      if (proceeds && seller && /\b(?:shares?|stock)\b/i.test(at) && /\b(?:offering|offer|register\w*|sell|sale)\b/i.test(at)) {
        return result('Who gets the sale money','The filing describes existing holders selling shares. For the sales covered by this passage, the company says it receives none of the proceeds. An offering headline alone does not mean cash is arriving to fund the business.',
          'Check the seller and the use of proceeds for this tranche. Registration allows a sale; it does not establish that every share was sold.',[entry('Who receives the proceeds',proceeds),entry('Who may sell',seller)]);
      }
      // The event itself must appear in the pitch for the combined business. A generic
      // forward-looking disclaimer or a shareholder meeting elsewhere in the filing is insufficient.
      const pitch = lines.find(s => /\b(?:unveil|demonstrat|showcas)\w*/i.test(s) && /\b(?:combined|merged) compan(?:y|ies)\b/i.test(s)
        && !/\b(?:not|no longer|cancelled|canceled|unrelated|litigation|lawsuit)\b/i.test(s) && overlap(at,s)>=2);
      const ask = lines.find(s => /\b(?:board|management|we)\b.{0,100}\b(?:hope|recommend|urge|ask|encourage)\w*\b.{0,90}\b(?:supporting (?:the|this) (?:combination|merger)|vote [“"']?for (?:the|this|each))\b/i.test(s));
      const meeting = lines.find(s => /\b(?:shareholder|stockholder).{0,45}\bmeeting\b/i.test(s) && /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d/i.test(s) && s.length<330);
      if (pitch && ask && /\b(?:unveil\w*|launch\w*|debut\w*|demonstrat\w*|prototype|showcas\w*)\b/i.test(at)) {
        const covered = cite.decision || /\b(?:vot\w*|ballot)\b/i.test(at) && /\b(?:merger|acquisition|combination)\b/i.test(at);
        return Object.assign({basis:"merger-pitch"},result(covered ? 'The filing backs up that framing' : 'The other audience for the launch',
          covered ? 'The article connects the unveiling to the merger vote. The company’s own voting material makes that same connection.'
          : 'Read this as a pitch to shareholders as well as a product unveiling. In asking for support for the deal, management points to the demonstration as evidence of what the combined company could make.',
          'The letter documents the pitch. To judge whether the product delivered, look for units shipped to paying customers after the unveiling.',
          [entry('Elsewhere in the article',cite.decision),entry('The product in the filing',pitch),entry('What management asked for',ask),entry('Scheduled shareholder meeting',meeting)]));
      }
    }
    if (doc.kind === 'pubmed' || doc.kind === 'doi') {
      // Both event rates and the hazard ratio must name the SAME primary outcome in one
      // sentence. Do not subtract two unlabelled percentages, subgroup results or CI bounds.
      for (const claim of [anchor,...(cite.nearby || [])]) {
       at=claim;
       for (const line of lines) {
        const m = line.match(/\b(?:a |the )?primary ([\w -]{0,80}?)event occurred in [\d,]+ of (?:the )?[\d,]+ (?:patients|participants) \((\d+(?:\.\d+)?)%\) in the ([\w -]{1,50}?) group and in [\d,]+ of (?:the )?[\d,]+ (?:patients|participants) \((\d+(?:\.\d+)?)%\) in the (placebo|control) group \(hazard ratio,\s*(0\.\d+)/i);
        if (!m || !/cardiovascular/i.test(m[1]) || !/\b(?:cardiovascular (?:risk|events?|outcomes?)|heart events?|heart attack.{0,65}stroke)\b/i.test(at)) continue;
        const pct = Number((100*(1-Number(m[6]))).toFixed(1)), treated = +m[2], control = +m[4];
        if (!pct || !(0<treated && treated<control && control<=100) || !new RegExp('\\b'+String(pct).replace('.','\\.')+'\\s*(?:%|percent\\b)','i').test(at)) continue;
        if (/\b(?:subgroup|secondary|post.hoc|weight loss|body weight|cost|price|discount|blood pressure|mortality alone|deaths? alone)\b/i.test(at)) continue;
        if (!tokens(at+' '+(at===anchor?cite.label:'')).has(m[3].trim().toLowerCase()) || !/\b(lower|reduc\w*|cut\w*|fell|fewer)\b/i.test(at) || /\b(?:not|failed|unrelated|higher|raise[ds]?)\b/i.test(at)) continue;
        const ci=line.match(/95%\s*(?:confidence interval|CI),?\s*(0\.\d+)\s*(?:to|[-–,])\s*(\d+(?:\.\d+)?)/i);
        if (!ci || +ci[1]>Number(m[6]) || +ci[2]<Number(m[6])) continue;
        if (+ci[2]>=1) return result('The estimate still includes no difference','The hazard ratio favors the treatment, but its reported interval includes 1. That leaves no difference between groups compatible with the estimate.',
          'Read the interval alongside the headline percentage.',[entry('Result and uncertainty',line)]);
        const both = [treated, control].every(n=>new RegExp('\\b'+String(n).replace('.','\\.')+'(?:\\.0)?\\s*%').test(at));
        const diff = Number((control-treated).toFixed(2)); const per1000 = Number((diff*10).toFixed(1));
        const duration = lines.find(s=>/mean duration of follow-up was \d/i.test(s));
        const time = duration && duration.match(/mean duration of follow-up was ([\d.]+)(?:\s*±\s*[\d.]+)? (months?|years?)/i);
        const endpoint = lines.find(s=>/\bprimary\b.{0,50}\b(?:end ?point|outcome)\b.{0,30}\bcomposite of\b/i.test(s));
        return result(both ? 'The article gives both numbers' : 'The percentage, in people',
          (both ? 'The article gives the relative and absolute views. ' : '')+'The '+pct+'% is a reduction in hazard. The observed event rates were '+m[2]+'% on '+m[3]+' and '+m[4]+'% on '+m[5]+': about '+per1000+' fewer people per 1,000 had a primary event'+(time?' over an average '+time[1]+' '+time[2]:' during follow-up')+'.',
          endpoint ? 'Look at which events were counted together before treating the headline as a reduction in deaths alone.' : 'Check who was enrolled and which events counted before applying that number to another group.',
          [entry('Primary result',line),entry('What counted as an event',endpoint),entry('Follow-up',duration)]);
       }
      }
      at=anchor;
      // A methodological detail can confirm good reporting, too. Show a species
      // boundary only when the page and the original both put the result in animals.
      const animalLines = lines.filter(s=>/\b(?:mice|rats)\b/i.test(s) && /\b(?:lifespan|life span|survival)\b/i.test(s) && /\d\s*%/.test(s));
      for (const claim of [anchor,...(cite.nearby || [])]) {
        if (!/lifespan|life span|survival/i.test(claim) || !/\d\s*%/.test(claim) || /\b(?:failed|no effect|unrelated|did not|not extended)\b/i.test(claim)) continue;
        const rodent = claim.match(/\b(mice|rats)\b/i)?.[1].toLowerCase();
        if (!rodent) continue;
        const numbers = x=>[...x.matchAll(/\b(\d+(?:\.\d+)?)\s*%/g)].map(m=>Number(m[1]));
        const genetic = x=>/\b(?:genetic|deletion|deleted|knockout)\b/i.test(x);
        const matching = animalLines.filter(s=>new RegExp('\\b'+rodent+'\\b','i').test(s) &&
          overlap(claim,s)>=2 && genetic(s)===genetic(claim) && numbers(s).some(n=>numbers(claim).includes(n)));
        if (!matching.length) continue;
        const animal=rank(matching,s=>overlap(claim,s))[0];
        at=claim; return result('Where the evidence stops','Both the article and the paper put the lifespan result in '+rodent+'. The result is about how long the animals lived; it does not establish longer life in people.',
          'For a human longevity claim, look for human follow-up measuring survival, not just a change in the same protein.',[entry('Population and outcome in the study',animal)]);
      }

    }
    if (doc.kind === 'trial') {
      const primary = doc.passages.find(s=>s.startsWith('Primary outcome: '));
      const sponsor = doc.passages.find(s=>s.startsWith('Lead sponsor: '));
      if (primary) return result('What the trial set out to measure','The registry names the main outcome the investigators chose. That is the yardstick to put beside the article’s claim.',
        'Does the claim describe this outcome, for this group and time period? A registered outcome alone does not show that the treatment achieved it.',
        [entry('Registered outcome',primary),entry('Enrollment',doc.passages.find(s=>s.startsWith('Enrollment: '))),entry('Named sponsor',sponsor)]);
    }
    const substantive = lines.filter(s=>s.length>=40 && s.length<=1100);
    const top = rank(substantive, s=> /\b(?:primary|participants|randomly assigned|funded by|approval|vote|purchase price|shareholders? will receive)\b/i.test(s)?1:0).slice(0,3);
    return result('Inside the cited record',top[0] && top[0].length<=370 ? '“'+top[0]+'”' : 'These are the passages closest to the article’s wording. They do not establish a different reading on their own.',
      doc.kind==='sec'?'Check who filed it, which decision it addresses, and what is a forecast rather than a result.':'Compare who was studied and what was measured with the wording beside the link.',
      (top.length?top:doc.passages.slice(0,2)).map(s=>entry('From the record',s)));
  }
  function choice(pairs) {
    for (const c of pairs || []) {
      const ratio = c.primaryArea/c.alternativeArea;
      if (ratio < 2 || !Number.isFinite(ratio) || !/^(?:buy|subscribe|start|try|upgrade|unlock|activate|switch to|join)\b/i.test(c.primary)) continue;
      const terms = clean(c.terms);
      // No extra prices, ranges, conditional rates, discounts or per-seat calculations.
      const m = terms.match(/^(?:price:\s*)?([$€£])(\d{1,4}(?:\.\d{1,2})?)\s*(?:\/\s*(?:mo(?:nth)?\.?)|per month|a month)\s*[,·•(—–-]?\s*(?:billed|charged|payable) (?:annually|yearly)\)?[.!]?$/i);
      if (!m || Number(m[2])<=0) continue;
      const cents = Math.round(100*Number(m[2]))*12;
      const yearly = m[1] + (cents%100?(cents/100).toFixed(2):cents/100);
      return {heading:'What the big button is selling',
        lead:'The price looks like '+m[1]+m[2]+' for a month. The billing line makes it '+yearly+' for a year at that rate. “'+c.primary+'” takes up '+Number(ratio.toFixed(1))+' times the area of “'+c.alternative+'”.',
        evidence:[{label:'Terms beside the buttons',quote:terms},{label:'Measured on screen',quote:'“'+c.primary+'” — '+c.primaryArea+' px²; “'+c.alternative+'” — '+c.alternativeArea+' px².'}],
        check:'The rate and button sizes are visible here. The checkout is where to verify the amount due today.'};
    }
    return null;
  }
  // A delivery instruction, not a sentiment classifier. The two actions must be
  // given together by the post. A complaint about someone else's tactic is not an offer.
  function post(body) {
    const rows = clean(body).match(/[^.!?\n]+(?:[.!?]+|$)/g) || [];
    for (const raw of rows) {
      const s = raw.trim();
      const m = s.match(/^(?:please )?(comment|reply(?: with)?)\s+["“'‘]([\w -]{1,30})["”'’]\s*(?:below\s*)?(?:[,;:—–-]\s*)?(?:and|so)\s+I(?:['’]ll| will)\s+(?:DM|direct[- ]message|private[- ]message)\s+you\s+(?:the|a|my|our|an)\s+([^.!?]{2,65})[.!]?$/i);
      if (!m || /\b(?:example|unless|instead|not|never|won't|won’t|might|maybe|if)\b/i.test(m[3])) continue;
      return {heading:'What a comment buys here',
        lead:'The comments double as an order form. Every “'+m[2]+'” adds a visible response to the post, even if the reader only wants the '+m[3].trim()+'. The promised delivery happens in private; the demand shows up in public.',
        evidence:[{label:'The exchange the author offers',quote:s}],
        check:'Look at what the replies actually say before treating the comment count as agreement. This post does not tell us why it appeared in your feed.'};
    }
    return null;
  }
  return {compare, choice, post};
});
