# Data sources for ownership, funding, bias and tracker information

The POC ships a hand-curated `extension/data/outlets.json` (134 outlets, 212 domains). This document is the plan for generating and maintaining that file, and the other datasets, from structured public sources so the project can grow past a hand-kept list.

## 1. Ownership and corporate structure

| Source | What it gives | Access | Licence |
|---|---|---|---|
| **Wikidata** | `P127` owned by, `P749` parent organization, `P112` founded by, `P1037` director/manager, `P856` official website, `P17` country, `P31` instance of (newspaper, think tank…), `P1830` owner of, `P2652`/`P8687` partnerships | SPARQL endpoint, free, no key | CC0 |
| **Wikipedia infoboxes** | Owner, publisher, political alignment fields (as text) | Dumps / API | CC BY-SA (attribute) |
| **SEC EDGAR** | Public US parents: 10-K ownership, 13D/13G large holders, DEF 14A voting control (dual-class) | Free API | Public domain |
| **OpenCorporates** | Company registrations, officers, parent links worldwide | API (free tier limited) | ODbL / commercial |
| **UK Companies House** | Officers, persons with significant control (PSC register) | Free API | OGL |
| **Media ownership monitors** (RSF Media Ownership Monitor, Columbia Journalism Review "Who Owns What", UNC Hussman news-deserts data) | Curated ownership for specific countries / US local news | Web | Varies; cite, don't copy |

Pipeline sketch (planned for v0.5; the script `scripts/build-outlets.js` does not exist yet):
1. Seed list of domains (top news/opinion/advocacy domains by traffic + anything users looked up that we lacked).
2. Resolve domain → Wikidata item via `P856` (official website) and sitelinks.
3. Walk `P127` / `P749` upward until an individual, a public company, a state body or a nonprofit; record the chain with each hop's Wikidata ID.
4. Classify the ultimate owner into our `ownerKinds` (billionaire individual, public company, family-controlled, PE/hedge fund, state funded/controlled, nonprofit/foundation, reader funded, religious, political, cooperative, trust, platform, advocacy, satire, fact-check) using `P31` and net-worth / listing facts.
5. Pull funding model hints: revenue model statements, 990 revenue categories (nonprofits), `P2139` total revenue.
6. Human review queue: every new or changed row shown with its evidence; approved rows get `confidence: high` and a `lastVerified` date.
7. Emit `outlets.json` with provenance per field.

Example SPARQL (owner chain for a website):
```sparql
SELECT ?item ?itemLabel ?owner ?ownerLabel ?ownerType ?ownerTypeLabel WHERE {
  ?item wdt:P856 ?site . FILTER(CONTAINS(LCASE(STR(?site)), "washingtonpost.com"))
  OPTIONAL { ?item wdt:P127|wdt:P749 ?owner . OPTIONAL { ?owner wdt:P31 ?ownerType } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
```

## 2. Funding, donors and political money

| Source | What it gives | Access |
|---|---|---|
| **ProPublica Nonprofit Explorer** | IRS Form 990 data for US nonprofits: revenue, expenses, officers, grants paid | Free API |
| **IRS 990 e-file bulk data** | Same, in bulk (AWS public dataset) | Free |
| **OpenSecrets** | Political contributions, lobbying, outside spending by organization and individual | API (free key) |
| **FEC API** | Federal campaign finance, committees, donors | Free API |
| **Candid / GuideStar** | Nonprofit profiles and funders | Partial free |
| **Charity Commission (England & Wales)**, **OSCR**, **ACNC** | Charity financials and trustees | Free APIs |
| **EU Transparency Register** | Lobby organizations and funding sources | Open data |
| **InfluenceWatch** (Capital Research Center, conservative) and **SourceWatch** (Center for Media and Democracy, progressive) | Narrative funding profiles for advocacy groups | Web; opposite lenses, present both |
| **DeSmog**, **Documented**, **Sludge** | Investigative funding reporting on specific sectors | Web; cite |

What we show: the type of money (donations, foundations, state, advertising, subscriptions, owner capital), the biggest named funders where public, and links to the primary documents. We do not infer motives.

## 3. Bias and reliability ratings (link, do not copy)

| Rater | Method | Data access |
|---|---|---|
| **AllSides** | Blind surveys + editorial review, left/right scale | Web; licensing for data |
| **Ad Fontes Media** | Analyst panels, bias × reliability chart | Paid API |
| **Media Bias/Fact Check** | Single-author methodology, widely used | Web; ratings are copyrighted text |
| **NewsGuard** | Journalist "nutrition labels", 9 criteria | Paid licensing (browser extension exists) |
| **Ground News** | Aggregates the above plus ownership, shows coverage by lean | Web app |
| **Wikipedia "Perennial sources" list** | Community consensus on reliability for citation | CC BY-SA |

Our `lean` field is a coarse synthesis of these for convenience and is labelled as such. The product links to each rater's own page for the outlet so users can see methodology and disagreement between raters, which is itself informative.

## 4. State media and state-affiliated accounts
- Wikipedia lists of state media by country; EU sanctions lists (RT, Sputnik); Ofcom licence decisions; US Treasury/State Department designations; platform "state-affiliated media" label lists (Meta, YouTube, X) where published. Classify as `state_funded` (editorially independent by charter, e.g. BBC, NPR, CBC, DW, ABC Australia) vs `state_controlled` (editorial line set by government).

## 5. Trackers, ad-tech and manipulation vendors
- **DuckDuckGo Tracker Radar**: largest open dataset of third-party domains with owner entity, prevalence and categories. CC BY-NC-SA 4.0: not bundled, because Subtext's licences allow commercial forks (docs/LICENSING.md). Used only as a reference when auditing the tracker list. The same holds for Disconnect (CC BY-NC-SA since 2020) and Ghostery TrackerDB (CC BY-NC-SA since 2023).
- **Bundled instead (6 Nov 2026):** the AdGuard companies database (CC BY-SA 4.0) and EasyPrivacy (GPL-3.0+ or CC BY-SA 3.0+, taken under CC BY-SA 4.0), built into extension/data/tracker-lists.json by scripts/build-tracker-lists.py (that file is held out of the public copy: docs/PUBLISHING.md). Audit of the hand-kept list against all of these: docs/CALIBRATION.md section 11.
- **Disconnect tracking protection lists**, **EasyList / EasyPrivacy**, **WhoTracks.me** (Ghostery) datasets.
- Vendor categories that no blocker list carries and we add ourselves: social-proof pop-up vendors, evergreen countdown vendors, exit-intent/pop-up capture, BNPL widgets, A/B testing. Discover by searching Shopify/WordPress app directories for "urgency", "social proof", "FOMO", "countdown" and recording their script hosts.

## 6. Dark patterns, deceptive design and enforcement
- deceptive.design (Brignull) pattern library and Hall of Shame; Dark Patterns Tip Line (Consumer Reports / EFF); Mathur et al. 2019 "Dark Patterns at Scale" dataset (11k shopping sites, 1,818 instances); FTC "Bringing Dark Patterns to Light" (2022); EU DSA Article 25 guidance; UK CMA "Online Choice Architecture" (2022); CNIL/EDPB cookie-banner decisions; FTC click-to-cancel rule and drip-pricing actions (ticketing, hotels). These give both vocabulary and real-world examples for fixtures.

## 7. Rhetoric, fallacies and propaganda
- Wikipedia list of fallacies; the 1937 IPA seven propaganda devices; Stanford Encyclopedia entries; the "Bad News" / "Go Viral!" inoculation games' technique lists (Cambridge Social Decision-Making Lab); clickbait and hyperpartisan corpora (e.g. Webis Clickbait 17, BuzzFeed-Webis fake news corpus) for calibrating lexicon thresholds.

## 8. Charts
- Tufte (lie factor), Alberto Cairo *How Charts Lie*, Reuters/WaPo graphics guidelines, the "misleading graphs" Wikipedia catalogue, and datasets of misleading charts collected on social media (e.g. the "viz.wtf" archive) for AI-layer evaluation.

## 9. Terms, pricing and offerings
- **ToS;DR** API for terms-of-service grades and specific points (data selling, arbitration, auto-renew). Pair with marketing copy to flag contradictions.
- Price history: camelcamelcamel/Keepa (Amazon), Honey/PriceSpy style data; or our own per-URL memory.

## 10. Reviews
- Signals from the Fakespot/ReviewMeta era: rating distribution shape, unverified share, review bursts, phrase repetition, reviewer history. Amazon product pages expose most of this in the DOM.

## 11. Licensing summary for bundling
- Bundle: Wikidata (CC0), government open data (public domain / OGL), our own curated lists.
- Attribute if bundled: Wikipedia (CC BY-SA), AdGuard companies database (CC BY-SA 4.0), EasyPrivacy (The EasyList authors). Tracker Radar (CC BY-NC-SA) is never bundled.
- Link, never bundle: AllSides, Ad Fontes, MBFC, NewsGuard, Ground News, InfluenceWatch, SourceWatch ratings text.
