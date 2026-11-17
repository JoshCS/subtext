const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const claims = require('../extension/claim-context.js');
const filing = 'https://www.sec.gov/Archives/edgar/data/1318605/000110465925090888/tm252289d17_defa14a.htm';
const quote = 'Musk said Tesla could reach a $20 to $30 trillion valuation if we execute well on autonomous transport and Optimus.';
const hit = claims.forPage({ title: 'News report', mainText: quote, url: 'https://news.example/story' });
assert.strictEqual(hit.length, 2);
assert(hit.every((item) => Object.keys(item).sort().join() === 'source,text' && item.text.length < 170));
assert(hit[0].text.includes('if autonomous'));
assert(hit[1].text.includes('asked shareholders'));
assert.strictEqual(claims.forPage({ title: 'Tesla and Musk', mainText: 'It actually does get to a $20—$30 TRILLION\n valuation.' }).length, 2);
assert.strictEqual(claims.forPage({ mainText: 'Tesla’s valuation could be $25 trillion if autonomous transport and Optimus succeed.' }).length, 0);
assert.strictEqual(claims.forPage({ mainText: 'It actually does get to a $20 to $30 trillion valuation.', url: filing + '?view=1#quote' }).length, 2);
for (const page of [
  {}, null,
  { mainText: 'A Tesla rival says its valuation could be $25 trillion if its autonomous cars succeed. Musk did not comment.' },
  { title: 'Musk and Tesla, Sept 17, 2025', mainText: 'New vehicle launch.' },
  { mainText: 'Musk forecasts Tesla Optimus demand. Global infrastructure will cost $25 trillion.' },
  { mainText: 'Nikola Tesla: the museum valuation could be $25 trillion.' },
  { mainText: 'Jane Musk says the art valuation could be $25 trillion.' },
  { mainText: 'A $20 to $30 trillion valuation.', url: filing.replace('www.sec.gov', 'www.sec.gov.evil.example') },
  { mainText: 'A $20 to $30 trillion valuation.', url: filing.replace('https:', 'http:') },
  { title: 'Tesla and Optimus', mainText: 'x'.repeat(800) + ' A $20 to $30 trillion valuation.' },
  { text: quote }, // Only supplied title/mainText are eligible.
]) assert.deepStrictEqual(claims.forPage(page), [], JSON.stringify(page));
const worker = { URL };
vm.runInNewContext(fs.readFileSync(require.resolve('../extension/claim-context.js'), 'utf8'), worker);
assert.strictEqual(worker.SubtextClaims.forPage({ mainText: quote }).length, 2);
console.log('Claim context: offline checks passed.');
