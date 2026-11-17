/* Shared between content scripts, popup and options (no DOM assumptions). */
(function (root) {
  const C = {};
  C.CATEGORY_ORDER = ['dark_pattern', 'urgency_scarcity', 'social_proof', 'attention', 'bias_exploit', 'deceptive_claims', 'rhetoric', 'emotional', 'interpersonal', 'charts', 'incentives', 'source_funding', 'surveillance', 'design_psych'];
  // Tier-1/2 copy for a finding: the finding's own label/why, else rules/labels.json by id, then by prefix.
  C.labelFor = function (f, labels) {
    if (f.label && f.why) return { label: f.label, why: f.why };
    const L = (labels && labels.labels) || {};
    const hit = L[f.id] || L[f.id.replace(/\.negated$/, '')] || L[f.id.split('.').slice(0, 2).join('.')] || L[f.id.split('.')[0]] || {};
    return { label: f.label || hit.label || f.name, why: f.why || hit.why || '' };
  };
  C.CATEGORY_CAP = 10; // no single category can push the score alone
  C.findingWeight = function (f) { if (!f || f.severity <= 0) return 0; return f.severity * (f.confidence == null ? 0.7 : f.confidence) * Math.sqrt(Math.min(f.count || 1, 6)); };
  C.PRESSURE_CATEGORIES = ['dark_pattern', 'urgency_scarcity', 'social_proof', 'attention', 'bias_exploit', 'deceptive_claims', 'rhetoric', 'emotional', 'interpersonal', 'charts', 'design_psych'];
  C.GRADE_MODE = 'all'; // internal weight for tests and evaluation only; the owner decided on 5 Nov 2026 that no single grade is shown to readers. Not switched without the owner's decision.
  C.scoreFindings = function (findings, mode) {
    const m = mode || C.GRADE_MODE; if (m === 'pressure') findings = (findings || []).filter((f) => C.PRESSURE_CATEGORIES.includes(f.category)); else if (m === 'data') findings = (findings || []).filter((f) => !C.PRESSURE_CATEGORIES.includes(f.category));
    const perCategory = {};
    for (const f of findings) { const v = C.findingWeight(f); if (!v) continue; perCategory[f.category] = (perCategory[f.category] || 0) + v; }
    let w = 0; for (const c of Object.keys(perCategory)) { perCategory[c] = Math.min(perCategory[c], C.CATEGORY_CAP); w += perCategory[c]; }
    // Squash to 0–100 (divisor tuned on eval/calibrate.js), then apply floors: one severe finding is at least C, two at least D.
    let score = Math.round(100 * (1 - Math.exp(-w / 20)));
    // floors only for findings that rest on behaviour, structure, network, policy text or the dataset (lexical matches can be planted)
    const severe = findings.filter((f) => f && f.severity >= 3 && (f.confidence == null || f.confidence >= 0.7) && !(f.meta && f.meta.lexical)).length;
    if (severe >= 1) score = Math.max(score, Math.min(70, 35 + 15 * (severe - 1)));
    let grade, label;
    if (score < 15) { grade = 'A'; label = 'Low pressure'; }
    else if (score < 30) { grade = 'B'; label = 'Some persuasion'; }
    else if (score < 50) { grade = 'C'; label = 'Moderate pressure'; }
    else if (score < 70) { grade = 'D'; label = 'High pressure'; }
    else { grade = 'F'; label = 'Very high pressure'; }
    return { score, grade, label, weight: Math.round(w * 10) / 10, perCategory };
  };
  C.GRADE_COLORS = { A: '#2ecc71', B: '#a3d65c', C: '#f1c40f', D: '#e67e22', F: '#e74c3c', '–': '#9aa4af' };
  C.seriousCount = (findings) => (findings || []).filter((f) => f.severity >= 3 && (f.confidence == null || f.confidence >= 0.6)).length;
  // the score, unless the page gives too little to grade: an error page, or under 300 characters with nothing measured beyond words
  C.gradeInfo = function (findings, meta) {
    const s = C.scoreFindings(findings || []); meta = meta || {};
    const measured = (findings || []).some((f) => f.severity > 0 && !(f.meta && f.meta.lexical));
    if (meta.errorPage) return Object.assign({}, s, { grade: '–', label: 'Error page', insufficient: true });
    if (meta.textChars != null && meta.textChars < 300 && !(meta.commerce && meta.commerce.sells) && !measured) return Object.assign({}, s, { grade: '–', label: 'Too little to grade', insufficient: true });
    // the letter covers everything; the words say which part it is, so a heavily tracked page with no pressure on the reader is not called "high pressure"
    const p = C.scoreFindings(findings || [], 'pressure'), d = C.scoreFindings(findings || [], 'data');
    const pw = { A: 'Low pressure', B: 'Some persuasion', C: 'Moderate pressure', D: 'High pressure', F: 'Very high pressure' }[p.grade];
    const dw = d.score < 15 ? 'little data collection' : d.score < 50 ? 'some data collection' : 'heavy data collection';
    return Object.assign({}, s, { label: pw + ' · ' + dw, pressure: p, data: d });
  };
  // What the reader sees at a glance: no letter and no single number. A page is not one metric: the top line says what is going on, and this says what to look at first.
  // Two rules can report one fact: the page's own auto-renew wording and the terms' renewal clause. The value is the id reading() asks for; the keeper takes the stronger severity and both sets of evidence.
  C.SAME_FACT = { 'bias.default_optout_language': 'policy.auto_renewal' };
  C.oneFactEach = function (findings) {
    const list = findings || []; const byId = new Map(list.map((f) => [f.id, f])); const dropped = new Map();
    for (const f of list) { const k = byId.get(C.SAME_FACT[f.id]); if (k && k.severity > 0) dropped.set(f.id, k.id); } // a quiet note of the same fact folds in too: it would sit under "Also noticed" beside its own chip
    if (!dropped.size) return list.slice();
    return list.filter((f) => !dropped.has(f.id)).map((f) => {
      const dups = list.filter((d) => dropped.get(d.id) === f.id); if (!dups.length) return f;
      const seen = new Set(); const evidence = [f].concat(dups).flatMap((d) => d.evidence || []).filter((e) => { const q = e && e.quote; if (!q) return true; if (seen.has(q)) return false; seen.add(q); return true; });
      return Object.assign({}, f, { severity: Math.max(f.severity, ...dups.map((d) => d.severity)), evidence, alsoIds: dups.map((d) => d.id) });
    });
  };
  // strongest first; within a severity, what the page was seen doing ahead of the rest, and vendor or dataset lookups last
  const proofRank = (f) => (f.source === 'behavior' ? 0 : /^(tracker\.|source\.ownership)/.test(f.id) ? 2 : 1);
  C.flagOrder = (a, b) => b.severity - a.severity || proofRank(a) - proofRank(b) || C.findingWeight(b) - C.findingWeight(a);
  // The one list: pill, badge, panel header, chip strip, "+N more" and the category folds all read `flags`.
  C.glance = function (findings, meta) {
    meta = meta || {}; const info = C.gradeInfo(findings, meta); const nameOf = (f) => String(f.label || f.name || '');
    const flags = C.oneFactEach(findings).filter((f) => f.severity > 0).sort(C.flagOrder);
    const top = flags[0] || null; const outside = meta.thirdPartyDomains || 0; const insufficient = !!info.insufficient;
    const tone = !top ? 'quiet' : top.severity >= 3 ? 'red' : top.severity >= 2 ? 'amber' : 'plain';
    const pill = top ? nameOf(top) + (flags.length > 1 ? ' +' + (flags.length - 1) : '') : 'Subtext';
    const known = flags.length ? flags.length + (flags.length > 1 ? ' things' : ' thing') + ' to know' : '';
    const thin = insufficient ? (meta.errorPage ? 'Error page' : 'Too little text to read') : '';
    const companies = outside && !insufficient ? outside + ' outside compan' + (outside > 1 ? 'ies' : 'y') + ' contacted' : '';
    const label = top ? pill : thin || 'Nothing to flag'; // the page says who it is about; a label never just repeats the product's name
    const parts = [thin, known || (thin ? '' : 'Nothing to flag'), companies].filter(Boolean);
    const rest = [top ? known : '', companies].filter(Boolean);
    return { flags, top, tone, pill, label, detail: rest.join(' · '), count: flags.length, meta: parts.join(' · '), insufficient, color: { red: '#e74c3c', amber: '#e67e22', plain: '#5d6d7e', quiet: '#9aa4af' }[tone] };
  };
  // one wording for the AI button on the panel and the popup
  C.deepAnalyzeLabel = function (hasKey, hasReading, provider, estimate, investigation = true) {
    const prov = provider === 'openai' ? 'ChatGPT' : 'Claude';
    if (!hasKey) return investigation ? 'Set up Investigate (optional AI)' : 'Set up Deep analyze (optional AI)';
    if (investigation) return (hasReading ? 'Investigate again with ' : 'Investigate with ') + prov + (!hasReading && estimate ? ' · about $' + estimate : '');
    return hasReading ? 'Re-run ' + prov + ' analysis' : 'Deep analyze with ' + prov + (estimate ? ' · about $' + estimate : '');
  };
  // What Subtext already knows, as facts the AI inquiry may cite, each labelled with its scope and source (ChatGPT review, 16 Nov 2026):
  // who it concerns, where it came from, and whether it covers this page, the whole site, the whole publisher or one series. Only checked
  // sources: hand-checked outlet rows, ad-exchange records with two or more listings, the site's own ads.txt and policy pages, and what was
  // observed on this page. Unchecked owner rows (Wikidata, AI-researched) and private-equity leads are left out: a name in the packet
  // passes the name guard, so it must be one we would show.
  // p: { outlet: {name, owners, funding, funders, sources, confidence}, operator: {name, count}, adsTxt: {owner, managerName, systems},
  //      findings: [{id, label, why, quote, severity}], asks }
  C.productObservations = function (p) {
    if (!p) return []; const out = []; const cut = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const e = p.outlet;
    if (e && e.name) {
      out.push({ label: 'Outlet record (whole publisher, checked by hand)', text: cut(e.name + ' is owned by ' + (e.owners || []).map((o) => o.name).join('; ') + '. Funding: ' + (e.funding || []).join(', ') + '.', 400), source: (e.sources || [])[0] });
      for (const it of (e.interests || []).slice(0, 6)) out.push({ label: 'Owner record (the owner\'s other interests, sourced)', text: cut(it.why + ' Topic: ' + it.topic + '.', 300), source: it.source });
      if (e.wealthy) out.push({ label: 'Owner record (the owner\'s other interests, sourced)', text: cut(C.ownerShort(e) + ({ ', a very wealthy family': ' is a very wealthy family', ', billionaires': ' are billionaires', ', who are very wealthy': ' are very wealthy', ', a billionaire': ' is a billionaire', ', who is very wealthy': ' is very wealthy' })[C.wealthWords(e, C.ownerShort(e))] + '. ' + (e.wealthySource ? 'Source: ' + e.wealthySource : ''), 360) });
      for (const l of (p.ownerLinks || []).slice(0, 4)) out.push({ label: 'Subtext observation (this page)', text: cut('Owner connection: ' + l.why, 300) });
      for (const f of (e.funders || []).slice(0, 3)) out.push({ label: 'Outlet record (one series only, not every article)', text: cut(f.name + ' funds ' + (f.what || 'a series') + ' at ' + e.name + '.', 300), source: f.source });
    }
    if (p.operator && p.operator.name && p.operator.count >= 2) out.push({ label: 'Ad-exchange records (whole site)', text: cut('The ad exchanges that pay this site list its operator as ' + p.operator.name + ' (' + p.operator.count + ' listings).', 300) });
    if (p.adsTxt && (p.adsTxt.owner || p.adsTxt.managerName)) out.push({ label: 'The site\'s own ads.txt (whole site)', text: cut((p.adsTxt.owner ? 'Its ads.txt names ' + p.adsTxt.owner + ' as owner. ' : '') + (p.adsTxt.managerName ? p.adsTxt.managerName + ' sells its ad space.' : ''), 300) });
    if (p.wire && p.wire.source) out.push({ label: 'Subtext observation (this page)', text: cut('The credits show republished reporting from ' + p.wire.source + ': "' + p.wire.line + '".', 300) });
    if (p.paidItem && p.paidItem.label) out.push({ label: 'Subtext observation (this page)', text: cut('The item itself is labelled "' + p.paidItem.label + '"' + (p.paidItem.sponsor ? '; the label or its logo names the sponsor as ' + p.paidItem.sponsor : '') + '.', 300) });
    const F = p.findings || [];
    for (const f of F.filter((x) => /^policy\./.test(x.id) && x.quote).slice(0, 4)) out.push({ label: 'The site\'s privacy policy or terms (whole site)', text: cut(f.label + ': "' + f.quote + '"', 360) });
    for (const f of F.filter((x) => /^(incentives\.purchase_path|incentives\.business_model|source\.listed_warning|source\.unknown_operator|source\.thin_shop|source\.named_operator|source\.affiliate_links|source\.funded_section|scam\.)/.test(x.id) && x.why).slice(0, 5)) out.push({ label: 'Subtext observation (this page)', text: cut(f.label + ': ' + f.why, 300) });
    // trackers are left out: they are on almost every ad-funded page and say nothing about what this item means (the report lists them);
    // given them, the model led a recipe with its ad tags (16 Nov 2026 review set)
    return out.slice(0, 14);
  };
  // Which owners, funders or owner businesses named in an outlet's record does this article's own text mention? Ownership earns a place in the
  // report only when it connects to the item (an outlet reporting on its owner's company), not because a publisher has a wealthy owner.
  // The outlet's own name never counts: it is on every page. Text is the article body, never the footer that says who owns the site.
  C.GIVEN_NAMES = new Set('Aaron Adam Alan Albert Alex Alexander Alice Amanda Amy Andrew Angela Ann Anna Anne Anthony Arthur Barbara Ben Benjamin Betty Bill Bob Brian Bruce Carl Carol Caroline Catherine Charles Charlie Chris Christina Christine Christopher Claire Craig Dan Daniel David Deborah Dennis Diana Donald Donna Dorothy Douglas Edward Elizabeth Ellen Emily Emma Eric Evelyn Frances Frank Fred Friede Gary George Gerald Grace Greg Gregory Harold Harry Heather Helen Henry Jack Jacob James Jane Janet Jason Jean Jeff Jeffrey Jennifer Jeremy Jerry Jessica Jim Joan Joe John Jonathan Jose Joseph Joshua Joyce Judith Julia Julie Justin Karen Kate Katherine Keith Kelly Kenneth Kevin Kim Larry Laura Lauren Laurene Lawrence Linda Lisa Louis Lucy Lynne Margaret Maria Marc Mark Martha Martin Mary Matthew Melissa Michael Michelle Mike Nancy Natalie Nathan Neil Nicholas Nicole Pamela Patricia Patrick Paul Peter Philip Rachel Ralph Randall Raymond Rebecca Rebekah Richard Robert Roger Ronald Rose Rupert Russell Ruth Ryan Sam Samuel Sandra Sarah Scott Sean Sharon Shirley Stephen Steve Steven Susan Susie Thomas Tim Timothy Tom Tony Tyler Victoria Virginia Walter Wayne William Lachlan Elisabeth Prudence Byron Jay Gautam Sultan Evgeny Dan Farris Ben Larry Rupert Sophie Laura Ellen Jacqueline'.split(' '));
  C.outletMentions = function (entry, text) {
    if (!entry || !text) return [];
    const GENERIC = /^(The|Inc|LLC|Ltd|Limited|Holdings?|Group|Media|Company|Corporation|Corp|Trust|Family|Foundation|Public|Shareholders?|Founder|Owner|Owned|Since|Via|And|Of|For|News|Network|Partners|Capital|Fund|Global|International|Society|Association|Institute|Center|Centre|Council|Board|Press|Publishing|Communications|Enterprises|Ventures|Investments?|Billionaire|Private|Nonprofit|Government|State|Federal|National|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Formerly|Previously|Slated|Majority|Minority|Principal)$/;
    const own = new Set(String(entry.name || '').split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((w) => w.toLowerCase()));
    for (const d of entry.domains || []) own.add(d.split('.')[0].toLowerCase());
    const names = (entry.owners || []).map((o) => o.name).concat((entry.funders || []).map((f) => f.name));
    // a full name always counts; alone, only a person's surname or a company's leading brand word (Skydance, Comcast) counts, never a
    // common first name or the first word of a trust ("Scott" from "Scott Trust" and "Marc" from "Marc and Lynne Benioff" matched
    // unrelated pages, 16 Nov 2026)
    const GIVEN = C.GIVEN_NAMES;
    const cands = new Set();
    for (const n of names) for (const m of String(n).match(/[A-Z][\p{L}\p{N}&'.-]+(?:\s+[A-Z][\p{L}\p{N}&'.-]+)*/gu) || []) {
      const words = m.split(/\s+/).map((w) => w.replace(/[.,'’]+$/, ''));
      const ok = (w) => w && w.length >= 4 && !GENERIC.test(w) && !own.has(w.toLowerCase()) && !GIVEN.has(w);
      if (words.length === 1) { if (ok(words[0])) cands.add(words[0]); continue; }
      if (!words.some((w) => own.has(w.toLowerCase())) && words.some((w) => w.length >= 4 && !GENERIC.test(w))) cands.add(words.join(' '));
      { const t = words.slice(); while (t.length > 1 && /^(Inc|LLC|Ltd|Limited|Holdings?|Group|Corp|Corporation|Company|plc|SE|AG|SA)$/.test(t[t.length - 1])) t.pop(); if (t.length >= 2 && t.length < words.length && !t.some((w) => own.has(w.toLowerCase()))) cands.add(t.join(' ')); }
      const one = GIVEN.has(words[0]) ? words[words.length - 1] : words[0];
      if (ok(one)) cands.add(one);
    }
    const out = []; const t = String(text);
    for (const c of cands) { if (new RegExp('(^|[^\\p{L}])' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\p{L}]|$)', 'u').test(t) && !out.some((x) => x.includes(c))) out.push(c); }
    return out.slice(0, 5);
  };
  // Does this item's subject touch its owner's interests? The ownership card opens, and the top line names the owner, when the page names
  // the owner or a funder (outletMentions), when its subject is one of the owner's businesses, governments or causes (data/owner-interests.json,
  // one source per interest), or when it is about taxing the very wealthy and the owner is a billionaire or a wealthy family, or about private
  // equity and the owner is a fund. Project owner, 16 Nov 2026: open it "if the page is referencing anything that might be influenced or directly related
  // to the owner in a meaningful way, like if an article is about not taxing billionaires but the owner is a billionaire". A topic counts when
  // it is in the title or a heading, or comes up at least twice in the text: one passing mention is not what the item is about.
  C.WEALTH_TOPIC = /\b(wealth tax(?:es)?|tax(?:es|ing|ed)? (?:on )?wealth\b|billionaires?['’]? (?:tax|minimum tax|income tax)(?:es)?|tax(?:es|ing|ed)? (?:on |for )?(?:the )?(?:rich|wealthy|wealthiest|billionaires?|millionaires?|super-rich|top earners|high earners)|estate tax(?:es)?|inheritance tax(?:es)?|death tax(?:es)?|capital gains tax(?:es)?|top (?:marginal |income )?tax rates?|carried interest|step-up in basis|millionaires?['’]? tax(?:es)?|tax the rich|tax cuts? for the (?:rich|wealthy))\b/gi;
  C.PE_TOPIC = /\b(private equity|leveraged buyouts?|carried interest|hedge funds?)\b/gi;
  // the words for the owner's wealth follow the checked source: "a billionaire" only where it says billion
  C.wealthWords = function (entry, owner) {
    if (/family|families|trust\b/i.test(owner || '')) return ', a very wealthy family';
    const billion = /billion/i.test(String(entry && entry.wealthySource || '')) && !/not a billionaire/i.test(String(entry.wealthySource));
    if (/ and /.test(owner || '')) return billion ? ', billionaires' : ', who are very wealthy'; // "Marc and Lynne Benioff"
    return billion ? ', a billionaire' : ', who is very wealthy';
  };
  C.ownerShort = function (entry) {
    const o = String((entry && (entry.ultimateOwner || (entry.owners && entry.owners[0] && entry.owners[0].name))) || '').split(';')[0].split(' (')[0].split(' → ').pop().trim();
    return /^[A-Z][\w'-]+ family\b/.test(o) ? 'the ' + o : o;
  };
  // merge the sourced interests file into the outlet records (by outlet name); the records file stays the one source for ownership
  C.mergeInterests = function (data, interests) {
    if (!data || !interests) return data;
    for (const e of data.outlets || []) {
      const r = interests[e.name]; if (!r) continue;
      e.interests = (r.interests || []).filter((i) => i && i.topic && Array.isArray(i.terms) && i.terms.length && i.source);
      if (typeof r.wealthy === 'boolean') e.wealthy = r.wealthy;
      if (r.wealthySource) e.wealthySource = String(r.wealthySource).slice(0, 300);
      // the researched owner name is shown only where a checked source backs it: an interest, or a verified change of owner
      if (r.owner && (e.interests.length || (r.ownerChange && r.ownerChange.status === 'verified'))) e.ultimateOwner = r.owner;
    }
    return data;
  };
  C.ownerRelevance = function (entry, page) {
    if (!entry) return [];
    page = page || {};
    const head = [page.title || ''].concat(page.headings || []).join('\n'); const body = String(page.text || '');
    const about = (re) => { re.lastIndex = 0; const inHead = re.test(head); re.lastIndex = 0; const n = (body.match(re) || []).length; re.lastIndex = 0; return inHead || n >= 2; };
    const kinds = (entry.owners || []).map((o) => o.kind); const owner = C.ownerShort(entry);
    const out = [];
    for (const name of C.outletMentions(entry, body)) out.push({ via: 'named', label: name, why: 'This page names ' + name + ', which is in ' + entry.name + '\'s ownership or funding record.' });
    // "a billionaire" only where a checked source says so (owner-interests.json wealthy: true); the record's owner kind alone is not enough
    // (the source check found owners worth under a billion filed as billionaire_individual)
    const wealthy = entry.wealthy === true;
    if (wealthy && about(C.WEALTH_TOPIC)) out.push({ via: 'topic', label: 'taxes on the very wealthy', why: 'This page is about taxes on the very wealthy, and ' + entry.name + ' is owned by ' + owner + C.wealthWords(entry, owner) + '.' });
    if (kinds.includes('private_equity_hedge_fund') && about(C.PE_TOPIC)) out.push({ via: 'topic', label: 'private equity and hedge funds', why: 'This page is about private equity or hedge funds, and ' + entry.name + ' is owned by ' + owner + ', an investment fund.' });
    const own = new RegExp('^(' + [entry.name].concat(entry.domains || []).map((x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i');
    for (const it of entry.interests || []) {
      const terms = (it.terms || []).map(String).filter((t) => t.length >= 3 && !own.test(t));
      if (!terms.length) continue;
      const re = new RegExp('(?<![\\p{L}\\p{N}])(?:' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}])', 'gu');
      if (about(re)) out.push({ via: 'topic', label: it.topic, why: 'This page is about ' + it.topic.replace(/^(The|A|An|Its|Their) /, (m) => m.toLowerCase()) + '. ' + it.why, source: it.source });
    }
    const seen = new Set(); return out.filter((x) => !seen.has(x.label) && seen.add(x.label)).slice(0, 4);
  };
  // Provider and network errors in plain words; the original text stays in the console for debugging
  C.plainError = function (raw) {
    const m = String(raw || '');
    if (/401|invalid.{0,20}(api.?key|x-api-key)|authentication|incorrect api key/i.test(m)) return 'The AI provider rejected the key. Check it in Settings.';
    if (/credit balance|insufficient_quota|billing/i.test(m)) return 'The AI account has no credit left. Add credit with the provider, then try again.';
    if (/429|rate.?limit|overloaded|529/i.test(m)) return 'The AI provider is busy or the key reached its limit. Try again in a minute.';
    if (/failed to fetch|networkerror|network error|load failed|timed? ?out/i.test(m)) return 'Could not reach the service. Check the connection and try again.';
    if (/cancel/i.test(m)) return 'Stopped. Requests already sent may still be billed.';
    return m || 'No response.';
  };
  // Known-bad list: the exact host or a parent domain. A hit reports who listed the site and when, never a verdict of ours.
  C.knownBadLookup = function (data, hostname, now) {
    const parts = String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '').split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(i).join('.'); const rows = ((data && data.entries) || {})[d]; if (!rows) continue;
      // the Czech, phishing and ESMA lists name one address; only HaGeZi's wildcard list and our own entries cover subdomains
      const live = rows.filter((r) => (!r.x || Date.parse(r.x) > (now || Date.now())) && (i === 0 || !['coi', 'phish', 'esma', 'amf'].includes(r.s))); if (!live.length) continue;
      const rank = { coi: 0, esma: 0, amf: 0, manual: 1, phish: 2, hagezi: 3 }; live.sort((x, y) => (rank[x.s] == null ? 9 : rank[x.s]) - (rank[y.s] == null ? 9 : rank[y.s]));
      return { domain: d, rows: live };
    }
    return null;
  };
  C.knownBadFinding = function (data, hit) {
    const r = hit.rows[0]; const src = (data.sources && data.sources[r.s]) || { name: r.s, short: r.s, kind: 'filter_list' };
    const who = r.s === 'manual' ? r.n : src.name; const short = r.s === 'manual' ? r.n : src.short; const version = r.s === 'hagezi' && src.version ? ' (version ' + src.version + ')' : '';
    const why = 'Listed by ' + who + (r.d ? ' on ' + r.d : version || (data.built ? ', list checked ' + data.built : '')) + '.';
    return { id: 'source.listed_warning', category: 'source_funding', source: 'dataset', severity: src.kind === 'filter_list' ? 2 : 3, confidence: 0.9, count: hit.rows.length, label: 'Warning list', why, name: 'On a third-party warning list', biases: [],
      explain: why + ' Subtext did not reach this conclusion itself. ' + (src.caveat || '') + (r.r ? ' The listing says: "' + r.r + '"' : ''), tip: 'Check the listing yourself before paying. Lists can be wrong or out of date, and a domain can change hands.',
      evidence: [{ quote: (r.r || why).slice(0, 220), url: r.u || src.url, elId: null }], meta: { listed: { domain: hit.domain, source: r.s, date: r.d || null } } };
  };
  C.severityLabel = (s) => (s >= 3 ? 'Severe' : s === 2 ? 'Notable' : s === 1 ? 'Minor' : 'Info');
  C.raterLinks = function (name, domain) {
    const q = encodeURIComponent(name || domain || '');
    return [
      { label: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=' + q },
      { label: 'Media Bias/Fact Check', url: 'https://mediabiasfactcheck.com/?s=' + q },
      { label: 'AllSides', url: 'https://www.allsides.com/media-bias/ratings?field_featured_bias_rating_value=All&field_news_source_type_tid%5B0%5D=2&title=' + q },
      { label: 'Ad Fontes', url: 'https://adfontesmedia.com/?s=' + q },
      { label: 'Ground News', url: 'https://duckduckgo.com/?q=' + encodeURIComponent('site:ground.news ' + (name || domain || '')) },
      { label: 'Wikidata', url: 'https://www.wikidata.org/w/index.php?search=' + q },
      { label: 'OpenSecrets', url: 'https://www.opensecrets.org/search?q=' + q },
      { label: 'Nonprofit Explorer (990s)', url: 'https://projects.propublica.org/nonprofits/search?q=' + q },
      { label: 'InfluenceWatch', url: 'https://www.influencewatch.org/?s=' + q },
      { label: 'SourceWatch', url: 'https://www.sourcewatch.org/index.php?search=' + q },
      { label: 'WHOIS / domain age', url: 'https://who.is/whois/' + encodeURIComponent(domain || '') }
    ];
  };
  C.MODELS = [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (cheapest, under a cent per page)', inPrice: 0.1, outPrice: 0.5, fallbacks: false },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (default: sharper readings, about 11 cents per Investigate, 5 more when it searches)', inPrice: 2, outPrice: 10, fallbacks: true },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (second opinion, best at self-contradictions, ~30x the cost)', inPrice: 4, outPrice: 20, fallbacks: true }
  ];
  C.DEFAULT_SETTINGS = { contextAuto: false, contextTrends: true, fecKey: '', aiContextSearch: true, aiProvider: 'anthropic', anthropicKey: '', openaiKey: '', anthropicModel: 'claude-sonnet-5-5', openaiModel: 'gpt-5.5', showBadge: true, hoverTips: true, autoScan: true, policyScan: true, sellerPages: true, tosdrLookup: false, rdapLookup: false, adsTxtLookup: true, aiWebCheck: false, aiInvestigation: true, disabledRules: [], disabledCategories: [], disabledSites: [], maxCharsToAI: 40000 };
  // registrable domain (eTLD+1, with the common two-label public suffixes); mirrors ML.registrableDomain in content/shared.js
  const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'or', 'ne', 'go', 'mil']);
  C.PLATFORM_SUFFIXES = ['livejournal.com', 'over-blog.com', 'itch.io', 'deviantart.com', 'blogspot.com', 'tumblr.com', 'typepad.com', 'substack.com', 'medium.com', 'github.io', 'gitlab.io', 'pages.dev', 'workers.dev', 'netlify.app', 'vercel.app', 'web.app', 'firebaseapp.com', 'herokuapp.com', 'onrender.com', 'fly.dev', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'blogspot.com', 'wordpress.com', 'substack.com', 'wixsite.com', 'myshopify.com', 'weebly.com', 'square.site', 'notion.site', 'webflow.io', 'framer.website', 'glitch.me', 'readthedocs.io', 'gumroad.com'];
  C.registrableDomain = function (host) { if (!host) return ''; host = String(host).toLowerCase().replace(/\.$/, ''); const parts = host.split('.'); const plat = C.PLATFORM_SUFFIXES.find((x) => host.endsWith('.' + x)); if (plat) return parts.slice(-(plat.split('.').length + 1)).join('.'); if (parts.length <= 2) return host; const tld = parts[parts.length - 1], sld = parts[parts.length - 2]; if (tld.length === 2 && SECOND_LEVEL.has(sld) && parts.length >= 3) return parts.slice(-3).join('.'); return parts.slice(-2).join('.'); };
  // Optional sourced outlet context. A dated article path establishes the section and
  // publication day; unknown dates and section landing pages get no policy context.
  C.outletContext = function (entry, pageUrl) {
    const out = { ownership: null, policy: null }; const record = entry && entry.context;
    if (!record) return out;
    let u; try { u = new URL(pageUrl); } catch (e) { return out; }
    if (!['https:', 'http:'].includes(u.protocol) || !(entry.domains || []).some((d) => u.hostname === d || u.hostname.endsWith('.' + d))) return out;
    if (record.ownership && record.ownership.text && record.ownership.source) out.ownership = record.ownership;
    const policy = record.policy;
    if (!policy || !policy.source || !policy.date || !policy.section) return out;
    const m = u.pathname.match(/^\/([^/]+)\/(\d{4})\/(\d{2})\/(\d{2})\/([^/]+)\/?$/);
    if (!m || m[1] !== policy.section) return out;
    const day = m[2] + '-' + m[3] + '-' + m[4]; const parsed = new Date(day + 'T00:00:00Z');
    if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day || day <= policy.date) return out;
    out.policy = policy; return out;
  };
  // One sentence on what is going on: the site's game, from the strongest evidence. Evidence words only, no intent words.
  // Used by the panel and the popup (ui/view.js). A screened interpretation can replace it after Deep analyze.
  const readingCore = function (findings, state) {
    state = state || {}; const F = findings || [];
    const get = (id) => F.find((f) => f.id === id);
    const bm = get('incentives.business_model'); const model = (bm && bm.meta && bm.meta.model) || [];
    const sale = model.some((m) => /direct sales|subscriptions/.test(m)); const ads = model.some((m) => /advertising/.test(m)); const leads = model.some((m) => /lead generation/.test(m)); const donations = model.some((m) => /donations/.test(m));
    // page-level signs first (text, behaviour, structure); third-party vendor findings (tracker.*) only name a tool, not what the reader sees
    const inCat = (cats, min) => F.filter((f) => cats.includes(f.category) && f.severity >= (min || 2) && f.confidence >= 0.6 && !/^tracker\./.test(f.id)).sort((a, b) => b.severity - a.severity || (b.weight || 0) - (a.weight || 0));
    const labelOf = (f) => { const t = String(f.label || f.name || '').replace(/[.]$/, ''); return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t; };
    const pressureAll = inCat(['urgency_scarcity', 'social_proof']); const dark = inCat(['dark_pattern', 'bias_exploit']); const rhet = inCat(['rhetoric', 'emotional', 'interpersonal']); const charts = inCat(['charts']);
    let sawDeadline = false; const pressure = pressureAll.filter((f) => { const isD = /deadline/i.test(labelOf(f)); if (isD && sawDeadline) return false; if (isD) sawDeadline = true; return true; }); // two names for one deadline is one point
    const purchase = get('incentives.purchase_path'); const operator = get('source.unknown_operator'); const web = get('ai.online_warnings'); const product = get('incentives.you_are_the_product');
    const tx = state.report && state.report.transaction;
    const ent = state.outlet && state.outlet.entry; const meta = (state.report && state.report.meta) || {}; const asks = meta.asks || {}; const prov = (state.report && state.report.provenance) || {};
    if (meta.errorPage) { const et = String(state.report.title || '').trim().slice(0, 60); return { text: 'An error or bot-check screen' + (et ? ' ("' + et + '")' : '') + ', so there is nothing to read here yet.', basis: 'rules' }; }
    if (meta.textChars != null && meta.textChars < 300 && !(meta.commerce && meta.commerce.sells) && !F.some((f) => f.severity > 0 && !(f.meta && f.meta.lexical))) return { text: 'Too little text on this page to read anything into it.', basis: 'rules' };
    const v = asks.vendors || {}; const vendorBits = []; if ((v.identity || []).length) vendorBits.push(v.identity.slice(0, 2).join(' and ') + ' to work out who you are'); if ((v.replay || []).length) vendorBits.push(v.replay[0] + ' recording your visit'); if ((v.native || []).length && asks.ads) vendorBits.push("'sponsored' stories from " + v.native[0]);
    const operatorClause = operator && operator.severity >= 1 ? String(operator.why || '').replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()) : '';
    // a page that sells is a shop or a pricing page; an ad-funded page with a subscription box is not a sale page
    const shopPage = !!asks.commerce || prov.platform === 'Shopify';
    const pricingPage = !!(tx && tx.product === 'subscription' && (asks.ads || 0) < 3 && !ent);
    const legal = prov.entity ? prov.entity.replace(/[.,\s]+$/, '') : ''; const nameClause = legal ? (prov.entityVia ? 'its ' + prov.entityVia + ' page names ' : 'the page names ') + legal + (prov.parent ? ', part of ' + prov.parent : '') : prov.copyright ? 'the page names ' + prov.copyright.replace(/[.,\s]+$/, '') : ''; // the page says so; we have not checked it
    const strong = F.filter((f) => f.severity >= 2 && f.confidence >= 0.6).length;
    if (shopPage || (pricingPage && (sale || purchase))) {
      // four axes (pressure, payment route, who answers, refund terms); the concern wording needs two axes at severity 2+ or one at 3
      const pm = purchase && purchase.meta ? purchase.meta : {}; const sig = pm.signals || [];
      const payAxis = sig.includes('one_way_payment') ? 3 : sig.includes('offsite_checkout') ? 2 : 0;
      const refundAxis = sig.includes('guarantee_contradicted') ? 3 : sig.includes('guarantee_no_terms') ? 2 : 0;
      const whoAxis = operator ? operator.severity : 0; const pressAxis = pressure.length ? pressure[0].severity : 0;
      const axes = [payAxis, refundAxis, whoAxis, pressAxis]; const concern = axes.filter((a) => a >= 2).length >= 2 || axes.some((a) => a >= 3);
      const what = tx && tx.marketplace ? 'other sellers\' goods' : tx && tx.product === 'digital' ? 'a digital product' : tx && tx.product === 'subscription' ? 'a subscription' : tx && tx.product === 'physical' ? 'goods' : 'products';
      const parts = []; const renew = get('policy.auto_renewal'), noref = get('policy.non_refundable');
      parts.push((concern && pressure.length ? 'A pressure sale of ' : 'A sale of ') + what + (prov.platform && /Shopify|Wix|Squarespace|WordPress|Webflow|Kajabi|Teachable/.test(prov.platform) ? ' on a ' + prov.platform + ' store' : '') + (pressure.length ? ' (' + pressure.slice(0, 2).map(labelOf).join(', ') + (dark.length ? ', ' + labelOf(dark[0]) : '') + ')' : dark.length ? ' (' + labelOf(dark[0]) + ')' : ''));
      if (pm.irreversible && pm.irreversible.length && !(pm.mainstream || []).length) parts.push('payment by ' + pm.irreversible.slice(0, 3).join(', ') + ' only');
      else if (pm.irreversible && pm.irreversible.length) parts.push('payment by card or ' + pm.irreversible[0]);
      else if (pm.mainstream && pm.mainstream.length) parts.push('payment by ' + (pm.mainstream.length > 2 ? 'card' : pm.mainstream.join(' or ')));
      else if (purchase && concern) parts.push('payment methods not shown on this page');
      if (sig.includes('merchant_of_record')) parts.push('sold through ' + pm.checkout.processor + ', the seller of record');
      else if (sig.includes('offsite_checkout')) parts.push('checkout on an unrelated domain');
      else if (sig.includes('affiliate_checkout')) parts.push('sold through an affiliate network');
      else if (sig.includes('processor_checkout')) parts.push('checkout via ' + pm.checkout.processor);
      else if (sig.includes('sold_by') && tx && tx.soldBy) parts.push('sold by ' + tx.soldBy);
      if (sig.includes('sponsored_placements') && tx) parts.push(tx.sponsoredPlacements + ' sponsored placements paid for by other sellers');
      if (tx && tx.perSeat) parts.push('priced per seat, so every invite raises the bill'); if (tx && tx.setupFee) parts.push('a setup fee of ' + tx.setupFee); if (tx && tx.takeRate) parts.push('takes ' + tx.takeRate + '% of each sale on some plans');
      if (tx && tx.renewsAt) parts.push('intro price, renews at ' + tx.renewsAt + (tx.renewalJump ? ' (' + tx.renewalJump + 'x at renewal)' : '') + (tx.upfront ? ', ' + tx.upfront : '')); else if (tx && tx.upfront && !/^for the first/.test(tx.upfront)) parts.push(tx.upfront);
      const seller = get('source.thin_shop') || (operator && operator.meta && operator.meta.shop ? operator : null); const sellerSaid = !!(seller && seller.severity > 0 && !(state.owner && state.owner.row) && !(state.outlet && state.outlet.entry)); // the shop facts, stated as facts; not when a record names the owner (Udemy's course page shows no company name, but Coursera owns it)
      if (sellerSaid) parts.splice(1, 0, String(seller.why).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()));
      { const of = C.ownerFacts(state, state.report && state.report.hostname, true); if (of && of.text && !(state.outlet && state.outlet.entry)) parts.push(of.text + (of.sourced ? '' : ' (per ' + of.via + ')')); else if (operatorClause && !sellerSaid && !(seller && state.owner && state.owner.row)) parts.push(operatorClause); else if (nameClause) parts.push(nameClause); else if (state.outlet && state.outlet.entry) parts.push('run by ' + state.outlet.entry.name); }
      const statedRefund = sig.includes('refund_stated'); if (renew || (noref && !statedRefund)) parts.push('the terms say ' + [renew ? 'it auto-renews' : '', noref && !statedRefund ? 'refunds only where they expressly allow' : ''].filter(Boolean).join(' and '));
      if (sig.includes('guarantee_contradicted')) parts.push('a money-back promise the small print cancels'); else if (sig.includes('guarantee_no_terms')) parts.push('a guarantee with no refund terms'); else if (sig.includes('refund_stated')) parts.push('refund terms stated on the page'); else if (sig.includes('no_refunds')) parts.push('no refunds, stated'); else if (noref) { /* the terms answer it below */ } else if (sig.includes('return_window') && tx) parts.push('returns within ' + tx.returnWindow + ' days'); else if (pm.refundLink) parts.push('refund terms linked');
      if (web && web.severity >= 2) parts.push('already flagged online');
      return { text: parts.slice(0, 5).join('; ') + '.', basis: 'rules', concern };
    }
    // commissioned recommendations: many partner links, no direct sale of its own
    const aff = asks.affiliate || 0; const disclosure = F.find((f) => f.id === 'source.affiliate_disclosure' && f.evidence && f.evidence[0]);
    const recoKind = ['review', 'guide', 'listicle'].includes(meta.pageKind) || /\b(best|top \d+|vs\.?|review)\b/i.test(String(state.report && state.report.title || ''));
    const refs = (meta.commerce && meta.commerce.referralCtas) || 0;
    if ((aff >= 15 || (aff >= 4 && (recoKind || refs >= 1)) || refs >= 3 || (disclosure && recoKind)) && !(purchase && purchase.severity >= 3)) {
      const parts = ['A commissioned recommendation page' + (ent ? ' from ' + ent.name : '')];
      parts.push(aff ? aff + ' partner links earn the publisher when you buy or apply' : refs ? refs + ' apply or deal buttons send you to other companies, which usually pay for the referral' : 'links on it earn the publisher when you buy or apply');
      const affF = get('source.affiliate_links'); parts.push(disclosure ? 'the page says "' + String(disclosure.evidence[0].match || disclosure.evidence[0].quote).replace(/^…|…$/g, '').slice(0, 70) + '"' : affF && /disclosed/i.test(String(affF.why || '') + String(affF.name || '')) ? 'the page discloses this' : 'no commission disclosure found on the page');
      if (asks.ads) parts.push(asks.ads + ' ad compan' + (asks.ads > 1 ? 'ies' : 'y') + ' besides');
      if (operator && operator.severity >= 1) parts.push('no company name or address found');
      if (web && web.severity >= 2) parts.push('already flagged online');
      return { text: parts.slice(0, 5).join('; ') + '.', basis: 'rules' };
    }
    // an institution by registry rule (.gov, .edu, .gov.uk ...): say so, then what the page asks
    if (prov.institution && !ent) {
      const onPage = []; if (asks.ads) onPage.push(asks.ads + ' ad compan' + (asks.ads > 1 ? 'ies' : 'y')); if (asks.newsletter) onPage.push('a newsletter signup'); if (asks.dataVendors) onPage.push(asks.dataVendors + ' tracking vendor' + (asks.dataVendors > 1 ? 's' : '')); if (asks.registration) onPage.push('a sign-in');
      return { text: 'A page from ' + prov.institution + '; on this page: ' + (onPage.length ? onPage.join(', ') : 'no ads or prompts') + (rhet.length >= 2 ? '; ' + rhet.slice(0, 2).map(labelOf).join(' and ') : '') + '.', basis: 'rules' };
    }
    // a page hosted on a platform (Substack, Shopify, Wix ...): the platform is the venue, the account holder is the publisher
    if (prov.platform && !ent && !shopPage && !pricingPage) {
      const onPage = []; if (asks.subscription) onPage.push('a subscription prompt'); if (asks.newsletter) onPage.push('an email signup'); if (asks.support) onPage.push('a request for money'); if (asks.ads) onPage.push(asks.ads + ' ad compan' + (asks.ads > 1 ? 'ies' : 'y')); onPage.push(...vendorBits);
      return { text: 'A page hosted on ' + prov.platform + ' (the account holder is the publisher' + (/Substack|beehiiv|Ghost|Medium|Kajabi|Teachable/.test(prov.platform) ? ', paid subscriptions run through the platform' : '') + ')' + (onPage.length ? '; on this page: ' + onPage.join(', ') : '') + (operatorClause ? '; ' + operatorClause : prov.copyright ? '; copyright line: ' + prov.copyright : '') + '.', basis: 'rules' };
    }
    // a page from a known outlet: name the business behind the free page and what this page does for it
    if (ent && !shopPage && !pricingPage) {
      const earns = (ent.funding || []).slice(0, 3).map((f) => f.replace(/\s*\(.*?\)/g, '')).join(', ');
      const onPage = []; if (asks.ads) onPage.push(asks.ads + ' ad compan' + (asks.ads > 1 ? 'ies' : 'y')); if (asks.pixels) onPage.push(asks.pixels + ' ad-tracking compan' + (asks.pixels > 1 ? 'ies' : 'y')); if (asks.support) onPage.push('a request for money'); if (asks.subscription) onPage.push('a subscription prompt'); if (asks.newsletter) onPage.push('a newsletter signup'); if (asks.affiliate >= 2) onPage.push(asks.affiliate + ' partner links'); onPage.push(...vendorBits); if (asks.dataVendors && !vendorBits.length) onPage.push(asks.dataVendors + ' tracking vendor' + (asks.dataVendors > 1 ? 's' : ''));
      const funded = F.find((f) => f.id === 'source.funded_section'); const practice = F.find((f) => f.id === 'ai.outlet_dossier' && f.meta && f.meta.practiceLine);
      const context = C.outletContext(ent, (state.report && state.report.url) || state.url);
      const ownerName = String((ent.owners && ent.owners[0] && ent.owners[0].name) || '').split(';')[0].split(' (')[0].trim(); const squash = (s) => String(s).toLowerCase().replace(/^the /, '').replace(/[^a-z0-9]/g, ''); const firstOfName = squash(String(ent.name).split(/\s*\(/)[0]); const ownerClause = ownerName && !squash(ownerName).includes(firstOfName) && !firstOfName.includes(squash(ownerName).slice(0, 6)) && ownerName.length < 60 ? ', owned by ' + ownerName : '';
      // the owner and the outlet's business lead only when this item involves the owner or a named funder (meta.ownerMentions); a recipe
      // does not inherit its publisher's owner. A section policy (an opinion section's stated line) is scoped to that section and stays.
      const links = meta.ownerLinks || ((meta.ownerMentions) || []).map((m) => ({ via: 'named', label: m }));
      const ownerRelevant = links.length > 0;
      const parts = ownerRelevant ? (context.ownership ? [context.ownership.text] : ['A page from ' + ent.name + ownerClause + (earns ? ', which earns from ' + earns : '')]) : ['A page from ' + ent.name];
      { const named = links.filter((l) => l.via === 'named').slice(0, 2).map((l) => l.label), topics = links.filter((l) => l.via === 'topic').slice(0, 2).map((l) => l.label);
        if (named.length) parts.push('it names ' + named.join(' and ') + ', in its owner\'s or funders\' record');
        if (topics.length) parts.push('it is about ' + topics.join(' and ') + ', which touches its owner\'s interests'); }
      if (context.policy) parts.push(context.policy.text);
      if (ownerRelevant && context.ownership && earns && !context.policy) parts.push('the paper earns from ' + earns);
      parts.push('on this page: ' + (onPage.length ? onPage.join(', ') : 'no ads or prompts'));
      { const adFact = C.adsTxtClause(state, !!asks.ads); if (adFact) parts.push(adFact); }
      if (asks.consentOrPay) parts.push('refusing cookies means paying');
      if (asks.donate) parts.push('donations go through ' + asks.donate.host + (asks.donate.taxNote ? ' (' + asks.donate.taxNote + ')' : '') + (asks.donate.deadline ? ', with a dated ask' : ''));
      if (funded && funded.evidence && funded.evidence[0]) parts.push('this section is ' + String(funded.evidence[0].match || funded.evidence[0].quote).replace(/^…|…$/g, '').toLowerCase());
      if (rhet.length >= 2) parts.push(rhet.slice(0, 2).map(labelOf).join(' and ')); // one lexical hit on a news page is noise; a pattern is not
      if (practice) parts.push(practice.meta.practiceLine);
      if (web && web.severity >= 2) parts.push('already flagged online');
      return { text: parts.slice(0, 5).join('; ') + '.', basis: 'rules' };
    }
    // a site the public record can name: the same sentence as a known outlet. Payers come from what this page shows, never from the record.
    const facts = !shopPage && !pricingPage ? C.ownerFacts(state, state.report && state.report.hostname, true) : null;
    if (facts && facts.text) {
      const payers = []; if (asks.ads) payers.push('advertisers'); if ((asks.affiliate || 0) >= 2) payers.push('commissions'); if (asks.subscription || (asks.funding || []).some((v) => /Memberful|Patreon|Ko-fi|Buy Me a Coffee/.test(v))) payers.push('readers'); if (asks.donate || asks.support) payers.push('donors');
      const site = facts.site || String(state.report && state.report.hostname || '').replace(/^www\./, '');
      const parts = [/^its ads\.txt/.test(facts.text) ? 'A page from ' + site + (payers.length ? ', earning from ' + payers.join(' and ') : '') : 'A page from ' + site + ', ' + facts.text + (facts.sourced ? '' : ' (per ' + facts.via + ')') + (payers.length ? ', earning from ' + payers.join(' and ') : '')]; if (/^its ads\.txt/.test(facts.text)) parts.push(facts.text);
      const onPage = []; if (asks.ads) onPage.push(asks.ads + ' ad compan' + (asks.ads > 1 ? 'ies' : 'y')); if (asks.pixels) onPage.push(asks.pixels + ' ad-tracking compan' + (asks.pixels > 1 ? 'ies' : 'y')); if (asks.affiliate >= 2) onPage.push(asks.affiliate + ' partner links'); if (asks.subscription) onPage.push('a subscription prompt'); if (asks.newsletter) onPage.push('an email signup'); onPage.push(...vendorBits); if (asks.consentOrPay) onPage.push('refusing cookies means paying');
      if (onPage.length) parts.push('on this page: ' + onPage.join(', '));
      { const adFact = C.adsTxtClause(state, !!asks.ads); if (adFact) parts.push(adFact); }
      if (rhet.length >= 2) parts.push(rhet.slice(0, 2).map(labelOf).join(' and '));
      if (web && web.severity >= 2) parts.push('already flagged online');
      return { text: parts.slice(0, 4).join('; ') + '.', basis: 'rules' };
    }
    // from here on: no dataset row, no sale, no platform, no institution. Say what the page shows, in order of who pays.
    const who = operatorClause || nameClause;
    const onPage = []; if (asks.ads) onPage.push(asks.ads + ' ad compan' + (asks.ads > 1 ? 'ies' : 'y')); if (asks.pixels) onPage.push(asks.pixels + ' ad-tracking compan' + (asks.pixels > 1 ? 'ies' : 'y')); if (asks.subscription) onPage.push('a subscription prompt'); if (asks.newsletter) onPage.push('an email signup'); onPage.push(...vendorBits); if (asks.consentOrPay) onPage.push('refusing cookies means paying');
    const voice = rhet.length >= 2 || (rhet[0] && rhet[0].severity >= 3) ? rhet.slice(0, 2).map(labelOf).join(' and ') : '';
    const memberVia = (asks.funding || []).find((v) => /Memberful|Patreon|GitHub Sponsors|Ko-fi|Buy Me a Coffee/.test(v));
    const sponsorMsgs = !asks.ads && (get('dark.disguised_ads') || get('source.sponsored_content'));
    let opener;
    if (asks.ads && voice) opener = 'An ad-funded page leaning on charged language';
    else if (memberVia && !asks.ads) opener = 'Reader-funded through ' + memberVia;
    else if (leads) opener = 'A page built around a contact-details form';
    else if (asks.donate && !asks.ads) opener = 'A site that takes donations through ' + asks.donate.host + (asks.donate.taxNote ? ' (' + asks.donate.taxNote + ')' : '');
    else if (asks.ads) opener = 'An ad-funded page' + (memberVia ? ' with paid memberships through ' + memberVia : '');
    else if (meta.pageKind === 'donation') opener = 'A donation page';
    else if (asks.marketing || get('policy.auto_renewal')) opener = 'A marketing page for the site\'s own product'; // terms that auto-renew mean something is sold, whatever the buttons say
    else if (meta.pageKind === 'index') opener = 'A list of links, with no ad slots or buy buttons found';
    else if (asks.subscription) opener = 'A free page with a subscription offer';
    else if (sponsorMsgs) opener = 'A page that carries ' + ((asks.funding || []).find((v) => /Carbon|EthicalAds/.test(v)) || 'sponsor') + ' messages' + (asks.pixels || vendorBits.length ? ', and visitors are tracked' : '');
    else if (asks.pixels || vendorBits.length) opener = 'No buy buttons or ad slots found, but visitors are tracked';
    else if ((state.adsTxt || {}).records) opener = 'No ad slots seen on this page';
    else opener = 'No ad slots or buy buttons found on this page';
    const parts = [opener]; { const adFact = C.adsTxtClause(state, !!asks.ads); if (adFact) parts.push(adFact); }
    if (onPage.length) parts.push((/^No ad slots/.test(opener) ? 'it asks for ' : 'on this page: ') + onPage.join(', '));
    if (voice) parts.push(voice);
    if (asks.marketing && (get('policy.auto_renewal') || get('policy.non_refundable'))) parts.push('the terms say ' + [get('policy.auto_renewal') ? 'it auto-renews' : '', get('policy.non_refundable') ? 'refunds only where they expressly allow' : ''].filter(Boolean).join(' and '));
    if (pressure.length && !shopPage) parts.push(pressure.slice(0, 2).map(labelOf).join(' and '));
    if (charts.length) parts.push('charts that distort');
    const darkShown = dark.filter((f) => f.id !== 'dark.disguised_ads' || !sponsorMsgs); if (darkShown.length) parts.push(labelOf(darkShown[0]));
    if (web && web.severity >= 2) parts.push('already flagged online');
    if (who) parts.push(who);
    return { text: parts.slice(0, 5).join('; ') + '.', basis: 'rules' };
  };
  // a third-party listing comes first: it is the one thing on the page someone else already vouched for
  C.reading = function (findings, state) {
    let r = readingCore(findings, state);
    // the item itself is labelled as paid for (engine.js paidItem): that leads, with the sponsor when the label or its logo names one.
    // A sponsored link elsewhere on the page does not count (16 Nov 2026 review: paid features read as ordinary Guardian pages).
    // republished reporting (engine.js wireCopy): say whose reporting it is first
    const wire = state && state.report && state.report.meta && state.report.meta.wire;
    if (r && wire && wire.source && !/^An error|^Too little/.test(r.text)) r = Object.assign({}, r, { text: 'This is ' + wire.source + '\'s reporting, republished here (the page credits "' + String(wire.line).slice(0, 60) + '"). ' + r.text });
    const paid = state && state.report && state.report.meta && state.report.meta.paidItem;
    if (r && paid && paid.label && !/^An error|^Too little/.test(r.text)) {
      const label = String(paid.label).split(/(?<=[.!?])\s/)[0].replace(/[.:]$/, '').slice(0, 70);
      r = Object.assign({}, r, { text: 'This item is paid for' + (paid.sponsor ? ' by ' + paid.sponsor : '') + ': the page labels it "' + label + '". ' + r.text.replace(/^A page that carries sponsor messages;?\s*/, '').replace(/^./, (c) => c.toUpperCase()) });
    }
    // the most serious thing the site's own terms say belongs in the top line
    if (r && !/^An error|^Too little/.test(r.text)) { const sells = (findings || []).find((f) => f.id === 'policy.sells_personal_info' && f.severity >= 2); if (sells && !/sell/i.test(r.text)) r.text = r.text.replace(/\.$/, '') + "; its privacy policy says it sells or shares your data."; } const listed = (findings || []).find((f) => f.id === 'source.listed_warning');
    // a scam pattern the page itself states (rules/scam-patterns.json) leads, quoted as what the page says, after any third-party listing
    const said = (findings || []).filter((f) => /^scam\./.test(f.id) && f.severity >= 2).sort((a, b) => b.severity - a.severity)[0];
    const lead = (listed ? String(listed.why).replace(/\.$/, '') + '. ' : '') + (said ? 'The page ' + String(said.why).replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase()) + '. ' : '');
    if (!lead || !r) return r;
    return Object.assign({}, r, { text: lead + r.text, concern: r.concern || (listed && listed.severity >= 3) || (said && said.severity >= 3) });
  };
  // ads.txt, the public file a site uses to say who may sell its ad space. Facts only: it shows the site sells ad space, not that this page carries ads, and files go stale.
  C.AD_MANAGERS = { 'mediavine.com': 'Mediavine', 'adthrive.com': 'Raptive', 'raptive.com': 'Raptive', 'ezoic.com': 'Ezoic', 'freestar.com': 'Freestar', 'monumetric.com': 'Monumetric', 'playwire.com': 'Playwire', 'venatus.com': 'Venatus', 'snigel.com': 'Snigel', 'adapex.io': 'Adapex', 'sortable.com': 'Sortable', 'setupad.com': 'Setupad', 'nitropay.com': 'NitroPay', 'pubnation.com': 'PubNation', 'journeymv.com': 'Journey by Mediavine', 'sheknows.com': 'SHE Media', 'cafemedia.com': 'Raptive' };
  C.parseAdsTxt = function (text) {
    const body = String(text || ''); if (!body.trim() || /^\s*<(!doctype|html|head|body)/i.test(body) || /<html[\s>]/i.test(body.slice(0, 2000))) return null;
    const out = { records: 0, direct: 0, reseller: 0, systems: 0, owner: null, manager: null, managerName: null }; const sys = new Set();
    for (const raw of body.split(/\r?\n/)) {
      const l = raw.split('#')[0].trim(); if (!l) continue;
      const v = l.match(/^(OWNERDOMAIN|MANAGERDOMAIN)\s*=\s*([a-z0-9.-]+\.[a-z]{2,})/i);
      if (v) { const k = v[1].toUpperCase() === 'OWNERDOMAIN' ? 'owner' : 'manager'; if (!out[k]) out[k] = v[2].toLowerCase(); continue; }
      const p = l.split(',').map((x) => x.trim()); if (p.length < 3 || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p[0])) continue;
      const rel = p[2].toUpperCase(); if (rel !== 'DIRECT' && rel !== 'RESELLER') continue;
      out.records++; if (rel === 'DIRECT') out.direct++; else out.reseller++; const d = p[0].toLowerCase(); sys.add(d);
      if (!out.managerName && C.AD_MANAGERS[d] && rel === 'DIRECT') out.managerName = C.AD_MANAGERS[d];
    }
    if (!out.records && !out.owner) return null;
    out.systems = sys.size; if (out.manager && C.AD_MANAGERS[out.manager]) out.managerName = C.AD_MANAGERS[out.manager];
    return out;
  };
  // Who owns the site, from the most accountable record we hold. The reader sees the source in the line. Never a guess: no record means no owner clause.
  const squashName = (s) => String(s || '').toLowerCase().replace(/^the /, '').replace(/\b(inc|llc|ltd|limited|plc|corp|corporation|company|co|group|gmbh|ag|sa|bv)\b\.?/g, '').replace(/[^\p{L}\p{N}]/gu, '');
  // Wikidata rows failed their test on 5 Nov 2026: 35 of 60 fair to show, 13 stale after a sale. The 20 AI-researched rows were checked on 6 Nov: 12 of 20 fair, 1 stale. Neither reaches the top line until a person checks it. They appear in the Source card, marked as possibly out of date, and are never stated in the top line (forLine).
  C.ownerFacts = function (state, host, forLine) {
    state = state || {}; const r0 = state.owner && state.owner.row; const r = r0 && forLine && !r0.checked_by ? null : r0; /* a row reaches the top line only after a person has checked it */ const ads = state.adsTxt;
    const here = C.registrableDomain(String(host || (state.report && state.report.hostname) || '').replace(/^www\./, ''));
    if (r) {
      const name = r.top || r.owner || ''; const same = name && (squashName(name).includes(squashName(r.site)) || squashName(r.site).includes(squashName(name)));
      if (r.kind === 'publicly_traded' || (same && r.kind === 'public_company')) return { site: r.site, text: 'a publicly traded company', sourced: !!r.source, via: r.source || 'Wikidata', asOf: r.as_of, url: r.url };
      if (name && !same && name.length < 60) return { site: r.site, owner: name, kind: r.kind, text: 'owned by ' + name, via: r.source || 'Wikidata', asOf: r.as_of, url: r.url, sourced: !!r.source };
    }
    if (ads && ads.owner && here && C.registrableDomain(ads.owner) !== here) return { site: r ? r.site : '', owner: ads.owner, text: 'its ads.txt names ' + ads.owner + ' as owner', via: 'ads.txt', sourced: true };
    // the company on the site's ad-exchange contracts (data/operators.json, from public sellers.json files): who runs it day to day; two or more listings before the top line uses it
    const op = state.operator; if (op && op.name && (!forLine || op.count >= 2) && !(r && (r.top || r.owner))) return { site: r ? r.site : '', operator: op.name, text: 'run by ' + op.name.replace(/[,.\s]+$/, ''), via: 'the ad exchanges that pay it (sellers.json, ' + op.count + (op.count === 1 ? ' listing' : ' listings') + ')', sourced: true, asOf: op.built };
    return r ? { site: r.site } : null;
  };
  C.adsTxtClause = function (state, adsSeen) {
    const a = state && state.adsTxt; if (!a || !a.records) return ''; const n = a.systems;
    if (a.managerName) return a.managerName + ' sells its ads, per its ads.txt';
    return !adsSeen && n >= 3 ? 'it sells ad space through ' + n + ' ad networks, per its ads.txt' : ''; // one or two lines in the file may be left over; a count says the site is set up to sell ads
  };
  // RDAP (public domain registration record) → { registered, expires, updated, registrar, registrant, redacted, ageDays, status }
  C.parseRdap = function (j, proxyPattern, now) {
    const out = { registered: null, expires: null, updated: null, registrar: null, registrant: null, registrantRole: false, redacted: false, ageDays: null, status: (j && j.status) || [], ldh: (j && (j.ldhName || j.unicodeName)) || null };
    if (!j || typeof j !== 'object') return out;
    const PRIV = proxyPattern instanceof RegExp ? proxyPattern : new RegExp(proxyPattern || 'redacted|privacy|proxy|withheld', 'i');
    for (const e of j.events || []) { const a = String(e.eventAction || '').toLowerCase(); if (a === 'registration' && !out.registered) out.registered = e.eventDate; else if (a === 'expiration') out.expires = e.eventDate; else if (a === 'last changed') out.updated = e.eventDate; }
    const vcard = (arr) => { const o = {}; try { for (const p of (arr && arr[1]) || []) { const k = String(p[0]).toLowerCase(); const v = Array.isArray(p[3]) ? p[3].filter(Boolean).join(' ') : p[3]; if (v && !o[k]) o[k] = String(v); } } catch (e) { /* ignore */ } return o; };
    const walk = (ents, depth) => { for (const e of ents || []) { const roles = (e.roles || []).map((r) => String(r).toLowerCase()); const v = vcard(e.vcardArray); if (roles.includes('registrar') && !out.registrar) out.registrar = v.fn || v.org || null; if (roles.includes('registrant')) { out.registrantRole = true; const name = v.fn || v.org || ''; const txt = name + ' ' + (v.org || '') + ' ' + (e.remarks || []).map((r) => (r.title || '') + ' ' + (r.description || []).join(' ')).join(' '); if (!name || PRIV.test(txt)) out.redacted = true; else out.registrant = name.slice(0, 80); } if (depth < 2) walk(e.entities, depth + 1); } };
    walk(j.entities, 0);
    for (const r of (j.remarks || []).concat(j.notices || [])) { const t = (r.title || '') + ' ' + (r.description || []).join(' '); if (/redacted for privacy|data redacted/i.test(t) && !out.registrant) out.redacted = true; }
    if (out.registered) { const t = Date.parse(out.registered); if (!isNaN(t)) out.ageDays = Math.max(0, Math.floor(((now || Date.now()) - t) / 86400000)); }
    return out;
  };
  root.MLCommon = C;
})(typeof globalThis !== 'undefined' ? globalThis : this);
