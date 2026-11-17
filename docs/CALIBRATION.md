# Scoring: design, calibration and the test protocol

**Read this first.** No person has labelled any result in this document: the real-page figures come from AI judges or from checks in code. The recorded pages, outside test sets and run outputs named here (under `eval/corpus*/`, `eval/out*/`, `eval/external/` and `eval/pool/`) are other people's content and are not in the public repository, so these figures cannot be reproduced from a clone. Some sections describe data files that are held out of the public copy (`docs/PUBLISHING.md`).

Readers see no grade and no score (owner's decision, 5 Nov 2026): the pill names the strongest flag, the badge counts flags, and the labelled findings carry the information. A weight, `scoreFindings`, still runs inside the code for the test suite and the evaluation harness, and that is all it does. The letter bands below are test labels, never shown to anyone. This document explains how the weight is produced, how it was checked so far, and the protocol for checking it on real pages with human labels and two independent AI judges.

## 1. The internal weight (v0.2, not shown to readers)

For each finding *f*:

```
weight(f) = severity(1–3) × confidence(0–1) × √min(count, 6)
```

* severity is the taxonomy's judgement of how harmful the technique is in general;
* confidence is the rule's (or the AI's) belief that this instance is real;
* the square root of the count rewards repetition without letting one repeated word dominate.

Per category, weights are summed and **capped at 10**, so no single category (for example twelve tracker vendors) can push a page to F alone. The capped category totals are summed into *w* and squashed:

```
score = 100 × (1 − e^(−w/20))
```

Two **floors** then apply, because the squash under-reacts to a single proven deception: one severity-3 finding with confidence ≥ 0.6 makes the score at least 35 (band C); each further severity-3 finding raises the floor by 15, up to 70 (D). Severity-0 "informational" findings (business model, chart checked, positive policy clauses, trust-owned outlet) never affect the score.

Test bands: A < 15, B < 30, C < 50, D < 70, F ≥ 70. `test/run.js`, `eval/calibrate.js` and the evaluation reports use them; no reader-facing surface does.

Why a curve at all: a bounded, saturating number makes "many small things" and "one big thing" comparable in a test. Why it stays out of the interface: a page is not one metric, and the research notes on warning labels are consistent that people act on legible severity (icon, colour, one word) more than on numbers. The interface leads with the top labels.

## 2. Calibration so far (synthetic)

`eval/calibrate.js` builds a product page and adds manipulation "blocks" cumulatively (urgency → social proof → anchoring/BNPL → free-trial trap → pre-checked boxes → asymmetric cookie banner → flattery/negging → vague authority → conspiracy framing → session replay, social pixel, social-proof vendor, data broker), runs the real extension on each, and checks monotonicity and grade bands:

| blocks | findings | score | grade | target |
|---|---|---|---|---|
| 0 | 0 | 0 | A | A |
| 1 | 2 | 18 | B | A–B |
| 2 | 3 | 21 | B | B–C |
| 4 | 10 | 58 | D | C–D |
| 7 | 14 | 71 | F | D–F |
| 10 | 27 | 91 | F | D–F |

Before the v0.2 change (divisor 14, no caps, no floors) the four-block page scored 71 (F), which read as too harsh for "a pushy but ordinary product page". The divisor was moved to 20 and the floors added so that a proven fake deadline alone still produces a C. The fixture suite confirms the control page (a sourced recipe on theguardian.com) stays at 0 and the two synthetic worst cases stay at 100.

What synthetic calibration cannot tell us: the base rate of findings on ordinary pages, the false-positive rate of each rule in the wild, and whether grades match human judgement. That needs section 3.

## 3. Protocol for real calibration

**Corpus.** 200 pages saved as single-file HTML snapshots (so runs are reproducible and the pages cannot change under us), stratified: 50 news/opinion (balanced left, right, centre, state media, hyperpartisan), 40 e-commerce product/checkout, 30 SaaS pricing/sign-up, 20 health/finance/supplement sales, 20 social feeds and video, 20 government/education/reference (expected clean), 20 "AI chat" product pages. Record URL, date, and a hash.

**Human labels.** Two annotators per page, using the taxonomy as the codebook, label: (a) each technique present (category + technique id, with the quote or element), (b) an overall 1–5 pressure rating, (c) the single most important thing a reader should know. Report Cohen's κ per category; the research notes report that dark-pattern labelling typically reaches only moderate agreement, so expect κ ≈ 0.5–0.7 and adjudicate disagreements rather than average them. Annotation tooling: Label Studio or doccano (both open source).

**AI judges.** Run `eval/run-ai.js` with both providers (Claude and ChatGPT) on the same snapshots using the extension's own prompt and schema, then `eval/compare.js`. Treat each model as a third and fourth annotator, not as ground truth: measure (1) grounding (does every quoted excerpt exist in the page? target 100%; a verifier pass drops the rest), (2) agreement with humans per category, (3) agreement between the two providers (category Jaccard, pressure label), (4) cost per page. Known failure modes from the notes: LLMs over-flag (reasoning models especially), treat profanity as manipulation, and show an asymmetric false-positive rate against reliable right-leaning outlets; the symmetry check below exists because of this.

**Heuristic precision.** For every rule, precision = labelled-true / fired. Targets before v1.0: ≥ 0.85 for severity ≥ 2 text rules, ≥ 0.9 for DOM/visual/behaviour checks, zero severity-3 findings on the expected-clean stratum. Rules below target get a higher `minCount`, a narrower pattern, a lower severity, or are demoted to severity 0 until fixed.

**Score fit.** Fit the grade thresholds (and if necessary the divisor and category cap) so that the median human pressure rating per grade is monotonic and the expected-clean stratum is ≥ 90% A/B. Report the confusion matrix of grade vs human rating. Do not tune per category weights by hand without a corpus; that is how a score becomes an opinion.

**Symmetry.** Equal numbers of left- and right-leaning pages with comparable tactics; the rhetoric and emotional categories must fire at comparable rates (difference < 10 percentage points) or the rules are rewritten.

**Fatigue.** Two-week diary study with 20 users: how many pills/chips per day, how often they open details, when they mute, which labels they report as wrong. Feeds the per-page budget (currently 5 glance chips).

## 4. Open questions for the product owner
* ~~Should the pill show the grade at all on pages that score A/B?~~ Decided 5 Nov 2026: no grade on any page.
* Should severe privacy-policy clauses (forced arbitration, data sale) carry the same floor as fake deadlines in the internal weight? Today they do (severity 3).
* AI findings count in the internal weight only after their quotes are verified on the page (`quoteOnPage` in `extension/ai.js`).

## 5. Real-page results, 4 to 5 November 2026

Recorded pages replayed offline (`eval/corpus-run.js`), so numbers are free of site drift. Judged by an independent AI agent that saw only the findings, the readings and, when it chose, the live page. **No human has labelled any of this.** The targets in section 3 (0.85 for severity 2 and above) are not met.

Verdicts: *supported* = the evidence shows the claim and a reader would be glad to know; *boilerplate* = true but ordinary; *unsupported* = the evidence does not show the claim. Tracker and ownership findings are excluded: they are facts, not judgement calls.

| Set | Code | Pages | Findings judged | Supported | Boilerplate | Unsupported | Unclear |
|---|---|---|---|---:|---:|---:|---:|
| `fresh`, blind mix | before the overnight run (up to 3 per rule) | 17 | 126 | 28 (22%) | 26 | 70 (56%) | 2 |
| `fresh`, blind mix | mid-run | 17 | 56 | 24 (43%) | 10 | 21 (38%) | 1 |
| `fresh2` | later, never tuned on before judging | 17 | 48 | 10 (21%) | 19 | 16 (33%) | 3 |
| `fresh3` | later, never tuned on before judging | 17 | 50 | 20 (40%) | 10 | 19 (38%) | 1 |

The sets differ, so `fresh2` and `fresh3` are not a trend. Read them together: on unseen pages about a third of what fires is still wrong and 20 to 40% is what a reader would want. The `fresh` rows are the only true before and after. The old code's sample was capped at 3 findings per rule and the new one was not; capping the new one the same way gives 42% supported and 40% unsupported, so the comparison holds at 22% to 42%, and 56% to 40% unsupported. It was measured before later rule changes.

Readings (the one line at the top):

| Set | Code | Accurate | Partly | Wrong | Says something beyond the obvious |
|---|---|---:|---:|---:|---:|
| `fresh` | before | 8 | 2 | 7 | 5 of 17 |
| `fresh` | mid-run | 11 | 5 | 1 | 9 of 17 |
| `fresh2` | later | 9 | 8 | 0 | 4 of 17 |
| `fresh3` | later | 7 | 5 | 5 | 7 of 17 |

The five wrong `fresh3` readings came from bad "run by" names, a platform's own site read as its tenant, a blocked load, a charity's pixels read as ad funding, and referral buttons not counted. All five causes were then fixed, and no unseen set has measured that fix. `fresh`, `fresh2` and `fresh3` have all now informed tuning; add a new split for the next honest number.

Volume (flags per page, trackers and ownership excluded): 8.9 before on `fresh`; 1.6 on the same pages now; 1.9 and 2.2 on `fresh2` and `fresh3` on final code.

Known trade-offs and gaps:
- **Rhetoric is close to silent on real partisan pages.** Zero rhetoric or emotion flags on 22 left and right pages (mean score 43 and 44). That is symmetric, and it is also low recall: the density and region gates removed the false alarms and most of the true ones. Deep analyze reads argument structure and is where this now lives.
- **Sale-page readings describe the page, not the economics.** Seats, take rate and setup fees are read from the page. Membership income, referral fees and who owns which review site are not on the page; they need a sourced business-model dataset beyond media, or Deep analyze.
- **No known-bad corpus.** No scam sites were visited live, so recall on real fake shops is unmeasured; only the fixture covers it.
- 39 of 165 pages are excluded above: 18 replay errors (bot protection or long-lived connections) and 21 error pages or pages under 300 characters. Counting every recorded split, 56 of 219 are excluded.

Reproduce: `node eval/corpus-record.js <names>`, `CORPUS_WORKERS=4 node eval/corpus-run.js <label> <split>`, `python3 eval/judge-sample.py`, `python3 eval/compare-grades.py <run.json>`.

## 6. After the reliable-only change, 5 November 2026

Only rules with tier `flag` in `rules/reliability.json` now reach readers. Two more unseen sets were recorded and judged the same way, on what a reader would actually see. Again these are AI judges, not people.

| Set | Pages | Flags shown | Useful | True but ordinary | Wrong | Unclear |
|---|---:|---:|---:|---:|---:|---:|
| `fresh4` | 22 | 29 | 17 (59%) | 3 | 8 (28%) | 1 |
| `fresh5`, after fixing what `fresh4` caught | 15 | 12 | 8 (67%) | 2 | 2 (17%) | 0 |

The samples are small. Two wrong out of 12 has a 95% range of roughly 5% to 45%, so this does not yet show the wrong rate is below a third. Both wrong flags in `fresh5` had no evidence; a flag with no evidence is now demoted, and that gate has not been measured on unseen pages.

| Set | Readings accurate | Partly | Wrong | Beyond the obvious |
|---|---:|---:|---:|---:|
| `fresh4` | 14 | 5 | 3 | 12 of 22 |
| `fresh5` | 10 | 3 | 2 | 6 of 15 |

Volume fell further: the 15 usable `fresh` pages went from 8.9 flags per page before any of this to 1.2. Quantity is not the target, but it is what the reader has to read.

**Known-bad pages.** 80 archived copies of sites on the Czech authority's list and HaGeZi's list, served locally so no listed site was contacted. The list itself names all of them by construction. Without the list, Subtext's own rules flagged 19 of 77 usable pages (25%), nearly all through the unnamed-operator check. This is a low estimate, because archived copies lack their scripts, so many shops render without prices or checkouts. It is also the cost of precision: most of what catches a scam shop is someone else's list. On the honest pages, the list matched one: shein.com, on the Czech authority's list.

**Still missing, from the judges' `missed` field.** The most common gap is ownership on non-media sites (Teladoc behind BetterHelp, Amazon behind Audible). Next is what a trial becomes (what it renews at). Both need a sourced business-model dataset beyond media, or Deep analyze.

## 7. What an independent methods review said, 5 November 2026

An AI reviewer with no part in the work recomputed the numbers from the raw verdicts. The arithmetic held. What it changes:

- **No set is truly unseen any more.** Every set fed a code change within minutes of being judged. The rules allowed to flag were partly chosen from the same pages. The honest statement today is that the wrong rate of what readers see is somewhere between about 14% and about a third, and the data cannot say which side of the owner's bar it falls on.
- **Sampling.** The pages are mostly home pages of well-known US and UK brands that do not block automated browsers. 39 of the first 165 pages could not be used, and 16 of 24 shop pages were among them. The numbers say little about long-tail shops, checkout flows, logged-in feeds, mobile or non-English pages.
- **Judges disagree.** The same rule was rated ordinary by one judge and useful by others. A blind re-judge agreed 82% on clean items. Useful versus ordinary is partly a judge effect.
- **The known-bad test is partly circular.** Pages were sampled from the lists, so the list's hit rate proves nothing. Own-rule hits came almost entirely from the unnamed-operator check, which has since been demoted, because on honest pages it was usually wrong.
- **Tests cannot catch precision problems.** `npm test` proves regexes match their own example text and that known traps stay quiet. The product could flag wrongly on every real site and still pass.

After this review the bar for a flag became: at least 5 judged firings, 15% or fewer wrong, 50% or more useful. Vendor facts, direct proofs and third-party listings are allowed separately. Direct proofs have not fired on real pages, so they are unmeasured.

**The evaluation that would settle it.** Sample flags rather than pages. Draw about 400 URLs by a fixed procedure from a public list nobody curated, including long-tail and product pages. Freeze the pool and do not look at it. Two people label about 150 shown flags using written definitions, with a screenshot of each. If 30 or fewer are wrong, the 95% upper bound is 27% and the bar is met. If 38 are wrong, it is not. That is about 11 hours per labeller. Any fix after that needs a second frozen pool.

**Replaced, 6 November 2026.** The 11 hours of human labelling are not available, and the aim changed: Subtext describes what is on a page rather than sorting pages into good and bad. A statement of a plain fact about the page ("no phone number on this page") can be checked for truth by code, with no person deciding whether it is fair. So the human step is replaced by a truth check (`eval/fact-check.py`, section 10). The bar above still applies to judgements, such as whether a countdown is pressure. The label kit stays in `eval/label/` for anyone who wants to use it, but nothing waits on it.



## 8. Owner records, 5 November 2026

The table from Wikidata was tested before use. 60 owners drawn at random, each checked against current sources by an AI reviewer with no part in the build: 35 fair to show, 9 true but odd, 13 stale after a sale or merger, 3 wrong. Among the 40 busiest sites, only half were fair. That fails the 90% bar, so Wikidata owners are not stated in the top line. They appear only in the Source card, marked as possibly out of date. The top line uses owners researched by an AI agent from cited sources and then checked independently (`data/owners-overrides.json`, `extension/data/outlets.json`) and an owner the site itself names in its ads.txt file. A row can be promoted once someone has checked it.


## 9. Scam pages without a list, 5 November 2026

**Test sets.** Listed pages: archived copies of shops on the Czech regulator's list and HaGeZi's Fake list. Honest pages: small shops, outside the top 100,000 sites, vouched for by trust marks (APEK, Thuiswinkel, Trusted Shops, Confianza Online, Gütezeichen, EHI), archived the same way, so a signal cannot tell them apart by how they were fetched. A blind AI pass labelled what each page was before any detector ran; pages that were not shops or scam pages were dropped. Half of each set was held back by a hash of the domain.

**Result on the held-back half, first run:** the new checks fired on 13 of 52 listed pages (25%) and 1 of 74 honest shops (1.4%, upper bound about 7%). The train half, after tuning: 19 of 51 and 0 of 43. Across 195 ordinary pages they fired once, on Shein.

**After one fix and a fresh check.** The two false alarms above both came from the title check alone, so it now also requires no real social profile. That fix was informed by those pages, so the zero that follows is not independent: 12 of 52 listed pages, 0 of 74 honest shops. Then the rule was frozen and run on 44 listed pages that arrived later, all from HaGeZi: 4 fired (9%). Results by list are not alike: the check works far better on the Czech regulator's anonymous shops than on HaGeZi's more polished ones. Own-rule catch rate is low either way. The bundled lists remain the main defence, and they now include a phishing list (21,732 sites) and the ESMA crypto register.

**After an independent code review.** The review showed a title alone could flag a search page or a news headline, so the title check now needs a shop as well. Final figures: held-back half 10 of 52 listed pages, 0 of 74 honest shops; later pages 4 of 44; train half 11 of 51, 0 of 47. Taking the held-back and later pages together, about 15% of listed pages fire. Most listed shops still pass unflagged.

**Limits.** The honest set is established shops with a trust mark, not new honest sellers, who may look more like the listed pages. English-language shops are thin. Many listed pages left no usable archive copy, so the test is not a random sample of listed shops. The lists can be wrong. At a low base rate most firings would be honest shops: if 1 shop in 100 is bad, many firings would be on honest pages even at a low false-alarm rate. So the line says only what could not be checked, never that a shop is dishonest.

The 20 rows in `data/owners-overrides.json` were researched by an AI agent from cited sources, then checked by a second AI agent on 6 November: 12 correct, 7 true but obscure or misleading, 1 stale (Udemy, now owned by Coursera). That is 12 of 20 fair to show, which fails the same bar, so the obscure and stale rows were corrected and no row reaches the top line until a person has checked it. The top line now names an owner only from the hand-made outlet table or from the site's own ads.txt.

## 10. Shop facts instead of a scam verdict, 6 November 2026

**What changed.** The shop check no longer combines traits into one "hard to check" verdict. On a shop it states each fact it found (no social profile, social links that lead nowhere, no phone, no company name, no terms of sale, a title stuffed with place or sale words, big discounts) and, beside each, how many listed and honest shops showed the same thing. The facts fold into the one finding about the seller, and the company-name and phone checks are now the provenance detector's, so two checks can no longer disagree about the same page. Before this, the shop check said "no company name" on a test page whose footer named Lensly Eyewear Inc.

**How common each fact is.** Counts from the extension's own run (`eval/scam-run.js`, `eval/shop-trait-rates.py`, run label d5) on the held-back half and the later listed pages; the train half is left out. 57 listed shops and 59 honest shops with a trust mark:

| fact | listed shops | honest shops |
|---|---|---|
| no social profile | 34 | 17 |
| social links that lead nowhere | 8 | 2 |
| no phone | 47 | 16 |
| no company name, registration number or address | 25 | 4 |
| no terms of sale or legal notice link | 12 | 1 |
| title stuffed with place or sale words | 3 | 0 |
| three or more discounts of 60% or more | 2 | 1 |
| no real social profile, no phone and no company name together | 14 | 1 |

Any one fact alone is common on honest shops, so only the combination reaches the top line, plus two facts that keep their own weight: a German-language shop with no legal notice (required by law there) and, when the opt-in registration lookup is on, a very new domain. In the run the top line described the seller on 25 of 62 listed shops (40%) and 1 of 59 honest shops (classicsportshoes.nl). Seller facts appear in the report on 60 of 62 listed shops and 30 of 59 honest shops. The honest shops carry trust marks that require them to show who they are, so honest new shops will show these facts more often. The top line also leaves the seller facts out when a record names the site's owner: on the 219-page ordinary corpus the only page that got the line was a Udemy course page, true of that page but misleading for a company whose owner is known, and after that guard no ordinary page gets it.

**Truth check.** For each fact stated as an absence, a second reader (Claude Haiku 5.5) was asked to find the missing thing on the same archived page and copy it exactly; code kept an answer only if the copied text was on the page. Of 177 absences stated on 121 shop pages:

- "no social profile": 0 of 65 shown false. The reader found 53 of the 56 real profiles the extension found.
- "no phone": 3 of 68 shown false. One of the three numbers sits inside an HTML comment a visitor never sees, so 2 are real misses (local numbers with no label). The reader found 47 of the 53 phones the extension found.
- "no company name, registration number or address": 1 of 30 shown false, a made-up address on a listed shop.
- "no terms of sale or legal notice link": 4 of 14 shown false. One of the four is a disclaimer page, not terms; the others are a Greek terms link, a page called "policy" and one called "service contract". The reader found 88 of the 107 such links the extension found.

So about 6 of 177 stated facts (3%) are shown false. Because the reader misses about 1 in 10 things that are there, the true rate is somewhat higher, probably under 5%. The first run of the same check found 23 phone and 36 company disagreements between two readers, and "no terms" was false on 37 of 53 pages. The fixes in between were made at the source: phone numbers in international form, phone words in other languages, structured data, a number beside a contact word or an email address; Czech, Slovak, Dutch and Spanish legal forms and registration numbers; a company named as the operator survives the copyright check; terms, privacy and legal-notice link words in Dutch, Czech, Slovak, German, Spanish, Italian, Polish and Nordic languages. Those fixes were made on these pages, so the 3% is not independent. Cost: about 40 cents per run.

**Limits.** Archived pages only, and the replay blocks every other request, so a terms page that names the company is never fetched here; on a live visit the policy fetch can find it, so live pages should say "no company name" less often. Listed shops come from the Czech regulator and HaGeZi; English-language shops are few.

## 11. Broader checks, 6 November 2026

The owner asked for more comprehensive checks in every area, prototypes of each, and a way to make them work. Five research passes found the best public data and methods; each prototype below was then measured against data someone else labelled, never against our own judgement alone. Each measurement is one command; the outside data it reads is in `eval/external/` (git-ignored, see its README), never published.

**Trackers.** Command: `scripts/build-tracker-lists.py` then a corpus replay. The 219 recorded pages contacted 1,169 outside registrable domains. The hand-kept list (499 entries) named 173 of them. Two openly licensed lists, the AdGuard companies database (CC BY-SA 4.0) and EasyPrivacy, name 489 of the other 982, which covers about two thirds of the page-contacts the hand-kept list missed. They are now bundled (36,803 domains) and read in the background; on the 195 replayed pages they name a median of 4 more outside companies per page, on 157 pages. As a flag this raised the count on 154 pages and was the only flag on 41, so it is a quiet note. The hand-kept list was never audited before: against the big lists, 420 of its 499 entries appear somewhere; the 79 that appear nowhere are mostly the dark-pattern vendors no public list labels (fake social-proof pop-ups, countdown widgets), which is what it is for. The audit also found wrong hosts: LogRocket, TrustPulse, FingerprintJS, Mixpanel, Yandex's session recorder and ClickTale loaded from hosts the list lacked; added. Still missed: many ad exchanges that no open list carries (a-mo.net, loopme.me, adkernel.com and others seen on 15 to 30 pages each). DuckDuckGo Tracker Radar, Disconnect and Ghostery are non-commercial and are used only as references.

**Privacy policies and terms.** Commands: `eval/policy-claudette.js` (CLAUDETTE-142: 142 terms of service tagged by legal experts; research use only, kept outside the repository) and `eval/policy-opp115.js` (OPP-115: 115 privacy policies annotated by law students; same terms). Documents were split in half by a hash of the file name; rules were written on one half and scored once on the other.

| rule | data set | held-out documents with the clause | found | precision |
|---|---|---|---|---|
| forced arbitration (existing) | CLAUDETTE | 26 | 20 | 100% |
| can change terms on its own (widened) | CLAUDETTE | 73 | 59 (was 18) | 100% |
| using the site counts as agreeing (new) | CLAUDETTE | 69 | 53 | 96% |
| can close your account at will (new) | CLAUDETTE | 70 | 57 | 100% |
| can remove your content at will (new) | CLAUDETTE | 54 | 32 | 97% |
| disputes in a court they chose (new) | CLAUDETTE | 59 | 49 | 96% |
| limits what they owe you (new) | CLAUDETTE | 74 | 59 | 98% |
| the law they chose (new) | CLAUDETTE | 68 | 50 | 96% |
| data passed on in a merger or sale (widened) | OPP-115 | 35 | 29 (about 41% before) | 100% |
| ignores Do Not Track (new) | OPP-115 | 13 | 9 | 82% |
| shares for partners' marketing (existing) | OPP-115 | 31 | 2 | 100% |
| location data (existing, precise location only) | OPP-115 | 28 | 2 | 100% |

A reader bug was found on the way: sentences written in capitals were skipped as if they were headings, and most liability disclaimers are written in capitals. Fixed; the liability rule went from 44% to 83% of documents on the development half. The change rule's wording was also corrected: it said "without notice", but the widened rule also finds changes that come with notice, so it now says only that they may change the terms on their own. The new clause types appear in most big companies' terms, so they are quiet notes. Weak spots that remain: sharing for marketing and location data are found in fewer than 1 in 10 policies that have them.

**Detecting word tricks on the reader's machine.** No published model or local method came close to the bar. The best small fallacy model labelled 82% of plainly factual news sentences as fallacies, the same rate as real fallacies. The one dark-pattern model with a usable licence flagged 905 of 8,506 short text pieces on honest trust-marked shops (about 1 in 9), mostly product names and prices. Published state of the art is far below the bar too (persuasion techniques: micro-F1 0.38 in SemEval-2023). Rhetoric stays with Deep analyze. A local model could at most pick which sentences Deep analyze reads first.

**A shop's own other pages.** Commands: `eval/seller-pages-fetch.py` (archived copies of each test shop's contact, legal-notice, terms and about pages, robots.txt and sitemap, from the Internet Archive only; then a second pass fetching exactly the pages the extension asked for), `eval/scam-run.js` with and without `NO_SELLER_PAGES=1` on the same code, and `eval/seller-pages-compare.py`. On honest trust-marked shops with archived own pages (59), reading those pages removed 6 of 16 "no phone" statements and 1 of 4 "no company name" statements; it read own pages on 19 of them (the archive lacks the rest). On listed shops (58) almost nothing changed (no phone 48 to 47, no company name 24 to 23; own pages read on 48): they really do not name anyone. The top line did not change on either side. Every company name the check reported (9) appears in the archived page it came from. The first version named a bank (a shop's financing partner), glued words from neighbouring lines onto names and accepted a fake US address as a company; names are now read one line at a time and banks, payment and financing firms are excluded. Limits: the Internet Archive throttled the test machine for hours, and archived pages miss content a live visit would load.

**Scam patterns.** Command: `eval/scam-patterns-eval.js` with archived scam pages (Beyond Phish: 2,849 pages of 5 KB or more; no licence, kept outside the repository; split by domain hash). One rules file (`rules/scam-patterns.json`) now holds six families: fixed high returns, send crypto get double, prize to claim, fee to release a parcel, recovery offers, pay to earn from tasks. Each states what the page says and quotes it.

| pattern | development pages | held-out pages | false alarms on 216 ordinary, 180 honest-shop and 362 listed-shop pages |
|---|---|---|---|
| fixed high returns | 14 | 7 | 0 |
| send crypto, get double | 3 | 0 | 0 |
| the other four | 0 | 0 | 0 |

The first fixed-returns version also fired on three honest look-alikes written as probes (a trading-card flash sale "20% for 48 hours", "70% daily deals", a software page's "300% ROI"); it now needs the percentage in the same sentence as deposit, investment, plan, principal or withdrawal words, and stays quiet on those and on a savings APY, a hotel offer and crypto staking. The figures above are for that version, which is promoted; the others stay held, because the archive has too few such pages to measure them (it is mostly fake shops). Two patterns first fired on ordinary pages ("Failed delivery logs" in a feature table; "Congratulations to the people of Montana" in a news story) and were narrowed so their words must sit in one sentence. The crypto-doubling wording was narrowed after its held-out hits turned out to be investment sites, so its held-out zero is not independent.

**Warning lists.** France's financial markets authority (AMF) blacklists are added: 2,407 sites with category and listing date, Licence Ouverte 2.0. The first build put t.me, calendly.com, tuta.com and the AMF's own domain on the list, because rows about impersonators list the services they used; e-mail rows in the impersonation categories and links to accounts on a platform are now left out. Of the top 100,000 sites, 11 remain listed, all crypto or forex platforms the AMF says operate without authorisation in France.

**Who runs the site.** Command: `scripts/build-operators.py` over the sellers.json files of 27 ad exchanges (fetched 6 November). 17,831 domains get the company name on their ad-exchange contracts; only names with a legal form are kept, and names that are a person's first and last name are dropped. Of 61 domains also in the hand-checked outlet table, 50 share a name word with it; the others are mostly the operating company under a parent (WP Company for the Washington Post, NYP Holdings for the New York Post), and one single-listing row was plainly wrong (msn.com). So the summary line says "run by X" only when two or more exchange listings agree (3,795 domains); on the ordinary pages that happened on 4, all correct (Spotify AB, Groupon, Heise Medien, WebMD). Ultimate owners still need a registry (GLEIF, Companies House) or the hand table.

**Private equity owners.** 110 sites whose top owner Wikidata names as a private equity firm (for example Apollo for Yahoo, KKR for Medscape, Alden Global Capital for the Denver Post) show in the Source card as an unchecked lead with no date. The Wikidata mirror refused the request, so the dated version (when the firm bought it, with a reference) is not built yet. Research on buyouts finds effects that differ by industry, so the card says only that.


## 12. Investigate on real pages: current versus proposed, 16 November 2026

Why: an outside review (ChatGPT, passed on by the owner) set the bar as "the most important supported thing that changes how I should understand this page, briefly, with evidence I can inspect", and asked for relevance-first context, several candidate points before choosing, the evidence the product already has (with scope), short output, a cheap-model check, and a real-page test with an untouched holdout.

What changed in the product: the owner card and the top line mention an outlet's owner or funders only when the page names them (`MLCommon.outletMentions`); Investigate receives the facts Subtext already has, each labelled with its scope (`MLCommon.productObservations`; tracker lists and unchecked owner leads are left out); the planner names two or three candidate points with how directly each is supported (direct, indirect, weak: weak means the evidence shows only that something could happen); the lead is about 20 to 35 words; ordinary pages get ordinary readings; the screen accepts up to five quotes and drops a "how it works" line that repeats the lead; every stage has a 12,000-token ceiling and one retry when an answer is cut off.

Set: 42 real pages captured on 16 November (news, opinion, recipes, sponsored, affiliate, funnels, research, small business, syndicated, launches, subscriptions, political), split by name hash into 25 development and 17 holdout pages. The holdout was not looked at while the prompts changed, up to its first run. After that run, two changes were made because of holdout pages (the retry, from the cystic fibrosis feature; the support grades and the script wording, from the Food Network recipe), so the holdout is no longer untouched: the first-run line below is the clean result, and the next prompt change needs freshly captured pages for a clean holdout. Captures, runs and the side-by-side page are in the git-ignored `eval/out-inquiry-real/` (third-party text; local only). Rebuild the page with `node eval/review-package.js`.

Commands: `node eval/inquiry-real.js run <capture> <arm>` with `INQUIRY_BACKEND=production` (the extension's own request code, Anthropic API), `INQUIRY_OBSERVATIONS=1` for the proposed arm, `INQUIRY_IMPL=<file>` to run another copy of `inquiry.js` (the current arm used the committed version); `node eval/inquiry-onepass.js <split> <half> final` for one model call with the same page, the same Subtext facts and the same documents the proposed run read.

| half | arm | pages | reading shown | mean cost per page | median time | median lead words | median lead + how-it-works words |
|---|---|---|---|---|---|---|---|
| holdout | current Investigate (Haiku 5.5) | 17 | 8 | $0.0042 | 20 s | 46.5 | 86.5 |
| holdout | one pass, same evidence (Haiku 5.5) | 17 | 17 | $0.0018 | 7 s | 33 | 56 |
| holdout | proposed Investigate (Haiku 5.5), first run, clean | 17 | 16 | $0.0060 | 21 s | 33.5 | 62 |
| holdout | proposed Investigate, committed code (after the two holdout-prompted changes) | 17 | 16 | $0.0063 | 25 s | 37 | 66.5 |
| development | current Investigate | 25 | 16 | $0.0040 | 21 s | 49 | 89 |
| development | one pass, same evidence | 25 | 23 | $0.0019 | 7 s | 32 | 57 |
| development | proposed Investigate | 25 | 24 | $0.0060 | 25 s | 35 | 65.5 |
| development | proposed Investigate on Sonnet 5.5 (same committed code) | 25 | 25 | $0.0891 | 18 s | 37 | 67 |

Prices are the published ones (Haiku 5.5 $0.10 in and $0.50 out per million tokens, Sonnet 5.5 $2 and $10). The cost of a call that failed (cut off) is not counted, because the transport throws before it returns usage. Times are wall-clock on one Mac: the staged arms ran four pages in parallel, the one-pass arm one page at a time, so its times were measured under less load. The one-pass lines are its runs with the committed code; its first holdout run (before the holdout-prompted changes) showed 17 of 17 at $0.0018, 7 s, 29-word leads.

What the numbers do not show, from reading the leads (no scores; read `review-package.html`):
- The current version fails on about half the pages: three answers were cut off by a 2,200 to 6,000 token limit, and the screen rejected others. Cause of the cut-offs: Haiku 5.5 thinks adaptively at medium effort and thinking counts against the limit; one review used 4,075 thinking tokens. One rarer runaway draft filled 16,000 tokens and then finished three times in under 3,500, hence the retry.
- The proposed leads more often name the point that changes the reading: CNBC and CNN reporting on their own parent companies, the Fortune author's firm selling the advice, the research population behind a cancer-test figure, Novartis behind a trial, the Medicaid rule's added impairment test, which personal data a 24-hour deletion promise does not cover.
- One pass with the same evidence is a third of the cost and a third of the time and almost always passes the screen, but its leads are more often plain descriptions ("Spotify's Premium page offers one free month...") and in the last run it added owner facts the page did not make relevant on four pages (the Guardian column's ownership, Ziff Davis on two buyer's guides, Sleep Doctor Holdings) and led the Food Network recipe with the link-rewriting script. The proposed staged run did neither in its last run. The stored captures still carry the old script wording ("rewrites links so the publisher earns on purchases"); `trackers.js` now says the script is loaded and no affiliate links were found, which applies to new captures. Which of the two to ship is the owner's call after reading the page.
- Sonnet 5.5 leads are sharper on several pages (the CNBC "beat" headline against year-over-year declines; where CNN's parent disclosure sits) at about 15 times the cost per page and no extra time.
- Run-to-run variation is large: the same page can lead with a different point on the next run (Food Network: a link-rewriting script, then a review summary shown beside "0 reviews"). Spotify and the cystic fibrosis feature each failed on one run and passed on another.
- Known wrong or doubtful leads: the Guardian Wales rail feature says no company is named as sponsor, because the sponsor's logo is an image the text capture cannot read; the Food Network "0 reviews" lead is true of the captured text but may be a ratings widget that had not loaded. CNN's outlet record names its old owner (the page says Skydance is the parent); the Fox opinion page's rules-only line says "commissioned recommendation page", and some rules-only lines omit the page's paid label; the named-operator rule took a cookbook credit ("Ina Garten, Clarkson Potter/Publisher") as the site's operator. These are listed, not fixed.
- Not done: historical and distribution context (what else the outlet or the people named have said, where the item spread). It needs the provider's web-search tool and its own test.

## 13. Fresh pages: does Investigate pick what matters? 16 November 2026

Why: a second outside review (ChatGPT, passed on by the owner) said the work was proving operation (completion, length, cost) rather than editorial judgment, and asked: did Subtext identify the most consequential supported connection, and avoid distracting the reader with weaker ones? The owner asked for owner relevance to follow the owner's interests (his example: an article about not taxing billionaires at a paper owned by a billionaire), for every strong point rather than one, and for Sonnet on his key.

Set: 43 real pages captured on 16 November, none used before (owner-interest pages and controls at the Boston Globe, TIME, CBS, NBC and Fox; Guardian Labs paid features; opinion pages with sponsored-story widgets; AP copy on a local station; affiliate guides; recipes; subscription and small-business pages; advocacy pages). For each page, what a careful reader should get from it was written before any run (`eval/out-inquiry-real/fresh-set.json`). Ten first picks were dropped because the capture was blocked or empty (Washington Post, Bloomberg, phys.org) and four replaced. The rules layer was corrected after a first capture of these pages (paid labels in side columns, first names and month names in owner matching, "taxing wealth", sponsor logos); the AI arms in the first round were not tuned on them.

How it was judged: three independent AI readers (Fable) each took a third of the pages, saw each arm's output under a random letter with the captured page and the written expectation, and noted with quotes whether the expected point was up front, only on request, or missed; unsupported claims; distracting or repeated sentences; and claims that something is missing which may only be outside the capture. These are one reader's notes, not grades. The page `eval/out-inquiry-real/fresh-package.html` (local only; `node eval/fresh-package.js`) shows every output and note.

| arm | readings shown | background search ran | expected point up front | only on request | missed | unsupported claims | distracting or repeated | leans on a possibly uncaptured absence | mean cost | median time | median words shown first |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sonnet 5.5, planner decides on search (default) | 42 | 2 | 35 | 1 | 7 | 7 | 24 | 9 | $0.107 | 20 s | 75.5 |
| Sonnet 5.5, always searching | 40 | 43 | 36 | 1 | 6 | 16 | 20 | 9 | $0.155 | 27 s | 83.5 |
| Sonnet 5.5, no search | 41 | 0 | 34 | 1 | 8 | 14 | 23 | 12 | $0.103 | 20 s | 73 |
| Haiku 5.5, same pipeline | 38 | 12 | 25 | 2 | 16 | 14 | 31 | 15 | $0.016 | 35 s | 49.5 |
| Committed version before today (a2db5c4), Haiku | 37 | 0 | 29 | 2 | 12 | 12 | 22 | 13 | $0.007 | 25 s | 37 |

What this says:
- Sonnet finds the point that matters clearly more often than Haiku (35 against 25 to 29 of 43). On this evidence the cheaper model does not meet the bar; Sonnet stays the default.
- Searching on every page found the point on one more page and added unsupported claims; the planner's choice (search on few pages) is kept. The two Sonnet arms with almost no search differ by 7 unsupported claims, so differences of a few counts are run-to-run noise.
- Haiku on the new multi-point prompts did worse than the committed Haiku version; the new instructions suit the stronger model.
- Patterns the readers saw in every arm: leads spent on what the capture could not see; "no source" said of figures whose links were stripped; useful background found and not passed on (a study not yet peer reviewed; a ballot measure already defeated); boilerplate treated as a finding; points that repeat the lead or raise a concern and withdraw it; the owner named without the reason it matters; AP copy never named as AP's. No output read a sponsored-story widget as making a page commissioned; the Guardian paid features were read through to "the sponsor co-funded the study and sells the pass".

Changed because of it (so these pages are no longer unseen for the AI either): a supplied owner connection is stated as a point unless it plainly does not bear on the item; wire and republished copy is detected by rules (byline or copyright line of AP, Reuters or AFP, "originally published by"; photo credits do not count) and leads the summary line; prompts forbid tool words (capture, snippet) in the lead and points, calling linked figures unsourced, boilerplate as findings, withdrawn concerns, leads that refer to things not yet shown; background that changes what the page means now is reported. A product-photo image from a shop's CDN no longer makes a news page "a Shopify store".

Round 2, same pages (tuned on them, so this checks the fixes, not how they generalise): the default re-run after the changes above, on a fresh capture of the same 43 pages, compared blind with the round-1 default by two more AI readers, two versions per page in random order.

| | preferred by the reader | expected point up front | missed | unsupported claims | distracting or repeated | possibly uncaptured absence | no reading | mean cost | median words shown first |
|---|---|---|---|---|---|---|---|---|---|
| Sonnet default, round 1 | 14 | 32 | 9 | 10 | 37 | 13 | 1 | $0.107 | 76 |
| Sonnet default, round 2 | 24 | 34 | 8 | 12 | 26 | 10 | 3 | $0.108 | 79 |
| the same | 5 | | | | | | | | |

The owner connection now appears on all four billionaire-tax pages ("TIME is owned by billionaires Marc and Lynne Benioff"), and AP copy leads the rules line. These readers counted the round-1 output differently from the round-1 readers (32 against 35 up front): reader variation is real too. After this run, tool words ("the captured text", "snippet", "page-level scan") became a code gate: the lead and limits are reworded to "the page" and a further point that leans on them is dropped (on the round-2 output it would reword 5 of 40 leads and drop 4 of 63 points).

Still open: three pages got no reading at all, CBS's report on its own parent's deal among them, even where the background search had found the point (the review rejects the draft and nothing is shown); concerns raised and withdrawn in one sentence still appear; "no price" was said of a page that shows one (Grammarly); very long pages are cut at 30,000 characters for the readers. A clean measure of these changes needs another set of unseen pages.

After round 2, three causes of blank readings were found in the code, not the model: the reviewer had kept or revised each draft, then the screen refused it. A quote did not match because the page markup left a space before a full stop ("office ."); the name guard refused "Canadian" (the page said CAD) and "Democratic" (the page said Democrats); it refused "Semafor" for a document from semafor.com. Quotes now match across spacing before punctuation, nationality and party adjectives pass, and a source's own site name counts. All three stored drafts pass the screen now; an invented organisation is still refused. The live extension path was also checked on a local news page with a video player (KSAT, AP copy): the page-change check aborted every run because the player's buttons ("Keep Watching 9", "Watch More") come and go; buttons now get the same tolerance as body text (at most two or 10% may change, half must remain, digits ignored), and Investigate completed in 23 s for $0.12 on Sonnet. Cost estimate recalibrated from these runs: about 41,000 tokens in and 2,500 out, about 11 cents.
