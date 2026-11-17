const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const Book = require('../extension/evidence-book');

const snapshot = {
  id: 'step-a', title: 'Subscription terms', url: 'https://example.test/terms?account=private#highlight',
  observedAt: '2026-11-07T10:00:00.000Z', label: 'Before cancellation', scope: 'visible-page-text', truncated: false,
  receipts: [{ source: 'page', label: 'Terms', quote: 'You can cancel your subscription at any time.', url: 'https://example.test/terms?secret=yes#private' }]
};

function pureChecks() {
  assert.equal(Book.sanitizeURL(snapshot.url), 'https://example.test/terms');
  for (const url of ['javascript:alert(1)', 'file:///private/data', 'https://user:password@example.test/', 'not a URL']) {
    assert.throws(() => Book.sanitizeURL(url), /URL/);
  }
  const clean = Book.cleanSnapshot({ ...snapshot, html: '<p>not saved</p>', images: ['private-image'], reading: { rawPrompt: 'private' }, receipts: [{ ...snapshot.receipts[0], dom: 'private' }] });
  assert.deepEqual(Object.keys(clean).sort(), ['id', 'title', 'url', 'observedAt', 'label', 'scope', 'receipts', 'truncated'].sort());
  assert.deepEqual(clean.receipts[0], { source: 'page', label: 'Terms', quote: snapshot.receipts[0].quote, url: 'https://example.test/terms' });
  assert.equal(clean.url, 'https://example.test/terms');
  const generated = Book.cleanSnapshot({ ...snapshot, id: undefined });
  assert.match(generated.id, /^[a-f0-9-]{36}$/);
  const invalid = [
    [null, /Snapshot/],
    [{ title: 'x'.repeat(201) }, /title/],
    [{ label: 'x'.repeat(101) }, /label/],
    [{ scope: 'x'.repeat(61) }, /scope/],
    [{ observedAt: 'yesterday' }, /timestamp/],
    [{ observedAt: '2026-02-30T00:00:00.000Z' }, /timestamp/],
    [{ truncated: 'false' }, /boolean/],
    [{ receipts: [] }, /1–30/],
    [{ receipts: Array(31).fill(snapshot.receipts[0]) }, /1–30/],
    [{ receipts: [{ ...snapshot.receipts[0], source: 'document' }] }, /source/],
    [{ receipts: [{ ...snapshot.receipts[0], quote: 'short' }] }, /quote/],
    [{ receipts: [{ ...snapshot.receipts[0], quote: 'x'.repeat(1601) }] }, /quote/],
    [{ receipts: Array(10).fill({ source: 'page', label: 'Text', quote: 'x'.repeat(1300) }) }, /12,000/]
  ];
  for (const [change, error] of invalid) assert.throws(() => Book.cleanSnapshot(change === null ? null : { ...snapshot, ...change }), error);
  assert.throws(() => Book.createStore(null), /unavailable/);
}

async function main() {
  pureChecks();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    // Give IndexedDB a non-opaque origin without a server or any network access.
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local evidence test</title>' }));
    const page = await context.newPage();
    await page.goto('https://subtext-evidence-book.test/');
    await page.addScriptTag({ path: path.resolve(__dirname, '../extension/evidence-book.js') });
    const saved = await page.evaluate(async sample => {
      const assert = (value, message) => { if (!value) throw new Error(message); };
      const reject = async (work, pattern) => {
        try { await work(); } catch (error) { assert(new RegExp(pattern).test(error.message), 'Unexpected error: ' + error.message); return; }
        throw new Error('Expected rejection: ' + pattern);
      };
      const a = SubtextEvidenceBook.createStore(indexedDB), b = SubtextEvidenceBook.createStore(indexedDB);
      const step = n => ({ ...sample, id: 'step-' + n, receipts: sample.receipts.map(r => ({ ...r })) });
      assert((await a.list()).length === 0, 'Database starts empty');
      await reject(() => a.create(''), 'title');
      const record = await a.create('Cancellation journey');
      assert(record.revision === 1 && record.snapshots.length === 0, 'Initial revision and steps');
      // Independent database connections must not overwrite one another's steps.
      await Promise.all([a.capture(record.id, step(1)), b.capture(record.id, step(2))]);
      let current = await a.get(record.id);
      assert(current.snapshots.length === 2 && current.revision === 3, 'Both racing captures survived');
      assert(current.snapshots.every(s => s.url === 'https://example.test/terms'), 'Stored URLs are sanitized');
      await reject(() => a.capture(record.id, step(1)), 'already saved');
      await reject(() => a.capture(record.id, { ...step(3), receipts: [] }), '1–30');
      assert((await a.get(record.id)).revision === 3, 'Failed captures do not mutate revision');

      const receipt = { id: 'p1', source: 'page', label: 'Page', quote: sample.receipts[0].quote, url: sample.url, rawPrompt: 'do not save' };
      const result = {
        status: 'complete', plan: { secret: 'do not save' }, stages: ['do not save'],
        reading: { kind: 'straightforward', lead: 'Both steps offer cancellation.', mechanism: '', alternative: '', check: '', evidence: [receipt], rawPrompt: 'do not save', reviewed: true,
          investigation: {
            actors: [{ name: 'Subscription provider', role: 'Supplies the cancellation terms', evidence: [receipt], rawPrompt: 'do not save' }],
            hinge: { observed: 'The terms allow cancellation.', dependency: 'The account route must apply these terms.', evidence: [receipt], rawPrompt: 'do not save' },
            explanations: [{ account: 'Cancellation is available.', support: 'The saved terms state it.', evidence: [receipt] }, { account: 'The account route may have conditions.', support: 'No account action is captured.', evidence: [] }],
            discriminator: 'Open the cancellation route.', rawPrompt: 'do not save'
          }
        }
      };
      await reject(() => a.saveAnalysis(record.id, ['step-1'], result, 3), 'two or three');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-1'], result, 3), 'different');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-2'], result), 'revision');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'missing'], result, 3), 'no longer exists');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-2'], { status: 'complete', reading: null }, 3), 'does not match');
      current = await a.saveAnalysis(record.id, ['step-1', 'step-2'], result, 3);
      assert(current.revision === 4 && current.analysis.status === 'complete', 'Analysis committed');
      assert(Object.keys(current.analysis).sort().join() === ['reading', 'status', 'snapshotIds', 'analyzedAt'].sort().join(), 'Only result fields saved');
      assert(!JSON.stringify(current.analysis).includes('do not save'), 'Raw prompts and extra fields discarded, including nested fields');
      assert(current.analysis.reading.evidence[0].url === 'https://example.test/terms', 'Analysis URLs sanitized');
      assert(current.analysis.reading.investigation.actors.length === 1, 'Structured brief survives');

      // Every read returns detached data, so callers cannot mutate saved evidence.
      current.snapshots[0].receipts[0].quote = 'Mutated outside the database';
      assert((await b.get(record.id)).snapshots[0].receipts[0].quote === sample.receipts[0].quote, 'Read returns detached records');
      const largeReceipt = { ...receipt, url: 'https://example.test/' + 'x'.repeat(4000), quote: '中'.repeat(1600) };
      const oversized = { ...result, reading: { lead: 'Bounded lead.', evidence: Array(4).fill(largeReceipt) } };
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-2'], oversized, 4), '32 KB');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-2'], { ...result, reading: { ...result.reading, lead: 'x'.repeat(561) } }, 4), 'lead');
      assert((await a.get(record.id)).revision === 4, 'Malformed and oversized analysis leaves case unchanged');

      await b.capture(record.id, step(3));
      current = await a.get(record.id);
      assert(current.analysis === null && current.revision === 5, 'Capture invalidates reading');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-2'], result, 4), 'changed during analysis');
      current = await a.saveAnalysis(record.id, ['step-1', 'step-2', 'step-3'], { status: 'unsupported', reading: null }, 5);
      assert(current.analysis.reading === null && current.revision === 6, 'Unsupported result can be retained');
      current = await b.removeStep(record.id, 'step-3');
      assert(current.analysis === null && current.revision === 7, 'Remove invalidates reading');
      await reject(() => a.removeStep(record.id, 'missing'), 'no longer exists');
      await reject(() => a.saveAnalysis(record.id, ['step-1', 'step-2', 'step-3'], result, 6), 'changed during analysis');

      // More simultaneous captures than available slots must reject without eviction.
      const captures = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).capture(record.id, step(i + 10))));
      assert(captures.filter(r => r.status === 'fulfilled').length === 10, 'Only ten remaining capture slots filled');
      assert(captures.filter(r => r.status === 'rejected').every(r => /12 steps/.test(r.reason.message)), 'Capacity errors are useful');
      current = await a.get(record.id);
      assert(current.snapshots.length === 12 && current.revision === 17, 'No lost updates at snapshot capacity');
      assert(current.snapshots.some(s => s.id === 'step-1') && current.snapshots.some(s => s.id === 'step-2'), 'Old steps were not evicted');

      const cases = await Promise.allSettled(Array.from({ length: 21 }, (_, i) => (i % 2 ? a : b).create('Case ' + i)));
      assert(cases.filter(r => r.status === 'fulfilled').length === 19, 'Only nineteen remaining case slots filled');
      assert(cases.filter(r => r.status === 'rejected').every(r => /20 cases/.test(r.reason.message)), 'Case capacity errors are useful');
      const list = await a.list();
      assert(list.length === 20, 'No overflow at case capacity');
      assert(list.every(r => Object.keys(r).sort().join() === ['id', 'title', 'updatedAt', 'count', 'revision'].sort().join()), 'List contains metadata only');
      assert(list.some(r => r.id === record.id && r.count === 12), 'Original case was not evicted');

      const doomed = list.find(r => r.id !== record.id);
      await a.delete(doomed.id);
      await reject(() => b.get(doomed.id), 'no longer exists');
      await reject(() => b.capture(doomed.id, step(50)), 'no longer exists');
      await reject(() => b.saveAnalysis(doomed.id, ['step-1', 'step-2'], result, doomed.revision), 'no longer exists');
      await a.create('Slot reused after explicit deletion');
      return { id: record.id, revision: current.revision };
    }, snapshot);

    // Reopening a page exercises durable IndexedDB, not an in-memory mock.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('https://subtext-evidence-book.test/');
    await reopened.addScriptTag({ path: path.resolve(__dirname, '../extension/evidence-book.js') });
    const persisted = await reopened.evaluate(async id => {
      const store = SubtextEvidenceBook.createStore(indexedDB);
      return { record: await store.get(id), count: (await store.list()).length };
    }, saved.id);
    assert.equal(persisted.record.revision, saved.revision);
    assert.equal(persisted.record.snapshots.length, 12);
    assert.equal(persisted.count, 20);
    console.log('Evidence book: validation, atomic capacity limits, concurrent writes, stale analysis and durable storage passed.');
  } finally {
    if (browser) await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
