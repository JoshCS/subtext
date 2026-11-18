# Privacy: what leaves your browser, and when

This page lists every request the Subtext extension can make. It was checked against the code in `extension/` for version 0.3.0. Each setting is shown with its name in `extension/common.js` and its default value.

The README has the same list in longer form, under [Privacy](README.md#privacy). If the two differ, the code decides. Please [open an issue](https://github.com/JoshCS/subtext/issues) when you find a difference.

## What never leaves your browser

- There is no Subtext server. The extension sends nothing to this project.
- The checks on a page run inside your browser.
- The outlet and owner tables are files inside the extension. No visited address is sent to look them up.
- "Not accurate" notes and muted rules stay on your device.
- API keys are kept in the extension's own storage. Web pages cannot read it.
- A site you mute gets no scan and no request. Use "Don't scan this site" in the panel, or the site list in Settings.
- With "Scan every page automatically" off (`autoScan: false`), a page gets no scan and no request until you ask for one.

## Sent on every scanned page, by default

These three requests go to the site you are visiting, or to its main domain. They carry no cookies and no referrer. The site can still see that the request was made, and it sees your IP address as it does for any visit.

| What is read | When | Setting and default |
|---|---|---|
| The site's privacy and terms pages | When the page links one. Only links on the same registrable domain are followed. | `policyScan: true` |
| The site's `ads.txt` file | On each scan, unless a copy from the last 7 days is saved. | `adsTxtLookup: true` |
| Up to five of a shop's own contact, legal notice, terms and about pages | On a page that sells and shows no company name or no phone number. | `sellerPages: true` |

Details that matter:

- **Policy pages.** The request comes from the extension's background worker. The site learns that its policy was read, not which page you were on. A redirect is followed and can lead to another host.
- **ads.txt.** The file is asked for at the site's registrable domain, then at `www.` plus that domain. So the request may go to a different host name than the page you are on. A redirect is followed. The answer is used only when it ends on the same registrable domain. Private and intranet host names get no request.
- **Shop pages.** The check is skipped for outlets in the bundled outlet table. When the page links no contact or legal notice page, the shop's `robots.txt` and sitemap are read too. A sitemap index adds one more sitemap file. That is at most eight requests for one page load.

## Sent only when you click

### Compare (no key needed)

The Compare button appears beside a link to a supported public record. Subtext sends the record's public identifier to one of three services:

- the SEC archive at `www.sec.gov`, for a filing;
- Europe PMC at `www.ebi.ac.uk`, for a PubMed or DOI article;
- `clinicaltrials.gov`, for a trial registration.

The request carries no cookies and no referrer. It does not carry the article's text or address. A redirect is refused. The service sees the request and your IP address.

### Show context (no AI key needed)

Subtext works out what the page is about. It then asks a few free public sources about that subject. One click makes at most 18 requests. No request carries the page address, the page text or a referrer.

| Source | What it receives |
|---|---|
| Wikidata and Wikipedia | The registrable domain, or the site's Wikidata id from the bundled table. On an article, also names or a short phrase from the headline, then an article title for its page views. |
| Google News | Headline words, on articles only. |
| ProPublica Nonprofit Explorer | A US tax ID. When no tax ID is known, the legal name printed on the organization's own page. If the page prints no legal name, the site's name is sent. When the footer of an organization's own page prints one US tax ID beside a label such as EIN or Tax ID, that nine-digit number is sent. A number in the main content is never read. |
| SEC (`data.sec.gov`) | A company's SEC number. When Wikidata names one company as the owner or developer of the site's product, that company's Wikidata id goes to Wikidata and its SEC number goes to the SEC. |
| The site's own status page | A request for the public incident feed (`/api/v2/incidents.json`). It is sent only when the page's footer, header or navigation links to a status page under the site's own domain. It carries nothing about the page you are on. The status host is often run for the site by another company, and it sees your IP address. |
| National Park Service (`irmaservices.nps.gov`) | The park's four-letter code from the page address. Only on an nps.gov page about one park. |
| Official statistics | One series or indicator code, and a country code where needed. The services are the US Bureau of Labor Statistics, the New York Fed, Freddie Mac and FRED. Outside the US they are the UK Office for National Statistics, Eurostat and the World Bank. |
| Federal Election Commission | An organization's name and your FEC key. Used only when you saved a key (`fecKey: ''`, empty by default). |
| Internet Archive, Tranco, Google Public DNS, Hacker News search | The registrable domain. |
| The shop itself | On a shop product page, requests for the store's own public product files. |
| Google Trends | The subject's name, sent with your Google cookies. |

Google Trends is the only request that carries cookies. Google can link the name to your Google account. It is sent only after a click, and only while "Include Google Trends" is on. That setting is on by default (`contextTrends: true`). Turn it off in Settings if you do not want it.

"What was looked up" in the report lists each request and what it sent. Private and intranet host names are never looked up.

### Investigate (your own AI key)

Investigate needs an API key that you add in Settings. The key and the page content go to the provider you chose: Anthropic at `api.anthropic.com` or OpenAI at `api.openai.com`. Nothing is sent before you click. The setting is `aiInvestigation: true`, and the default provider is `aiProvider: 'anthropic'`.

One click makes three AI requests: plan, draft and review. A request whose answer is cut off is sent once more. The requests receive:

- the page's origin, title, visible headings and control labels;
- an excerpt of the main text and visible credits, up to the limit in Settings (`maxCharsToAI: 40000`);
- measured button areas for a two-button dialog;
- the text of sections you can open but have not, such as closed FAQ answers, marked as collapsed;
- a sponsor's name read from the logo beside a paid label;
- facts Subtext already holds about the site, such as the outlet record, the `ads.txt` summary and policy clauses;
- up to twelve links to supported public sources found on the page;
- in the later requests, excerpts from the sources that were read.

The query string and fragment of the page address are left out. Text printed on the page can still contain personal information.

The same click can also make these requests:

- **Source reads.** Up to two public sources are read. They are SEC, publication or trial records, or disclosure and terms pages on the page's own site. No cookies or referrer are sent, and a redirect is refused.
- **Record search.** When a needed filing or paper is not linked, one search may go to SEC full-text search (`efts.sec.gov`) or Europe PMC. It carries identifying words from the page. Those services see the words and your IP address.
- **Background search.** With Claude, one more request can use Anthropic's web-search tool, with up to four searches. It receives the page title, the address without its query string, the outlet name, credits and the central claim. This is on by default (`aiContextSearch: true`) and runs only when the planning step asks for it. Turn it off in Settings.

### Deep analyze (your own AI key, single-pass mode)

Deep analyze replaces Investigate when you turn off "Investigate with sources" (`aiInvestigation: false`). One click makes one AI request to the provider you chose. It receives:

- the page's origin and path, without the query string or fragment. A token inside the path itself would still be sent;
- the title, visible headings, control labels, and an excerpt of the main text and credits;
- the outlet and owner names from the bundled table, and measured signals about the page;
- the ids of the rules that flagged, without their text;
- passages from a record you already compared in this tab, when the claim is in the excerpt;
- up to four charts, as SVG markup or images.

Chart image files are first fetched from wherever the page loads them, without cookies. That host can see the request.

### Analyze selected evidence (your own AI key)

Saving a casebook step sends nothing. The saved text stays in the browser profile. "Analyze selected evidence" sends the two or three saved steps you selected to your AI provider. Each step carries its saved text, its title, its capture time and its address. The address has no query string or fragment. This analysis makes no source reads and no searches.

### Links you open

The panel shows links to outside sites, such as Wikipedia, ToS;DR and media raters. Subtext contacts none of them. Opening a link is an ordinary visit by your browser.

## Sent only if you turn it on

All four settings are off by default.

| Setting and default | What is sent |
|---|---|
| ToS;DR lookup, `tosdrLookup: false` | The site's host name to `api.tosdr.org`. Saved for 7 days. It runs after the policy scan, so it needs `policyScan` on and a privacy or terms link on the page. |
| Domain registration lookup, `rdapLookup: false` | For sites not in the outlet table: the registrable domain to the registry's RDAP server, or to `rdap.org`. A second request can go to the registrar's RDAP server. The list of servers comes from `data.iana.org`, and that request carries no domain. Saved for 7 days. |
| Web check, `aiWebCheck: false` | With Deep analyze only: one more AI request naming the registrable domain and the outlet name. The provider's search tool receives searches naming the site. Saved for 30 days per site. |
| Load context automatically, `contextAuto: false` | The Show context requests, a few seconds after each page you open. Google Trends is left out. |

## What is stored on your device

- Settings, muted sites and rules, and "Not accurate" notes.
- Saved answers from `ads.txt`, ToS;DR, domain registration and web check lookups.
- API keys, unencrypted, in the extension's own storage.
- Casebook steps: up to 20 cases, 12 steps per case and 12,000 characters per step.

None of this is synced by the extension. Removing the extension removes it.

## Data files held out of the public copy

Some data files are not in the public copy. The README lists them under "Data held out of the public copy". Without them the extension has no warning list, no ad-exchange owner names and no owner-interest notes. So it cannot show those facts or send them to an AI provider.
