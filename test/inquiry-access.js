const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const browser = require('./ui/lib');

const url = 'https://subtext-access-fixture.org/rail/service-update';
const title = 'Rail maintenance moves to Sunday';
const lede = 'Rail crews will replace a section of track near the station on Sunday morning. The northbound platform will reopen at noon.';
const detail = 'During the work, passengers can use the southbound platform to reach both sides of town. Staff will put temporary signs at the station entrances.';
const header = '<header><button>Subscribe</button></header>';
const article = `${header}<main><article><h1>${title}</h1><p>${lede}</p><p>${detail}</p></article></main>`;
const preview = `${header}<main><article><h1>${title}</h1><p>${lede}</p></article></main>`;
const checkout = `<section id="paywall-1176d186cb35"><p>$3 USD every four weeks. 3 extra accounts.</p>
  <p>Already a subscriber? <a href="/signin">Sign in</a></p><p>Unlimited access on the web and in our apps</p>
  <input type="email" aria-label="Email"><button>PayPal</button><button>Credit/Debit</button></section>`;

async function checkPostScope(context, sw) {
  const postUrl = 'https://x.com/station/status/123';
  const text = 'Reply MAP and I will send the full service map to you by direct message.';
  const target = `<article data-testid="tweet" id="target">
    <div data-testid="User-Name">Station Desk <span>@station</span></div>
    <div data-testid="tweetText">${text}<span aria-hidden="true">Hidden target decoy</span></div>
    <a href="/Station/status/123"><time>Oct 7, 2026</time></a><button>Repost</button></article>`;
  const reply = `<article data-testid="tweet"><div data-testid="User-Name">Reply Desk</div>
    <div data-testid="tweetText">Unrelated reply wants people to buy a subscription.</div>
    <a href="/reply/status/124"><time>Oct 8, 2026</time></a><button>Buy access</button>
    <p><a href="https://clinicaltrials.gov/study/NCT01234567">Unrelated citation</a></p></article>`;
  await context.route(postUrl, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><title>Timeline and other topics</title><h1>Timeline</h1>${reply}${target}`,
  }));
  const { page } = await browser.open(context, postUrl);
  const tabId = await browser.tabId(sw, postUrl);
  const extract = () => sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'extractForLLM' }), tabId);
  const post = await extract();
  assert.equal(post.mainText, text);
  assert.deepEqual(post.credits, ['Station Desk @station', 'Oct 7, 2026']);
  assert.equal(post.title, '');
  assert.doesNotMatch(JSON.stringify(post), /Unrelated|Timeline|Buy access|Repost|Hidden target decoy/);
  for (const field of ['headings', 'ctas', 'choiceLayout', 'charts', 'citations', 'inquiryLinks', 'heuristicFindings']) {
    assert.deepEqual(post[field], [], field);
  }
  assert.equal(post.signals, null);

  await page.locator('#target').evaluate(el => el.after(el.cloneNode(true)));
  assert.match((await extract()).error, /single visible post/i);
  await page.locator('#target').last().evaluate(el => { el.hidden = true; });
  assert.equal((await extract()).mainText, text);
  await page.locator('#target').first().evaluate(el => el.remove());
  assert.match((await extract()).error, /single visible post/i);
  await page.close();
}

async function main() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'subtext-inquiry-access-'));
  let session;
  try {
    session = await browser.launch(out);
    const { context, sw } = session;
    await context.route(url, route => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><title>${title}</title>${article}`,
    }));
    const { page } = await browser.open(context, url);
    const tabId = await browser.tabId(sw, url);
    const extract = () => sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'extractForLLM' }), tabId);
    const changePage = (body, nextTitle = title) => page.evaluate(({ body, nextTitle }) => {
      document.title = nextTitle;
      document.body.innerHTML = body;
    }, { body, nextTitle });

    const normal = await extract();
    assert.ok(normal.ctas.includes('Subscribe'));
    assert.ok(normal.mainText.includes(detail));

    await changePage(article, 'Why the airport security check moved');
    assert.ok((await extract()).mainText.includes(detail));

    await changePage(article + '<div role="dialog" aria-modal="true"><h2>Subscribe to our newsletter</h2><button>Subscribe</button><button>No thanks, keep reading</button></div>');
    assert.ok((await extract()).mainText.includes(detail));

    await changePage(article + checkout);
    assert.ok((await extract()).mainText.includes(detail));

    await changePage(preview + `<div id="paywall-options" role="dialog" aria-modal="true"><h2>Two ways to read this article</h2>
      <p>Create an account</p><button>Start reading</button><button>Subscribe $3 USD every 4 weeks</button></div>`);
    assert.match((await extract()).error, /article preview.*wall/i);

    await changePage(preview + checkout);
    assert.match((await extract()).error, /article preview.*wall/i);

    await changePage(`<main><h1>Access denied</h1><p>Please enable JavaScript and cookies.</p><p>${lede} ${detail}</p></main>`, 'Access denied');
    assert.match((await extract()).error, /loading or access error/i);
    const blockedReport = await sw.evaluate(id => chrome.tabs.sendMessage(id, { type: 'rescan' }), tabId);
    assert.equal(blockedReport.meta.errorPage, true);

    await changePage(article + '<a href="/methodology">Reporting methodology</a>');
    const restored = await extract();
    assert.ok(restored.mainText.includes(detail));
    assert.doesNotMatch(restored.allText, /Access denied/);
    assert.equal(restored.inquiryLinks[0]?.label, 'Reporting methodology');

    const embedded = '<article data-testid="tweet"><div data-testid="tweetText">Embedded quote inside an article page.</div><a href="https://x.com/station/status/123"><time>Oct 7, 2026</time></a></article>';
    await changePage(article.replace('</article>', `${embedded}</article>`));
    const ordinaryArticle = await extract();
    assert.equal(ordinaryArticle.title, title);
    assert.ok(ordinaryArticle.mainText.includes(detail));

    await checkPostScope(context, sw);
    console.log('Inquiry access: previews and error shells blocked, readable pages recovered, status extraction scoped to one post.');
  } finally {
    await session?.close();
    fs.rmSync(out, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
