# Context data contract

The shapes that `extension/context-data.js` (router), the source files (`extension/context-*.js`) and `extension/ui/view.js` (the card) agree on. Change this file in the same commit as any change to a shape.

## What the card is for

One question about the page's subject, answered by one chart or dated list, with the comparison stated in a sentence. The router starts from **what the page is about** (its subject), not from which series is easy to draw.

- **Subject.** For a shop, an organization's own pages and most other pages, the subject is the site's entity. For an article, a guide or a review, the subject is what the page is about: a person, organization, event, product or work that the page names. A place, a food, a holiday or one ordinary word is never a subject.
- **Basis.** Every chart says what kind of evidence it is. The order below is also the ranking: a higher basis leads when it applies.

| basis | what it is | heading shown above the chart |
|---|---|---|
| `records` | filings and official records about the subject (IRS Form 990, SEC, FEC) | Public records |
| `statistic` | an official statistical series the page itself names | Official statistics |
| `coverage` | how widely this story is covered | Coverage of this story |
| `topic` | public attention to the page's subject | Attention to the subject |
| `site` | public attention to the site or its owner | Attention to this site |

Attention charts lead only when they show a clear spike; otherwise they are folded away. On unseen pages no ordinary attention chart told a reader anything about the page (docs/CONTEXT-DATA.md, Evaluation). Anything about the site shown on an article is labelled as about the site, not the page.

## Page facts `f` (input to every source)

```
f = {
  url, origin, domain,            // registrable domain, no www
  siteName, brand,                // the site's name as shown to readers
  group,                          // 'news' | 'evergreen' | 'shop' | 'organization' | 'other'
  title,                          // headline without the site's name
  text,                           // main text of the page, at most 60,000 characters (never sent anywhere whole)
  published,                      // 'YYYY-MM-DD' or '' when the page gives no date
  terms: { title, query, entity, topic, keyword, candidates },
  legalName,                      // the legal entity the page itself names (footer, imprint), or ''
  site: Entity | null,            // the site's own entity, when resolved
  subject: Entity | null          // the page's subject, when resolved (equals `site` on shop/organization/other pages)
}
Entity = { q, label, enwiki, founded, country,   // Wikidata id, English label, English Wikipedia title, year, ISO country code or ''
           ein, cik, ticker,                     // US tax id (digits only), SEC central index key (digits), ticker; '' when absent
           kind }                                // 'person' | 'organization' | 'event' | 'work' | 'product' | 'other'
```

## A source file

Each source lives in its own file, `extension/context-<name>.js`, and registers itself. Use the same UMD wrapper as `context-data.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./context-data.js'));
  else factory(root.SubtextContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (X) {
  'use strict';
  const U = X.util; // json, strip, enc, num, iso, daysAgo, fmtN, fmtT, money, cleanSeries, validSeries, summary, MIN_POINTS, MIN_YEARS
  X.register({
    id: 'nonprofit_finances',
    basis: 'records',                 // records | statistic | coverage | topic | site
    scope: 'entity',                  // 'entity': run once for an Entity. 'page': run once for the page.
    label: 'Finances reported to the IRS',          // shown under "What was looked up"
    question: 'What does this organization report to the IRS?',
    // scope 'entity': applies(entity, f, o) / sends(entity, f) / run(entity, f, io, now, o)
    // scope 'page':   applies(f, o)         / sends(f)         / run(f, io, now, o)
    applies: (entity, f, o) => !!entity.ein,
    sends: (entity, f) => 'the tax ID of ' + entity.label + ' to ProPublica Nonprofit Explorer',
    async run(entity, f, io, now, o) { /* ... */ return { chart, facts: [] }; }
  });
  return X;
});
```

Rules for `run`:
- `io.get(url, { accept? })` returns `{ status, text }`. It never throws for an HTTP error; check `status`. No cookies, no Referer. HTTPS only. The router counts requests: use **at most 3** per run.
- `o.keys` holds the reader's own free keys from Settings (for example `o.keys.fec`), when present. `o.trends` is true only after a click.
- Return `null` when there is nothing defensible to show. Never return a weaker chart to fill the space.
- Identity comes first. Match by identifier (tax ID, CIK, committee ID), never by a similar name. When a name is all there is, the match must be exact after normalizing, and the sentence must say what was matched.
- Missing is not zero. Use `U.num()` (it returns `null` for null, empty and non-numbers) and keep a missing period as `v: null`.
- Drop the unfinished current period (`U.cleanSeries(points, resolution, now)`).
- State observations, not motives: "reported", "filed", "listed". No "because", no judgement words.
- Send the least: an identifier or a series code where one exists; a name only when the source has no identifier lookup. Never the page URL or its text.

## Result shapes (router → card)

```
Chart = {
  id, basis, question,            // from the source
  about, aboutLabel,              // 'page' (the story or a statistic it names), 'subject' (aboutLabel names it), or 'site' (a last resort on an article: about the site, not this page)
  title,                          // short: what is measured and for whom ("Revenue: Everytown for Gun Safety Support Fund")
  sentence,                       // the comparison in words; must be true and complete without the chart
  kind,                           // 'line' | 'bars' | 'steps' | 'list'
  resolution,                     // 'day' | 'week' | 'month' | 'quarter' | 'year' | 'cycle' (two-year election cycle)
  points: [{ t, v }],             // t: 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD', ascending. v: number, or null for a missing period (drawn as a gap, never as 0)
  unit,                           // 'US dollars', 'articles', 'views a day', 'percent', 'index (100 = busiest week)'
  nominal,                        // true when money is not adjusted for inflation (the card says so)
  mark: { t, label } | undefined, // one reference date on the chart, such as the day the page was published
  rows: [{ t, text, url }],       // optional dated list under the chart (at most 6), e.g. filings in the peak month; required for kind 'list'
  rowsLabel,                      // heading for rows, e.g. 'SEC filings around Apr 2026'
  note,                           // one limit of the data, plain words
  notable,                        // attention charts only: true when one period is at least 5 times the usual, or dated records explain a peak
  transient,                      // true when the source's terms restrict storing its data (FRED): kept in memory only
  source: { name, url },          // where a reader can check it
  sends, cookies                  // added by the router
}
Fact = { id, label, text, links: [{ text, url }], note, source: { name, url } }
Result = {
  group, subject: { label, kind } | null, terms,   // kind: person | organization | event | work | product | phrase
  charts: [Chart],                // only charts that may lead: records, an official statistic, real coverage, or attention with a clear spike (`notable`). charts[0] leads. May be empty.
  other: [Chart],                 // ordinary attention charts (views, searches). Never lead; the card folds them under "Attention data"
  facts: [Fact],
  ran: [{ id, label, ok, chart, error, sends }],
  requests, at
}
state.context = { route, status: 'busy' | 'done' | 'error', error, trigger: 'click' | 'auto', result }
```

The card escapes every string and coerces every number before drawing. Points are placed by their date, not by their position in the list, so a missing year leaves a visible gap.

## Tests

Each source has `test/context-<name>.js` with synthetic responses in the source's real response shape. Never commit recorded third-party responses. Each test covers: the happy path, a missing value (stays missing), an unfinished period (dropped), a near-name or wrong-identifier case (no chart), and an HTTP error (returns null, no throw).
