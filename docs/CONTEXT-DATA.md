# Context from public data

"Show context" in the report adds outside context for the page on screen: one chart or dated list that answers a question about the page's subject, a few facts about the site, and a list of every request made. It uses free public sources only and needs no AI key.

- **Code:** `extension/context-data.js` (subject, question order, series rules, built-in sources), `extension/context-nonprofit.js`, `context-sec.js`, `context-stats.js`, `context-fec.js` (one source family each), `background.js` `loadContext` (requests, route and mute checks), `ui/view.js` `renderContext` and `chartSvg` (the card).
- **Shapes:** `docs/CONTEXT-CONTRACT.md`.
- **Tests:** `test/context-data.js`, `context-nonprofit.js`, `context-sec.js`, `context-stats.js`, `context-fec.js`, `context-chart.js`.
- **Live run:** `node eval/context-live.js <label> [pages.json] [--auto] [--repeat]` (headless).

## Why it is built this way

The first version charted whatever series was easy to get. On a pasta recipe it showed Wikipedia traffic for "Pea". Every chart it drew measured attention, and none answered a question about the page. The rebuild starts from the page's subject and asks which source can answer a question about it. When nothing defensible applies, there is no chart.

## How a chart is chosen

1. **Who runs the site.** The site's Wikidata item, from the bundled table of 7,572 domains or one exact-website lookup. It carries identifiers when Wikidata has them: US tax ID (P1297), SEC number (P5531), ticker.
2. **What the page is about (its subject).**
   - On a shop, an organization's own pages, a front page and most other pages, the subject is the site's entity.
   - On an article, a guide or a review, the subject is a name the headline carries and the text repeats, or the name the text repeats most when the headline has none. The name is confirmed against Wikipedia and Wikidata.
   - **Kinds allowed:** a person, an organization, an event, a work or a product. A place, a country, a species, a food, a holiday or an idea is refused, whatever the page says about it.
   - **One ordinary word is never a subject** (pea, laptop, economy). One word counts as a name only when the page writes it with a capital nearly every time (Nvidia).
   - **One word cannot pick among several things of that name:** a title with a bracketed qualifier, such as "The Democrats (Israel)", is refused for a one-word name.
   - **A phrase subject:** two or three ordinary words the page repeats, accepted only when they are the exact title of a Wikipedia article or redirect ("robot vacuums"). It can get attention charts only.
3. **Which question a source can answer.** Sources are tried in this order, and the first that returns a defensible chart leads. Up to two more are folded.

| page | order |
|---|---|
| article | an official statistic the page names → FEC records of the subject (pages about political money) → the subject's filings (pages about money: earnings, funding, a deal) → coverage of the story → the subject's filings (other pages) → attention to the subject → **last resort, labelled as about the site:** the site's own filings, then attention to the site |
| guide, review, recipe | an official statistic the page names → searches for the subject (after a click) → attention to the subject → the last resort above |
| shop, organization, other | the site's own records (FEC, IRS Form 990, SEC) → attention to the site (with SEC filings listed for a peak month) → recent SEC filings → searches for the site → Hacker News |

4. **Budget:** at most 18 requests. A failed source is listed under "What was looked up" and never stops the others. The last resort is skipped once something about the page was found.

## Identity rules

- **Records are matched by identifier:** a tax ID for IRS filings, an SEC number for SEC filings, a committee ID for the FEC.
- **When Wikidata gives a ticker but no SEC number,** the number comes from the SEC's own ticker list (bundled, `extension/data/sec-tickers.json`, rebuilt by `scripts/build-sec-tickers.js`) only when the ticker and the company name both match.
- **With no ticker either,** the number is accepted only when exactly one listed company has exactly that name.
- **A nonprofit's legal name:** when the page itself names its legal entity and no tax ID is known, ProPublica is asked for that exact name. It is accepted only when exactly one filer carries it. "… Support Fund" and "… Action Fund" are different filers and are never merged.
- **FEC:** a committee is accepted only when the FEC lists its connected organization as exactly the entity's name, with a committee type that fits. Individual donors are never looked up: people who share a name cannot be told apart.

## Series rules (in code)

- A chart needs at least 8 non-zero points from one source in a stated window (6 for yearly filings).
- **Missing is not zero.** A period with no value stays `null` and is drawn as a gap. A count source (news items per day, forum stories per year) is the only place a zero is written, because there it is a real zero.
- **Unfinished periods are dropped:** today, the week in progress, the current month, year, fiscal year or election cycle.
- **The news chart** counts only items dated inside 30 complete days, needs one day with 3 or more articles, and says it is a sample of what Google News returned.
- **Wording.** Wikipedia figures are "views", not readers. A peak is stated as a peak; no cause is suggested. Money is labelled as not adjusted for inflation.
- **Drawing.** Points are placed by date, so a missing year leaves a gap. The sentence above the chart carries the comparison, and the chart supports it.

## Sources built

| id | basis | what it shows | sends | trigger |
|---|---|---|---|---|
| official_statistic | statistic | the official series a page names (16 series: US CPI, core CPI, unemployment, earnings, gasoline, mortgage rate, policy rate, GDP, median income; UK CPI and unemployment; euro-area inflation and unemployment; World Bank inflation, unemployment and GDP by country) | a series code, and a country code | click or automatic |
| fec_committee | records | receipts by election cycle of a committee the FEC links to the subject | the organization's name, then a committee ID; needs the reader's free key | click or automatic, pages about political money |
| nonprofit_finances | records | revenue by tax year from IRS Form 990, expenses, the filer's legal name | a tax ID (or the legal name on the page, once) | click or automatic |
| sec_financials | records | annual revenue and net income from SEC annual reports | an SEC number | click or automatic |
| sec_filings | records | recent material filings, or the filings in a peak month | an SEC number | click or automatic |
| news_coverage | coverage | articles per day on the story, 30 days; other outlets covering it | headline words | click or automatic |
| subject_views | topic | daily Wikipedia views of the subject's article, 90 days | an article title | click or automatic |
| subject_trends | topic | weekly Google search interest in the subject, 12 months | the subject's name, **with the reader's Google cookies** | click only |
| site_views | site | monthly Wikipedia views of the site's article, 24 months | an article title | click or automatic |
| site_trends | site | weekly Google search interest in the site | the site's name, with cookies | click only |
| site_discussion | site | Hacker News stories linking the site, by year | the domain | click or automatic |
| facts | | the store's own product files; Internet Archive presence; Tranco rank; services the domain verifies with in DNS | the domain | click or automatic |

## Known limits

- **No free source for political giving by individuals** that is safe to match by name. The FEC source covers committees only and needs the reader's own key.
- **Employer totals from the FEC are not built:** one total needs many requests, and employer names are free text.
- **Wikidata coverage decides reach.** About 26 of 36 well-known nonprofits carry a tax ID and 12 of 14 large public companies carry an SEC number. Small organizations often have neither, so they get nothing unless their own page names a legal entity or their name, city and state match one filer.
- **A site whose Wikidata item is its product, not its company** (Asana, Figma) gets no filings: there is no safe identifier to follow.
- **The site's own modal can cover the panel** on a few pages (a donation pop-up on one tested nonprofit).
- **Foreign companies** that file 20-F reports get no revenue chart.
- **BLS keyless access** is limited to about 25 requests a day per reader.
- **Pages that name no subject** (most recipes, many essays) get only the labelled last resort, or nothing.

## Evaluation

### First run on 36 unseen pages (17 Nov 2026)

`eval/context/pages.json` holds 36 live pages of 12 kinds, three each: news that names a statistic, company news, political-money news, news about a person, news about a nonprofit, nonprofits' own pages, product pages of public companies and of small shops, recipes, buying guides, software pricing pages, and a local story, a blog post and a government page. The answer key (subject, what would help, what would be irrelevant) was written before the tool ran, by an agent that did not know how the tool works. A second agent judged the output against the key without reading the code. One judge, one run: these are counts from that reading, not a measurement of quality.

| question | counts (of 36) |
|---|---|
| Is the lead about the page's subject? | right 21 · about the site and labelled so 3 · wrong 4 · no chart 8 |
| Does the measure fit the page? (24 charts on the right subject or site) | fits 10 · weak 12 · misfit 2 |
| Is the data handled honestly? (28 charts) | clean 22 · a problem 6 |
| Would a reader learn something relevant? | yes 10 · marginal 2 · no 23 (8 of them pages with no chart) · harmful 1 |
| Where nothing defensible existed (16 pages), was the fallback honest? | honest 12 · dishonest 4 |
| Did the lead change on a second run? | 1 of 36 |

- **All 10 useful leads were records or official statistics:** CPI and unemployment from the BLS; SEC revenue for Boeing, Marvell, Crocs, Sonos and Asana; IRS filings for the Southern Poverty Law Center, Wounded Warrior Project and the Red Cross.
- **No lead built on Wikipedia views or Google searches was judged useful.**
- **The 4 wrong subjects:** a PepsiCo story matched to a television series ("North of North"), dell.com resolved to Michael Dell, a shop's product page treated as a news story, and a Yellowstone page charted as the National Park Service.
- **The FEC source was off** (it needs a reader's key). It would have mattered on 4 pages.

### What changed after that run

1. **Ordinary attention charts no longer lead.** They are folded under "Attention data". A chart leads only if it is a record, a statistic, real coverage, or attention with a clear spike.
2. **Subject fixes:**
   - a one-word name must be the whole article title;
   - the headline's first name is tried first;
   - job titles, months and number fragments are not names;
   - the site's Wikidata item is never a person, and is the most widely described item for that address;
   - a page that marks itself a product is a shop page.
3. **More reach for records:**
   - a company the headline names beside a person, when Wikidata links the two;
   - a small nonprofit by its own name, with the filer's city and state on the page;
   - the country for a statistic from the agencies the page names.
4. **An adversarial code review found identity holes, and each was fixed with a test:**
   - a surname resolving to a company ("Ford");
   - "CPI" as a party or an advertising cost;
   - a statistic for a country with no series;
   - a name-only match on the SEC's list (removed);
   - a paged nonprofit search;
   - an unrelated second name in the headline;
   - a same-named person.

### Second run on the same pages, after the fixes

Run `eval4`, after every fix above (lead charts only; not judged, because the pages are no longer unseen):

| lead | pages (of 36) |
|---|---|
| records (SEC revenue, IRS Form 990) | 10: Boeing, Marvell, PepsiCo, Nvidia, Dell, Crocs, Sonos, Southern Poverty Law Center, Wounded Warrior Project, Red Cross |
| official statistic | 1: the mortgage-rate story (Freddie Mac series) |
| coverage of the story | 1 |
| attention with a clear spike | 4: three super PAC stories (views of "Super PAC" on election day) and one athlete |
| no chart | 20: recipes, small shops, buying guides, pricing pages of private or unlisted-in-Wikidata companies, small nonprofits with no match, a blog post |

- **The four wrong subjects from the first run are gone.** PepsiCo and Dell now get their own SEC revenue, the shop page gets no chart, and the Yellowstone page gets no lead.
- **Two statistic pages (CPI, jobs) showed no statistic in this run** because the test runs had used up the BLS's keyless allowance of about 25 requests a day. The card now says so. In the first three runs both showed the BLS series.
- **Two pricing pages (Asana, Figma) lost their SEC chart** when the name-only match on the SEC's list was removed. Wikidata links those domains to the software, not the listed company, so there is no safe identifier.
- **35 of 36 pages led with the same result on a second run.**
- **Suites:** the timing-sensitive UI and regression tests failed once when run while the machine was under heavy load, and passed when run alone. Nothing in this work changed them.

These pages have now been used to find and fix faults, so they are no longer unseen. The next change must be measured on new pages.

## Routing table: every free source kept from the 464-source catalog

Built rows feed the sources above. A row marked "not built" says which page signal would call it.

| page signal | source | how | key | tested from the extension (17 Nov 2026) | built as |
|---|---|---|---|---|---|
| claim text | Duke Reporters' Lab Fact-Check Insights dataset | bundle | free | not run | not built |
| claim text | Duke Reporters' Lab fact-checker database | bundle | none | not run | not built |
| claim text | EUvsDisinfo database | link/embed | none | not run | not built |
| claim text | Google Fact Check Tools Claim Search API | own key | free | not run | not built |
| claim text | IFCN code signatories | bundle | none | not run | not built |
| domain | dns.google DNS-over-HTTPS | direct | none | worked | dns_services fact |
| domain | Tranco | direct | none | worked | rank fact |
| domain | Tranco list and rank API | direct | none | worked | rank fact |
| domain | Wayback Machine CDX Server API | direct | none | worked (years, 301s) | archive fact |
| domain | Wikidata (official website with date qualifiers) | direct | none | worked: exact-URL join 15/15 picked, 20/24 eval-set domains | site and subject entities |
| domain | Wikipedia/MediaWiki Action API (outlet and org articles) | direct | none | not run | subject resolution |
| domain | ads.txt (per site) | own files | none | worked | not built |
| domain | app-ads.txt | own files | none | not run | not built |
| domain | Apple App Store lookup API (iTunes) | direct | none | not run | not built |
| domain | Bellingcat wayback-google-analytics | direct | none | not run | not built |
| domain | ccTLD RDAP (Nominet .uk example) | direct | none | not run | not built |
| domain | Cert Spotter (SSLMate) | direct | none | worked | not built |
| domain | CFPB Consumer Complaint Database | direct | none | not run (wrong endpoint returned HTML) | not built |
| domain | Chrome UX Report (CrUX) API | own key | free | not run | not built |
| domain | Cisco Umbrella Popularity List (top 1M) | bundle | none | not run | not built |
| domain | Cloudflare Gateway/1.1.1.3 and Quad9 malware DNS | direct | none | worked | not built |
| domain | Cloudflare Radar API (domain ranking, scanner) | own key | free | not run | not built |
| domain | Cloudflare Radar domain ranking | own key | free | not run | not built |
| domain | crt.sh (Certificate Transparency search) | direct | none | failed (timeout) | not built |
| domain | CrUX History API | own key | free | not run | not built |
| domain | DNSlytics | own key | free | not run | not built |
| domain | FCA Warning List and FS Register API | page/feed | free | not run | not built |
| domain | Google Safe Browsing (Lookup/Update v4, v5) | own key | free | not run | not built |
| domain | HackerTarget API (reverse IP, reverse analytics, subdomains, AS, headers, page links) | direct | none | worked | not built |
| domain | IANA TLD list and RDAP bootstrap | bundle | none | not run | not built |
| domain | Majestic Million | bundle | none | not run | not built |
| domain | Mnemonic Passive DNS (public) | direct | none | worked | not built |
| domain | Open PageRank | own key | free | not run | not built |
| domain | OpenSincera (Sincera) | own key | free | not run | not built |
| domain | Public Suffix List | bundle | none | not run | not built |
| domain | RDAP (IANA bootstrap + registry servers) | direct | none | worked | not built |
| domain | RIPEstat Data API | direct | none | worked | not built |
| domain | RSF World Press Freedom Index | bundle | none | not run | not built |
| domain | security.txt (RFC 9116) | own files | none | worked | not built |
| domain | sellers.json (IAB, per ad system) | direct | none | not run | not built |
| domain | Sucuri SiteCheck | direct | none | worked | not built |
| domain | Trustpilot APIs | own key | free | not run | not built |
| domain | urlscan.io Search API | direct | none | worked | not built |
| domain | VirusTotal API v3 | own key | free | not run | not built |
| domain | VirusTotal domain report | own key | free | not run | not built |
| domain | Wayback Machine Availability API | direct | none | not run | not built |
| domain | Wayback Machine Memento / Timemap | direct | none | not run | not built |
| domain | Wikipedia Reliable sources / Perennial sources | bundle | none | fetched raw page | not built |
| organization or person name | OpenCorporates alternatives: Wikidata company items | direct | none | worked: exact-URL join 15/15 picked, 20/24 eval-set domains | site and subject entities |
| organization or person name | OpenFEC API | own key | free | worked (DEMO_KEY) | fec_committee (reader key) |
| organization or person name | ProPublica Nonprofit Explorer API | direct | none | worked | nonprofit_finances (by tax ID) |
| organization or person name | SEC EDGAR submissions API | direct | none | worked | sec_filings |
| organization or person name | SEC XBRL frames and company facts | direct | none | not run | sec_financials |
| organization or person name | Wikidata SPARQL endpoint | direct | none | worked: exact-URL join 15/15 picked, 20/24 eval-set domains | site and subject entities |
| organization or person name | Wikipedia pageviews API | direct | none | worked | subject_views, site_views |
| organization or person name | CFPB Consumer Complaint Database API | direct | none | not run (wrong endpoint returned HTML) | not built |
| organization or person name | Charity Commission register bulk extract | own key | none | not run | not built |
| organization or person name | CMS Open Payments | direct | none | not run | not built |
| organization or person name | Companies House bulk data | build-time source | none | not run | not built |
| organization or person name | Congress.gov API | own key | free | not run | not built |
| organization or person name | CourtListener API | own key | free | not run | not built |
| organization or person name | EU Financial Sanctions Files (FSF) | bundle | free | not run | not built |
| organization or person name | EU Transparency Register | bundle | none | not run | not built |
| organization or person name | FARA eFile API | direct | none | not run | not built |
| organization or person name | FEC bulk data | build-time source | none | not run | not built |
| organization or person name | Federal Register API | direct | none | worked (yearly) | not built |
| organization or person name | France Recherche d'entreprises API | direct | none | not run | not built |
| organization or person name | GLEIF Golden Copy bulk | direct | none | not run | not built |
| organization or person name | GLEIF LEI API | direct | none | ran; exact-name filter returned 0 | not built |
| organization or person name | Google Ads Transparency Center | link/embed | none | page loads (JS app) | not built |
| organization or person name | ICIJ Offshore Leaks bulk database | build-time source | none | not run | not built |
| organization or person name | ICIJ Offshore Leaks reconciliation API | direct | none | not run | not built |
| organization or person name | LittleSis API | direct | none | worked | not built |
| organization or person name | Media Ownership Monitor (RSF) | link/embed | none | not run | not built |
| organization or person name | Meta Ad Library API | own key | free | not run | not built |
| organization or person name | New York State corporation data (data.ny.gov) | direct | none | not run | not built |
| organization or person name | NIH RePORTER API v2 | direct | none | not run | not built |
| organization or person name | Norway Brønnøysund Enhetsregisteret API | direct | none | not run | not built |
| organization or person name | OFAC Sanctions List Service | bundle | none | not run | not built |
| organization or person name | Open Ownership BODS data (bulk) | build-time source | none | not run | not built |
| organization or person name | Open Ownership Register | bundle | none | not run | not built |
| organization or person name | OpenStates API v3 | own key | free | not run | not built |
| organization or person name | SEC EDGAR full-text search | direct | none | not run | not built |
| organization or person name | SEC enforcement and litigation releases | page/feed | none | not run | not built |
| organization or person name | TikTok Commercial Content Library | link/embed | free | not run | not built |
| organization or person name | UK Charity Commission Register API | own key | free | not run | not built |
| organization or person name | UK Companies House API | own key | free | not run | not built |
| organization or person name | UK Electoral Commission donations (search.electoralcommission.org.uk) | direct | none | not run | not built |
| organization or person name | UK FCA Register API | own key | free | not run | not built |
| organization or person name | UK Parliament Members API | direct | none | not run | not built |
| organization or person name | UK Parliament Register of Members' Financial Interests API | direct | none | not run | not built |
| organization or person name | UK sanctions list (OFSI/FCDO) | bundle | none | not run | not built |
| organization or person name | US OFAC SDN list | bundle | none | not run | not built |
| organization or person name | US Senate LDA lobbying API | own key | free | not run | not built |
| organization or person name | USAspending API | direct | none | not run | not built |
| organization or person name | Wikidata dumps | build-time source | none | not run | not built |
| organization or person name | Wikipedia ownership via Wikidata P127/P749/P355 | direct | none | worked: exact-URL join 15/15 picked, 20/24 eval-set domains | not built |
| organization or person name | Wikipedia REST summary | direct | none | not run | not built |
| organization or person name | Wikipedia revision history and XTools | direct | none | worked (edits per month) | not built |
| product or ingredient | CPSC Recalls API | direct | none | not run | not built |
| product or ingredient | NHTSA APIs (recalls, complaints, VIN) | direct | none | not run | not built |
| product or ingredient | Open Food Facts API | direct | none | not run | not built |
| product or ingredient | openFDA | direct | none | worked (counts by date) | not built |
| statistic the page cites | BLS Public Data API | direct | none | worked | official_statistic |
| statistic the page cites | Eurostat dissemination API | direct | none | not run | official_statistic |
| statistic the page cites | FRED API (St. Louis Fed) | own key | free | csv worked keyless | official_statistic (memory only) |
| statistic the page cites | UK ONS API | direct | none | not run | official_statistic |
| statistic the page cites | World Bank Indicators API | direct | none | worked on 2nd try (1st timed out) | official_statistic |
| statistic the page cites | BEA API (US Bureau of Economic Analysis) | own key | free | not run | not built |
| statistic the page cites | CDC data.cdc.gov (Socrata) | direct | none | not run | not built |
| statistic the page cites | data.europa.eu | direct | none | not run | not built |
| statistic the page cites | data.gov (catalog) | direct | none | not run | not built |
| statistic the page cites | DBnomics | direct | none | not run | not built |
| statistic the page cites | EIA Open Data API v2 | own key | free | not run | not built |
| statistic the page cites | IMF Data (DataMapper and SDMX) | direct | none | not run | not built |
| statistic the page cites | OECD Data Explorer SDMX API | direct | none | not run | not built |
| statistic the page cites | Our World in Data (Grapher CSV and API) | direct | none | worked | not built |
| statistic the page cites | UN Data / SDG API / UN Comtrade | direct | none | not run | not built |
| statistic the page cites | US Census Bureau API | own key | free | not run | not built |
| statistic the page cites | WHO Global Health Observatory OData API | direct | none | not run | not built |
| study or DOI the page cites | ClinicalTrials.gov API v2 | direct | none | not run | not built |
| study or DOI the page cites | Retraction Watch database (via Crossref) | direct | none | worked | not built |
| topic words | Google News RSS search | page/feed | none | worked (topic, site:, when:, planner queries 5/5) | news_coverage |
| topic words | Google Trends web (explore) unofficial endpoints / pytrends | page/feed | none | worked with reader cookies (3/3); omit cookies -> 429; long queries return no data | subject_trends, site_trends |
| topic words | Hacker News Algolia search (by URL) | direct | none | worked | site_discussion |
| topic words | Hacker News Algolia search API | direct | none | worked | site_discussion |
| topic words | Internet Archive Wayback CDX and availability API | direct | none | worked (years, 301s) | archive fact |
| topic words | SEC EDGAR data APIs | direct | none | worked | sec_filings |
| topic words | Wikidata API / SPARQL | direct | none | worked: exact-URL join 15/15 picked, 20/24 eval-set domains | site and subject entities |
| topic words | Wikimedia pageviews aggregate and dumps | direct | none | worked | subject_views, site_views |
| topic words | Wikimedia Pageviews API | direct | none | worked | subject_views, site_views |
| topic words | Wikimedia Pageviews REST API (per-article) | direct | none | worked | subject_views, site_views |
| topic words | Wikimedia pageviews top articles | direct | none | worked | subject_views, site_views |
| topic words | Wikipedia/MediaWiki search API | direct | none | worked; weak on headlines, fair on planner queries | subject resolution |
| topic words | Bluesky search (app.bsky.feed.searchPosts) | own key | free | not run | not built |
| topic words | Brave Search API | own key | paid | not run | not built |
| topic words | Crossref REST API | direct | none | worked | not built |
| topic words | Currents API | own key | free | not run | not built |
| topic words | Exa search API | own key | paid | not run | not built |
| topic words | GDELT DOC 2.0 API | direct | none | 1 of 4 calls answered (429 otherwise) | not built |
| topic words | GDELT TV 2.0 API | direct | none | not run | not built |
| topic words | GNews API | own key | free | not run | not built |
| topic words | Google Autocomplete / suggestqueries | direct | none | worked | not built |
| topic words | Google Books Ngram Viewer | direct | none | worked | not built |
| topic words | Google Dataset Search | link/embed | none | not run | not built |
| topic words | Google Trends daily trending RSS | page/feed | none | worked (RSS) | not built |
| topic words | Mastodon public API (trends, search) | direct | none | worked | not built |
| topic words | Media Cloud | own key | free | not run | not built |
| topic words | New York Times Developer APIs (Article Search, Archive, Most Popular, Top Stories) | own key | free | not run | not built |
| topic words | NewsAPI.ai / Event Registry | own key | free | not run | not built |
| topic words | NewsAPI.org | own key | free | not run | not built |
| topic words | NewsData.io | own key | free | not run | not built |
| topic words | OpenAlex | direct | free | worked (by year) | not built |
| topic words | Reddit Data API | own key | free | not run | not built |
| topic words | SerpAPI | own key | free | not run | not built |
| topic words | Serper.dev | own key | free | not run | not built |
| topic words | Tavily | own key | free | not run | not built |
| topic words | The Guardian Open Platform | own key | free | not run | not built |
| topic words | Wayback Machine availability / CDX | direct | none | worked (years, 301s) | not built |
| topic words | Webz.io (Open Web Data feeds) | own key | free | not run | not built |
| topic words | YouTube Data API v3 | own key | free | not run | not built |
