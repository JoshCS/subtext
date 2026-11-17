/* Offline regression: sourced ownership, section/date scope, and observed page asks. */
const assert = require('assert');
require('../extension/common.js');
const C = global.MLCommon;
const outlets = require('../extension/data/outlets.json').outlets;
const post = outlets.find((x) => x.domains.includes('washingtonpost.com'));
const url = (path) => 'https://www.washingtonpost.com' + path;
const ctx = (path) => C.outletContext(post, url(path));
assert(ctx('/politics/2026/11/01/news/').ownership.text.includes('Jeff Bezos'));
assert(ctx('/opinions/2025/02/27/editorial/').policy);
for (const path of ['/opinions/', '/opinions/editorial/', '/opinions/2025/02/26/editorial/', '/opinions/2025/02/25/editorial/', '/opinions/2025/02/30/editorial/', '/politics/2026/11/01/opinion-in-title/', '/food/2026/11/01/recipe/']) {
  assert.strictEqual(ctx(path).policy, null, path);
}
assert.strictEqual(C.outletContext(post, 'https://washingtonpost.com.evil.test/opinions/2026/11/01/test/').ownership, null);
assert.strictEqual(C.outletContext(post, 'not a URL').policy, null);
assert.deepStrictEqual(C.outletContext({ domains: ['example.com'] }, 'https://example.com/'), { ownership: null, policy: null });
const reading = (entry, path, pageKind, ownerMentions) => C.reading([], { outlet: { entry }, report: { url: url(path), meta: { pageKind, asks: {}, textChars: 1000, ownerMentions: ownerMentions || [] } } }).text;
// the owner leads only when the article involves the owner (16 Nov 2026): an article naming Amazon, yes; an unrelated article, no
assert(reading(post, '/politics/2026/11/01/news/', 'article', ['Amazon']).includes('Jeff Bezos'));
assert(!reading(post, '/politics/2026/11/01/news/', 'article').includes('Jeff Bezos'));
assert.deepStrictEqual(C.outletMentions(post, 'Amazon Web Services opened a data center.'), ['Amazon']);
assert.deepStrictEqual(C.outletMentions(post, 'Toss the pasta with lemon. The Washington Post food section.'), []);
assert(!reading(post, '/politics/2026/11/01/news/', 'article').includes('February 26'));
assert(reading(post, '/opinions/2025/02/27/editorial/', 'article').includes('February 26, 2025'));
const guardian = outlets.find((x) => x.domains.includes('theguardian.com'));
const recipe = reading(guardian, '/food/2026/11/01/recipe/', 'recipe');
assert(recipe.includes('no ads or prompts'));
assert(!/evergreen|search traffic/.test(recipe));
// the ownership card opens when the SUBJECT touches the owner's interests, not only when a name appears (the owner, 16 Nov 2026: an article
// about not taxing billionaires at a billionaire-owned paper). A topic counts in the title or a heading, or twice in the text.
const rel = (entry, page) => C.ownerRelevance(entry, page).map((l) => l.label);
const postW = { ...post, wealthy: true, ultimateOwner: 'Jeff Bezos', wealthySource: 'Jeff Bezos: about $284 billion (Bloomberg Billionaires Index).' };
assert.strictEqual(C.wealthWords({ wealthySource: '£875 million, not a billionaire' }, 'Sir Paul Marshall'), ', who is very wealthy');
assert.strictEqual(C.ownerShort({ ultimateOwner: 'Ellison family (via Skydance)' }), 'the Ellison family');
assert.deepStrictEqual(rel(postW, { title: 'Why a billionaire minimum tax would backfire', text: 'Lawmakers debated the plan on Tuesday.' }), ['taxes on the very wealthy']);
assert(C.ownerRelevance(postW, { title: 'Why a billionaire minimum tax would backfire' })[0].why.includes('Jeff Bezos, a billionaire'));
assert.deepStrictEqual(rel(postW, { title: 'Senate vote', text: 'The estate tax exemption doubles. Critics say the estate tax change mostly helps heirs.' }), ['taxes on the very wealthy']);
assert.deepStrictEqual(rel(postW, { title: 'Senate vote', text: 'One aside mentioned the estate tax. The rest is about farm subsidies.' }), []);
assert.deepStrictEqual(rel(post, { title: 'Toss the pasta with lemon', headings: ['Ingredients'], text: 'Boil water. Add salt.' }), []);
assert.deepStrictEqual(rel({ ...post, wealthy: false, owners: [{ name: 'Example Media Inc', kind: 'public_company' }] }, { title: 'Why a billionaire minimum tax would backfire' }), []);
assert.deepStrictEqual(rel(post, { title: 'Why a billionaire minimum tax would backfire' }), [], 'no wealth topic without a checked wealthy flag');
// the shipped owner-interests file is held out of the public copy (docs/PUBLISHING.md): without it these two checks cannot run
if (!require('fs').existsSync(require('path').join(__dirname, '..', 'extension', 'data', 'owner-interests.json'))) console.log('skipped: extension/data/owner-interests.json is not in this copy (shipped data: a checked billionaire; an unrelated page stays quiet)');
else {
  const real = C.mergeInterests(JSON.parse(JSON.stringify(require('../extension/data/outlets.json'))), require('../extension/data/owner-interests.json')).outlets;
  const realPost = real.find((x) => x.domains.includes('washingtonpost.com'));
  assert(C.ownerRelevance(realPost, { title: 'California billionaire tax fails at the ballot' }).some((l) => /Jeff Bezos, a billionaire/.test(l.why)), 'shipped data: Bezos is a checked billionaire');
  assert.deepStrictEqual(C.ownerRelevance(realPost, { title: 'Snow expected across the region tonight', text: 'Forecasters say two inches will fall.' }), []);
}
const withInterests = C.mergeInterests({ outlets: [JSON.parse(JSON.stringify(post))] }, { [post.name]: { owner: 'Jeff Bezos', wealthy: true, interests: [{ topic: 'Blue Origin and spaceflight', terms: ['Blue Origin', 'New Glenn'], why: 'Jeff Bezos founded Blue Origin.', source: 'https://www.blueorigin.com/about' }, { topic: 'no source', terms: ['Unsourced'], why: 'x' }] } }).outlets[0];
assert.strictEqual(withInterests.interests.length, 1, 'an interest without a source is dropped');
assert.deepStrictEqual(rel(withInterests, { title: 'New Glenn launch slips to spring' }), ['Blue Origin and spaceflight']);
assert.deepStrictEqual(rel(withInterests, { title: 'Rocket news', text: 'A rival compared itself to Blue Origin once.' }), []);
assert(C.reading([], { outlet: { entry: post }, report: { url: url('/politics/2026/11/01/news/'), meta: { pageKind: 'article', asks: {}, textChars: 1000, ownerLinks: C.ownerRelevance(postW, { title: 'Why a billionaire minimum tax would backfire' }) } } }).text.includes('taxes on the very wealthy, which touches its owner'));
const guardianM = outlets.find((x) => x.domains.includes('theguardian.com'));
assert.deepStrictEqual(C.outletMentions(guardianM, 'Coach Scott Parker said the club would invest.'), [], 'a first name from Scott Trust is not the owner');
assert.deepStrictEqual(C.outletMentions(guardianM, 'The Scott Trust owns the paper.'), ['Scott Trust']);
const timeM = outlets.find((x) => x.name === 'TIME');
assert.deepStrictEqual(C.outletMentions(timeM, 'Marc Andreessen spoke at the summit.'), []);
console.log('Outlet context: offline checks passed.');
