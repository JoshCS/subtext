# Subtext threat model

Version 0.1 (4 Nov 2026; counts and row 7 of the table in section H updated 17 Nov 2026). Scope: the extension in `extension/`, the rule base in `extension/rules/`, the ownership dataset `extension/data/outlets.json`, and the Subtext name. Sources are the research notes in `research_notes/Subtext manipulation detection landscape/` (chiefly `trackers_charts_reviews_evasion.md` §4, `warning_ux_licensing_governance.md` §B3, `dark_patterns_regulation_detection.md` KQ3/KQ5). The notes are not in the public copy of this repository. Figures the notes could only read from search snippets are marked *(snippet)*; claims they left unverified are marked *(unverified)*.

The founder's concern is copying and dual use. Both are real. The research says two other threats will hurt first: **the extension is detectable, so sites can serve it a clean page**, and **false positives can be manufactured to discredit it**.

## A. Assets and adversaries

**What we protect:** the user's attention, money and data. **Project assets:** the rule base (86 text regexes, DOM thresholds, 511 vendor domains, 30 policy clauses, 134 outlets), any future labelled corpus, and the name's reputation for accuracy. A detector believed to be wrong is worthless even when right.

| Adversary | Goal | Capability |
|---|---|---|
| Manipulative sites | Keep the pattern, lose the flag | Full control of DOM, CSS, scripts, server |
| "Optimisation" consultants and CRO vendors | Sell flag-free funnels; 48 social-proof and countdown vendors in `trackers.json` already sell the pattern | Iterate against Subtext at scale |
| Cloners, commercial forks | Rebranded or paid copy | Trivial: everything is public JSON and JS |
| AI-assisted copiers | Regenerate rules and UI without attribution | Code LLMs emit memorised licensed code ([arXiv 2308.09932](https://arxiv.org/pdf/2308.09932)); the DMCA §1202(b) remedy was foreclosed by the Ninth Circuit on 16 Sept 2026 ([opinion](https://www.courthousenews.com/wp-content/uploads/2026/09/doe-vs-github-ninth-circuit.pdf)) |
| Discreditors | Make Subtext flag honest pages; sue over an ownership label | Planted text, fabricated dataset rows, defamation claims |
| Subtext itself | Leak browsing or API keys; fingerprint users | Runs on every page with `<all_urls>` |

## B. Evasion, layer by layer

The ad-block literature transfers: keyword and selector rules get paraphrased or randomised, perceptual detectors get adversarial perturbations, and behaviour/flow features hold up best (WebGraph cut adversary success from "near-perfect" against AdGraph to "around 8%", [spring-epfl/WebGraph](https://github.com/spring-epfl/WebGraph)). Anti-adblock scripts ran on 6.7–9% of top sites a decade ago ([Nithyanand 2016](https://arxiv.org/pdf/1605.05077); [Iqbal 2017](https://par.nsf.gov/biblio/10073730-ad-wars-retrospective-measurement-analysis-anti-adblock-filter-lists); both *snippet*), and circumvention services now randomise URLs, DOM and CSS, forcing procedural matchers such as uBO's `:has-text` and `:matches-attr` ([CV-Inspector](https://par.nsf.gov//servlets/purl/10288360); [uBO wiki](https://github.com/gorhill/uBlock/wiki/Procedural-cosmetic-filters)). For calibration, screenshot-level dark-pattern detectors reach micro-F1 ≈0.73 on mobile but ≈0.50 on websites (DPGuard, [arXiv 2501.13351](https://arxiv.org/html/2501.13351v3)); AidUI reports precision 0.66 ([repo](https://github.com/SageSELab/AidUI)). The notes found **no** peer-reviewed work on evasion of dark-pattern detectors specifically; the table below is inference from our own code.

Test for each layer: does evading it also remove the harm? Where it does, evasion is the product working.

| Layer (file) | To evade, a site must… | Cost | Harm removed? | Robustness |
|---|---|---|---|---|
| **Text regex** (`text.js`, 86 rules over the visible-text index) | Paraphrase ("3 remain" beats `only \d+ left`); put copy in CSS `::before` content, images, SVG `<text>` or canvas (all skipped by the index); split phrases across blocks; homoglyphs break `\b` | Trivial, though blunt phrasing is what works on humans | No | Lowest. Spam filters have lost to HTML/CSS obfuscation since 2006 ([VB2006](https://www.virusbulletin.com/conference/vb2006/abstracts/game-goes-analysis-modern-spam-techniques/)); SpamAssassin gives a rule "a few months" ([PublicRules](https://cwiki.apache.org/confluence/spaces/SPAMASSASSIN/pages/119545167/PublicRules)) |
| **DOM / visual** (`dom.js`) | Hashed class names defeat `[class*="cookie"]` candidates; `role=checkbox` evades `input:checked`; images for button text; shadow DOM (nothing pierces it); iframes (`all_frames:false`) | Low–medium | Partly: the computed-style comparisons (area, contrast, font, background) are evaded only by making reject as prominent as accept, unticking the box, shrinking the overlay | Medium-high for measurements, low for name-based selection |
| **Behaviour over time** (`behavior.js`) | Countdown digits in SVG/canvas/images, or persist the fake deadline per visitor in a cookie so the reset check passes (vendors already do). Overlays, infinite scroll, autoplay, title bait: stop, or hide in a shadow root | Medium | Mostly yes | Highest: the WebGraph lesson |
| **Network / vendor** (`trackers.js`) | Self-host or first-party-proxy the widget; `performance.clearResourceTimings()` hides dynamic loads from `collectUrls()` | Trivial for a countdown widget, costly for ad-tech | No | Medium; the durable version is flow-based (storage writes, identifier sharing) via `webRequest`, not yet used |
| **SVG chart analysis** (`charts.js`) | Export text as paths (Illustrator default), canvas, or raster; Subtext emits a severity-0 "not inspectable" note | Trivial | No | Low |
| **Policy scan** (`incentives.js`) | Reword; serve PDF or a JS-rendered shell (relay accepts only `text/html`/`text/plain`) | Trivial | No | Low |
| **Dataset lookup** (`outlets.json`) | New or mirror domain | Trivial | Hiding ownership is what `transparency.js` flags | Coverage-bound (134 rows) |
| **LLM semantic** (`ai.js`) | Paraphrase fails. Attacks: instructions in page text; hidden text (§E); style bias toward polished copy | Medium | No | Medium-high against lexical evasion, weakest to adversarial text. Models are fooled by dark patterns ~41% of the time ([arXiv 2510.18113](https://arxiv.org/abs/2510.18113)); UX experts recalled 198/200 patterns vs five LLMs 383/500 ([AI and Ethics 2026](https://link.springer.com/article/10.1007/s43681-026-01151-x)) |

Two cross-cutting holes: anything in an iframe is invisible (many CMPs render in one), and the 200k-character cap lets a long visible preamble push checkout copy out of the index.

Ranking, most to least robust: behaviour over time; computed-style DOM measurements; vendor matching (once moved to request observation); LLM reading; dataset lookup; SVG axis checks; policy regex; text regex and name-based selectors. The inverse of today's rule count (86 text rules, 13 DOM checks, 6 behaviours).

## C. Detect evasion as a finding

Each evasion leaves a trace worth showing the user, provided the finding is honest about confidence. Proposed rules:

- **`evasion.pseudo_element_copy`**: run the urgency/scarcity/social-proof rules over `getComputedStyle(el, '::before'|'::after').content` in pricing/CTA containers. Nothing legitimate puts "Only 2 left" in a stylesheet. Sev 2, conf 0.8.
- **`evasion.hidden_disclosure`**: a sponsored/affiliate/"may earn a commission" string in the DOM that fails visibility (`display:none`, opacity 0, font <9px, contrast <3:1, clipped 1px box, off-screen, alt-text only): a disclosure for regulators, not readers. Sev 2, conf 0.85; extends the tiny-label check in `dom.js` step 6.
- **`evasion.text_as_image`**: `<img>` whose alt or filename matches a text rule inside a checkout/pricing container. Sev 1, conf 0.5; hero banners make this noisy.
- **`evasion.opaque_ui`**: an element covering >20% of the viewport with painted area but no text nodes or inspectable children (canvas, or a closed shadow root, which a content script cannot distinguish from nothing). Sev 0 unless in checkout/consent context; video players and maps are the false-positive class. Separately, traverse *open* shadow roots everywhere.
- **`evasion.randomised_consent_dom`**: be sceptical. Hashed classes are what CSS modules emit, so entropy is not evidence. The usable signal is differential: hash the consent dialog's structure per site and flag markup that churns between visits while the text stays constant. Sev 0, conf 0.5.
- **`evasion.anti_adblock_wall`**: an overlay whose text matches `ad ?block|disable .{0,20}(blocker|extension)|whitelist (us|this site)|allow ads`. Obstruction; precedent is EasyList's Adblock Warning Removal List ([antiadblockfilters](https://github.com/easylist/antiadblockfilters)). Sev 1–2.
- **`evasion.extension_probe`**: `#ml-badge` or `.ml-flag` present before Subtext creates it means the page is baiting for us. Sev 2, conf 0.9; keep it after our identifiers are randomised (§F).
- **`evasion.cleared_timings`**: zero `resource` performance entries while the DOM holds ≥5 external scripts or images. Sev 1, conf 0.6; perf tooling sometimes clears legitimately.

Extension enumeration by the page is **not** reliably detectable from a content script; the honest answer is the 24 fingerprinting vendors in `trackers.json` plus making ourselves hard to see.

## D. Dual use: does publishing the rules teach bad actors?

1. **The taxonomy is already public.** Brignull's types ([deceptive.design/types](https://www.deceptive.design/types)), Gray et al.'s 64/65-type ontology ([article](https://deceptive.design/articles/an-ontology-of-dark-patterns-knowledge-foundations-definitions-and-a-pathway-for-shared-knowledge-building)), the FTC's 2022 report ([ftc.gov](https://www.ftc.gov/reports/bringing-dark-patterns-light)) and the OECD's 2022 categories ([doi](https://doi.org/10.1787/44f5e846-en)) name every pattern we detect, with examples; the vendors in `trackers.json` sell them as a service.
2. **Our marginal uplift is "which phrasings trigger".** That launders copy past the regex layer, already ranked least robust, and does nothing against behavioural, structural or LLM detection, where the only evasion is to stop.
3. **Secret rules do not stay secret.** SpamAssassin's two-decade position: a secret ruleset is security through obscurity; spamware shipped features to evade AOL's *secret* filters, reverse-engineered without source; open rules "get reviewed and improved by more people" ([PublicRules](https://cwiki.apache.org/confluence/spaces/SPAMASSASSIN/pages/119545167/PublicRules); ["Wouldn't a secret ruleset work better?"](https://cwiki-test.apache.org/confluence/x/Tx0gBw)). Our rules run client-side and store policy forbids obfuscation ([policies](https://developer.chrome.com/docs/webstore/program-policies/policies?hl=en)), so secrecy is unavailable anyway. The notes found **no empirical study** of the trade-off; this is community experience.
4. **The real dual-use product is a feedback loop**: "run Subtext on my funnel until it is green." For honest teams a linter; for others, lexically laundered pages that still exploit, which the LLM and behavioural layers exist to catch.

**Policy.**

- Publish mechanisms and rules; quality comes from cadence and review.
- Keep a **small private hold-out set for evaluation only** (20–50 saved pages, never shipped, never used for detection): a thermometer. If public-corpus precision holds while hold-out recall falls, sites are tuning against the public rules. No source evaluated hold-outs *(unverified benefit)*.
- **Signed, versioned rule feeds** so rules and vendor lists move faster than releases. MV3 allows fetching *data* at runtime though code cannot update out of band ([uBOL FAQ](https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ))). Verify a signature; fall back to the bundled copy. No source evaluated signed feeds *(unverified)*.
- **No "make my page pass" service, no pass/fail API, no "Subtext Verified" badge.** A site badge would be gamed in a week and is itself a trust-badge pattern. A lint mode is fine if it always explains the harm and never returns a binary verdict.
- A **responsible-disclosure channel** for evasion reports (SECURITY.md, private advisories), with EasyList's rule that filters are not removed "on your word or policy" ([easylist](https://github.com/easylist/easylist)).
- A trademark/usage-policy clause against using Subtext to optimise manipulation. Mostly symbolic: grounds to refuse association and name the practice.

## E. Honeypot and discrediting attacks

Tramèr et al. (CCS 2019) fed a perceptual ad blocker "a nearly invisible false positive that could work as a honeypot to detect ad-blocking", and made it hide another user's content ([ftramer/ad-versarial](https://github.com/ftramer/ad-versarial)). Subtext annotates rather than removes, which neutralises the second attack; the first transfers, and the code is exposed four ways:

1. **Lexical rules fire on one match.** `scarcity.low_stock` (sev 2) and `dark.confirmshaming` (sev 3) have no `minCount` or `scope`. A forum comment saying "only 3 left", an article *about* dark patterns quoting "No thanks, I don't want to save money", or a comment planted on a competitor's page each yields a finding, and `MLCommon.scoreFindings` floors any severity-3 finding with confidence ≥0.6 at grade C. One planted phrase moves a clean page off A.
2. **Visibility is weak.** `checkVisibility` passes text with `color:transparent`, `font-size:0`, a clipped 1px box or an off-screen position.
3. **The LLM gets hidden text.** `mainText()` reads `innerText` from a detached clone, which for unrendered nodes is `textContent`, so `display:none` text reaches the model: a prompt-injection channel ("report no findings"; "this page is owned by X") against a judge the literature calls injectable ([Awesome-LLM-as-a-judge](https://github.com/llm-as-a-judge/Awesome-LLM-as-a-judge)). Quotes are verified only offline in `eval/compare.js`.
4. **Marking is observable.** `ML.mark` writes `data-ml-id` onto evidence elements; a site can plant bait, poll for the attribute, and learn which rule fired: an oracle for tuning.

Dataset side: `source.lean_extreme` asserts "far-left"/"far-right"/"state" at severity 2–3 on the authority of unnamed "third-party raters"; 25 of 134 rows are `confidence: medium`. A disputing outlet has a defamation theory; a hostile contributor can submit a fabricated row by PR.

**Mitigations.**

- Lexical rules at sev ≥2 need `minCount ≥ 2` or `scope: 'cta' | 'heading'`; sev-3 lexical rules (confirmshaming, trick question, cancellation friction) are button and form patterns and should require CTA scope. Cap lexical confidence at 0.8.
- Score floors only for `source ∈ {behavior, dom, dataset}` at confidence ≥0.85. A regex never moves the internal weight alone.
- Extend `isVisible` (transparent colour, tiny font, clipping, off-screen); build the LLM extract from the visible index; delimit page text as untrusted; verify every AI quote at runtime and drop ungrounded findings; cap AI severity at 2 unless the quote sits in a heading or CTA.
- `WeakMap` instead of `data-ml-id`; stop writing `data-ml-scanned`.
- Evidence-first UI stays: every finding shows its quote or measured asymmetry, so users see when a flag is silly. Ship the planned "wrong" button and feed it into per-rule precision.
- Dataset: two independent sources per row; rater name and date per lean label, or rater links only (`PLAN.md` §10, decision 3); "state-controlled" only from official designations in `docs/DATA-SOURCES.md`; a published correction/takedown address with 72-hour acknowledgement; medium rows re-verified before store release. Say "discloses X", never "is trustworthy", as IPTC advises for self-asserted trust markup ([IPTC](https://iptc.org/std/guidelines/trust-and-credibility/)).

## F. Extension fingerprinting and user privacy

Carnus automated behaviour-based fingerprints for 29,428 extensions ([NDSS 2020](https://dev.ndss-symposium.org/?p=5911), *snippet*); 6,645 of 116K Chrome Web Store extensions inject a stylesheet on every page, 1,074 of them not previously fingerprintable ([Laperdrix, USENIX 2021](https://www.usenix.org/conference/usenixsecurity21/presentation/laperdrix), *snippet*); personalised extension behaviour uniquely identified 25% of users in a pilot ([ACSAC 2024](https://securitee.org/files/multifp_acsac2024.pdf), *snippet*). Subtext v0.1 is detectable by every method:

*Status 5 Nov 2026: the `overlay.css`, `drawBadge` and `web_accessible_resources` vectors below are closed (H1 to H3); they stay here as the reasoning. The policy fetch stays on load (H6).*

- `overlay.css` is injected into every http(s) page via the manifest: create `<div id="ml-badge">`, read `position:fixed; z-index:2147483646` from computed style.
- `drawBadge()` appends `#ml-badge` to `document.body` by default; `document.documentElement.dataset.mlScanned` is set on every scan.
- `web_accessible_resources` exposes `rules/*.json` and `data/*.json` to `<all_urls>` under a stable extension id, so `fetch('chrome-extension://<id>/rules/text-rules.json')` both detects Subtext and reads the live rules. `use_dynamic_url` would replace the stable id *(unverified; the notes could not read the Chrome docs)*; relaying rules from the background removes the need.
- Behavioural: ~1.2 s after idle, a GET of whatever URL the page labelled "Privacy" arrives from the extension's background worker, with no cookies and no Referer. The page's scripts and service worker cannot see it, but the server can, so a per-visitor privacy URL still makes it a beacon; likewise chart images on deep analysis.
- Personalisation: disabled categories and the badge toggle alter observable behaviour per user, the ACSAC vector.

Once detected, a site can A/B serve a clean page to Subtext users, defeating every layer at once. That is why this outranks rule evasion.

**Mitigations.** Inject nothing until the user acts (badge and highlights off by default); if an in-page pill stays, render pill, highlights and card in a closed shadow root on a host with a per-install random tag, styles inside the root, no manifest CSS; mark via `WeakMap`; drop `web_accessible_resources`; fetch policies only from the page's registrable domain, through the background worker, on load by the owner's decision (H6); never patch page prototypes.

**What leaves the browser.** Default: nothing to us (no backend) and nothing to third parties except the policy fetch, which goes to the site or whoever hosts its policy. Opt-in (`tosdrLookup`, default off): the hostname to `api.tosdr.org`, cached seven days. Opt-in (`rdapLookup`, default off, only when the outlet is unknown and the host is not a hosting platform): the registrable domain to the registry's RDAP server (found via IANA's bootstrap file, which is fetched once without any domain in it), to the registrar's RDAP server for thin registries such as .com, and to `rdap.org` only for TLDs IANA does not list; cached seven days. Opt-in (`aiWebCheck`, default off, only during a Deep analyze the user pressed): a second request to the AI provider whose web-search tool sends queries naming the registrable domain to the provider's search backend; the model's citations are shown to the user as required by the tool's terms. On click only: up to 40,000 characters of text, headings, CTAs, the origin and path without query or fragment, title, measured signals, up to four charts, the outlet line and heuristic ids (flags only) go to Anthropic or OpenAI under the user's key. Local residue: per-URL timer state in `chrome.storage.local` (a browsing trace; cap and expire it) and per-tab reports in session storage.

**Key caveat.** The API key sits unencrypted in the extension's own IndexedDB (since 16 Nov 2026; before that in `chrome.storage.local`, which content scripts inside every page can read). Only the background worker and extension pages can open it, and keys never go to a tab. It is still readable by anyone with access to the browser profile on disk. Recommend spend-limited keys and offer session-only storage.

## G. Copying and cloning

Licence and trademark are decided in `docs/LICENSING.md` (pending; `PLAN.md` §10 lists the licence as open; the governance notes argue for AGPLv3 plus a Mozilla/Debian-style trademark policy permitting unmodified redistribution and requiring renamed modified builds, [Debian–Mozilla dispute](https://en.wikipedia.org/wiki/Debian%E2%80%93Mozilla_trademark_dispute)). Assume code and rules will be absorbed into models regardless; copyright traps need ~100-token sequences repeated ~1,000 times ([Meeus et al., ICML 2024](https://proceedings.mlr.press/v235/meeus24a.html)), which no rule file carries, though fictitious outlet rows remain tell-tales for verbatim dataset copying.

The technical moats are what a snapshot cannot take: a rule base and vendor list updated weekly (a stale clone decays on SpamAssassin's months-long half-life); the ownership dataset with provenance per row; the labelled benchmark corpus (`PLAN.md` §8) with published per-rule precision; signed feeds only the canonical build trusts; community reporting on the EasyList/Consent-O-Matic model ([Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic)); the store listing tied to the mark. The archived Dapde Pattern Highlighter ([repo](https://github.com/Dapde/Pattern-Highlighter)) is the warning: good idea, project ended, nothing kept it current.

## H. Prioritised mitigation backlog

| # | Mitigation | Threat | Effort | When |
|---|---|---|---|---|
| 1 | **Done 4 Nov 2026.** `WeakMap` not `data-ml-id`; drop `data-ml-scanned`; badge/highlights off until user acts | Oracle (E4), fingerprint (F) | S | v0.2 |
| 2 | **Done 4 Nov 2026.** Pill, highlights, card in closed shadow root, random host tag, no manifest CSS | Injected-CSS/DOM fingerprint (F) | M | v0.2 |
| 3 | **Done 4 Nov 2026.** Remove `web_accessible_resources`; relay rules from background | WAR fingerprint, rule read (F) | S | v0.2 |
| 4 | `minCount`/`scope` on lexical rules at sev ≥2; confidence cap 0.8; floors only for behaviour/DOM/dataset at conf ≥0.85 | Honeypot false positives (E1) | S | v0.2 |
| 5 | **Done 4 Nov 2026.** Stronger `isVisible`; LLM extract from visible index; untrusted delimiting; runtime quote verification | Hidden-text injection (E2, E3) | M | v0.2 |
| 6 | **Decided 5 Nov 2026 by the owner: the fetch stays on load, not on demand,** so the first report can name the clauses. Done: same registrable domain only, through the background worker, no cookies, no Referer naming the page, not visible to page scripts, none for a muted site, one fetch per policy page per load, `policyScan` turns it off. Accepted risk: the server still sees the request, so a per-visitor privacy URL is still a beacon | Fetch beacon (F) | S | v0.2 |
| 7 | SECURITY.md evasion-report channel (17 Nov 2026: reports go to GitHub private vulnerability reporting and issues; there is no e-mail address); usage clause in trademark policy (not written) | Governance (D) | S | v0.2 |
| 8 | §C evasion findings | Evasion made visible (C) | M | v0.3 |
| 9 | **Open shadow roots done; frames open.** Open shadow-root traversal; `all_frames: true` with frame reports merged to top | Shadow DOM, iframe blind spots (B) | M | v0.3 |
| 10 | **Done 4 Nov 2026.** `role=checkbox`; SVG/canvas timer digits; viewport/CTA blocks before the 200k cap | Cheap DOM evasions (B) | S | v0.3 |
| 11 | Dataset governance: two sources per row, rater+date per lean, takedown process, re-verify medium rows | Defamation, fabricated rows (E) | M | before store release |
| 12 | Signed, versioned rule and vendor feed with bundled fallback | Rule half-life, stale clones (D, G) | M–L | v0.5 |
| 13 | Private hold-out eval set; per-rule precision published per release | Tuning against public rules (D) | M | v0.5, ongoing |
| 14 | Non-blocking `webRequest` observation, then flow features | Vendor self-hosting, cleared timings (B) | L | v0.5–v1 |
| 15 | **Partly: keys no longer reach tabs, old per-site data pruned while running.** Spend-limited key guidance; session-only key option; expire timer storage | Key and local-trace exposure (F) | S | v0.3 |
| 16 | Differential self-test: fixtures with and without presence signals | Clean-page A/B serving (F) | L | v1+, research |
