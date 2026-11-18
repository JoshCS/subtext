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
| `coverage` | how widely this story is covered. Never leads: always folded with the attention charts | Coverage of this story |
| `topic` | public attention to the page's subject | Attention to the subject |
| `site` | public attention to the site or its owner | Attention to this site |

The count of news articles on a story never leads: on 30 unseen pages it led four times and a blind judge found it unhelpful each time, so it is folded with the attention charts. Attention charts lead only when they show a clear spike; otherwise they are folded away. On unseen pages no ordinary attention chart told a reader anything about the page (docs/CONTEXT-DATA.md, Evaluation). Anything about the site shown on an article is labelled as about the site, not the page.

## Page facts `f` (input to every source)

```
f = {
  url, origin, domain,            // the page's host, no www
  registrable,                    // its registrable domain ("example.com" for app.example.com), worked out in the worker with
                                  //   MLCommon.registrableDomain and passed to X.pageFacts, never taken from the page. Checked again there:
                                  //   one the page is not on is not used, and the page's own host stands in (narrower).
  siteName, brand,                // the site's name as shown to readers
  group,                          // 'news' | 'evergreen' | 'shop' | 'organization' | 'other'
  title,                          // headline without the site's name
  text,                           // main text of the page, at most 60,000 characters (never sent anywhere whole)
  published,                      // 'YYYY-MM-DD' or '' when the page gives no date
  terms: { title, query, entity, topic, keyword, candidates },
  legalName,                      // the legal entity the page itself names (footer, imprint), or ''
  address,                        // the postal address the scan found on the page, or '' (never sent anywhere)
  root,                           // true on the site's front page
  taxIds,                         // US tax IDs the page's own footer prints beside a label ("EIN", "Tax ID", "Tax identification number",
                                  //   "Employer Identification Number"). Read ONLY from the page's footer (`footer`, `[role=contentinfo]`,
                                  //   an element with the id or class `footer` or `site-footer`; not one inside the main content, an
                                  //   article, a section, a dialog or a table cell), never from the main content: a number there can be a
                                  //   customer's or an applicant's. Nine digits each, de-duplicated, at most 6. [] when none. A nine-digit
                                  //   number with no label is never taken.
  taxIdNonprofit,                 // true when the footer text beside such an ID calls the organization a nonprofit ("501(c)(3)",
                                  //   "nonprofit", "tax-deductible", "charity"). "Tax exempt" does not count: billing forms print it.
  statusPages,                    // https origins the page links to as its status page ("https://status.example.com"). A link counts only
                                  //   when it sits in the page's own footer, header or navigation (`footer`, `header`, `nav`,
                                  //   `[role=contentinfo]`, `[role=banner]`, `[role=navigation]`; not in the main content, a comment or a
                                  //   post) AND its host is under the site's own domain (X.ownStatusHost): a host that starts with
                                  //   "status.", or a link whose text is "Status", "System status" or "Service status". Never the site's
                                  //   own host, never any other host, whatever the link says. Public hosts only, no path, port or user
                                  //   name, at most 2. [] when none. X.pageFacts and the status source each apply the host rule again.
  footerText,                     // up to 4,000 characters of the page's footer (never sent anywhere; used for the city check)
  site: Entity | null,            // the site's own entity, when resolved
  subject: Entity | null,         // the page's subject, when resolved (equals `site` on shop/organization/other pages)
  owner: Owner | null             // the one company Wikidata names as behind the site (or behind an article's subject); see "The company behind it"
}
Entity = { q, label, enwiki, founded, country,   // Wikidata id, label (English, else the default for all languages), English Wikipedia title, year, ISO country code or ''
           ein, cik, ticker,                     // US tax id (digits only), SEC central index key (digits), ticker; '' when absent
           einFrom,                              // 'page' when the tax ID was read from the page's footer and the filer's name agreed with the site's
                                                 //   Wikidata label (exact-website lookup) or its address; otherwise absent
           matchedBy,                            // on the site's entity only: 'bundled' (the extension's own table of sites) or 'website' (the
                                                 //   exact-website lookup). Only 'website' lets the label confirm a printed tax ID. Absent on an entity made from a name on the page.
           owners,                               // [{ q, via }]: the current organizations Wikidata names as owner or parent, or, when none is
                                                 //   stated, as developer, publisher or operator. via: 'owned' | 'parent' | 'developed' | 'published' | 'operated'
           kind }                                // 'person' | 'organization' | 'event' | 'work' | 'product' | 'other'
Owner  = Entity + { via, of, sameName }          // of: the label of the product or site it stands behind; sameName: "Asana" and "Asana Inc."
```

The new facts are collected by `contextSignals()` in `extension/content/engine.js` and checked again in `X.pageFacts`: a value of the wrong shape is dropped there, whatever the page sent, and so is a status host that is not under the site's own domain.

## Identity added on 17 Nov 2026

**A tax ID printed on the page.** On a page about the site itself (groups `shop`, `organization`, `other`), when the site entity has no tax ID and no SEC number and `f.taxIds` holds exactly one ID, the router reads the filer ProPublica lists for that ID (`X.filerByEin`) and gives the site entity that `ein` with `einFrom: 'page'`. Conditions, all required:
- The ID was read from the page's own footer (see `taxIds` above). A number in the main content of an invoice, an account page or an application form is never read, so it is never sent.
- Exactly one distinct ID in the footer. Two or more: none is taken.
- The site's address ends in .org, or the page is in group `organization`, or the footer text beside the ID calls the organization a nonprofit (`f.taxIdNonprofit`).
- The filer's name that ProPublica returns agrees with something the page does not write (`X.filerIsSite`):
  1. the site's Wikidata label, when the entity came from the exact-website lookup (`matchedBy: 'website'`). "Agrees" is `X.namesAgree`: lower case, no punctuation, no "the / inc / foundation"; every remaining word of the shorter name is in the longer one, and at least one of them is not a word many organizations share ("food", "bank", "community", "fund"). When the shorter name is one word, that is agreement only when the longer name has no other word of its own ("Tides" and "Tides Foundation" agree; "Atlas" and "Fractured Atlas Productions" do not). Initials do not agree here; or
  2. the site's address itself: the first label of the registrable domain (`f.registrable`), hyphens dropped, must EQUAL the filer's name run together (`chestercountyfoodbank` = CHESTER COUNTY FOOD BANK INC), or its initials when they are four letters or more (`sfspca`). The filer's name may lose a leading "the", legal words at its end ("inc", "foundation") and its small words ("of", "for"). Containing the name is not enough: `relief-society-donate` does not agree with RELIEF SOCIETY, and the first words of a longer name are not that name.
- The site's name as the page gives it (`og:site_name`), the parts of its title and a legal name printed in its footer confirm nothing: a page that prints another organization's tax ID can write that organization's name wherever it likes. A listing site's profile page, a fiscal sponsor's ID and a page that copies a well-known charity's ID and name all give no chart.
- An ID that fails the name check is remembered for the run: the exact-name lookup may not bring the same ID back.

The check and the chart read the same ProPublica address. The router answers the second read from memory, so the path costs one request. Another site can still register an address that matches a filer's name, so the chart carries a `relation` line that says what is known and no more: "This page prints the tax ID 12-3456789. IRS filings under that ID are from EXAMPLE COUNTY FOOD BANK." The chart's note also says the tax ID was read from the page and which name the IRS has for it.

**A status page.** `status_incidents` asks only a host under the site's own domain (`X.ownStatusHost(host, f.domain, f.registrable)`), and never the site's own host. A page on the registrable domain itself (example.com, www.example.com) may have any other host under it (status.example.com). A page on a subdomain (shop.bigplatform.com) may only have a host under that subdomain: many platforms give each tenant a subdomain and are on no list, and the platform's status page is not the tenant's. No other host is ever requested, whatever the page links to and whatever a host calls itself in its feed: a link anyone can post must not choose where a request goes. A status page on a vendor's domain (example.statuspage.io) therefore gives no chart. The request refuses redirects, so a status host that redirects gives no chart either. The chart's title uses the site's name; nothing in the feed names the chart. The source does not set `about`: on an inner page the router labels the chart as about the site, not this page.

**The company behind it (one hop).** When the site entity (or, on an article, the subject) has no SEC number and no tax ID, and its Wikidata item names exactly one current organization behind it, the router reads that organization once and keeps it in `f.owner`. `f.site` and `f.subject` are not changed.
- Which statements count: "owned by" (P127) and "parent organization" (P749) are read first. Only when neither is stated are "developer" (P178), "publisher" (P123) and "operator" (P137) read. Within the group that is read, the same organization through several properties is one; two different ones give no hop. A deprecated statement and a statement with an end date are not current; where a property has a preferred statement, only that one counts. A statement that carries a proportion (P1107: a 5 percent stake) or a point in time (P585: who held it on one date) is skipped: it does not say "is owned by". When an ownership or parent statement exists but has ended, and no current one stands beside it, there is no hop at all: the developer, publisher and operator are not read in its place.
- One request, one hop. The owner's own owner is never read. On an article the hop is skipped for a work (a book, a film): only a company of the subject's own name is shown there, and a publisher never has it.
- The owner gets SEC records only under the rules every company is held to: its SEC number on Wikidata, or its ticker together with a matching name on the SEC's list, or listed on an exchange with exactly one exact name on that list.
- `sec_financials`, then `sec_filings`, run for the owner with `aboutLabel` = the owner's label and a `relation` line (`X.ownerRelation`): "Slack is owned by Salesforce. The figures are for the whole company, not for Slack alone." The line states only the property Wikidata gives. When both sentences do not fit in 240 characters, the first stands alone. For a company that carries the product's name (Asana, Asana Inc.) the second sentence is left out. A company word is allowed on the company's side only: "Slack Technologies" has Slack's name, and "Amazon" does not have the name of "Amazon Studios".
- Where the owner's charts may appear: a company with the product's own name stands wherever the site's or subject's own SEC records would, in the same place in the order. A company with another name is shown only on a page about the site itself (group `shop` or `organization`, or a front page), and never on an article, a guide or a review, or on an inner page that is labelled "about the site, not this page".

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
- `io.get(url, { accept?, redirect? })` returns `{ status, text }`. It never throws for an HTTP error; check `status`. No cookies, no Referer. HTTPS only. At most 3,000,000 bytes of an answer are read; the rest is cancelled. `redirect: 'error'` makes a request that is redirected fail at the first host (status 0), so the address it points to is never asked: use it when the host was read from the page (the status source does). Without it redirects are followed and an answer that ended on a host that is not public https is not read. The router counts requests: use **at most 3** per run. Within one run, a second read of the same address that answered 200 is served from memory and is not counted.
- A page-scoped source that charts something other than the site (a park, a city) **must** set `about: 'subject'` and `aboutLabel: '<its name>'` on the chart, or the card would name the site. It may also set `relation`. A page-scoped source that charts the site itself (`status_incidents`) sets neither: the router's values stand, so an inner page keeps "About the site, not this page."
- Cut every string from a feed to a fixed length (400 characters) before any pattern runs on it.
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
  about, aboutLabel,              // 'page' (the story or a statistic it names), 'subject' (aboutLabel names it), or 'site' (a last resort on an article: about the site, not this page).
                                  //   Set by the router. A source may set them itself: 'subject' together with a non-empty aboutLabel, or 'page', is kept;
                                  //   'subject' with no name, or any other value, is replaced by the router's.
  relation,                       // optional: one plain sentence or two on how the chart's subject relates to the page ("Slack is owned by Salesforce.
                                  //   The figures are for the whole company, not for Slack alone."; "This page prints the tax ID 12-3456789. IRS filings under that ID
                                  //   are from EXAMPLE COUNTY FOOD BANK."). Shown above the title and the sentence. At most 240 characters: when the whole
                                  //   does not fit, the router keeps the first sentence only (`X.fitRelation`), never a cut in mid-sentence.
                                  //   Set by a source or by the router (the company behind a product). Text only.
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
  charts: [Chart],                // only charts that may lead: records, an official statistic, or attention with a clear spike (`notable`). Never a `coverage` chart. charts[0] leads. May be empty.
  other: [Chart],                 // the news-article count (first, when found) and ordinary attention charts (views, searches). Never lead; the card folds them under "Coverage and attention data" or "Attention data"
  facts: [Fact],
  ran: [{ id, label, ok, chart, error, sends }],
  requests, at
}
state.context = { route, status: 'busy' | 'done' | 'error', error, trigger: 'click' | 'auto', result }
```

The card escapes every string and coerces every number before drawing. Points are placed by their date, not by their position in the list, so a missing year leaves a visible gap.

## Where the sources stand (`X.candidates`)

1. `official_statistic`, then `park_visits`, then `building_permits` (page-scoped; each checks for itself what the page is about). `park_visits` does not apply on a news article (group `news`) or under a path that contains `/news/`.
2. On a page about the site itself: the records sources for the site (`fec_committee`, `fec_employer`, `nonprofit_finances`, `sec_financials`), `sec_financials` for the owner, `sec_filings` for the site and for the owner, `status_incidents` (page-scoped; applies only when `f.statusPages` holds a host under the site's own domain), then the attention sources.
3. On an article, a guide or a review: political money, the subject's records (the subject's own, then an owner of the same name) before coverage when the page is about money and after it otherwise, attention to the subject, and the site as a labelled last resort.

A line for a source that is not loaded is skipped.

## Tests

Each source has `test/context-<name>.js` with synthetic responses in the source's real response shape. Never commit recorded third-party responses. Each test covers: the happy path, a missing value (stays missing), an unfinished period (dropped), a near-name or wrong-identifier case (no chart), and an HTTP error (returns null, no throw).
