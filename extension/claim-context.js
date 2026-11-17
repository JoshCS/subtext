/* One curated historical claim; these records describe the quote, not its republisher. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SubtextClaims = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const filing = 'https://www.sec.gov/Archives/edgar/data/1318605/000110465925090888/tm252289d17_defa14a.htm';
  const proxy = 'https://www.sec.gov/Archives/edgar/data/1318605/000110465925090866/tm252289-12_def14a.htm';
  const normalize = (value) => String(value || '').toLowerCase().normalize('NFKC')
    .replace(/[\u2010-\u2015]/g, '-').replace(/[“”‘’]/g, "'").replace(/\s+/g, ' ');
  function isFiling(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && u.hostname === 'www.sec.gov' && u.pathname === new URL(filing).pathname;
    } catch (_) { return false; }
  }
  function forPage(page) {
    if (!page || typeof page !== 'object') return [];
    const text = normalize(String(page.title || '') + '\n' + String(page.mainText || ''));
    // Preserve the distinctive valuation wording rather than matching a name or amount alone.
    const claim = /(?:\$\s*20\s*(?:to|-)\s*\$?\s*30\s*trillion\s+valuation|valuation\s+could\s+be\s+\$\s*25\s*trillion)/g;
    let match;
    while ((match = claim.exec(text))) {
      const nearby = text.slice(Math.max(0, match.index - 350), match.index + match[0].length + 350);
      // A different forecaster can discuss the very same targets. Off the original filing,
      // require a distinctive part of Musk's wording as well as company/speaker context.
      const wording = /it actually does get to a \$\s*20\s*(?:to|-)\s*\$?\s*30\s*trillion valuation|if we execute well on autonomous transport and optimus/.test(nearby);
      if (!isFiling(page.url) && !(wording && /\b(?:elon musk|musk)\b/.test(nearby) && /\b(?:tesla|optimus)\b/.test(nearby))) continue;
      return [
        { text: 'In Sept. 2025 Musk projected a $20–30T Tesla valuation if autonomous transport and Optimus succeeded. Tesla filed his remarks as shareholder voting material.', source: filing },
        { text: 'Tesla’s 2025 proxy asked shareholders to approve Musk’s CEO award, tied to market-cap and operating milestones.', source: proxy }
      ];
    }
    return [];
  }
  // An indexed event can point to a missing primary source. Match the event, time and
  // participants in the item itself. The match only offers a document, never a verdict.
  function related(page) {
    const title=normalize(page.title), paragraphs=(page.paragraphs || []).slice(0,14);
    const text=normalize(paragraphs.join(' ').slice(0,6500));
    const event=/\bsolar (?:tile )?roof(?:s|-?top)?\b/;
    if (!event.test(title+' '+text) || !/\btesla\b/.test(title+' '+text) || !/\b(?:solar\s?city|powerwall 2(?:\.0)?)\b/.test(text)) return null;
    if (!/^2016-10-(?:2[89]|3[01])(?:$|T|\s)/.test(page.date || '') &&
      !/\b(?:october|oct\.?)\s+(?:28(?:th)?[,]?\s+2016|2016)\b/.test(text)) return null;
    for (const para of paragraphs) {
      const piece = String(para).split(/(?<=[.!?])\s+(?=[A-Z])/).find(s=>s.length<550 &&
        event.test(normalize(s)) && /\b(?:unveil\w*|launch\w*|show(?:s|ed)? off|presented|demonstrat\w*)\b/.test(normalize(s)));
      const decision = paragraphs.flatMap(s=>s.split(/(?<=[.!?])\s+(?=[A-Z])/)).find(s=>s.length<420 && /\b(?:event|launch|unveil\w*|demonstration)\b/i.test(s) && /\b(?:merger|combination|acquisition|deal)\b/i.test(s) && /\b(?:vot\w*|shareholders?|sell the merger)\b/i.test(s));
      if (piece) return {decision, url:'https://www.sec.gov/Archives/edgar/data/1318605/000119312516743920/d272397d425.htm',label:'October 2016 shareholder letter',passage:piece,discovery:'related'};
    }
    return null;
  }
  function stakeFor(source) {
    if (source!=='https://www.sec.gov/Archives/edgar/data/1318605/000119312516743920/d272397d425.htm') return null;
    return {title:'Who else had money at stake?',text:'SpaceX bought about $165 million of SolarCity bonds in 2015 and reinvested the proceeds as they matured in 2016. It was a creditor of the company Tesla wanted to buy.',limit:'The joint proxy says the bonds were offered on public terms. This documents exposure to SolarCity, not why Tesla sought the merger.',
      source:'https://www.sec.gov/Archives/edgar/data/1318605/000119312516736377/d241192d424b3.htm#:~:text=In%202015%2C%20Space%20Exploration%20Technologies',label:'October 2016 joint proxy · Ownership of Other SolarCity Securities'};
  }
  return { forPage, related, stakeFor };
});
