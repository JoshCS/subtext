/* Context from public data: what the page is about, which question a source may answer, series rules, budget, cookies.
   Responses are synthetic, in each source's real response shape (no recorded third-party content). The chart drawing is tested in test/context-chart.js. */
const assert = require('assert');
const X = require('../extension/context-data.js');

const NOW = new Date('2026-11-17T12:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 864e5);
const rss = (items) => '<rss><channel>' + items.map((i) => '<item><title>' + i.t + '</title><link>https://news.example/' + encodeURIComponent(i.t) + '</link><pubDate>' + i.d.toUTCString() + '</pubDate><source url="https://' + i.host + '">' + i.s + '</source></item>').join('') + '</channel></rss>';
const monthly = (n, base, spikeAt, spike) => ({ items: Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2024, 10 + i, 1)); return { timestamp: d.toISOString().slice(0, 7).replace('-', '') + '0100', views: i === spikeAt ? spike : base + (i % 3) * 10 }; }) });
const daily = (n, base) => ({ items: Array.from({ length: n }, (_, i) => ({ timestamp: day(n - i).toISOString().slice(0, 10).replace(/-/g, '') + '00', views: base + i })) });
const trendsExplore = ")]}'\n" + JSON.stringify({ widgets: [{ id: 'TIMESERIES', token: 'tok', request: { time: '12m' } }] });
// 53 weekly points; the last one starts 2 days before NOW, so that week is still in progress
const trendsLine = ")]}',\n" + JSON.stringify({ default: { timelineData: Array.from({ length: 53 }, (_, i) => ({ time: String(Math.floor(day(2 + 7 * (52 - i)).getTime() / 1000)), value: [i === 20 ? 100 : i === 52 ? 3 : 20 + (i % 5)], hasData: [true] })) } });
// a Wikidata entity in the wbgetentities shape
const claim = (v) => [{ mainsnak: { datavalue: { value: v } } }];
const wd = (q, label, enwiki, claims, description) => ({ entities: { [q]: { labels: { en: { value: label } }, descriptions: description ? { en: { value: description } } : {}, sitelinks: enwiki ? { enwiki: { title: enwiki } } : {}, claims } } });
const HUMAN = { P31: claim({ id: 'Q5' }) };
const COMPANY = { P31: claim({ id: 'Q4830453' }), P856: claim('https://example.com'), P169: claim({ id: 'Q1' }), P414: claim({ id: 'Q82059' }), P5531: claim('0001045810'), P17: claim({ id: 'Q30' }), P571: claim({ time: '+1993-04-05T00:00:00Z' }) };
const NONPROFIT = { P31: claim({ id: 'Q163740' }), P856: claim('https://example.org'), P1297: claim('13-3871360'), P17: claim({ id: 'Q30' }) };
const TAXON = { P225: claim('Pisum sativum'), P31: claim({ id: 'Q16521' }) };
const PLACE = { P625: claim({ latitude: 42, longitude: -71 }), P1082: claim({ amount: '+650000' }), P856: claim('https://boston.gov'), P571: claim({ time: '+1630-00-00T00:00:00Z' }) };
const OUTLET = { P31: claim({ id: 'Q11032' }), P856: claim('https://www.example-news.com'), P571: claim({ time: '+1872-03-04T00:00:00Z' }), P17: claim({ id: 'Q30' }) };

function fakeIo(routes) {
  const calls = [];
  return { calls, get: async (url, opt) => { calls.push({ url, cookies: !!(opt && opt.cookies) }); for (const [re, body] of routes) if (re.test(decodeURIComponent(url))) return typeof body === 'function' ? body(url) : { status: 200, text: typeof body === 'string' ? body : JSON.stringify(body) }; return { status: 404, text: '' }; } };
}
const siteFacts = [
  [/web\.archive\.org\/cdx/, [['timestamp'], ['1998'], ['1999'], ['2000'], ['2016'], ['2026']]],
  [/tranco-list\.eu/, { ranks: [{ date: '2026-11-16', rank: 3740 }, { date: '2026-11-01', rank: 3800 }] }],
  [/dns\.google/, { Answer: [{ data: '"openai-domain-verification=abc"' }, { data: '"google-site-verification=x"' }, { data: '"tollbit-domain-verification=y"' }, { data: '"v=spf1 include:_spf.google.com ~all"' }] }],
];
const article = (over) => X.pageFacts(Object.assign({ url: 'https://www.example-news.com/2026/11/01/story/', siteName: 'Example News', pageKind: 'article', isArticle: true, entityQ: 'Q100' }, over));

(async () => {
  // ---- topic words: one ordinary word is never a subject
  const pasta = X.topicTerms({ title: 'A weeknight pasta with lemon and peas | Food | The Guardian', siteName: 'The Guardian', text: 'This is a simple pasta. Use frozen peas and a lemon. Add the peas. A note on peas: frozen peas are sweet. Fresh peas are lovely. Pasta again, pasta.' });
  assert.strictEqual(pasta.entity + pasta.topic + pasta.keyword, '', 'a recipe names no subject: ' + JSON.stringify(pasta));
  const econ = X.topicTerms({ title: 'Taxing Wealth Makes Sense, But It Won’t Fix Our Economy', siteName: 'TIME', text: 'The economy is slowing. Our economy needs more. An economy like this. Economy watchers say the economy.' });
  assert.strictEqual(econ.entity, '', 'a headline capital does not make "Economy" a name');
  const nv = X.topicTerms({ title: 'Nvidia spy scandal underlines China threat', siteName: 'Washington Examiner', text: 'Nvidia said on Monday. Shares of Nvidia fell. The chips Nvidia sells. Nvidia again.' });
  assert.strictEqual(nv.entity, 'Nvidia', 'a word the page always capitalises is a name');
  const kirk = X.topicTerms({ title: 'Jennifer Welch laughs at Charlie Kirk joke', siteName: 'Fox News', text: 'Welch said. Then Charlie Kirk was named. Fans of Charlie Kirk replied. Charlie Kirk again.' });
  assert.strictEqual(kirk.entity, 'Charlie Kirk');
  const tax = X.topicTerms({ title: 'Taxing billionaires in Calif. goes to the ballot - The Boston Globe', siteName: 'The Boston Globe', text: 'A billionaire tax would apply once. The billionaire tax measure. Supporters of the billionaire tax say', url: 'https://example.com/2026/11/01/billionaire-tax-ballot/' });
  assert.strictEqual(tax.title, 'Taxing billionaires in Calif. goes to the ballot'); assert.strictEqual(tax.topic, 'billionaire tax');
  assert.ok(!/fix a/i.test(X.topicTerms({ title: 'How to Fix a Running Toilet', siteName: 'Bob Vila', text: 'a running toilet wastes water; fix a running toilet; running toilet parts' }).topic), 'a fragment with a small word inside is not a phrase');

  const owners = X.topicTerms({ title: 'Boston sports political donations: How team owners gave ahead of midterms', siteName: 'The Boston Globe', siteNames: ['Boston Globe', 'bostonglobe'], article: true, text: 'The Red Sox owner gave nothing. Kraft Group executives gave. A Red Sox spokesman said. Employees of the Red Sox gave. The Kraft Group again. For the Red Sox, the cycle was quiet. Celtics staff gave.' });
  assert.strictEqual(X.topicTerms({ title: 'The 6 best robot vacuums in 2026', siteName: 'X', text: 'Dreame D10 Plus. The Dreame D10 Plus. Buy Dreame D10 Plus. Dreame D10 Plus again. robot vacuums, robot vacuums.' }).entity, '', 'on a guide, the most repeated product is not the subject');
  assert.strictEqual(owners.entity, 'Red Sox', 'the name the text returns to most, when the headline names none: ' + JSON.stringify(owners));
  assert.strictEqual(X.topicTerms({ title: 'Nvidia spy scandal', siteName: 'X', text: 'Nvidia said. Nvidia fell. Nvidia chips. Jensen Huang said. Jensen Huang again. Jensen Huang spoke. Jensen Huang left. Nvidia.' }).entity, 'Nvidia', 'a headline name outranks a name only in the text');

  // ---- what kind of thing: a species, a place and an idea are never subjects
  assert.strictEqual(X.entityFrom('Q1', { claims: TAXON }).kind, 'other', 'a species');
  assert.strictEqual(X.entityFrom('Q2', { claims: PLACE }).kind, 'other', 'a city, even with a website and a founding date');
  assert.strictEqual(X.entityFrom('Q3', { claims: HUMAN }).kind, 'person');
  assert.strictEqual(X.entityFrom('Q148', { claims: { P1082: claim({ amount: '+1400000000' }), P36: claim({ id: 'Q956' }), P2139: claim({ amount: '+1' }), P856: claim('https://gov.cn') } }).kind, 'other', 'a country, even with an economy and a website');
  const co = X.entityFrom('Q4', { claims: COMPANY }); assert.deepStrictEqual([co.kind, co.cik, co.country, co.founded], ['organization', '0001045810', 'US', '1993']);
  assert.strictEqual(X.entityFrom('Q5x', { claims: NONPROFIT }).ein, '133871360', 'tax id digits only');
  assert.strictEqual(X.entityFrom('Q6', { claims: {} }).kind, 'other', 'an item with no telling claims');

  const TICK = { NYT: [71691, 'NEW YORK TIMES CO'], BIRD: [1653909, 'Smartbird, Inc.'] };
  assert.strictEqual(X.cikFromTicker({ ticker: 'NYT', label: 'The New York Times Company' }, TICK), '71691', 'ticker and name both match');
  assert.strictEqual(X.cikFromTicker({ ticker: 'BIRD', label: 'Allbirds' }, TICK), '', 'same ticker, another name: no match');
  assert.strictEqual(X.cikFromTicker({ ticker: '', label: 'The New York Times Company' }, TICK), '');
  assert.strictEqual(X.pageFacts({ url: 'https://www.example.org/', title: 'Home', pageKind: 'article', isArticle: true }).group, 'organization', 'a home page is about the site even when it reads like an article');

  // ---- page groups
  assert.strictEqual(article({ title: 'x' }).group, 'news');
  assert.strictEqual(X.pageFacts({ url: 'https://www.example-news.com/', title: 'Home', pageKind: 'index', isArticle: true }).group, 'other', 'a front page is about the site, not one story');
  assert.strictEqual(X.pageFacts({ url: 'https://www.example.org/', title: 'Home', pageKind: 'index' }).group, 'organization');
  const shop = X.pageFacts({ url: 'https://shop.example.com/products/wool-runner', title: 'Wool Runner | Example', siteName: 'Example', pageKind: 'page', sells: true });
  assert.deepStrictEqual([shop.group, shop.shopHandle], ['shop', 'wool-runner']);
  assert.strictEqual(X.pageFacts({ url: 'https://x.com/r', title: 'Pasta', pageKind: 'recipe', isArticle: true }).group, 'evergreen');

  // ---- subject resolution
  const nvidiaPage = article({ title: 'Nvidia spy scandal underlines China threat', text: 'Nvidia said on Monday. Shares of Nvidia fell. The chips Nvidia sells. Nvidia again.' });
  let io = fakeIo([[/list=search.*srsearch=Nvidia/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]]);
  let subj = await X.resolveSubject(nvidiaPage, io);
  assert.deepStrictEqual([subj.label, subj.kind, subj.cik], ['Nvidia', 'organization', '0001045810']);
  // a recipe: nothing is asked at all
  const recipe = X.pageFacts({ url: 'https://www.example-news.com/food/pasta', title: 'A weeknight pasta with lemon and peas', siteName: 'Example News', text: 'frozen peas, peas, peas, pasta, pasta', pageKind: 'recipe', isArticle: true });
  io = fakeIo([]); assert.strictEqual(await X.resolveSubject(recipe, io), null); assert.strictEqual(io.calls.length, 0, 'no request for a page with no named subject');
  // a name that resolves to a place or a species is refused
  const boston = article({ title: 'Boston mayor on the budget', text: 'In Boston today. Boston officials. Across Boston, people. Boston again.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'Boston' }] } }], [/wbgetentities/, wd('Q100', 'Boston', 'Boston', PLACE)]]);
  assert.strictEqual(await X.resolveSubject(boston, io), null, 'a city is not a subject');
  // the first headline name is a country: the next one is tried
  const spy = article({ title: 'Nvidia spy scandal underlines China threat', text: 'China said. In China, officials. China again. China and Nvidia. Nvidia said. Nvidia fell. Nvidia chips. China.' });
  assert.deepStrictEqual(spy.terms.entities.slice().sort(), ['China', 'Nvidia']);
  io = fakeIo([[/list=search.*srsearch=China/, { query: { search: [{ title: 'China' }] } }], [/wbgetentities.*titles=China/, wd('Q148', 'People\'s Republic of China', 'China', PLACE)], [/list=search.*srsearch=Nvidia/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]]);
  assert.strictEqual((await X.resolveSubject(spy, io)).label, 'Nvidia');
  // the headline's first name leads; one word inside a longer name is not a name; one word must be the whole title
  const pep = article({ title: 'PepsiCo to cut about 1,000 North America jobs', text: 'PepsiCo said. PepsiCo North America. In North America, PepsiCo. North America again. PepsiCo.' });
  assert.deepStrictEqual(pep.terms.entities, ['PepsiCo', 'North America'], JSON.stringify(pep.terms.entities));
  const north = article({ title: 'North wins again', text: 'North said. North won. North again. North.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'North of North' }] } }], [/wbgetentities/, wd('Q8', 'North of North', 'North of North', { P577: claim({ time: '+2025' }) })]]);
  assert.strictEqual(await X.resolveSubject(north, io), null, '"North" is not "North of North"');
  assert.strictEqual(article({ title: 'Mortgage rates fall', text: 'Freddie Mac said rates fell.' }).countryHint, 'US');
  assert.strictEqual(article({ title: 'Rates', text: 'The Federal Reserve and the Bank of England both moved.' }).countryHint, '', 'two countries named: no hint');
  assert.ok(!X.candidates(Object.assign(X.pageFacts({ url: 'https://shop.example/p/gift-set', title: 'Christmas Coffee and Cake Gift Set', pageKind: 'page', isArticle: true }), { site: null, subject: null }), {}).some((c) => c.id === 'news_coverage'), 'prose on a product page is not a story');
  // a company's fuller name is the name; a job title is not part of one
  const marv = article({ title: 'Marvell announces $115 billion acquisition of Lumentum', text: 'On Monday Marvell said. Shares of Marvell rose. The deal gives Marvell more. At Marvell, staff.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'Marvel Comics' }, { title: 'Marvell Technology' }] } }], [/wbgetentities/, wd('Q1', 'Marvell Technology', 'Marvell Technology', COMPANY)]]);
  assert.strictEqual((await X.resolveSubject(marv, io)).label, 'Marvell Technology');
  const ceo = X.topicTerms({ title: 'Why did Nvidia CEO Jensen Huang resign, and who is Colette Kress?', siteName: 'Al Jazeera', article: true, text: 'On Monday Nvidia CEO Jensen Huang said he would go. Shares of Nvidia fell. The board thanked Jensen Huang. At Nvidia, staff were told. Then Jensen Huang left. Nvidia named Colette Kress. She, Colette Kress, said.' });
  assert.deepStrictEqual(ceo.entities, ['Nvidia', 'Jensen Huang', 'Colette Kress'], JSON.stringify(ceo.entities));
  assert.strictEqual(X.pageFacts({ url: 'https://shop.example/shop/gift-box/', title: 'Gift Box', pageKind: 'article', isArticle: true, productPage: true, published: '2026-10-01' }).group, 'shop', 'a page that marks itself a product is a shop page');
  // one word cannot pick among several things of that name, and part of a word is not the name
  const dems = article({ title: 'The mandate is clear. Democrats must act now', text: 'Democrats won. The Democrats said. Senate Democrats. Democrats in Israel and elsewhere. Democrats.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'The Democrats (Israel)' }, { title: 'Democratic Party (United States)' }] } }], [/wbgetentities/, wd('Q9', 'The Democrats', 'The Democrats (Israel)', COMPANY)]]);
  assert.strictEqual(await X.resolveSubject(dems, io), null, 'an ambiguous one-word name resolves to nothing');
  assert.ok(!io.calls.some((c) => /wbgetentities/.test(c.url)), 'and the wrong article is never fetched');
  // a phrase with no article of that exact name is not a subject (and a look-alike with another qualifier is never fetched)
  const mass = article({ title: 'Millionaires tax: levy brings in $3.1 billion for Mass.', text: 'The millionaires tax passed in Massachusetts. The millionaires tax again.' });
  io = fakeIo([[/prop=pageprops/, { query: { pages: { '-1': { title: 'Millionaires tax', missing: '' } } } }]]);
  assert.strictEqual(await X.resolveSubject(mass, io), null, 'no article of that exact name: no subject');
  // a repeated two-word phrase that is an article's exact title becomes a phrase subject
  const vac = X.pageFacts({ url: 'https://x.com/best-robot-vacuums', title: 'The best robot vacuums in 2026', siteName: 'X', text: 'robot vacuums clean. these robot vacuums. a robot vacuum that', pageKind: 'review' });
  io = fakeIo([[/prop=pageprops.*titles=robot vacuums\|robot vacuum/i, { query: { pages: { '-1': { title: 'Robot vacuums', missing: '' }, 5: { title: 'Robotic vacuum cleaner' } } } }], [/wbgetentities/, wd('Q7', 'robotic vacuum cleaner', 'Robotic vacuum cleaner', {})]]);
  subj = await X.resolveSubject(vac, io);
  assert.deepStrictEqual([subj.kind, subj.label, subj.enwiki], ['phrase', 'robot vacuums', 'Robotic vacuum cleaner']);
  io = fakeIo([[/prop=pageprops/, { query: { pages: { 5: { title: 'Robot vacuum', pageprops: { disambiguation: '' } } } } }]]);
  assert.strictEqual(await X.resolveSubject(vac, io), null, 'a disambiguation page is not a subject');

  // ---- which questions may be asked, in order
  const ids = (f, o) => X.candidates(f, o).map((c) => c.id + ':' + c.about);
  const withE = (f, site, subject) => Object.assign(f, { site, subject });
  const siteE = X.entityFrom('Q100', wd('Q100', 'Example News', 'Example News', OUTLET).entities.Q100);
  const nvE = X.entityFrom('Q182477', wd('Q182477', 'Nvidia', 'Nvidia', COMPANY).entities.Q182477);
  assert.deepStrictEqual(ids(withE(nvidiaPage, siteE, nvE), {}), ['news_coverage:page', 'subject_views:subject', 'site_views:site'], 'no Trends without the click');
  assert.deepStrictEqual(ids(withE(nvidiaPage, siteE, nvE), { trends: true }), ['news_coverage:page', 'subject_views:subject', 'subject_trends:subject', 'site_views:site', 'site_trends:site']);
  assert.deepStrictEqual(ids(withE(recipe, siteE, null), {}), ['site_views:site'], 'a recipe with no subject: only the labelled last resort');
  assert.deepStrictEqual(ids(withE(shop, nvE, nvE), { trends: true }), ['site_views:subject', 'site_trends:subject', 'site_discussion:subject'], 'on a shop the site is the subject');
  assert.deepStrictEqual(ids(withE(X.pageFacts({ url: 'https://www.agency.example/parks/plan-your-visit', title: 'Plan Your Visit', pageKind: 'page' }), nvE, nvE), {}).map((x) => x.split(':')[1]), ['site', 'site'], 'an inner page of a large site: what is shown is labelled as about the site');
  // records sources, once registered, come first when they apply; a registered source that throws in applies() is skipped
  X.register({ id: 'sec_financials', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.cik, sends: () => 's', run: async () => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [{ t: '2020', v: 1 }], sentence: 'x' } }) });
  X.register({ id: 'fec_committee', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: () => { throw new Error('bad'); }, sends: () => 's', run: async () => null });
  assert.deepStrictEqual(ids(withE(shop, nvE, nvE), {}).slice(0, 2), ['sec_financials:subject', 'site_views:subject']);
  const earnings = article({ title: 'Nvidia revenue beats forecasts as profit doubles', text: 'Nvidia said. Nvidia revenue rose. Nvidia shares. Nvidia.' });
  assert.strictEqual(ids(withE(earnings, siteE, nvE), {})[0], 'sec_financials:subject', 'a page about the company\'s money: its filings lead');
  assert.strictEqual(ids(withE(nvidiaPage, siteE, nvE), {})[0], 'news_coverage:page', 'a page about something else: coverage leads, filings follow');
  assert.ok(!ids(withE(article({ title: 'x y z story' }), nvE, null), {}).includes('sec_financials:subject'));
  assert.ok(ids(withE(article({ title: 'A long story headline here' }), nvE, null), {}).includes('sec_financials:site'), 'the site\'s own filings are a labelled last resort');
  assert.throws(() => X.register({ id: 'x', basis: 'vibes', scope: 'page', label: 'l', question: 'q', applies() {}, sends() {}, run() {} }), /bad basis/);
  delete X.REGISTERED.sec_financials; delete X.REGISTERED.fec_committee;

  // ---- series rules
  const clean = X.cleanSeries([{ t: '2026-11', v: 212 }, { t: '2026-10', v: 8139 }, { t: '2026-09', v: null }, { t: '2026-08', v: '9000' }, { t: 'junk', v: 1 }], 'month', NOW);
  assert.deepStrictEqual(clean, [{ t: '2026-08', v: 9000 }, { t: '2026-09', v: null }, { t: '2026-10', v: 8139 }], 'unfinished month dropped; a missing value stays missing, never 0');
  assert.deepStrictEqual([3216, 999999.6, 1.25e6, 2.5e9, -93e6].map(X.util.money), ['$3,216', '$1,000,000', '$1.3 million', '$2.5 billion', '-$93.0 million']);
  assert.strictEqual(X.util.num(null), null); assert.strictEqual(X.util.num(''), null); assert.strictEqual(X.util.num('0'), 0);
  const wk = X.cleanSeries([{ t: '2026-11-15', v: 3 }, { t: '2026-11-08', v: 20 }, { t: '2026-11-01', v: 22 }], 'week', NOW);
  assert.deepStrictEqual(wk.map((p) => p.t), ['2026-11-01', '2026-11-08'], 'the week in progress is dropped');
  assert.deepStrictEqual(X.cleanSeries([{ t: '2026-11-17', v: 1 }, { t: '2026-11-16', v: 2 }], 'day', NOW).map((p) => p.t), ['2026-11-16'], 'today is dropped');
  assert.ok(!X.validSeries([{ v: 0 }, { v: null }, { v: 93 }].concat(Array(90).fill({ v: 0 }))), 'one non-zero point among 93 is not a series');
  const sm = X.summary([{ t: '2020', v: 5 }, { t: '2021', v: null }, { t: '2022', v: 9 }]); assert.deepStrictEqual([sm.first.t, sm.last.v, sm.count], ['2020', 9, 2]);
  assert.strictEqual(X.summary([{ t: '2020', v: null }]), null);

  // ---- a full run on a news page: coverage leads, subject attention follows, the site is not charted
  const items = []; for (let i = 0; i < 10; i++) items.push({ t: 'Story ' + i, d: day(1 + (i % 3)), s: 'Outlet ' + (i % 6), host: 'o' + (i % 6) + '.example' });
  items.push({ t: 'Old', d: new Date('2021-06-24T00:00:00Z'), s: 'Legacy', host: 'legacy.example' }, { t: 'Today', d: NOW, s: 'Fast', host: 'fast.example' });
  const routes = [[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/list=search/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)],
    [/news\.google\.com/, rss(items)], [/per-article.*Nvidia\/daily/, daily(90, 5000)], [/per-article.*Example_News\/monthly/, monthly(25, 10000, 17, 77163)]].concat(siteFacts);
  io = fakeIo(routes);
  let out = await X.run(article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text, published: '2026-11-10T08:00:00Z' }), io, { now: NOW });
  assert.deepStrictEqual(out.charts, [], 'the count of news articles never leads: nothing leads here');
  assert.deepStrictEqual(out.other.map((c) => c.id + ':' + c.basis + ':' + c.about), ['news_coverage:coverage:page', 'subject_views:topic:subject'], 'coverage is folded first, ordinary attention after it; the site is not charted once something about the page was found');
  assert.deepStrictEqual(out.subject, { label: 'Nvidia', kind: 'organization' });
  const nc = out.other[0];
  assert.strictEqual(nc.points.length, 30); assert.strictEqual(nc.points[29].t, '2026-11-16', 'the window ends yesterday');
  assert.strictEqual(nc.points.reduce((a, p) => a + p.v, 0), 10, 'the 2021 item and today\'s item are outside the window');
  assert.ok(/Google News returned 10 articles/.test(nc.sentence) && /not that none were written/.test(nc.note), nc.sentence);
  const sv = out.other[1];
  assert.ok(/was viewed about/.test(sv.sentence) && !/readers of/i.test(sv.sentence) && /not unique readers/.test(sv.note), 'views, not readers');
  assert.deepStrictEqual(sv.mark, { t: '2026-11-10', label: 'page published' }); assert.strictEqual(sv.aboutLabel, 'Nvidia');
  assert.ok(out.facts.find((x) => x.id === 'subject' && /Nvidia/.test(x.text)) && out.facts.find((x) => x.id === 'entity' && /founded 1872/.test(x.text)));
  assert.ok(out.facts.find((x) => x.id === 'archive' && /from 1998 to 2026, with none from 2001 to 2015/.test(x.text)));
  assert.ok(out.facts.find((x) => x.id === 'dns_services' && /OpenAI and TollBit/.test(x.text)) && out.facts.find((x) => x.id === 'rank' && /3,740/.test(x.text)));
  assert.ok(io.calls.every((c) => !c.cookies) && !io.calls.some((c) => /trends\.google/.test(c.url)), 'no cookies and no Trends without the click');
  assert.ok(out.ran.find((r) => r.id === 'subject' && r.ok && /"Nvidia"/.test(r.sends)), 'the subject lookup is listed with what it sent');
  assert.ok(!io.calls.some((c) => c.url.includes('example-news.com/2026')), 'the page address is never sent');

  // ---- flat attention never leads: with no record, statistic or coverage there is no lead chart, and the views sit in `other`
  io = fakeIo([[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/per-article.*Example_News\/monthly/, monthly(25, 10000, 17, 10020)]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example-news.com/food/pasta', title: 'A weeknight pasta with lemon and peas', siteName: 'Example News', text: recipe.text, pageKind: 'recipe', isArticle: true, entityQ: 'Q100' }), io, { now: NOW });
  assert.deepStrictEqual([out.charts.length, out.other.map((c) => c.id + ':' + c.about).join()], [0, 'site_views:site'], 'steady views of the site: no lead');
  // ---- a person leads the headline: the company named beside him is the one with filings
  const huang = article({ title: 'Why did Nvidia CEO Jensen Huang resign?', text: 'On Monday Jensen Huang said he would go. Shares of Nvidia fell. The board thanked Jensen Huang for his work. At Nvidia, staff were told. Chips from Nvidia sell well. Then Jensen Huang left.' });
  assert.deepStrictEqual(huang.terms.entities, ['Nvidia', 'Jensen Huang']);
  const huang2 = article({ title: 'Jensen Huang resigns from Nvidia', text: huang.text });
  io = fakeIo([[/list=search.*srsearch=Jensen Huang/, { query: { search: [{ title: 'Jensen Huang' }] } }], [/wbgetentities.*titles=Jensen Huang/, wd('Q305177', 'Jensen Huang', 'Jensen Huang', Object.assign({ P108: claim({ id: 'Q182477' }) }, HUMAN), 'Taiwanese-American businessman, co-founder of Nvidia')], [/list=search.*srsearch=Nvidia/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]]);
  const hs = await X.resolveSubject(huang2, io);
  assert.deepStrictEqual([hs.label, huang2.secondary && huang2.secondary.label], ['Jensen Huang', 'Nvidia']);
  X.register({ id: 'sec_financials', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.cik, sends: () => 's', run: async () => null });
  assert.ok(ids(Object.assign(huang2, { site: siteE, subject: hs }), {}).includes('sec_financials:subject'), 'the company\'s filings are offered');
  delete X.REGISTERED.sec_financials;
  // two names in one headline are not a link: without one in Wikidata, the second name's filings are never offered
  const swift = article({ title: 'Taylor Swift thanks Ford workers after Detroit show', text: 'On stage Taylor Swift thanked them. Workers at Ford cheered. The singer Taylor Swift said. At Ford, shifts ended early. Then Taylor Swift left. Ford said.' });
  io = fakeIo([[/list=search.*srsearch=Taylor Swift/, { query: { search: [{ title: 'Taylor Swift' }] } }], [/wbgetentities.*titles=Taylor Swift/, wd('Q26876', 'Taylor Swift', 'Taylor Swift', HUMAN, 'American singer-songwriter')], [/list=search.*srsearch=Ford/, { query: { search: [{ title: 'Ford' }] } }], [/wbgetentities.*titles=Ford/, wd('Q44294', 'Ford Motor Company', 'Ford', COMPANY)]]);
  const sw1 = await X.resolveSubject(swift, io);
  assert.deepStrictEqual([sw1.label, swift.secondary], ['Taylor Swift', null], 'an unrelated company in the headline is not attached');
  // a surname the text spells out in full is that person, not the company of the same name
  const ford = article({ title: "Ford's pardon of Nixon, 50 years on", text: 'In 1974 Gerald Ford pardoned his predecessor. Critics said Ford acted too soon. Historians now say Gerald Ford was right. For Ford it cost an election. Aides to Gerald Ford recall. Ford said little.' });
  assert.ok(ford.terms.entities.includes('Gerald Ford') && !ford.terms.entities.includes('Ford'), JSON.stringify(ford.terms.entities));
  assert.deepStrictEqual(article({ title: 'Nvidia spy scandal', text: 'On Monday Nvidia Corporation said. Shares of Nvidia fell. A Nvidia Corporation filing. Chips from Nvidia. Nvidia.' }).terms.entities, ['Nvidia'], 'a company word does not make a different name');
  // many people share a name: the page must use a word of this person's description
  const obit = article({ title: 'James Brown, longtime bus driver, dies at 81', text: 'For decades James Brown drove the number 9 bus. Neighbours said James Brown never missed a shift. The family of James Brown asks for privacy. Mr Brown retired in 2010.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'James Brown' }] } }], [/wbgetentities/, wd('Q5950', 'James Brown', 'James Brown', HUMAN, 'American singer, songwriter and bandleader')]]);
  assert.strictEqual(await X.resolveSubject(obit, io), null, 'another person of the same name');
  assert.strictEqual(X.entityFrom('Q9', { claims: { P17: claim({ id: 'Q159' }), P856: claim('https://x.ru') } }).country, 'Q159', 'a country outside the table is known, and is not the US');
  // a senator described only as "American politician": the page's own political words confirm her; a bus driver's obituary does not
  const pel = article({ title: 'Mary Peltola leads in U.S. Senate race', text: 'On Friday Mary Peltola led. The campaign of Mary Peltola said. Votes for Mary Peltola rose. The Senate race is close. Ballots are still being counted.' });
  io = fakeIo([[/list=search/, { query: { search: [{ title: 'Mary Peltola' }] } }], [/wbgetentities/, wd('Q1', 'Mary Peltola', 'Mary Peltola', HUMAN, 'American politician (born 1973)')]]);
  assert.strictEqual((await X.resolveSubject(pel, io)).label, 'Mary Peltola');
  // a listed company with no SEC number or ticker in Wikidata: the stock-exchange claim and one exact name on the SEC's list, both needed
  const TICK3 = { ASAN: [1477720, 'Asana, Inc.'], ROOT: [1788882, 'Root, Inc.'], AAA: [1, 'Acme Corp'], AAB: [2, 'ACME INC'] };
  assert.strictEqual(X.cikFromName({ label: 'Asana', kind: 'organization', country: 'US', listed: true }, TICK3), '1477720');
  assert.strictEqual(X.cikFromName({ label: 'The Root', kind: 'organization', country: 'US', listed: false }, TICK3), '', 'a magazine is not the insurer of the same name');
  assert.strictEqual(X.cikFromName({ label: 'Acme', kind: 'organization', country: 'US', listed: true }, TICK3), '', 'two listed companies share the name');
  assert.strictEqual(X.cikFromName({ label: 'Asana', kind: 'organization', country: 'Q159', listed: true }, TICK3), '', 'not a US company');
  // exactly one filer cannot be established from the first of several pages; a city name inside another word is not the city
  assert.strictEqual(await X.filerByName(fakeIo([[/search\.json/, { num_pages: 13, organizations: [{ ein: 1, name: 'Hope Shelter Inc', city: 'Ada', state: 'OK' }] }]]), 'Hope Shelter'), null);
  X.register({ id: 'nonprofit_finances', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.ein, sends: () => 's', run: async (e) => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [], sentence: 'x' } }) });
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, { organizations: [{ ein: 731111111, name: 'Hope Shelter Inc', city: 'Ada', state: 'OK' }] }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://hopeshelter.org/', title: 'Home', siteName: 'Hope Shelter', text: 'A shelter in Toronto, Canada. OK to call any time.', pageKind: 'index' }), io, { now: NOW });
  assert.strictEqual(out.charts.length, 0, '"Ada" inside "Canada" is not the filer\'s city');
  delete X.REGISTERED.nonprofit_finances;
  // a site's own articles are not coverage of its story
  const ownOnly = []; for (let i = 0; i < 10; i++) ownOnly.push({ t: 'Own ' + i, d: day(1 + (i % 3)), s: 'Example News', host: 'www.example-news.com' });
  const own = await X.REGISTERED.news_coverage.run(Object.assign({}, nvidiaPage), fakeIo([[/news\.google\.com/, rss(ownOnly)]]), NOW);
  assert.ok(!own.chart, 'no other outlet: no coverage chart');
  // the name scan stays fast on hostile text (house limit: 300 ms at 40,000 characters)
  { const t0 = Date.now(); X.topicTerms({ title: 'A story', siteName: 'X', article: true, text: 'A-'.repeat(30000) }); X.topicTerms({ title: 'A story', siteName: 'X', article: true, text: 'Aa Bb '.repeat(10000) }); assert.ok(Date.now() - t0 < 600, 'name scan took ' + (Date.now() - t0) + ' ms'); }

  // ---- a feed at its cap is not a curve: the outlets are listed, no chart
  const many = []; for (let i = 0; i < 95; i++) many.push({ t: 'S' + i, d: day(1 + (i % 4)), s: 'Outlet ' + (i % 40), host: 'h' + (i % 40) + '.example' });
  const capped = await X.REGISTERED.news_coverage.run(nvidiaPage, fakeIo([[/news\.google\.com/, rss(many)]]), NOW);
  assert.ok(!capped.chart && /Widely covered: Google News returned 95 or more/.test(capped.facts[0].text), 'near the feed\'s cap the daily counts show its order, not the coverage');
  // ---- a small nonprofit by its own name: only with the filer's city on the page
  const fb = { organizations: [{ ein: 232345678, name: 'Example County Food Bank', city: 'Exton', state: 'PA' }] };
  X.register({ id: 'nonprofit_finances', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.ein, sends: () => 's', run: async (e) => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [], sentence: 'x ' + e.ein } }) });
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, fb]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://examplefoodbank.org/', title: 'Home - Example County Food Bank', siteName: 'Example County Food Bank', text: 'Visit us at 650 Main Road, Exton, PA.', pageKind: 'index' }), io, { now: NOW });
  assert.strictEqual(out.charts[0] && out.charts[0].sentence, 'x 232345678', 'name and city both match');
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, fb]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://examplefoodbank.org/', title: 'Home', siteName: 'Example County Food Bank', text: 'Serving families in Ohio.', pageKind: 'index' }), io, { now: NOW });
  assert.strictEqual(out.charts.length, 0, 'the same name in another town is not this organization');
  delete X.REGISTERED.nonprofit_finances;
  assert.strictEqual(X.topicTerms({ title: 'October jobs report: U.S. adds 1,000 jobs', siteName: 'X', article: true, text: 'October was strong. In October the U.S. added. October again. U.S. jobs. The U.S. economy. 1,000 jobs. 1,000 jobs.' }).entities.join(), '', 'months, numbers and country initials are not names');

  // ---- the pasta recipe: no subject, no topic chart. Only the site, labelled as the site; and nothing at all when the site is unknown
  io = fakeIo([[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/per-article.*Example_News\/monthly/, monthly(25, 10000, 17, 77163)]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example-news.com/food/pasta', title: 'A weeknight pasta with lemon and peas', siteName: 'Example News', text: recipe.text, pageKind: 'recipe', isArticle: true, entityQ: 'Q100' }), io, { now: NOW });
  assert.deepStrictEqual(out.charts.map((c) => c.id + ':' + c.about + ':' + c.aboutLabel), ['site_views:site:Example News']);
  assert.ok(!io.calls.some((c) => /Pea|pasta|lemon/i.test(decodeURIComponent(c.url))), 'no ingredient is ever looked up');
  assert.ok(/77k times, .* times the usual/.test(out.charts[0].sentence) && !out.charts[0].points.some((p) => p.t === '2026-11'), out.charts[0].sentence);
  assert.ok(!/usually means|in the news/.test(JSON.stringify(out.charts[0])), 'no unsupported explanation of a peak');
  io = fakeIo([[/sparql/, { results: { bindings: [] } }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://tiny-blog.example/pasta', title: 'A weeknight pasta with lemon and peas', text: recipe.text, pageKind: 'recipe' }), io, { now: NOW });
  assert.deepStrictEqual([out.charts.length, out.subject], [0, null], 'nothing defensible: no chart');
  assert.ok(out.facts.length >= 2, 'the site facts still show');

  // ---- Trends: only with the click, cookies only there, one retry after a 429, the week in progress dropped
  let first = true;
  io = fakeIo(routes.filter((r) => !/news\\\.google|daily/.test(String(r[0]))).concat([[/trends\/api\/explore/, () => { if (first) { first = false; return { status: 429, text: '' }; } return { status: 200, text: trendsExplore }; }], [/trends\.google\.com\/trends\/\?geo/, ''], [/widgetdata\/multiline/, trendsLine]]));
  out = await X.run(article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text }), io, { now: NOW, trends: true });
  const tr = out.other.find((c) => c.id === 'subject_trends');
  assert.ok(tr && tr.cookies && /highest in the week of/.test(tr.sentence), 'Trends chart after a 429 retry');
  assert.strictEqual(tr.points.length, 52, 'the week in progress is not drawn'); assert.ok(!/stands at 3 /.test(tr.sentence), 'and is not called the latest week: ' + tr.sentence);
  assert.ok(io.calls.filter((c) => c.cookies).length >= 3 && io.calls.filter((c) => c.cookies).every((c) => /trends\.google\.com/.test(c.url)), 'cookies only on Trends requests');

  // ---- a peak month on a public company's site: its SEC filings that month are listed under the chart, when that source is present
  X.register({ id: 'sec_filings', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.cik, sends: () => 's', run: async (e, f, io2, now, o) => ({ chart: { kind: 'list', title: 't', sentence: 's', rows: [{ t: o.month + '-09', text: '8-K: change of chief executive', url: 'https://www.sec.gov/x' }] } }) });
  io = fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)], [/monthly/, monthly(25, 5000, 17, 77163)]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://shop.example.com/products/wool-runner', title: 'Wool Runner', siteName: 'Example', sells: true, entityQ: 'Q182477' }), io, { now: NOW });
  const lead = out.charts.find((c) => c.id === 'site_views');
  assert.deepStrictEqual(lead.rows, [{ t: '2026-04-09', text: '8-K: change of chief executive', url: 'https://www.sec.gov/x' }]); assert.strictEqual(lead.rowsLabel, 'SEC filings around Apr 2026');
  delete X.REGISTERED.sec_filings;

  // ---- a nonprofit's own page names its legal entity: exactly one filer of exactly that name gives the tax ID; a near name does not
  const pp = { organizations: [{ ein: 454349842, name: 'Example Safety Support Fund Inc' }, { ein: 800000001, name: 'Example Safety Action Fund' }] };
  assert.strictEqual(await X.einByLegalName(fakeIo([[/search\.json/, pp]]), 'Example Safety Support Fund'), '454349842');
  assert.strictEqual(await X.einByLegalName(fakeIo([[/search\.json/, pp]]), 'Example Safety'), '', 'the shared part of two names matches neither');
  assert.strictEqual(await X.einByLegalName(fakeIo([[/search\.json/, { organizations: [pp.organizations[1], pp.organizations[1]] }]]), 'Example Safety Action Fund'), '', 'two filers of the same name: refused');
  io = fakeIo([[/search\.json/, pp]]); assert.strictEqual(await X.einByLegalName(io, 'Fund'), ''); assert.strictEqual(io.calls.length, 0, 'one word is not a legal name');
  X.register({ id: 'nonprofit_finances', basis: 'records', scope: 'entity', label: 'l', question: 'q', applies: (e) => !!e.ein, sends: (e) => 'tax id ' + e.ein, run: async (e) => ({ chart: { title: 'Revenue', kind: 'bars', resolution: 'year', points: [{ t: '2020', v: 1 }], sentence: 'x ' + e.ein } }) });
  io = fakeIo([[/sparql/, { results: { bindings: [] } }], [/search\.json/, pp]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example.org/', title: 'Example Safety', pageKind: 'index', legalName: 'Example Safety Support Fund' }), io, { now: NOW });
  assert.deepStrictEqual(out.charts.map((c) => c.id + ':' + c.basis + ':' + c.sentence), ['nonprofit_finances:records:x 454349842'], 'records lead on the organization\'s own page');
  assert.ok(out.ran.find((r) => r.id === 'legal_name' && r.ok && /"Example Safety Support Fund"/.test(r.sends)));
  delete X.REGISTERED.nonprofit_finances;

  // ---- budget and failure isolation
  io = { get: async (url) => { if (/tranco/.test(url)) throw new Error('boom'); return { status: 500, text: '' }; } };
  out = await X.run(article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text }), io, { now: NOW, maxRequests: 4 });
  assert.ok(out.requests <= 4 && out.ran.some((r) => !r.ok), 'budget respected; failures listed, not thrown');
  assert.strictEqual(out.charts.length, 0);

  // ---- shop: the store's own files
  io = fakeIo([[/products\/wool-runner\.json/, { product: { created_at: '2018-11-12T14:25:43-08:00', variants: [{ price: '110.00', compare_at_price: null }] } }], [/products\.json/, { products: Array.from({ length: 30 }, (_, i) => ({ created_at: (i < 25 ? '2025' : '2021') + '-01-01' })) }]]);
  const r3 = await X.FACTS.shop_product.run(shop, io, NOW);
  assert.ok(/listed since Nov 2018, priced 110\.00 in the store's currency\. Of the 30 products in its catalog file, 25 were added in 2025\./.test(r3.text), r3.text);

  // ---- Hacker News by year: a year with no story is a real zero; the unfinished year is dropped
  io = fakeIo([[/hn\.algolia\.com/, { nbHits: 12, hits: Array.from({ length: 12 }, (_, i) => ({ created_at_i: Date.UTC(2015 + (i % 6) * 2, 3, 1) / 1000 })) }]]);
  const hn = await X.REGISTERED.site_discussion.run(shop, io, NOW);
  assert.ok(hn.chart.points.some((p) => p.v === 0) && hn.chart.points[hn.chart.points.length - 1].t === '2025', JSON.stringify(hn.chart.points));

  // =====================================================================================================================
  // New page facts (taxIds, statusPages, footerText), sources that name their own subject, the relation line,
  // a tax ID printed on the page, and the company behind a product. All responses below are invented.
  {
  // ---- the new facts are checked again in pageFacts, whatever the content script sent
  const pf = X.pageFacts({ url: 'https://www.example.org/', title: 'Home', pageKind: 'index',
    taxIds: ['12-3456789', '123456789', ' 98-7654321 ', '12-34567', 'EIN 11-1111111', 123456789, null, '12-3456789', '1234567890'],
    statusPages: ['https://example.statuspage.io/history', 'https://t98765.evil.example/', 'https://status.example.org.evil.example/', 'https://www.examplestatus.org/', 'https://status.example.org/incidents?x=1', 'http://status.example.net/', 'https://status.intranet.local/', 'https://10.0.0.5/', 'https://user:pw@status.example.org/', 'https://status.example.org:8443/', 'https://localhost/', 'javascript:alert(1)', 'https://www.example.org/status', 'https://example.org/status', 42, 'https://uptime.example.org/x', 'https://third.example.org/'],
    footerText: 'f'.repeat(5000), taxIdNonprofit: true, registrable: 'example.org' });
  assert.deepStrictEqual(pf.taxIds, ['123456789', '987654321'], 'nine digits each, de-duplicated; anything else is dropped');
  assert.deepStrictEqual(pf.statusPages, ['https://status.example.org', 'https://uptime.example.org'], 'only https origins under the site\'s own registrable domain, without path, port or user name; another host is dropped whatever it is called; the site\'s own host is not a status page; at most 2');
  assert.strictEqual(pf.registrable, 'example.org');
  assert.strictEqual(pf.footerText.length, 4000, 'footer text is capped');
  const bare = X.pageFacts({ url: 'https://www.example.org/', title: 'Home', taxIds: 'x', statusPages: { a: 1 }, footerText: 7, taxIdNonprofit: true });
  assert.deepStrictEqual([bare.taxIds, bare.statusPages, bare.footerText, bare.taxIdNonprofit, bare.owner, bare.registrable], [[], [], '', false, null, 'example.org'], 'wrong types become empty facts; with no registrable domain given, the page\'s own host stands in');
  assert.ok(!('titleParts' in bare), 'the parts of the page title are no longer a fact: a name the page writes confirms nothing');
  // the registrable domain comes from the worker and is checked again: one the page is not on is not used
  for (const [reg, want] of [['evil.example', 'example.org'], ['org', 'example.org'], ['', 'example.org'], [42, 'example.org'], ['Example.ORG', 'example.org'], ['ample.org', 'example.org']])
    assert.strictEqual(X.pageFacts({ url: 'https://www.example.org/', title: 'Home', registrable: reg, statusPages: ['https://status.evil.example', 'https://status.ample.org'] }).registrable + '|' + X.pageFacts({ url: 'https://www.example.org/', title: 'Home', registrable: reg, statusPages: ['https://status.evil.example', 'https://status.ample.org'] }).statusPages.length, want + '|0', 'registrable ' + JSON.stringify(reg));
  // a page on a subdomain: only a status host under that subdomain, because a platform that gives each tenant a subdomain may be on no list
  const sub = (reg, pages) => X.pageFacts({ url: 'https://shop.bigplatform.com/', title: 'Corner Candles', registrable: reg, statusPages: pages }).statusPages;
  assert.deepStrictEqual(sub('bigplatform.com', ['https://status.bigplatform.com', 'https://status.shop.bigplatform.com']), ['https://status.shop.bigplatform.com'], 'the platform\'s status page is not the tenant\'s');
  assert.deepStrictEqual(sub('shop.bigplatform.com', ['https://status.bigplatform.com']), []);
  assert.ok(X.ownStatusHost('status.example.co.uk', 'example.co.uk', 'example.co.uk') && !X.ownStatusHost('status.other.co.uk', 'example.co.uk', 'example.co.uk') && !X.ownStatusHost('example.co.uk', 'example.co.uk', 'example.co.uk') && !X.ownStatusHost('www.example.co.uk', 'example.co.uk', 'example.co.uk') && !X.ownStatusHost('status.example.co.uk', '', '') && !X.ownStatusHost('', 'example.co.uk', 'example.co.uk'), 'a host under the site\'s domain, never the site\'s own host');

  // ---- where the three new sources stand in the order (the lines are harmless while a source is not loaded)
  const stub = (id, scope, basis, chart) => X.register({ id, basis, scope, label: id, question: 'q', applies: () => true, sends: () => 'nothing', run: async () => ({ chart: Object.assign({ title: id, kind: 'bars', resolution: 'year', points: [{ t: '2020', v: 1 }], sentence: 's' }, chart || {}) }) });
  assert.ok(!ids(withE(X.pageFacts({ url: 'https://www.example.org/', title: 'Home', pageKind: 'index' }), null, null), {}).some((x) => /park_visits|building_permits|status_incidents/.test(x)), 'not loaded: not offered');
  stub('official_statistic', 'page', 'statistic'); stub('park_visits', 'page', 'statistic', { about: 'subject', aboutLabel: '  Example   National Park ', relation: 'This page is on the park\'s own site.' }); stub('building_permits', 'page', 'statistic', { about: 'subject' }); stub('status_incidents', 'page', 'records', { about: 'elsewhere', aboutLabel: 'Ignored', relation: { not: 'text' } });
  stub('sec_filings', 'entity', 'records');
  assert.deepStrictEqual(ids(withE(article({ title: 'A long story headline here' }), null, null), {}).slice(0, 3), ['official_statistic:page', 'park_visits:page', 'building_permits:page'], 'park visits right after the official statistic, then building permits');
  const orgPage = () => X.pageFacts({ url: 'https://www.example.com/', title: 'Example', siteName: 'Example', pageKind: 'index', entityQ: 'Q182477' });
  const siteOrder = ids(withE(orgPage(), nvE, nvE), {});
  assert.ok(siteOrder.indexOf('sec_filings:subject') === siteOrder.indexOf('status_incidents:subject') + 1 && siteOrder.indexOf('site_views:subject') === siteOrder.indexOf('sec_filings:subject') + 1, 'status incidents after the records, before the filings list and site views: ' + siteOrder.join(' '));
  assert.ok(!ids(withE(article({ title: 'A long story headline here' }), nvE, null), {}).includes('status_incidents:page') && !ids(withE(article({ title: 'A long story headline here' }), nvE, null), {}).some((x) => /^status_incidents/.test(x)), 'status incidents only where the page is about the site');
  // ---- the count of news articles never leads: folded even when the source calls it notable; records found after it lead; the site's own records are not shown in its place
  { const keep = Object.assign({}, X.REGISTERED);
    for (const k of ['official_statistic', 'park_visits', 'building_permits', 'status_incidents', 'sec_filings', 'fec_committee', 'fec_employer']) delete X.REGISTERED[k]; // the stubs above always answer
    stub('news_coverage', 'page', 'coverage', { notable: true }); stub('nonprofit_finances', 'entity', 'records'); stub('sec_financials', 'entity', 'records'); stub('subject_views', 'entity', 'topic'); stub('site_views', 'entity', 'site');
    const story = () => article({ title: 'Nvidia spy scandal underlines China threat', text: nvidiaPage.text, published: '2026-11-10T08:00:00Z' });
    const routesN = [[/wbgetentities.*ids=Q100/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/list=search/, { query: { search: [{ title: 'Nvidia' }] } }], [/wbgetentities.*titles=Nvidia/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]].concat(siteFacts);
    let o1 = await X.run(story(), fakeIo(routesN), { now: NOW, secTickers: [] });
    const cov1 = o1.other.find((c) => c.id === 'news_coverage');
    assert.ok(cov1 && !o1.charts.some((c) => c.basis === 'coverage') && cov1.notable === undefined, 'coverage is folded, and a source cannot mark it notable: ' + JSON.stringify([o1.charts.map((c) => c.id), o1.other.map((c) => c.id)]));
    assert.ok(o1.charts.every((c) => c.about !== 'site') && !o1.other.some((c) => c.about === 'site'), 'something about the page was found (its coverage), so nothing about the site is shown in its place: ' + JSON.stringify([o1.charts.map((c) => c.id + ':' + c.about), o1.other.map((c) => c.id + ':' + c.about)]));
    assert.strictEqual(o1.charts[0] && o1.charts[0].basis, 'records', 'records about the subject lead past the folded coverage');
    // no record for the subject, a record for the site: with coverage found, the site's record is still not shown in its place
    const onlySite = (id) => X.register({ id, basis: 'records', scope: 'entity', label: id, question: 'q', applies: () => true, sends: () => 'nothing', run: async (e) => (e && e.label === 'Example News' ? { chart: { title: id, kind: 'bars', resolution: 'year', points: [{ t: '2020', v: 1 }], sentence: 's' } } : null) });
    onlySite('nonprofit_finances'); onlySite('sec_financials');
    let o2 = await X.run(story(), fakeIo(routesN), { now: NOW, secTickers: [] });
    assert.deepStrictEqual([o2.charts.map((c) => c.id + ':' + c.about), o2.other.map((c) => c.id).slice(0, 1)], [[], ['news_coverage']], 'coverage found and folded: no chart leads, and the site\'s own record does not take the lead');
    delete X.REGISTERED.news_coverage;
    let o3 = await X.run(story(), fakeIo(routesN), { now: NOW, secTickers: [] });
    assert.ok(o3.charts.length && o3.charts[0].about === 'site', 'with no coverage at all, the last resort still shows the site\'s record, labelled as about the site: ' + JSON.stringify(o3.charts.map((c) => c.id + ':' + c.about)));
    for (const k of Object.keys(X.REGISTERED)) delete X.REGISTERED[k]; Object.assign(X.REGISTERED, keep); }
  // ---- a source that names its own subject keeps it; anything else gets the router's label; the relation line is text or nothing
  io = fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]].concat(siteFacts));
  out = await X.run(orgPage(), io, { now: NOW, maxCharts: 6 });
  const by = (id) => out.charts.find((c) => c.id === id);
  assert.deepStrictEqual([by('park_visits').about, by('park_visits').aboutLabel, by('park_visits').relation], ['subject', 'Example National Park', 'This page is on the park\'s own site.'], 'about, aboutLabel and relation from the source are kept');
  assert.deepStrictEqual([by('building_permits').about, by('building_permits').aboutLabel], ['page', ''], '"subject" with no name is not kept: the card would name the site');
  assert.deepStrictEqual([by('status_incidents').about, by('status_incidents').aboutLabel, 'relation' in by('status_incidents')], ['subject', 'Nvidia', false], 'an unknown value and a non-text relation are dropped');
  assert.deepStrictEqual([by('official_statistic').about, by('official_statistic').aboutLabel, by('sec_filings').aboutLabel], ['page', '', 'Nvidia'], 'sources that say nothing keep the router\'s values');
  for (const id of ['official_statistic', 'park_visits', 'building_permits', 'status_incidents', 'sec_filings']) delete X.REGISTERED[id];
  // ---- a relation line that does not fit is not cut mid-sentence: the first sentence stands alone
  stub('official_statistic', 'page', 'statistic', { about: 'subject', aboutLabel: 'Example Series', relation: 'This page names the series.   ' + 'A second sentence that goes on and on. '.repeat(12) });
  out = await X.run(orgPage(), fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]].concat(siteFacts)), { now: NOW });
  assert.strictEqual(out.charts[0].relation, 'This page names the series.', 'only the first sentence');
  stub('official_statistic', 'page', 'statistic', { about: 'subject', aboutLabel: 'Example Series', relation: 'Example Holdings Inc. is the parent organization of Example Series Ltd. and of St. Example Co. ' + 'One more long sentence follows here. '.repeat(8) });
  out = await X.run(orgPage(), fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]].concat(siteFacts)), { now: NOW });
  assert.strictEqual(out.charts[0].relation, 'Example Holdings Inc. is the parent organization of Example Series Ltd. and of St. Example Co.', 'a company word with a full stop does not end the sentence');
  stub('official_statistic', 'page', 'statistic', { about: 'subject', aboutLabel: 'Example Series', relation: 'word '.repeat(80) });
  out = await X.run(orgPage(), fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]].concat(siteFacts)), { now: NOW });
  assert.ok(out.charts[0].relation.length <= 240 && /word\u2026$/.test(out.charts[0].relation) && !/wor\u2026$/.test(out.charts[0].relation), 'one sentence that is too long by itself is cut at a word, with a mark: ' + out.charts[0].relation.slice(-20));
  stub('official_statistic', 'page', 'statistic', { about: 'subject', aboutLabel: 'Example Series', relation: 'Short and whole. It fits.' });
  out = await X.run(orgPage(), fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', COMPANY)]].concat(siteFacts)), { now: NOW });
  assert.strictEqual(out.charts[0].relation, 'Short and whole. It fits.');
  delete X.REGISTERED.official_statistic;
  // ---- the real status source: on an inner page of a large site the chart is labelled as about the site, not this page; on the front page it is about the site as the subject
  { require('../extension/context-status.js');
    const incs = []; for (let m = 1; m <= 10; m++) { const at = '2026-' + String(m).padStart(2, '0') + '-10T09:30:00.000Z'; incs.push({ id: 'inc' + String(m).padStart(9, '0'), name: 'Elevated error rates', status: 'resolved', impact: m % 3 ? 'minor' : 'major', created_at: at, updated_at: at, resolved_at: at }); }
    const statusFeed = JSON.stringify({ page: { id: 'pg1', name: 'Some Other Name' }, incidents: incs.slice().reverse() });
    const statusRun = async (url, pages) => { const io2 = fakeIo([[/sparql/, { results: { bindings: [] } }], [/status\.example\.com\/api\/v2\/incidents\.json/, statusFeed], [/evil\.example/, statusFeed]].concat(siteFacts)); const pf2 = X.pageFacts({ url, title: 'Keyboard shortcuts | Example Co', siteName: 'Example Co', pageKind: 'page', statusPages: pages, registrable: 'example.com' }); return { pf2, io2, o: await X.run(pf2, io2, { now: NOW }) }; };
    let s1 = await statusRun('https://www.example.com/help/keyboard-shortcuts', ['https://status.example.com']);
    assert.deepStrictEqual(s1.o.charts.map((c) => [c.id, c.about, c.aboutLabel, c.title]), [['status_incidents', 'site', 'Example Co', 'Incidents Example Co reported on its own status page']], 'an inner page of group "other": about the site');
    assert.deepStrictEqual([s1.pf2.group, s1.pf2.root, X.candidates(s1.pf2, {}).filter((c) => c.id === 'status_incidents').map((c) => c.about).join()], ['other', false, 'site']);
    s1 = await statusRun('https://www.example.com/', ['https://status.example.com']);
    assert.deepStrictEqual(s1.o.charts.map((c) => [c.id, c.about, c.aboutLabel]), [['status_incidents', 'subject', 'Example Co']], 'the front page is about the site itself');
    // a link anyone can post: the planted host never reaches the source, and nothing is asked of it
    s1 = await statusRun('https://forum.example.com/t/98765', ['https://t98765.evil.example/x', 'https://status.example.com']);
    assert.deepStrictEqual([s1.pf2.statusPages, s1.o.charts.length, s1.io2.calls.filter((c) => /evil|status\./.test(c.url)).length], [[], 0, 0], 'a forum thread on a subdomain with a planted link: no status host, no request, no chart');
    s1 = await statusRun('https://www.example.com/t/98765', ['https://t98765.evil.example/x']);
    assert.deepStrictEqual([s1.pf2.statusPages, s1.o.charts.length, s1.io2.calls.some((c) => /evil/.test(c.url)), s1.o.ran.some((r) => r.id === 'status_incidents')], [[], 0, false, false], 'a planted host is not a status page: not asked, not listed');
    delete X.REGISTERED.status_incidents; }

  // ---- names: does the filer ProPublica lists for a printed tax ID name this site? Only something the page does not write can say so
  assert.ok(X.namesAgree('DOGWOOD ALLIANCE INC', 'Dogwood Alliance') && X.namesAgree('Example Valley Hospice Foundation', 'The Example Valley Hospice'), 'punctuation, case, "the", "inc" and "foundation" aside');
  assert.ok(X.namesAgree('EXAMPLE FOR SAFER STREETS SUPPORT FUND INC', 'Example Safer Streets'), 'two or more words, each of them in the longer name');
  assert.ok(!X.namesAgree('EXAMPLE FOR SAFER STREETS SUPPORT FUND INC', 'Example'), 'one shared word is not agreement when the longer name has other words');
  for (const [filer, site] of [['TIDES FOUNDATION', 'Rising Tides'], ['FRACTURED ATLAS PRODUCTIONS INC', 'Atlas'], ['NEW VENTURE FUND', 'Venture'], ['HOPE LUTHERAN CHURCH OF SPRINGFIELD', 'Hope'], ['COMMUNITY PARTNERS INC', 'River Cleanup Project']])
    assert.ok(!X.namesAgree(filer, site) && !X.namesAgree(site, filer), 'not the same organization: ' + filer + ' / ' + site);
  assert.ok(X.namesAgree('TIDES FOUNDATION', 'Tides') && X.namesAgree('The Atlas Inc', 'ATLAS'), 'one word agrees when the other name has no other word of its own');
  assert.ok(!X.namesAgree('COMMUNITY FOOD BANK OF EASTERN COUNTY', 'Community Food Bank'), 'only words many organizations share: not enough');
  assert.ok(!X.namesAgree('COMMUNITY PARTNERS INC', 'River Cleanup Project') && !X.namesAgree('RIVER TRUST', 'River Cleanup Project'), 'a sponsor with another name; one shared word is not every word');
  assert.ok(!X.namesAgree('EXAMPLE COUNTY FOOD BANK', 'ECFB') && !X.namesAgree('EXAMPLE COUNTY FOOD BANK', 'ECFA') && !X.namesAgree('EXAMPLE COUNTY FUND', 'ECF') && !X.namesAgree('', 'x') && !X.namesAgree('Inc', 'The'), 'a one-word name is not agreement by initials either (initials count only for the site\'s address); empty names never agree');
  const siteIs = (name, over) => X.filerIsSite(name, Object.assign({ siteName: '', brand: '', domain: 'example.org', registrable: 'example.org', legalName: '', site: null }, over));
  const at = (d, reg) => ({ domain: d, registrable: reg || d });
  // the site's address: the label of the registrable domain must EQUAL the filer's name run together, or its initials
  assert.ok(siteIs('EXAMPLE VALLEY HOSPICE INC', at('examplevalleyhospice.org')) && siteIs('THE EXAMPLE VALLEY HOSPICE FOUNDATION', at('example-valley-hospice.org')) && siteIs('BANK OF EXAMPLE VALLEY INC', at('bankofexamplevalley.org')) && siteIs('BOYS & GIRLS CLUB OF EXAMPLE VALLEY', at('boysandgirlsclubofexamplevalley.org')), 'the name run together; "the", "inc" and "foundation" may be left out, small words may stay or go');
  assert.ok(siteIs('EXAMPLE COUNTY FOOD BANK', at('ecfb.org')) && siteIs('SAN EXAMPLE SOCIETY FOR THE PREVENTION OF CRUELTY TO ANIMALS', at('sespca.org')), 'or its initials, when they are at least four letters');
  assert.ok(siteIs('EXAMPLE VALLEY HOSPICE INC', at('donate.examplevalleyhospice.org', 'examplevalleyhospice.org')) && siteIs('EXAMPLE VALLEY HOSPICE INC', at('examplevalleyhospice.org.uk', 'examplevalleyhospice.org.uk')), 'the label is the registrable domain\'s, whatever subdomain the page is on');
  assert.ok(!siteIs('EXAMPLE VALLEY FOR SAFER STREETS FUND', at('examplevalley.org')), 'the first words of the name are not the name');
  assert.ok(!siteIs('RELIEF SOCIETY', at('relief-society-donate.org')) && !siteIs('EXAMPLE NATIONAL RELIEF SOCIETY', at('relief-donate-now.example')) && !siteIs('EXAMPLE VALLEY HOSPICE INC', at('examplevalleyhospicefriends.org')), 'an address that contains the name, or part of it, does not agree');
  assert.ok(!siteIs('COMMUNITY PARTNERS INC', at('community.org')) && !siteIs('COMMUNITY FOUNDATION', at('community.org')) && !siteIs('COMMUNITY PARTNERS INC', at('rivercleanup.org')), 'one word many organizations share, or another name');
  assert.ok(!siteIs('EXAMPLE COUNTY FUND', at('ecf.org')), 'three initials are too few');
  assert.ok(!siteIs('EXAMPLE VALLEY HOSPICE INC', at('examplevalleyhospice.bigplatform.com', 'bigplatform.com')) && !siteIs('EXAMPLE VALLEY HOSPICE INC', at('donate.example.org', 'example.org')), 'a subdomain label is not the registrable domain\'s label');
  // names the page itself writes confirm nothing: its site name, its title, a legal name in its footer
  assert.ok(!siteIs('RIVER CLEANUP PROJECT INC', { siteName: 'River Cleanup Project', brand: 'River Cleanup Project', titleParts: ['Donate', 'River Cleanup Project'], legalName: 'River Cleanup Project Inc' }), 'og:site_name, a title part and a footer legal name');
  assert.ok(!siteIs('EXAMPLE SAFETY SUPPORT FUND INC', { siteName: 'Example Safety', legalName: 'Example Safety Support Fund' }));
  // the site's Wikidata label counts, but only for the entity that came from the exact-website lookup
  assert.ok(siteIs('EXAMPLE SAFETY SUPPORT FUND INC', { site: { q: 'Q5', label: 'Example Safety', matchedBy: 'website' } }), 'found by the exact-website lookup');
  assert.ok(!siteIs('EXAMPLE SAFETY SUPPORT FUND INC', { site: { q: 'Q5', label: 'Example Safety', matchedBy: 'bundled' } }) && !siteIs('EXAMPLE SAFETY SUPPORT FUND INC', { site: { q: '', label: 'Example Safety', matchedBy: 'website' } }) && !siteIs('EXAMPLE SAFETY SUPPORT FUND INC', { site: { q: 'Q5', label: 'Example Safety' } }) && !siteIs('EXAMPLE SAFETY SUPPORT FUND INC', { site: { q: 'Q5', label: 'Example', matchedBy: 'website' } }) && !siteIs('EXAMPLE COUNTY FOOD BANK', { site: { q: 'Q5', label: 'ECFB', matchedBy: 'website' } }), 'an entity from another route, one made from a name on the page, one with no record of where it came from, a one-word label inside a longer name, or a label that is initials: no');

  // ---- a tax ID printed on the page -> IRS filings (the real nonprofit source from here on)
  require('../extension/context-nonprofit.js');
  const ppRow = (y, rev) => ({ ein: 232345678, tax_prd: y * 100 + 12, tax_prd_yr: y, formtype: 0, totrevenue: rev, totfuncexpns: Math.round(rev * 0.9), totnetassetend: 100000 });
  const ppOrg = (ein, name, city, state) => ({ organization: { id: ein, ein, name, city, state, subsection_code: 3 }, filings_with_data: [2024, 2023, 2022, 2021, 2020, 2019, 2018].map((y) => Object.assign(ppRow(y, 1e6 + (y - 2018) * 1e5), { ein })), filings_without_data: [], api_version: 2 });
  const noSite = [/sparql/, { results: { bindings: [] } }];
  const ppCalls = (io2) => io2.calls.filter((c) => /propublica\.org/.test(c.url)).map((c) => c.url.replace('https://projects.propublica.org/nonprofits/api/v2/', ''));
  const foodBank = (over) => X.pageFacts(Object.assign({ url: 'https://examplecountyfoodbank.org/', title: 'Home - Example County Food Bank', siteName: 'Example County Food Bank', text: 'We feed our neighbours.', pageKind: 'index', taxIds: ['23-2345678'], footerText: 'Example County Food Bank 650 Main Road Exton, PA 19341 EIN: 23-2345678' }, over));
  // the happy path: one labelled ID, the filer's name is the site's own address run together, and the record is read once
  io = fakeIo([noSite, [/organizations\/232345678\.json/, ppOrg(232345678, 'EXAMPLE COUNTY FOOD BANK', 'Exton', 'PA')]].concat(siteFacts));
  out = await X.run(foodBank(), io, { now: NOW });
  assert.deepStrictEqual(out.charts.map((c) => c.id + ':' + c.about + ':' + c.aboutLabel), ['nonprofit_finances:subject:Example County Food Bank'], 'the filings lead on the organization\'s own page');
  assert.deepStrictEqual(ppCalls(io), ['organizations/232345678.json'], 'one request to ProPublica: the check and the chart read the same record, and no name search is made');
  assert.ok(/^The tax ID 23-2345678 was read from this page\. The IRS lists it as EXAMPLE COUNTY FOOD BANK\./.test(out.charts[0].note), out.charts[0].note);
  assert.strictEqual(out.charts[0].relation, 'This page prints the tax ID 23-2345678. IRS filings under that ID are from EXAMPLE COUNTY FOOD BANK.', 'the line says what is known: the page prints the ID, and whose filings the ID has');
  assert.ok(out.ran.find((r) => r.id === 'page_tax_id' && r.ok && r.sends === 'the tax ID printed on this page to ProPublica Nonprofit Explorer'), 'the lookup is listed with what it sent');
  assert.ok(!out.facts.some((x) => x.id === 'entity'), 'no Wikidata fact for an entity that did not come from Wikidata');
  assert.ok(!io.calls.some((c) => /Exton|Main Road|19341|neighbours/i.test(decodeURIComponent(c.url))), 'footer and page text are in no request');
  // the same page at an address that only resembles the filer's name (the fixture this test used before): the names the page writes
  // (og:site_name, title, footer) all say "Example County Food Bank", and that confirms nothing. No chart, and the name lookup may not bring the same ID back.
  io = fakeIo([noSite, [/organizations\/232345678\.json/, ppOrg(232345678, 'EXAMPLE COUNTY FOOD BANK', 'Exton', 'PA')], [/search\.json/, { organizations: [{ ein: 232345678, name: 'Example County Food Bank', city: 'Exton', state: 'PA' }] }]].concat(siteFacts));
  out = await X.run(foodBank({ url: 'https://examplefoodbank.org/', legalName: 'Example County Food Bank' }), io, { now: NOW });
  assert.ok(out.charts.length === 0 && out.ran.find((r) => r.id === 'page_tax_id' && !r.ok) && out.ran.find((r) => r.id === 'legal_name' && !r.ok), 'examplefoodbank.org is not EXAMPLE COUNTY FOOD BANK run together: no chart');
  // an impersonating page: it prints a well-known charity's real tax ID and sets its own og:site_name and title to the charity's name
  io = fakeIo([noSite, [/organizations\/530000001\.json/, ppOrg(530000001, 'EXAMPLE NATIONAL RELIEF SOCIETY', 'Washington', 'DC')], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://relief-donate-now.example/', title: 'Donate today | Example Relief Society', siteName: 'Example Relief Society', pageKind: 'donation', text: 'Give now. Tax-deductible. EIN: 53-0000001', taxIds: ['53-0000001'], taxIdNonprofit: true, footerText: 'Example National Relief Society, Washington, DC. EIN: 53-0000001' }), io, { now: NOW });
  assert.ok(out.charts.length === 0 && out.ran.find((r) => r.id === 'page_tax_id' && !r.ok), 'a planted charity page: the charity\'s filings are not shown as this site\'s');
  // a listing site's profile of another organization: the title part names the profiled charity, not the site
  io = fakeIo([[/wbgetentities/, { entities: { Q900: { labels: { en: { value: 'GiveList' } }, claims: { P856: [{ mainsnak: { datavalue: { value: 'https://givelist.org' } } }] } } } }], [/organizations\/232345678\.json/, ppOrg(232345678, 'EXAMPLE ANIMAL RESCUE INC', 'Exton', 'PA')], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  let listing = X.pageFacts({ url: 'https://givelist.org/charity/example-animal-rescue', title: 'Example Animal Rescue | GiveList', siteName: 'GiveList', entityQ: 'Q900', pageKind: 'page', text: 'Profile. EIN: 23-2345678', taxIds: ['23-2345678'] });
  out = await X.run(listing, io, { now: NOW });
  assert.ok(out.charts.every((c) => c.id !== 'nonprofit_finances') && !listing.site.ein && listing.site.label === 'GiveList', 'a profile page on a listing site: the profiled charity\'s filings are not the site\'s');
  // a fiscal sponsor named in the page title
  io = fakeIo([noSite, [/organizations\/951234567\.json/, ppOrg(951234567, 'PLAYERS GIVING FUND INC', 'Towson', 'MD')], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://rivercleanup.org/donate', title: 'Donate | River Cleanup Project | A project of Players Giving Fund', siteName: 'River Cleanup Project', pageKind: 'donation', text: 'River Cleanup Project is a fiscally sponsored project of Players Giving Fund, EIN 95-1234567.', taxIds: ['95-1234567'] }), io, { now: NOW });
  assert.ok(out.charts.length === 0 && out.ran.find((r) => r.id === 'page_tax_id' && !r.ok), 'a sponsor named in the title: no chart');
  // the site's Wikidata item, found by its exact address, carries the name: that agrees, whatever the page calls itself
  { const hospice = { P31: claim({ id: 'Q163740' }), P856: claim('https://evh-care.org'), P17: claim({ id: 'Q30' }) };
    io = fakeIo([[/sparql/, { results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q950' } }] } }], [/wbgetentities.*ids=Q950/, wd('Q950', 'Example Valley Hospice', '', hospice)], [/organizations\/232345678\.json/, ppOrg(232345678, 'EXAMPLE VALLEY HOSPICE INC', 'Exton', 'PA')]].concat(siteFacts));
    const hp = X.pageFacts({ url: 'https://evh-care.org/', title: 'Home', siteName: 'EVH Care', pageKind: 'index', taxIds: ['23-2345678'] });
    out = await X.run(hp, io, { now: NOW });
    assert.deepStrictEqual([out.charts.map((c) => c.id).join(), hp.site.matchedBy, hp.site.einFrom, out.charts[0] && out.charts[0].relation], ['nonprofit_finances', 'website', 'page', 'This page prints the tax ID 23-2345678. IRS filings under that ID are from EXAMPLE VALLEY HOSPICE INC.'], 'the Wikidata label of the entity found by the site\'s address'); }
  // two different IDs on one page: none is taken (and no name matches, so nothing is shown)
  io = fakeIo([noSite, [/organizations\/\d+\.json/, ppOrg(232345678, 'EXAMPLE COUNTY FOOD BANK', 'Exton', 'PA')], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  out = await X.run(foodBank({ taxIds: ['23-2345678', '45-1111111'] }), io, { now: NOW });
  assert.ok(out.charts.length === 0 && !ppCalls(io).some((u) => /organizations\//.test(u)) && !out.ran.some((r) => r.id === 'page_tax_id'), 'two IDs: no ID leaves the page: ' + ppCalls(io).join(' '));
  // a fiscal sponsor's ID: the filer's name does not agree with the site, so there is no chart
  const river = (over) => X.pageFacts(Object.assign({ url: 'https://rivercleanup.org/', title: 'River Cleanup Project', siteName: 'River Cleanup Project', text: 'Donations are tax-deductible through our fiscal sponsor.', pageKind: 'index', taxIds: ['95-1234567'], footerText: 'River Cleanup Project is a sponsored project of Community Partners Inc, EIN 95-1234567' }, over));
  const sponsor = ppOrg(951234567, 'COMMUNITY PARTNERS INC', 'Los Angeles', 'CA');
  io = fakeIo([noSite, [/organizations\/951234567\.json/, sponsor], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  out = await X.run(river(), io, { now: NOW });
  assert.ok(out.charts.length === 0 && out.ran.find((r) => r.id === 'page_tax_id' && !r.ok), 'a sponsor\'s tax ID gives no chart');
  // the same sponsor named in the footer as a legal entity: the exact-name lookup finds the same tax ID, and it is still refused
  io = fakeIo([noSite, [/organizations\/951234567\.json/, sponsor], [/search\.json/, { organizations: [{ ein: 951234567, name: 'Community Partners Inc', city: 'Los Angeles', state: 'CA' }] }]].concat(siteFacts));
  out = await X.run(river({ legalName: 'Community Partners Inc' }), io, { now: NOW });
  assert.ok(out.charts.length === 0 && out.ran.find((r) => r.id === 'legal_name' && !r.ok), 'the refused tax ID does not come back through the legal name');
  // a small nonprofit that sells things is grouped as a shop: the printed ID still works, when the page calls it a nonprofit
  const rescue = (over) => X.pageFacts(Object.assign({ url: 'https://exampleanimalrescueproject.com/products/tote-bag', title: 'Tote bag | Example Animal Rescue', siteName: 'Example Animal Rescue', text: 'A tote bag.', sells: true, taxIds: ['81-7654321'], taxIdNonprofit: true }, over));
  io = fakeIo([noSite, [/organizations\/817654321\.json/, ppOrg(817654321, 'EXAMPLE ANIMAL RESCUE PROJECT INC', 'Santa Rosa', 'CA')]].concat(siteFacts));
  const shopFacts = rescue(); out = await X.run(shopFacts, io, { now: NOW });
  assert.deepStrictEqual([shopFacts.group, out.charts.map((c) => c.id).join(), ppCalls(io).join()], ['shop', 'nonprofit_finances', 'organizations/817654321.json'], 'a shop-grouped nonprofit gets its filings');
  // a .org site that sells (grouped as a shop) and prints its ID with no nonprofit wording beside it: the address is enough
  io = fakeIo([noSite, [/organizations\/232345678\.json/, ppOrg(232345678, 'EXAMPLE COUNTY FOOD BANK', 'Exton', 'PA')]].concat(siteFacts));
  const orgShop = foodBank({ url: 'https://examplecountyfoodbank.org/donate', title: 'Donate - Example County Food Bank', sells: true, pageKind: 'donation' }); out = await X.run(orgShop, io, { now: NOW });
  assert.deepStrictEqual([orgShop.group, orgShop.taxIdNonprofit, out.charts.map((c) => c.id).join()], ['shop', false, 'nonprofit_finances'], 'a .org page grouped as a shop, no wording beside the ID');
  // the same number on a .com page that does not call itself a nonprofit (an invoice, an account page) is never sent
  io = fakeIo([noSite].concat(siteFacts));
  out = await X.run(rescue({ taxIdNonprofit: false }), io, { now: NOW });
  assert.ok(ppCalls(io).length === 0 && out.charts.length === 0, 'no nonprofit wording beside the ID on a .com page: nothing is sent');
  /* An account page of a company's app that prints the reader's own tax ID in its main content. The fixture is what the content script
     returns for this page: it reads labelled IDs from the footer only, so it returns none (test/context-worker.js runs the real content
     script on this page, and checks that "Tax exempt: No" is not nonprofit wording). Nothing is sent. */
  const billing = 'Billing details\nCompany: Reader Widgets LLC\nTax ID: 12-3456789\nTax exempt: No. Upload a certificate to claim tax-exempt status.\nPlan: Team, 14 seats';
  io = fakeIo([noSite, [/organizations\/123456789\.json/, ppOrg(123456789, 'READER WIDGETS LLC', 'Akron', 'OH')]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://app.example.com/settings/billing', title: 'Billing | Example App', siteName: 'Example App', text: billing, pageKind: 'page', taxIds: [], taxIdNonprofit: false, footerText: 'Example App Inc. Terms Privacy' }), io, { now: NOW });
  assert.ok(ppCalls(io).length === 0 && !out.ran.some((r) => r.id === 'page_tax_id'), 'an account page: the tax ID stays on the device');
  // a .com page whose footer prints an ID with no nonprofit wording beside it: the gate still holds
  io = fakeIo([noSite].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://www.example.com/about', title: 'About | Example Co', siteName: 'Example Co', text: 'About us.', pageKind: 'page', taxIds: ['12-3456789'], taxIdNonprofit: false }), io, { now: NOW });
  assert.strictEqual(ppCalls(io).length, 0, 'a company\'s footer ID with no nonprofit wording: not sent');
  // and if such an ID did arrive with nonprofit wording, the filer is still not the site: no chart
  io = fakeIo([noSite, [/organizations\/123456789\.json/, ppOrg(123456789, 'READER WIDGETS LLC', 'Akron', 'OH')], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  out = await X.run(X.pageFacts({ url: 'https://app.example.com/settings/billing', title: 'Billing | Example App', siteName: 'Example App', text: billing, pageKind: 'page', taxIds: ['12-3456789'], taxIdNonprofit: true }), io, { now: NOW });
  assert.strictEqual(out.charts.length, 0, 'the filer of a customer\'s tax ID is not the site');
  // an article never sends a printed tax ID
  io = fakeIo([[/wbgetentities/, wd('Q100', 'Example News', 'Example News', OUTLET)]].concat(siteFacts));
  await X.run(article({ title: 'A charity prints its EIN in a story', text: 'EIN 23-2345678', taxIds: ['23-2345678'], taxIdNonprofit: true }), io, { now: NOW });
  assert.strictEqual(ppCalls(io).length, 0, 'not on an article');
  // HTTP error on the record: no chart, no throw, and the name lookup still runs
  io = fakeIo([noSite, [/organizations\/232345678\.json/, () => ({ status: 500, text: '' })], [/search\.json/, { organizations: [] }]].concat(siteFacts));
  out = await X.run(foodBank(), io, { now: NOW });
  assert.ok(out.charts.length === 0 && out.ran.find((r) => r.id === 'page_tax_id' && !r.ok) && out.ran.find((r) => r.id === 'legal_name'), 'a failed read is listed, not thrown');
  // the city check reads the footer and the address, not only the main text
  const fbHit = { organizations: [{ ein: 232345678, name: 'Example County Food Bank', city: 'Exton', state: 'PA' }] };
  const fbRoutes = [noSite, [/search\.json/, fbHit], [/organizations\/232345678\.json/, ppOrg(232345678, 'EXAMPLE COUNTY FOOD BANK', 'Exton', 'PA')]].concat(siteFacts);
  io = fakeIo(fbRoutes); out = await X.run(foodBank({ taxIds: [], footerText: 'Example County Food Bank 650 Main Road Exton, PA 19341' }), io, { now: NOW });
  assert.strictEqual(out.charts.map((c) => c.id).join(), 'nonprofit_finances', 'the filer\'s city is in the footer');
  io = fakeIo(fbRoutes); out = await X.run(foodBank({ taxIds: [], footerText: '', address: '650 Main Road, Exton, PA 19341' }), io, { now: NOW });
  assert.strictEqual(out.charts.map((c) => c.id).join(), 'nonprofit_finances', 'or in the address the scan found');
  io = fakeIo(fbRoutes); out = await X.run(foodBank({ taxIds: [], footerText: 'Serving families in Ohio.' }), io, { now: NOW });
  assert.strictEqual(out.charts.length, 0, 'no city on the page: the name alone is not enough');
  delete X.REGISTERED.nonprofit_finances;

  // ---- software or a product -> the company behind it -> SEC (the real SEC sources from here on)
  require('../extension/context-sec.js');
  const SOFT4 = (o) => Object.assign({ P31: claim({ id: 'Q7397' }), P856: claim('https://product.example'), P452: claim({ id: 'Q11661' }) }, o);
  const st = (id, rank, ended) => Object.assign({ mainsnak: { snaktype: 'value', datavalue: { value: { id } } }, rank: rank || 'normal' }, ended ? { qualifiers: { P582: [{ datavalue: { value: { time: '+2019-01-01T00:00:00Z' } } }] } } : {});
  const ownersOf = (claims) => X.entityFrom('Q1', { claims }).owners.map((x) => x.q + ':' + x.via).join();
  assert.strictEqual(ownersOf({ P127: [st('Q10')], P178: [st('Q10')], P123: [st('Q10')] }), 'Q10:owned', 'one organization through several properties is one');
  assert.strictEqual(ownersOf({ P127: [st('Q10')], P178: [st('Q11')], P137: [st('Q12')] }), 'Q10:owned', 'ownership is read first: who develops or operates it does not change who owns it');
  assert.strictEqual(ownersOf({ P178: [st('Q11')], P123: [st('Q11')] }), 'Q11:developed', 'with no owner stated, the developer');
  assert.strictEqual(ownersOf({ P127: [st('Q10'), st('Q13', 'normal', true), st('Q14', 'deprecated')] }), 'Q10:owned', 'a former owner (end date) and a deprecated statement are not current');
  assert.strictEqual(ownersOf({ P178: [st('Q11'), st('Q15', 'preferred')] }), 'Q15:developed', 'the preferred statement is the current one');
  assert.strictEqual(X.ownerLink(X.entityFrom('Q1', { claims: { P127: [st('Q10'), st('Q16')] } })), null, 'two different owners: no hop');
  // a minority stake (a statement with a proportion) or a dated snapshot (a point in time) is not "is owned by"
  const stQ = (id, quals) => Object.assign(st(id), { qualifiers: quals });
  const STAKE = { P1107: [{ datavalue: { value: { amount: '+0.05' } } }] }, SNAP = { P585: [{ datavalue: { value: { time: '+2015-01-01T00:00:00Z' } } }] };
  assert.strictEqual(ownersOf({ P127: [stQ('Q10', STAKE)] }), '', 'a 5 percent stake is not ownership');
  assert.strictEqual(ownersOf({ P127: [stQ('Q10', SNAP)] }), '', 'who owned it on one date in 2015 is not who owns it');
  assert.strictEqual(ownersOf({ P749: [stQ('Q10', STAKE)], P127: [stQ('Q12', SNAP), st('Q13')] }), 'Q13:owned', 'the plain statement beside them still counts');
  assert.strictEqual(ownersOf({ P127: [stQ('Q10', STAKE), stQ('Q16', STAKE)], P178: [st('Q11')] }), 'Q11:developed', 'stakes only: no owner is stated, so the developer is read');
  // an ownership that has ended and no current one: who made it years ago is not who is behind it now. No hop
  assert.strictEqual(ownersOf({ P127: [st('Q10', 'normal', true)], P178: [st('Q11')] }), '', 'a former owner and the original developer: no hop');
  assert.strictEqual(ownersOf({ P749: [st('Q10', 'normal', true)], P123: [st('Q11')], P137: [st('Q11')] }), '', 'a former parent: no fall back to publisher or operator');
  assert.strictEqual(ownersOf({ P127: [st('Q10', 'normal', true), st('Q13')], P178: [st('Q11')] }), 'Q13:owned', 'a former owner beside a current one: the current one');
  assert.strictEqual(X.ownerLink(X.entityFrom('Q1', { claims: { P178: [st('Q11')], P137: [st('Q12')] } })), null, 'a developer and a different operator: no hop');
  assert.strictEqual(X.ownerLink(X.entityFrom('Q1', { claims: { P127: [st('Q1')] } })), null, 'an item is not its own owner');
  assert.strictEqual(X.entityFrom('Q1', { labels: { mul: { value: 'Chatly Inc.' } }, claims: {} }).label, 'Chatly Inc.', 'a name stored only as the default for all languages is read');
  const R = X.ownerRelation;
  assert.strictEqual(R({ of: 'Chatly', label: 'Bigcloud', via: 'owned', sameName: false }), 'Chatly is owned by Bigcloud. The figures are for the whole company, not for Chatly alone.');
  assert.strictEqual(R({ of: 'Taskly', label: 'Taskly Inc.', via: 'developed', sameName: true }), 'The figures are for Taskly Inc, the company behind Taskly.', 'the product\'s own company: one sentence, and not "Taskly is owned by Taskly Inc."');
  assert.strictEqual(R({ of: 'Chatly', label: 'Bigcloud', via: 'parent', sameName: false }).split('.')[0], 'Bigcloud is the parent organization of Chatly');
  // the line holds 240 characters: when both sentences do not fit, the first stands alone and whole
  { const long = R({ of: 'The Example Product With A Very Long Official Name For Teams And Enterprises Edition', label: 'Example International Holdings and Technologies Corporation of North America Inc.', via: 'parent', sameName: false });
    assert.strictEqual(long, 'Example International Holdings and Technologies Corporation of North America Inc. is the parent organization of The Example Product With A Very Long Official Name For Teams And Enterprises Edition.', 'the first sentence only, ending at its full stop');
    const edge = R({ of: 'P'.repeat(55), label: 'C'.repeat(55), via: 'owned', sameName: false }); assert.ok(edge.length <= 240 && / alone\.$/.test(edge), 'both sentences when they fit: ' + edge.length); }
  // "the same name apart from a company word" allows the word on the company's side only
  for (const [product, company, same] of [['Taskly', 'Taskly, Inc.', true], ['Taskly', 'Taskly Technologies', true], ['Bank of Example', 'Bank of Example Corporation', true], ['Bigcloud Studios', 'Bigcloud', false], ['Bigcloud Entertainment', 'Bigcloud Corporation', false], ['Chatly', 'Bigcloud', false]]) {
    const o4 = { owner: null }; const routes4 = [[/ids=Q900(&|$)/, wd('Q900', product, product, SOFT4({ P127: [st('Q901')] }))], [/ids=Q901(&|$)/, wd('Q901', company, '', { P31: claim({ id: 'Q4830453' }), P17: claim({ id: 'Q30' }), P169: claim({ id: 'Q1' }), P5531: claim('0001108000') })]].concat(siteFacts);
    const f4 = X.pageFacts({ url: 'https://product.example/', title: product, siteName: product, pageKind: 'index', entityQ: 'Q900' }); await X.run(f4, fakeIo(routes4), { now: NOW });
    assert.strictEqual(f4.owner && f4.owner.sameName, same, product + ' / ' + company + ': same name ' + same);
  }
  assert.strictEqual(R({ of: '', label: 'Bigcloud', via: 'owned' }) + R({ of: 'Chatly', label: '', via: 'owned' }) + R({ of: 'Chatly', label: 'Bigcloud', via: 'made' }), '', 'never a line with an empty name');
  // invented companies: Taskly (software) is owned by Taskly Inc. (ticker TSKL); Chatly is owned by Bigcloud (SEC number on Wikidata)
  const SOFT = (o) => Object.assign({ P31: claim({ id: 'Q7397' }), P856: claim('https://taskly.example'), P452: claim({ id: 'Q11661' }) }, o);
  const LISTED = (tick, o) => Object.assign({ P31: claim({ id: 'Q4830453' }), P17: claim({ id: 'Q30' }), P169: claim({ id: 'Q1' }), P414: [{ mainsnak: { datavalue: { value: { id: 'Q82059' } } }, qualifiers: { P249: [{ datavalue: { value: tick } }] } }] }, o);
  const TICKS = { TSKL: [1477000, 'Taskly, Inc.'] };
  const k10 = (endY, val) => ({ start: (endY - 1) + '-02-01', end: endY + '-01-31', val, accn: '0001477000-' + String(endY).slice(2) + '-000010', fy: endY, fp: 'FY', form: '10-K', filed: endY + '-03-20' });
  const concept = (name, tag, rows) => ({ cik: 1, taxonomy: 'us-gaap', tag, entityName: name, units: { USD: rows } });
  const secRoutes = (cik10, name) => [[new RegExp('CIK' + cik10 + '/us-gaap/Revenues\\.json'), concept(name, 'Revenues', [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => k10(y, 1e8 * (y - 2017))))], [new RegExp('CIK' + cik10 + '/us-gaap/NetIncomeLoss\\.json'), concept(name, 'NetIncomeLoss', [k10(2026, -5e7)])],
    [new RegExp('submissions/CIK' + cik10 + '\\.json'), { name, filings: { recent: { form: ['8-K', '10-K'], filingDate: ['2026-09-04', '2026-03-20'], accessionNumber: ['0001477000-26-000031', '0001477000-26-000010'], items: ['5.02', ''] }, files: [] } }]];
  const wdCalls = (io2) => io2.calls.filter((c) => /wbgetentities/.test(c.url)).map((c) => (/ids=([^&]+)/.exec(decodeURIComponent(c.url)) || [])[1]);
  const taskly = [[/wbgetentities.*ids=Q500(&|$)/, wd('Q500', 'Taskly', 'Taskly', SOFT({ P127: [st('Q501')] }))], [/wbgetentities.*ids=Q501(&|$)/, wd('Q501', 'Taskly Inc.', '', LISTED('TSKL', { P749: [st('Q777')] }))]].concat(secRoutes('0001477000', 'Taskly, Inc.'), siteFacts);
  const chatly = (ownerClaims) => [[/wbgetentities.*ids=Q600(&|$)/, wd('Q600', 'Chatly', 'Chatly', SOFT({ P127: [st('Q601')], P178: [st('Q602')], P123: [st('Q602')], P137: [st('Q603')] }))], [/wbgetentities.*ids=Q601(&|$)/, wd('Q601', 'Bigcloud', 'Bigcloud', ownerClaims)]].concat(secRoutes('0001108000', 'Bigcloud, Inc.'), siteFacts);
  const BIG = LISTED('BGC', { P5531: claim('0001108000'), P127: [st('Q888')] });
  const lead = (o2) => (o2.charts[0] ? [o2.charts[0].id, o2.charts[0].about, o2.charts[0].aboutLabel, o2.charts[0].relation] : []);
  // the product's own company, on a pricing page that sells: it leads, with the link stated and no scope sentence
  io = fakeIo(taskly); let pf2 = X.pageFacts({ url: 'https://taskly.example/pricing', title: 'Pricing | Taskly', siteName: 'Taskly', sells: true, entityQ: 'Q500' });
  out = await X.run(pf2, io, { now: NOW, secTickers: TICKS });
  assert.deepStrictEqual(lead(out), ['sec_financials', 'subject', 'Taskly Inc.', 'The figures are for Taskly Inc, the company behind Taskly.'], JSON.stringify(out.ran));
  assert.ok(/^Taskly Inc\. reported \$900 million in revenue for fiscal 2026 and a net loss of \$50 million/.test(out.charts[0].sentence), out.charts[0].sentence);
  assert.deepStrictEqual([out.charts[1].id, out.charts[1].relation], ['sec_filings', 'The figures are for Taskly Inc, the company behind Taskly.'], 'the filings list follows, with the same line');
  assert.deepStrictEqual([pf2.site.label, pf2.owner.label, pf2.owner.cik, pf2.owner.sameName], ['Taskly', 'Taskly Inc.', '1477000', true], 'the site entity is kept as it is; the owner is a separate entity, matched by ticker and name');
  assert.deepStrictEqual(wdCalls(io), ['Q500', 'Q501'], 'one extra Wikidata request, and the owner\'s own parent (Q777) is never read');
  assert.ok(out.ran.find((r) => r.id === 'owner' && r.ok && /behind Taskly to Wikidata/.test(r.sends)) && out.facts.find((x) => x.id === 'entity' && /^Taskly/.test(x.text)), 'the hop is listed; the site fact is still the site');
  // a company with another name, on a pricing page that sells: it may lead, and the line says whose figures these are
  io = fakeIo(chatly(BIG)); pf2 = X.pageFacts({ url: 'https://chatly.example/pricing', title: 'Pricing | Chatly', siteName: 'Chatly', sells: true, entityQ: 'Q600' });
  out = await X.run(pf2, io, { now: NOW, secTickers: TICKS });
  assert.deepStrictEqual(lead(out), ['sec_financials', 'subject', 'Bigcloud', 'Chatly is owned by Bigcloud. The figures are for the whole company, not for Chatly alone.'], JSON.stringify(out.ran));
  assert.deepStrictEqual(wdCalls(io), ['Q600', 'Q601'], 'the developer (Q602), the operator (Q603) and the owner\'s owner (Q888) are never read: one hop');
  // the same company on the site's front page: also about the site itself
  io = fakeIo(chatly(BIG)); out = await X.run(X.pageFacts({ url: 'https://chatly.example/', title: 'Chatly', siteName: 'Chatly', pageKind: 'index', entityQ: 'Q600' }), io, { now: NOW });
  assert.strictEqual(lead(out)[0], 'sec_financials', 'a front page is about the site');
  // an inner page that neither sells nor is the front page is labelled as about the site: another company's figures are not shown there
  io = fakeIo(chatly(BIG)); out = await X.run(X.pageFacts({ url: 'https://chatly.example/help/keyboard-shortcuts', title: 'Keyboard shortcuts | Chatly', siteName: 'Chatly', pageKind: 'page', entityQ: 'Q600' }), io, { now: NOW });
  assert.ok(!out.charts.some((c) => /^sec_/.test(c.id)) && !io.calls.some((c) => /sec\.gov/.test(c.url)), 'a help page: no chart about the parent company, and nothing asked of the SEC');
  io = fakeIo(taskly); out = await X.run(X.pageFacts({ url: 'https://taskly.example/help/keyboard-shortcuts', title: 'Keyboard shortcuts | Taskly', siteName: 'Taskly', pageKind: 'page', entityQ: 'Q500' }), io, { now: NOW, secTickers: TICKS });
  assert.deepStrictEqual(lead(out).slice(0, 3), ['sec_financials', 'site', 'Taskly Inc.'], 'the product\'s own company stands where the site would: shown, and labelled as about the site');
  // an article about the product: a company with another name is never shown; the product's own company stands where a company subject would
  const story = (name, q, text) => X.pageFacts({ url: 'https://www.example-news.com/2026/11/01/story/', siteName: 'Example News', pageKind: 'article', isArticle: true, entityQ: 'Q100', title: name + ' adds a new calendar view for teams', text });
  const newsRoutes = (name, q, rest) => [[/wbgetentities.*ids=Q100(&|$)/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/list=search/, { query: { search: [{ title: name }] } }], [new RegExp('wbgetentities.*titles=' + name), rest[0][1]]].concat(rest);
  io = fakeIo(newsRoutes('Chatly', 'Q600', chatly(BIG)));
  let art = story('Chatly', 'Q600', 'On Monday Chatly said. Users of Chatly can. The new Chatly view. Chatly again.'); out = await X.run(art, io, { now: NOW });
  assert.deepStrictEqual([art.subject.label, art.owner && art.owner.label, out.charts.concat(out.other).some((c) => /^sec_/.test(c.id)), io.calls.some((c) => /sec\.gov/.test(c.url))], ['Chatly', 'Bigcloud', false, false], 'an article about a product: the parent company\'s figures are not shown, and the SEC is not asked');
  io = fakeIo(newsRoutes('Taskly', 'Q500', taskly));
  art = story('Taskly', 'Q500', 'On Monday Taskly said. Users of Taskly can. The new Taskly view. Taskly again.'); out = await X.run(art, io, { now: NOW, secTickers: TICKS });
  const own = out.charts.find((c) => c.id === 'sec_financials');
  assert.deepStrictEqual([own && own.about, own && own.aboutLabel, own && own.relation], ['subject', 'Taskly Inc.', 'The figures are for Taskly Inc, the company behind Taskly.'], 'an article about a product whose company carries its name: that company\'s filings, with the link stated');
  // an article about a book: its publisher never carries its name, so the publisher is not looked up
  io = fakeIo([[/wbgetentities.*ids=Q100(&|$)/, wd('Q100', 'Example News', 'Example News', OUTLET)], [/list=search/, { query: { search: [{ title: 'Chatly' }] } }], [/wbgetentities.*titles=Chatly/, wd('Q700', 'Chatly', 'Chatly', { P577: claim({ time: '+2025-01-01T00:00:00Z' }), P50: claim({ id: 'Q9' }), P123: [st('Q601')] })]].concat(siteFacts));
  art = story('Chatly', 'Q700', 'On Monday Chatly said. Users of Chatly can. The new Chatly view. Chatly again.'); out = await X.run(art, io, { now: NOW });
  assert.deepStrictEqual([art.subject.kind, art.owner, wdCalls(io).filter((q) => q === 'Q601').length], ['work', null, 0], 'a work on an article: no hop');
  // two different organizations as owners: no hop, no request
  io = fakeIo([[/wbgetentities.*ids=Q600(&|$)/, wd('Q600', 'Chatly', 'Chatly', SOFT({ P127: [st('Q601'), st('Q604')] }))]].concat(chatly(BIG).slice(1)));
  pf2 = X.pageFacts({ url: 'https://chatly.example/pricing', title: 'Pricing | Chatly', siteName: 'Chatly', sells: true, entityQ: 'Q600' }); out = await X.run(pf2, io, { now: NOW });
  assert.deepStrictEqual([pf2.owner, wdCalls(io).join(), out.charts.some((c) => /^sec_/.test(c.id)), out.ran.some((r) => r.id === 'owner')], [null, 'Q600', false, false], 'two owners: nothing is guessed and nothing is asked');
  // an owner with no SEC identity (a private company; a ticker whose name does not match; a person): no chart
  for (const [why, claims] of [['private', { P31: claim({ id: 'Q4830453' }), P17: claim({ id: 'Q30' }), P169: claim({ id: 'Q1' }), P749: [st('Q888')] }], ['ticker of another company', LISTED('TSKL', {})], ['a person', HUMAN]]) {
    io = fakeIo(chatly(claims)); pf2 = X.pageFacts({ url: 'https://chatly.example/pricing', title: 'Pricing | Chatly', siteName: 'Chatly', sells: true, entityQ: 'Q600' }); out = await X.run(pf2, io, { now: NOW, secTickers: TICKS });
    assert.ok(!out.charts.some((c) => /^sec_/.test(c.id)) && !io.calls.some((c) => /sec\.gov/.test(c.url)) && !(pf2.owner && pf2.owner.cik), 'owner is ' + why + ': no SEC chart and no SEC request');
    assert.deepStrictEqual(wdCalls(io), ['Q600', 'Q601'], 'owner is ' + why + ': its own parent is not followed to find a filer');
  }
  // a site that files itself is never hopped from; neither is a nonprofit with a tax ID
  io = fakeIo([[/wbgetentities/, wd('Q182477', 'Nvidia', 'Nvidia', Object.assign({ P749: [st('Q601')] }, COMPANY))]].concat(siteFacts));
  await X.run(X.pageFacts({ url: 'https://shop.example.com/products/wool-runner', title: 'Wool Runner', siteName: 'Example', sells: true, entityQ: 'Q182477' }), io, { now: NOW });
  assert.deepStrictEqual(wdCalls(io), ['Q182477'], 'a filer keeps its own records: no hop');
  delete X.REGISTERED.sec_financials; delete X.REGISTERED.sec_filings;
  // ---- one run reads one address once
  { let n2 = 0; const once = { get: async (url) => { n2++; return { status: 200, text: '{}' }; } }; X.register({ id: 'park_visits', basis: 'statistic', scope: 'page', label: 'l', question: 'q', applies: () => true, sends: () => 's', run: async (f2, io2) => { await io2.get('https://a.example/x'); await io2.get('https://a.example/x'); await io2.get('https://a.example/x', { cookies: true }); return null; } });
    const asked = []; const once2 = { get: async (url, opt) => { asked.push(url + (opt && opt.cookies ? ' +cookies' : '')); return once.get(url); } };
    const before = n2; const o3 = await X.run(X.pageFacts({ url: 'https://tiny-blog.example/pasta', title: 'A weeknight pasta', pageKind: 'recipe' }), once2, { now: NOW, maxRequests: 30 });
    assert.strictEqual(o3.requests, n2 - before, 'the count is of requests that left');
    assert.deepStrictEqual(asked.filter((u) => u.startsWith('https://a.example/x')), ['https://a.example/x', 'https://a.example/x +cookies'], 'three reads of one address: one request, plus the one that carries cookies (never answered from memory)');
    assert.strictEqual(asked.length, 6, 'exactly six requests left: the site lookup, the address once, the address with cookies, and three site facts. Got ' + asked.length + ': ' + asked.map((u) => u.slice(0, 40)).join(' | '));
    assert.strictEqual(new Set(asked).size, asked.length, 'no address was asked twice');
    delete X.REGISTERED.park_visits; }
  }
  console.log('Context data: subject, question order, series rules, sources, budget and cookies passed.');
  console.log('Context data: new page facts, sources naming their subject, the relation line, a printed tax ID and the company behind a product passed.');
})().catch((e) => { console.error(e); process.exit(1); });
