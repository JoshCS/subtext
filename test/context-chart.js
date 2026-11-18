/* The context card's chart (extension/ui/view.js: chartSvg, chartFigure, fmtValue, chartModel) and the card itself.
   The chart functions are pure strings, so they run here in Node; the card is rendered in a headless page with the real
   stylesheet to check the list kind, the empty state and that no chart label touches another at the narrowest panel width.
   Shapes follow docs/CONTEXT-CONTRACT.md. All data here is synthetic. */
const assert = require('assert');
const path = require('path');
global.MLCommon = {}; require('../extension/ui/view.js'); const V = global.SubtextView;

const rects = (svg) => (svg.match(/<rect[^>]*>/g) || []).map((r) => ({ x: +/ x="([-\d.]+)"/.exec(r)[1], y: +/ y="([-\d.]+)"/.exec(r)[1], w: +/ width="([-\d.]+)"/.exec(r)[1], h: +/ height="([-\d.]+)"/.exec(r)[1], end: /cx-bar--end/.test(r) }));
const zeroY = (svg) => +/class="cx-zero" d="M0 ([-\d.]+)H1000"/.exec(svg)[1];
const noNaN = (s) => !/NaN|Infinity|undefined/.test(s.replace(/aria-label="[^"]*"/, ''));

// ---- escaping, coercion, unparseable dates
{
  const svg = V.chartSvg({ kind: 'line', title: 'x', sentence: 'A <b>bold</b> "claim"', points: [{ t: '2026-01', v: 5 }, { t: '2026-02', v: '7' }, { t: '2026-03', v: 'NaN' }, { t: '2026-04', v: -3 }, { t: '<script>', v: 9 }] });
  assert.ok(!/<b>|<script>/.test(svg) && /aria-label="A &lt;b&gt;bold&lt;\/b&gt; &quot;claim&quot;"/.test(svg), 'the sentence is escaped into aria-label');
  assert.ok(/role="img"/.test(svg) && noNaN(svg), 'no NaN reaches the drawing');
  const fig = V.chartFigure({ kind: 'line', unit: '<i>units</i>', sentence: 's', mark: { t: '2026-02', label: '<img src=x onerror=1>' }, points: [{ t: '2026-01', v: 5 }, { t: '2026-02', v: 7 }, { t: '2026-03', v: 6 }] });
  assert.ok(!/<i>|<img/.test(fig) && /&lt;i&gt;units/.test(fig) && /&lt;img src=x/.test(fig), 'unit and mark label are escaped');
  assert.ok(!/ style=/.test(fig), 'no inline style attribute: positions travel as data-* numbers');
  assert.strictEqual(V.chartSvg({ points: [{ t: '1', v: 1 }] }), '', 'one point draws nothing');
  assert.strictEqual(V.chartSvg({ points: [{ t: '2026-01', v: 1 }, { t: '2026-02', v: null }] }), '', 'one value and one gap draw nothing');
  assert.strictEqual(V.chartFigure({ points: [] }), '', 'no points, no figure');
}

// ---- bars: one rect per value, zero is a stub, null and absent periods leave empty slots, negatives hang below zero
{
  const daily = V.chartSvg({ kind: 'bars', sentence: 's', points: Array.from({ length: 30 }, (_, i) => ({ t: '2026-10-' + String(i + 1).padStart(2, '0'), v: i % 4 })) });
  assert.strictEqual(rects(daily).length, 30, 'one bar per day, zeros included');
  const z = zeroY(daily); assert.ok(rects(daily).every((r) => Math.abs(r.y + r.h - z) < 0.01 && r.h >= 2), 'every bar stands on the zero line; a zero is a visible stub');
  // yearly records: 2017 is absent from the list, 2021 is null, 2016 and 2020 are losses
  const pts = [{ t: '2012', v: 1.2e6 }, { t: '2013', v: 2.1e6 }, { t: '2014', v: 1.7e6 }, { t: '2015', v: 3.9e6 }, { t: '2016', v: -1.1e6 }, { t: '2018', v: 5.2e6 }, { t: '2019', v: 6.8e6 }, { t: '2020', v: -4.6e6 }, { t: '2021', v: null }, { t: '2022', v: 7.4e6 }, { t: '2023', v: 4.9e6 }, { t: '2024', v: 3.1e6 }];
  const chart = { kind: 'bars', resolution: 'year', unit: 'US dollars', nominal: true, sentence: 's', points: pts };
  const svg = V.chartSvg(chart); const r = rects(svg); const zy = zeroY(svg);
  assert.strictEqual(r.length, 11, 'a null year draws no bar');
  const slot = 1000 / 13; // 2012 to 2024 inclusive is 13 yearly slots
  const centre = (year) => (year - 2012 + 0.5) * slot;
  ['2012', '2013', '2014', '2015', '2016', '2018', '2019', '2020', '2022', '2023', '2024'].forEach((y, i) => assert.ok(Math.abs(r[i].x + r[i].w / 2 - centre(+y)) < 1.5, 'the ' + y + ' bar sits in its own year, not at its position in the list'));
  assert.ok(!r.some((b) => Math.abs(b.x + b.w / 2 - centre(2017)) < slot / 2) && !r.some((b) => Math.abs(b.x + b.w / 2 - centre(2021)) < slot / 2), 'the slots for 2017 (absent) and 2021 (null) are empty');
  assert.ok(Math.abs(r[4].y - zy) < 0.01 && r[4].h > 2 && Math.abs(r[7].y - zy) < 0.01 && r[7].h > r[4].h, 'losses hang below the zero line, the larger loss further');
  assert.ok(r[0].y + r[0].h <= zy + 0.01 && r[9].y < r[0].y, 'gains rise above it');
  assert.ok(zy > 8 && zy < 92, 'the zero line is inside the plot when values go negative');
  assert.ok(r[10].end && r.filter((b) => b.end).length === 1, 'only the latest bar is emphasised');
  const m = V.chartModel(chart); assert.deepStrictEqual(m.gaps.map((t) => new Date(t).getUTCFullYear()), [2017, 2021], 'both missing years are known as gaps');
  const fig = V.chartFigure(chart);
  assert.ok(/US dollars, not adjusted for inflation/.test(fig), 'nominal money says so');
  assert.ok(/cx__val--end[^>]*>\$3\.1M</.test(fig) && /cx__val--ref[^>]*>\$7\.4M</.test(fig), 'the latest value and the highest are labelled');
  assert.strictEqual((fig.match(/class="cx__val /g) || []).length, 2, 'at most two value labels');
  assert.ok(/<span>2012<\/span><span>2024<\/span>/.test(fig), 'first and last dates on the axis');
}

// ---- lines: a null breaks the line, an absent period breaks it too, a lone value is still drawn
{
  const line = V.chartSvg({ kind: 'line', resolution: 'month', sentence: 's', points: [{ t: '2025-08', v: 3.0 }, { t: '2025-09', v: 3.0 }, { t: '2025-10', v: null }, { t: '2025-11', v: 2.7 }, { t: '2025-12', v: 2.7 }, { t: '2026-02', v: 2.4 }, { t: '2026-03', v: 2.6 }] });
  const d = /class="cx-line" d="([^"]+)"/.exec(line)[1];
  assert.strictEqual((d.match(/M/g) || []).length, 3, 'three runs: before the null, after it, and after the absent January');
  assert.ok(!/<rect/.test(line), 'a line chart has no bars');
  const lone = V.chartSvg({ kind: 'line', resolution: 'month', sentence: 's', points: [{ t: '2026-01', v: 1 }, { t: '2026-02', v: null }, { t: '2026-03', v: 2 }, { t: '2026-04', v: null }, { t: '2026-05', v: 3 }, { t: '2026-06', v: 3 }] });
  assert.ok(/class="cx-pt" d="M[-\d. ]+h0M[-\d. ]+h0"/.test(lone), 'values with no neighbour are drawn as points');
  // zero baseline for a percent series that never comes near zero
  const pct = { kind: 'line', resolution: 'month', unit: 'percent', sentence: 's', points: [{ t: '2026-01', v: 3.7 }, { t: '2026-02', v: 3.9 }, { t: '2026-03', v: 4.2 }, { t: '2026-04', v: 2.6 }] };
  const pm = V.chartModel(pct); assert.ok(Math.abs(pm.y0 - 98.5) < 0.01 && pm.Y(4.2) < pm.Y(2.6) && pm.Y(2.6) < pm.y0 - 40, 'the axis starts at zero, so 2.6 sits well above the baseline');
  const steps = V.chartSvg({ kind: 'steps', resolution: 'month', sentence: 's', points: [{ t: '2026-01', v: 5.5 }, { t: '2026-02', v: 5.5 }, { t: '2026-03', v: 5.0 }] });
  assert.ok(/class="cx-line" d="M0 [\d.]+H[\d.]+V[\d.]+H[\d.]+V[\d.]+H1000"/.test(steps), 'steps hold each value for its period');
}

// ---- value labels: one decimal for a percent, cents for small money, a real minus sign
{
  const f = V.fmtValue;
  assert.strictEqual(f(3.7, 'percent'), '3.7%'); assert.strictEqual(f(4, 'percent'), '4.0%'); assert.strictEqual(f(2.6, 'percent'), '2.6%'); assert.strictEqual(f(3.75, 'percent'), '3.75%', 'a rate quoted to two decimals keeps both'); assert.strictEqual(f(6.23, 'percent'), '6.23%'); assert.strictEqual(f(5.5, 'percent'), '5.5%'); assert.strictEqual(f(12.34, 'percent'), '12.3%');
  assert.strictEqual(f(-0.6, 'percent'), '−0.6%', 'negative growth keeps its sign and its decimal');
  assert.strictEqual(f(3.119, 'US dollars a gallon'), '$3.12'); assert.strictEqual(f(80610, 'US dollars, adjusted for inflation'), '$80.6k');
  assert.strictEqual(f(-4.6e6, 'US dollars'), '−$4.6M'); assert.strictEqual(f(41.5e6, 'US dollars'), '$41.5M'); assert.strictEqual(f(2.3e9, 'US dollars'), '$2.3B');
  assert.strictEqual(f(296000, 'views a month'), '296k'); assert.strictEqual(f(41, 'articles'), '41'); assert.strictEqual(f(999999, 'articles'), '1M');
  const fig = V.chartFigure({ kind: 'bars', resolution: 'quarter', unit: 'percent', sentence: 's', points: [{ t: '2025-01', v: 3.7 }, { t: '2025-04', v: -0.6 }, { t: '2025-07', v: 3.0 }, { t: '2025-10', v: 2.6 }] });
  assert.ok(/cx__val--end[^>]*>2\.6%</.test(fig) && /cx__val--ref[^>]*>3\.7%</.test(fig), '3.7 is printed as 3.7, never 4');
  assert.ok(/<span>Q1 2025<\/span><span>Q4 2025<\/span>/.test(fig), 'quarters are labelled as quarters');
  const qm = V.chartModel({ kind: 'bars', resolution: 'quarter', sentence: 's', mark: { t: '2025-07', label: 'page published' }, points: [{ t: '2025-01', v: 1 }, { t: '2025-04', v: 2 }, { t: '2025-07', v: 3 }, { t: '2025-10', v: 2 }] });
  assert.ok(Math.abs(qm.mark.x - qm.xMid(qm.pts[2])) < 0.01, 'a mark given as the first month of a quarter stands at the centre of that quarter\'s bar');
  const gaps = { kind: 'bars', resolution: 'year', sentence: 'No figure is listed for 2019 and 2020.', note: '', points: [{ t: '2017', v: 1 }, { t: '2018', v: 2 }, { t: '2019', v: null }, { t: '2020', v: null }, { t: '2021', v: 3 }] };
  assert.deepStrictEqual(V.chartModel(gaps).gaps.length, 2, 'two null years are gaps');
}

// ---- the reference mark: drawn inside the window, dropped outside it
{
  const base = { kind: 'line', resolution: 'month', sentence: 's', points: [{ t: '2026-01', v: 1 }, { t: '2026-02', v: 2 }, { t: '2026-03', v: 3 }, { t: '2026-04', v: 2 }] };
  const inside = V.chartFigure(Object.assign({ mark: { t: '2026-03', label: 'page published' } }, base));
  assert.ok(/class="cx-rule"/.test(inside) && />Page published</.test(inside), 'a mark inside the window is a rule with its label');
  const rx = +/class="cx-rule" d="M([-\d.]+) 0V100"/.exec(inside)[1]; assert.ok(Math.abs(rx - 1000 * (31 + 28 + 15.5) / 120) < 1, 'the rule stands at mid-March by date (days, not list position)');
  const outside = V.chartFigure(Object.assign({ mark: { t: '2027-01', label: 'page published' } }, base));
  assert.ok(!/cx-rule|cx__mark/.test(outside), 'a mark outside the window is not drawn');
}

// ---- the card in a browser: list kind, empty state, about-the-site line, and no label collision at 280 px
(async () => {
  const { chromium } = require('playwright'); const fs = require('fs');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 280, height: 900 } });
  await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0"><div id="host" style="width:254px;padding:0 12px"></div></body>');
  await page.addScriptTag({ content: 'window.MLCommon = { glance: () => ({ flags: [], count: 0 }), reading: () => null, oneFactEach: (x) => x, labelFor: () => ({}), findingWeight: () => 0, flagOrder: () => 0 };' });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'extension', 'ui', 'view.js'), 'utf8') });
  await page.addStyleTag({ content: await page.evaluate(() => SubtextView.CSS) });
  const render = (result, status) => page.evaluate(([result, status]) => {
    const host = document.getElementById('host'); host.innerHTML = '';
    SubtextView.render(host, { state: { report: { hostname: 'example.org', url: 'https://example.org/a', findings: [], meta: {} }, context: { status: status || 'done', result, error: status === 'error' ? 'no response' : '' } }, rules: {}, labels: {}, on: {} });
    const q = (s) => Array.from(host.querySelectorAll(s)); const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, text: e.textContent }; };
    const card = host.querySelector('.ctx').getBoundingClientRect();
    return { text: host.querySelector('.ctx').textContent, svg: q('.ctx svg.ctx__svg').length, rows: q('.ctx__rows li').length, links: q('.ctx__rows a').map((a) => a.getAttribute('href')), card: { l: card.left, r: card.right },
      figures: q('.cx').map((f) => ({ plot: box(f.querySelector('.cx__plot')), labels: Array.from(f.querySelectorAll('.cx__val, .cx__mark, .cx__unit, .cx__axis > span')).map(box) })) };
  }, [result, status]);
  const done = (charts, extra) => Object.assign({ group: 'news', subject: { label: 'Example Co', kind: 'organization' }, terms: {}, charts, facts: [], ran: [], requests: 1, at: '2026-11-17T00:00:00Z' }, extra || {});
  const list = await render(done([{ id: 'sec_filings', basis: 'records', about: 'subject', aboutLabel: 'Example Co', title: 'SEC filings: Example Co', sentence: 'Example Co filed 2 reports.', kind: 'list', resolution: 'day', points: [], unit: 'filings', rowsLabel: 'SEC filings around Apr 2026',
    rows: [{ t: '2026-04-09', text: '8-K: <b>results</b>', url: 'https://www.sec.gov/a' }, { t: '2026-04-02', text: '8-K: other events', url: 'javascript:alert(1)' }], note: 'n', source: { name: 'SEC EDGAR', url: 'https://www.sec.gov/' } }]));
  assert.ok(list.svg === 0 && list.rows === 2, 'a list draws its rows and no chart');
  assert.ok(/Public records/.test(list.text) && /SEC filings around Apr 2026/.test(list.text) && /9 Apr 2026/.test(list.text) && /8-K: <b>results<\/b>/.test(list.text), 'basis heading, rows heading, dates and escaped text');
  assert.deepStrictEqual(list.links, ['https://www.sec.gov/a'], 'only http(s) links become links');
  const empty = await render(done([], { subject: null, facts: [{ id: 'a', label: 'Popularity', text: 'Ranked 201.', links: [], note: '' }] }));
  assert.ok(/Nothing to show for this page/.test(empty.text) && /Popularity/.test(empty.text) && /Ranked 201\./.test(empty.text), 'no subject and no chart: said plainly, and the facts still render');
  const site = await render(done([{ id: 'site_views', basis: 'site', about: 'site', aboutLabel: 'The Example', title: 'Wikipedia views: The Example', sentence: 's', kind: 'line', resolution: 'month', unit: 'views a month', points: Array.from({ length: 12 }, (_, i) => ({ t: '2026-' + String(i + 1).padStart(2, '0'), v: 100 + i })) }]));
  assert.ok(/Attention to this site/.test(site.text) && /About the site, not this page\./.test(site.text), 'a site chart on an article says it is about the site');
  // a chart about the company behind the page's subject: the source's own subject is named, and one line states the link, above the title and the sentence
  const rel = await page.evaluate(() => { const host = document.getElementById('host'); host.innerHTML = '';
    const chart = { id: 'sec_financials', basis: 'records', about: 'subject', aboutLabel: 'Bigcloud', relation: 'Chatly is owned by Bigcloud. The figures are for the whole company, not for <b>Chatly</b> alone.', title: 'Revenue: BIGCLOUD INC', sentence: 'Bigcloud reported $900 million in revenue for fiscal 2026.', kind: 'bars', resolution: 'year', unit: 'US dollars', nominal: true, points: [{ t: '2021', v: 4e8 }, { t: '2022', v: 5e8 }, { t: '2023', v: 6e8 }, { t: '2024', v: 7e8 }, { t: '2025', v: 8e8 }, { t: '2026', v: 9e8 }], source: { name: 'SEC EDGAR', url: 'https://www.sec.gov/' } };
    const park = Object.assign({}, chart, { id: 'park_visits', basis: 'statistic', aboutLabel: 'Example National Park', relation: undefined, title: 'Recreation visits by month', sentence: 's' });
    const odd = Object.assign({}, chart, { id: 'x', relation: { text: 'not a line' }, title: 'Odd', sentence: 's' });
    SubtextView.render(host, { state: { report: { hostname: 'chatly.example', url: 'https://chatly.example/pricing', findings: [], meta: {} }, context: { status: 'done', result: { group: 'shop', subject: { label: 'Chatly', kind: 'organization' }, terms: {}, charts: [chart, park, odd], other: [], facts: [], ran: [], requests: 1, at: '2026-11-17T00:00:00Z' } } }, rules: {}, labels: {}, on: {} });
    const blocks = Array.from(host.querySelectorAll('.ctx__chart')); const lead = blocks[0]; const order = Array.from(lead.children).map((e) => e.className.split(' ')[0]);
    const r = lead.querySelector('.ctx__relation').getBoundingClientRect(); const card = host.querySelector('.ctx').getBoundingClientRect();
    return { order, relation: lead.querySelector('.ctx__relation').textContent, html: lead.querySelector('.ctx__relation').innerHTML, who: (lead.querySelector('.ctx__who') || {}).textContent || '', about: !!lead.querySelector('.ctx__about'),
      inside: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 && r.height > 0, parkWho: blocks[1].querySelector('.ctx__who').textContent, parkRelation: blocks[1].querySelectorAll('.ctx__relation').length, oddRelation: blocks[2].querySelectorAll('.ctx__relation').length }; });
  assert.strictEqual(rel.relation, 'Chatly is owned by Bigcloud. The figures are for the whole company, not for <b>Chatly</b> alone.', 'the relation line is shown as text');
  assert.ok(/&lt;b&gt;Chatly&lt;\/b&gt;/.test(rel.html) && !/<b>/.test(rel.html), 'and escaped like every other string');
  assert.ok(rel.order.indexOf('ctx__relation') > rel.order.indexOf('ctx__basis') && rel.order.indexOf('ctx__relation') < rel.order.indexOf('ctx__title') && rel.order.indexOf('ctx__relation') < rel.order.indexOf('ctx__sentence'), 'above the title and the sentence: ' + rel.order.join(' '));
  assert.ok(rel.inside && !rel.about, 'it wraps inside the card at 280 px; a chart about the subject is not called "about the site"');
  assert.deepStrictEqual([rel.who, rel.parkWho], ['', 'Example National Park'], 'the name a source gave for its own subject is shown, not the page\'s subject (Chatly); a title that already names it is not repeated');
  assert.deepStrictEqual([rel.parkRelation, rel.oddRelation], [0, 0], 'no relation, or one that is not text: no line');
  // `other` never leads: with no lead chart the card says so, shows the facts, and keeps the attention charts in a closed fold
  const att = await page.evaluate(() => { const host = document.getElementById('host'); host.innerHTML = '';
    const view = { id: 'site_views', basis: 'site', about: 'site', aboutLabel: 'The Example', title: 'Wikipedia views: The Example', sentence: 'Viewed about 100 times a month.', kind: 'line', resolution: 'month', unit: 'views a month', points: Array.from({ length: 12 }, (_, i) => ({ t: '2026-' + String(i + 1).padStart(2, '0'), v: 100 + i })) };
    SubtextView.render(host, { state: { report: { hostname: 'example.org', url: 'https://example.org/a', findings: [], meta: {} }, context: { status: 'done', result: { group: 'news', subject: { label: 'Example Co', kind: 'organization' }, terms: {}, charts: [], other: [view], facts: [{ id: 'a', label: 'Popularity', text: 'Ranked 201.', links: [], note: '' }], ran: [], requests: 1, at: '2026-11-17T00:00:00Z' } } }, rules: {}, labels: {}, on: {} });
    const btn = host.querySelector('.card__more[data-fold="ctx-other"]'); const fold = btn && btn.nextElementSibling; const ctx = host.querySelector('.ctx');
    const order = Array.from(ctx.children).map((e) => e.className.split(' ')[0]);
    return { lead: ctx.querySelector('.ctx__empty').textContent, button: btn && btn.textContent, expanded: btn && btn.getAttribute('aria-expanded'), hidden: fold && fold.hidden, inFold: fold ? fold.querySelectorAll('svg.ctx__svg').length : -1, outside: Array.from(ctx.querySelectorAll('svg.ctx__svg')).filter((e) => !fold.contains(e)).length, order }; });
  assert.ok(/No public record or official statistic was found for this page's subject, Example Co\./.test(att.lead), 'the empty lead is said plainly');
  assert.ok(att.button === 'Attention data (1)' && att.expanded === 'false' && att.hidden === true && att.inFold === 1 && att.outside === 0, 'attention charts sit in a closed fold and nothing from `other` is promoted');
  assert.ok(att.order.indexOf('kvs') > att.order.indexOf('ctx__lead') && att.order.indexOf('card__more') > att.order.indexOf('kvs'), 'lead, then facts, then the fold');
  const cov = await page.evaluate(() => { const host = document.getElementById('host'); host.innerHTML = '';
    const pts = Array.from({ length: 12 }, (_, i) => ({ t: '2026-11-' + String(i + 1).padStart(2, '0'), v: i % 4 }));
    const news = { id: 'news_coverage', basis: 'coverage', about: 'page', aboutLabel: '', title: 'Articles on this story, last 30 days', sentence: 'Google News returned 18 articles.', kind: 'bars', resolution: 'day', unit: 'articles', points: pts };
    const view = { id: 'subject_views', basis: 'topic', about: 'subject', aboutLabel: 'Example Co', title: 'Wikipedia views: Example Co', sentence: 'Viewed about 100 times a day.', kind: 'line', resolution: 'day', unit: 'views a day', points: pts };
    SubtextView.render(host, { state: { report: { hostname: 'example.org', url: 'https://example.org/a', findings: [], meta: {} }, context: { status: 'done', result: { group: 'news', subject: { label: 'Example Co', kind: 'organization' }, terms: {}, charts: [], other: [news, view], facts: [], ran: [], requests: 2, at: '2026-11-17T00:00:00Z' } } }, rules: {}, labels: {}, on: {} });
    const btn = host.querySelector('.card__more[data-fold="ctx-other"]'); const fold = btn && btn.nextElementSibling; const ctx = host.querySelector('.ctx');
    return { lead: ctx.querySelector('.ctx__empty').textContent, button: btn && btn.textContent, show: btn && btn.dataset.show, hide: btn && btn.dataset.hide, hidden: fold && fold.hidden, inFold: fold ? fold.querySelectorAll('svg.ctx__svg').length : -1, outside: Array.from(ctx.querySelectorAll('svg.ctx__svg')).filter((e) => !fold.contains(e)).length }; });
  assert.ok(cov.button === 'Coverage and attention data (2)' && cov.show === cov.button && cov.hide === 'Hide coverage and attention data' && cov.hidden === true && cov.inFold === 2 && cov.outside === 0, 'the news-article count sits in the closed fold with the attention charts, and the fold says so: ' + JSON.stringify(cov));
  assert.ok(/Coverage and attention data are folded below; they show interest, not what the records say\./.test(cov.lead), cov.lead);
  const busy = await render(null, 'busy'); assert.ok(/Looking up public data for this page/.test(busy.text));
  const err = await render(null, 'error'); assert.ok(/Could not load context: no response/.test(err.text) && /Show context/.test(err.text) === false, 'error text shown (no button without a loader callback)');
  // label collisions at the narrowest panel (254 px of content), across the awkward cases
  const overlap = (a, b) => a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
  const cases = {
    'peak beside the latest value': { kind: 'line', resolution: 'month', unit: 'views a month', points: Array.from({ length: 24 }, (_, i) => ({ t: (2025 + Math.floor(i / 12)) + '-' + String((i % 12) + 1).padStart(2, '0'), v: 300000 + (i === 22 ? 12000 : 0) + i * 10 })) },
    'mark at the left edge': { kind: 'line', resolution: 'week', unit: 'index (100 = busiest week)', mark: { t: '2025-11-19', label: 'A long label for the day the page was published' }, points: Array.from({ length: 52 }, (_, i) => ({ t: new Date(Date.UTC(2025, 10, 18) + i * 7 * 864e5).toISOString().slice(0, 10), v: i === 1 ? 100 : 5 })) },
    'mark at the right edge': { kind: 'bars', resolution: 'day', unit: 'articles', mark: { t: '2026-10-30', label: 'A long label for the day the page was published' }, points: Array.from({ length: 30 }, (_, i) => ({ t: '2026-10-' + String(i + 1).padStart(2, '0'), v: i })) },
    'large negative money': { kind: 'bars', resolution: 'year', unit: 'US dollars', nominal: true, points: [{ t: '2019', v: -1.25e9 }, { t: '2020', v: -3.4e9 }, { t: '2021', v: 2e8 }, { t: '2022', v: -9.9e8 }] },
    'flat series': { kind: 'steps', resolution: 'month', unit: 'percent', points: Array.from({ length: 12 }, (_, i) => ({ t: '2026-' + String(i + 1).padStart(2, '0'), v: 5.5 })) }
  };
  for (const [name, c] of Object.entries(cases)) {
    const r = await render(done([Object.assign({ id: 'x', basis: 'statistic', title: name, sentence: name }, c)]));
    assert.strictEqual(r.figures.length, 1, name + ': one figure');
    const f = r.figures[0];
    assert.ok(f.labels.length >= 4 && f.labels.every((l) => l.r > l.l && l.b > l.t), name + ': unit, two dates and at least one value are laid out');
    for (let i = 0; i < f.labels.length; i++) {
      const a = f.labels[i];
      assert.ok(a.l >= r.card.l - 0.5 && a.r <= r.card.r + 0.5, name + ': "' + a.text + '" stays inside the card');
      assert.ok(!overlap(a, f.plot), name + ': "' + a.text + '" stays off the plot');
      for (let j = i + 1; j < f.labels.length; j++) assert.ok(!overlap(a, f.labels[j]), name + ': "' + a.text + '" and "' + f.labels[j].text + '" do not touch');
    }
  }
  await browser.close();
  console.log('Context chart: escaping, date placement, gaps, negatives, zero baseline, value labels, reference mark, list kind, states and label collisions at 280 px passed.');
})().catch((e) => { console.error(e); process.exit(1); });
