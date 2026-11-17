# Subtext UX specification: glance, hover, click

Status: draft for v0.2, November 2026. Scope: how findings are communicated, not how they are detected. Evidence is drawn from `research_notes/Subtext manipulation detection landscape/warning_ux_licensing_governance.md` (Part A). The notes are not in the public copy of this repository. Where that file records a gap, this spec says so instead of inventing support.

## 1. The problem

The shop fixture produced 83 findings when this was written (`npm run test:screens` writes a screenshot to `test/out/shop-popup.png`). Nobody reads 83 of anything. The UI must spend the user's attention on the three or four things that could change a decision, keep the rest one gesture away, and stay quiet enough that the user still looks after two weeks. The labels, the one-line why and the hover/click stack decide whether Subtext is kept or uninstalled.

## 2. Design principles

| # | Principle | Evidence | Consequence for Subtext |
|---|---|---|---|
| P1 | Labels work. | Martel & Rand 2024 meta-analysis (21 experiments, N = 14,133): labels reduce belief and sharing even among people who distrust fact-checkers. [IDEAS record](https://ideas.repec.org/a/nat/nathum/v8y2024i10d10.1038_s41562-024-01973-x.html), [MIT DSpace](https://dspace.mit.edu/handle/1721.1/163267) | The core gesture is a label on a specific thing, not a verdict on a page. |
| P2 | Specific beats generic. | Specific labels work better than general warnings, which also lower trust in true content (secondary summary). [FUJO review](https://fujomedia.eu/news/labelling-disinformation/) | Every tier names a technique ("Countdown timer"). No page-level "may be manipulative" banner. |
| P3 | Do not over-flag. | Implied truth (Pennycook et al. 2020): labelling some false items makes unlabelled ones more believed; the mitigation is contested. [FUJO review](https://fujomedia.eu/news/labelling-disinformation/), [Wooster 9915](https://openworks.wooster.edu/independentstudy/9915) | A visible "nothing detected by our rules" state, never an endorsement. Precision over recall. Severity 0 never wears a warning colour. |
| P4 | Static warnings become wallpaper. | Anderson et al. 2016 (fMRI, n = 25; mouse tracking, n = 80) and Vance et al. 2018 (three weeks in the field): polymorphic warnings habituate far less; four variants sufficed. [JMIS](https://jmis-web.org/articles/1304), [MISQ](https://misq.org/tuning-out-security-warnings-a-longitudinal-examination-of-habituation-through-fmri-eye-tracking-and-field-experiments.html), [summary](https://boingboing.net/2018/06/15/attentional-tragic-commons.html) | Per-page budgets, two to four phrasings, throttled repeats, no interstitials. |
| P5 | Visual design beats wording; comprehension lags. | Felt et al. CHI 2015: SSL warning adherence rose from 37% to 61–62% through visual cues, not text; comprehension stayed "lower than desired". [eWeek](https://www.eweek.com/security/google-study-shows-users-fail-to-understand-security-warnings/), [Help Net Security](https://www.helpnetsecurity.com/?p=38223) | Severity is carried by colour, shape and position; hover and click do the explaining; comprehension is tested (section 9). |
| P6 | Each flag is a mini-inoculation. | Roozenbeek et al. 2022, seven experiments, ~30,000 participants: short technique explanations improve recognition by 5–10%. [Cambridge](https://www.cam.ac.uk/stories/inoculateexperiment) | Tier 3 always carries the mechanism. Effects are modest; copy must not over-promise. |
| P7 | Reflection prompts help modestly. | Accuracy prompts improved sharing discernment by about 10% (N = 26,863). [MIT DSpace](https://dspace.mit.edu/handle/1721.1/144231) | The why-line is a prompt to reflect, not an order. Counter-moves are optional and take a minute. |
| P8 | Glance → hover → click is the proven convention. | NewsGuard: icon at a glance, summary on hover, nutrition label on click. [Wikipedia](https://en.wikipedia.org/wiki/NewsGuard), [handout](https://www.newsguardtech.com/wp-content/uploads/2023/04/NewsGuard-Library-Handout_2023-2.pdf). Dark Pita: banner plus a "show" button that highlights patterns in place. [arXiv 2310.17846](https://arxiv.org/pdf/2310.17846) | Four tiers (section 3). Markers are opt-in, as in Dark Pita. |
| P9 | Severity must be legible at a glance. | Categorical warnings beat traffic lights for understanding (27.0% vs 8.2%, n = 1,607). [PMC6024864](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6024864/). Letter grades had the best objective understanding. [Nutri-Score study](https://archpublichealth.biomedcentral.com/articles/10.1186/s13690-021-00595-3/figures/1). Summary-plus-detail labels improved accuracy and speed (n = 200). [NSF PAR 10574916](https://par.nsf.gov/biblio/10574916) | Decided 5 Nov 2026: no letter grade and no number. The pill names the strongest flag, in a colour for its severity. Gap: no study compares formats for manipulation warnings. |
| P10 | Jargon kills labels; labels must connect to an action. | iOS privacy labels failed on unfamiliar terms and no link to settings. [NSF PAR 10426770](https://par.nsf.gov/biblio/10426770) | Plain-language names. Every Tier 3 entry has a doable counter-move and a mute control beside it. |
| P11 | Hover content must be dismissible, hoverable, persistent and keyboard-triggerable. | WCAG 2.2 SC 1.4.13. [W3C](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus), [Deque](https://dequeuniversity.com/resources/wcag2.1/1.4.13-content-on-hover-or-focus) | Section 6. |
| P12 | Platform limits shape the click layer. | Chrome `sidePanel`: Chrome 114+, `open()` 116+, user gesture required, no `isOpen()`. Safari has no sidebar API. [Extension.js](https://extension.js.org/docs/implementation-guide/side-panel.md), [stefanvd.net](https://www.stefanvd.net/blog/?p=1354) | Side panel is the Chrome click layer; popup and an "open in tab" report on Safari. Nothing auto-opens. |

## 3. Information architecture

**Changed 5 Nov 2026 by the owner's decision.** There is no letter grade and no 0 to 100 score on any surface: a page cannot be boiled down to one number. The pill names the strongest flag, the badge counts flags, and the panel header says how many things to know and how many outside companies were contacted (`MLCommon.glance`). The toolbar icon opens the panel; the popup page remains as the window for pages where no panel can open. Only rules with tier `flag` in `rules/reliability.json` appear as flags.

### Tiers

| Tier | Content | Limits |
|---|---|---|
| 0 Presence | Strongest flag's label, a colour for its severity, how many more | No interruption, no motion, no grade, no score |
| 1 Warning sign | Label (1–3 words), category name in words, severity colour and shape (a triangle for severe, a dot otherwise; no emoji since the 17 Nov 2026 redesign) | Max 5 at a glance, max 2 per category |
| 2 Why | One line, ≤12 words, the most pointed reason | One idea; evidence first when the detector has it |
| 3 Detail | Technique name, explanation, mechanism, "why it works on you", evidence quotes with locate-on-page, counter-move, source links, confidence, mute and "this is wrong" controls | Unlimited, grouped by category, collapsed by default |

### What appears where

| Surface | Shows | Must not show |
|---|---|---|
| Toolbar badge | Count of flags, coloured by the strongest; title "Subtext: 3 things to know · 12 outside companies contacted" | Grade, score |
| In-page pill (bottom-right) | Dot in the severity colour plus the strongest flag's label and how many more ("Fake deadline +2"), or "Subtext" when nothing is flagged. Click: opens and closes the report panel. (Built 4 Nov 2026.) | Grade, score, "8k chars" |
| Hover tooltip (in page) | Appears only when the mouse rests 150 ms on a flagged element: ≤3 findings for that element, chip (Tier 1) + why (Tier 2); "Details" expands explanation and counter-move; "Open in panel" jumps to the full entry. Escape closes; the pointer can move onto it; it stays while hovered (WCAG 1.4.13). Anchored to the pointer when the element fills most of the viewport. (Built 4 Nov 2026.) | Evidence list, bias glossary, any mark on the element itself |
| Dot markers (in page, optional) | Behind a toggle in the panel header, off by default: an 11 px severity-coloured dot at the corner of each flagged element with severity ≥2, repositioned on scroll. | Outlines or boxes around elements |
| Report panel (in page) | Resizable box docked to the right (default 360 px wide, full height; minimum 280 × 240; drag the left edge, bottom edge or corner; arrow keys on the focused handle; size and open state remembered across pages). Header: site, how many things to know, how many outside companies were contacted. Deep analyze, rescan, settings, close. Body: the same Tier 1–3 breakdown as the popup (`extension/ui/view.js`). Hovering a finding washes its elements on the page; clicking a quote scrolls to it. Everything lives in one closed shadow root with a random host tag. (Built 4 Nov 2026; replaces the Chrome side-panel plan for Tier 3.) | Auto-open on detection |
| Source card, unknown outlet | One sentence ("Does not say who runs it: no legal pages, no address or company name, registrant hidden") and one finding, `source.unknown_operator`; "Show the checks" unfolds the provenance checklist (found / not found / could not check per row) and the one-click lookups. (Built 4 Nov 2026.) | The checklist unfolded by default; one finding per failed check |
| Report window (where no panel can open) | Same renderer as the panel. "What to know": ≤5 chip-plus-why rows. Categories collapsed with counts. Source card. AI section. | Grade, score, developer telemetry |

### States

| State | Pill | Badge | Popup |
|---|---|---|---|
| Scanning (first 1.2 s, rescans) | Hidden until first report; never a spinner on the page | Blank | "Scanning…", for ≤2 s |
| Nothing found | Small muted "Subtext" | Blank | "Nothing detected by Subtext's rules. That is not a clean bill: rules catch common patterns, not all of them." plus the Deep analyze offer |
| Severe flag present | "Fake deadline +2" in the severe colour | Count, in the severe colour | Top label first in "What to know" |
| Too little to read (<300 chars, no measured findings), or an error page | Muted "Subtext" | Blank | "Too little text on this page to read anything into it." or "An error or bot-check screen…"; on an error page, findings from policy pages and trackers are notes |
| AI not set up | — | — | Button reads "Deep analyze (set up AI key)" and opens options once; never nags |
| AI available, not run | — | — | "Deep analyze with Claude · about $0.02" (estimate moved from options to the button) |
| AI running / failed | — | — | Spinner on the button; inline error notice (exists) |
| Restricted page (browser pages, store, PDF, file) | None | Blank, title "Subtext can't read this page" | Notice (exists) |
| Site muted | None | Grey "–" | "Muted on example.com · Unmute" |

## 4. Copy rules

Labels and why-lines live in `extension/rules/labels.json` (about 170 entries). This spec's audit found no why-line over 12 words, eight labels over three words, and about ten why-lines that pass judgement instead of stating mechanism.

| Rule | Statement |
|---|---|
| L1 | A label names the warning sign as a noun phrase, 1–3 words. Quote the page's own words in single quotes when the sign is literal: `'Only N left'`, `'Experts say'`. |
| L2 | A label never accuses intent. "Fake" or "fabricated" is allowed only when behaviour evidence proves it (`urgency.fake_countdown_reset`: the timer was observed restarting). |
| L3 | No instructions, jokes or slogans as labels. |
| L4 | A why-line is ≤12 words and states mechanism or evidence. Banned: fraud, propaganda, scam, "that's the model", "against you", "wants something". |
| L5 | Evidence first when the detector saw something (behaviour, DOM, network); mechanism otherwise. |
| L6 | One idea per why-line. Second sentences are where judgement creeps in. |
| L7 | A counter-move is one sentence, starts with a verb, and can be done in a minute ("Reload the page and watch the timer"). |
| L8 | Category shorts must pass L2 too: "Trap" and "Mind games" accuse; "Dark pattern" and "Coercion" name the sign. |

| | Current (labels.json) | Verdict | Rewrite |
|---|---|---|---|
| Label | `Countdown timer`, `Pre-checked box`, `Truncated axis`, `'Only N left'` | Good: names the sign, quotes the page | — |
| Label | `Added to cart for you` | Five words | `Sneaked add-on` |
| Label | `Check the baseline` | Instruction, not a sign | `Big % change` |
| Label | `Nobody did it` | Joke; reader must decode it | `Passive voice` |
| Label | `You are the product` | Slogan, four words | `Data-funded` |
| Label | `Won't let you leave` | Accuses, four words | `Cancel pressure` |
| Why | `This timer restarted on reload. It's not real.` | First sentence is perfect evidence; second is verdict | `This timer restarted on reload.` |
| Why | `Accept is one click; refusing is buried.` | Evidence, 7 words | — |
| Why | `Sign up online, cancel by phone. That's the model.` | Judgement tail | `Sign up online; cancelling requires a phone call.` |
| Why | `Specific income promises are the vocabulary of fraud.` | Accuses | `Specific income figures with no audited basis.` |
| Why | `Your version of the page is being optimized against you.` | Intent | `Variants of this page are tested for conversion.` |
| Why | `People described as pests or floods. Propaganda.` | Verdict | `People described as pests or floods.` |

## 5. Severity and score

**Levels.** Keep the four levels in `common.js` (`Severe`, `Notable`, `Minor`, `Info`) and give each a shape: filled triangle, filled circle, ring, dot. The popup's three-dot meter is a fair non-colour cue; chips and pill have none. WCAG 1.4.1 was not fetched in the research session, so the shape rule is good practice, not a cited requirement.

**One colour scale.** Severity 3 red, 2 orange, 1 yellow, 0 grey. No finding is ever green.

**No grade, no number (owner's decision, 5 Nov 2026).** A page is not one metric. `scoreFindings` stays as an internal weight for tests, and no surface shows it or a letter. The earlier proposal here (A–F with a 0–100 tooltip, after NewsGuard) was dropped.

**Lead with the top label.** Tier 0 is the strongest flag by name. Evidence on "top 3" summaries specifically was not found; the layered-label result is the nearest support.

**What the pill says.** `Fake deadline +2`, or a muted `Subtext`. A total like "83" is the number that trains people to stop looking, so the count stays to flags that passed the reliability and evidence gates.

## 6. In-page markers

**Status, 5 Nov 2026.** Highlight-all is gone: nothing is drawn over the page by default, the hover tooltip is the only cue on a flagged element, and the breakdown lives in the in-page panel. Markers and tooltips carry a finding's label and severity, never a page grade. The optional dot markers below replace the old outlines. The resize handle follows the W3C window-splitter pattern (`role="separator"`, arrow keys, Home/End, Enter closes). Still open: a keyboard path to flagged elements themselves (UX-4).

**Default off.** Marks stay opt-in: always-on outlines become wallpaper (P4), spill onto legitimate elements (P2, P3), break sites, and Dark Pita's participants valued a "show" button they controlled (P8). The panel's marker toggle turns the dots on; the pill and the popup's button open the panel.

**Auto-show, narrowly (proposed, not built; UX-7).** Severity-3 findings with element evidence and confidence ≥0.6 get a corner glyph unasked: confirmshaming links, evergreen timers, no-reject consent banners. Cap three per page, one per element, never for lexicon rules, suppressed on a site once the user dismisses one there, off in one click from the popup. It is the only unsolicited in-page element besides the pill.

**Render as an overlay, not a class.** Done: `extension/content/ui.js` draws the locate wash and the dot markers in the shadow root from `getBoundingClientRect`, repositioned on scroll and resize in one animation frame (never polled); nothing is written onto site elements for display. The pill, panel and tooltip share that shadow root so site CSS cannot restyle them.

**Hover card (WCAG 1.4.13).** The card already dismisses on Escape, stays open while hovered, and waits 350 ms before hiding. Missing: a keyboard path. Markers get `tabindex="0"`, an accessible name ("Confirmshaming, severe, 1 of 3") and open the card on focus; arrow keys move between markers; Escape returns focus. A card holding a "Details" button cannot be `role="tooltip"` (tooltips must be static): make it a non-modal `role="dialog"` referenced by `aria-describedby`. Open on hover after 150 ms so a passing cursor does not flash cards.

**Reduced motion.** Under `prefers-reduced-motion`, drop the pill's hover translate, the ring transition and the spinner. Markers never animate: a pulsing marker is the trap the taxonomy flags as `design.animated_cta`.

**Pill placement.** Bottom-right collides with chat bubbles and cookie buttons. Let the user drag it to any corner, remembered globally; hide it in print.

## 7. Avoiding alarm fatigue

| Budget | Value | Where enforced |
|---|---|---|
| Glance chips | ≤5, ≤2 per category, severity then weight | popup `renderGlance` (today: top 5 by severity only, so all five can be red and three from one category, as in the shop screenshot) |
| Auto-markers | ≤3 per page | engine |
| Hover card | ≤3 findings per element (exists) | engine |
| Severity 0 | Collapsed into "Also noticed (N)"; excluded from category counts and bars | popup |

**Mutes, one click each.** Site (popup header), category (category header), rule (finding row: "Don't flag 'Listicle' again"). Today site and category mutes live only on the options page and rule mutes do not exist. A Tier 3 footer ("4 muted") keeps them findable.

**"This is wrong".** Two taps on any finding: wrong match, or real match but not manipulation here. Stored on this device only and exportable as JSON by the reader. Nobody at the project sees or reviews it; it reaches anyone only if the reader sends the export. The precision loop in `docs/PLAN.md` needs a sending path that does not exist yet.

**Polymorphic phrasing.** Vary the frame, not the name: labels stay fixed so users learn them; `why` becomes an array of two to four variants chosen per site and week; the pill's dot shape and the card accent rotate weekly. Four variants sufficed in Vance et al. Whether that transfers from security warnings to labels is untested, so section 9 tests it.

**Seen-before throttling.** A finding opened three times on the same site leaves the glance strip for seven days; attention partially recovered between days in Vance et al., so a weekly reset is defensible.

## 8. Onboarding and first run

| Time | What the user sees |
|---|---|
| 0 s, install | One welcome tab (`onInstalled` only saves defaults today). Left: `test/fixtures/shop.html` rendered live with the pill and three auto-markers, so the user hovers a real card. Right: three sentences ("Subtext labels; it never blocks or changes a page. Everything runs locally. AI is off until you add a key."), three toggles (pill on, auto-mark severe on, highlight-all off) and a "pin the icon" picture. |
| ~30 s, first real page | One coach mark on the pill: "Click to show what was flagged; hover a marker for why." Dismissed forever on first click. |
| ~60 s, first serious finding | Nothing extra. The marker and its card are the explanation. |

**One click from the popup:** mute site, category or rule; pill on/off; auto-mark on/off; highlight-all; this is wrong; full report; settings. Everything else (AI provider and key, scan limits, policy scan, ToS;DR, site and category lists) stays on the options page, as now.

## 9. Evaluation plan

| Study | Design | n | Metrics | Pass | Template |
|---|---|---|---|---|---|
| Comprehension | Within-subjects online task: 12 chips as Tier 1 only, then with Tier 2, then the pill `Fake deadline +2`. "Explain what this means in your own words", coded against a rubric. | 40 (Prolific) | Share of correct explanations per tier; per-label error list | ≥70% correct from Tier 1 alone, ≥85% with Tier 2; any label under 50% is rewritten | Felt et al. measured comprehension separately from adherence and ranked it higher ([eWeek](https://www.eweek.com/security/google-study-shows-users-fail-to-understand-security-warnings/)) |
| Behaviour | Between-subjects mock checkout with a pre-checked add-on, an evergreen timer and a confirmshaming exit modal. Arms: no Subtext, pill only, pill plus auto-markers. | 200 per arm pilot; ~400 per arm to detect a 10-point difference on a binary outcome at 80% power | Untick rate, "no thanks" rate on the modal, time to decision, self-reported regret | Any arm beats control by ≥10 points on untick rate | Expect 5–10% effects, as in accuracy prompts and prebunking ([MIT DSpace](https://dspace.mit.edu/handle/1721.1/144231), [Cambridge](https://www.cam.ac.uk/stories/inoculateexperiment)); the n = 200 privacy-label test ([NSF PAR 10574916](https://par.nsf.gov/biblio/10574916)) |
| Fatigue | Two-week technology probe, randomised to static or polymorphic phrasing. Local-only counters the participant exports: pill hovers, card opens, Tier 3 opens, mutes, per flagged page per day. Pre/post technique-recognition quiz and exit interview. | 20 (10 per arm) | Slope of interactions per flagged page from day 1 to day 14; quiz gain; mutes per day | Polymorphic arm's day-14 interaction rate ≥70% of day 1; quiz gain ≥5 points | Dark Pita's two-week probe with 15 participants ([arXiv 2310.17846](https://arxiv.org/pdf/2310.17846)); Vance et al.'s three-week adherence curves |

The Virginia Tech detector study (40 participants, perception only, [VTechWorks](https://vtechworks.lib.vt.edu/handle/10919/115787)) is the floor: users liked the tool; nothing shows it changed anything.

## 10. Gap list

Tickets in rough priority; files are repository-relative.

| ID | Ticket | Files |
|---|---|---|
| UX-1 | **Done, then changed 5 Nov 2026.** Pill copy: strongest flag's label and how many more; muted "Subtext" when nothing is flagged; no grade | `extension/content/engine.js` `drawBadge`, `overlay.css` |
| UX-2 | **Done 4 Nov 2026.** Glance diversity: ≤2 chips per category; severity shapes on chips | `extension/popup/popup.js` `renderGlance`, `popup.css` |
| UX-3 | Monochrome SVG category icons, severity glyphs, one colour ramp for severity | `extension/rules/labels.json` `categories`, `extension/common.js` `GRADE_COLORS`, both CSS files |
| UX-4 | Keyboard access to flagged elements: a shortcut to step through findings, focus opens the tooltip (the card is already `role="dialog"`; the panel's resize handles are keyboard-operable) | `content/ui.js` |
| UX-5 | ~~Overlay rendering in a shadow root instead of `.ml-flag` class mutation; pill and card in the same shadow root~~ Done 4 Nov 2026 | `content/ui.js` |
| UX-6 | **Done 4 Nov 2026.** `prefers-reduced-motion` for pill, ring and spinner | `overlay.css`, `popup.css` |
| UX-7 | Auto-markers for severity-3 findings with element evidence: cap 3, confidence ≥0.6, per-site dismissal, popup toggle | `engine.js`, `popup.js`, settings schema in `common.js` |
| UX-8 | ~~Chrome side panel as Tier 3~~ Replaced 4 Nov 2026 by the in-page resizable panel (works in every browser, no `sidePanel` permission) | `content/ui.js`, `ui/view.js` |
| UX-9 | Safari fallback: "Open full report in a tab" | `popup.js`, options or a new report page |
| UX-10 | **Done, then changed 5 Nov 2026.** Header: top label and counts, no grade and no score; "8k chars" removed | `popup.js` `render`, `popup.html` |
| UX-11 | **Done 4 Nov 2026.** Severity-0 collapsed into "Also noticed (N)", excluded from category counts | `popup.js` `renderCategories` |
| UX-12 | **Done 4 Nov 2026.** One-click site, category and rule mutes from the popup | `popup.js`, `options.js`, `common.js` `DEFAULT_SETTINGS`, `engine.js` filter |
| UX-13 | **Done 4 Nov 2026.** "This is wrong" per finding, local store, JSON export | `popup.js` `renderFinding`, `background.js` |
| UX-14 | Polymorphic why-lines: `why` accepts an array, variant chosen by site and ISO week; pill dot shape rotates | `labels.json`, `common.js` `labelFor`, `engine.js` |
| UX-15 | Copy audit per section 4: eight long labels, judgement why-lines, category shorts "Trap" and "Mind games" | `labels.json` |
| UX-16 | Seen-before throttling with seven-day reset | `engine.js`, `popup.js`, `chrome.storage.local` |
| UX-17 | **Done 4 Nov 2026.** States: too little to read, site-muted, AI cost estimate on the button | `popup.js`, `background.js` `setBadge`, `engine.js` |
| UX-18 | Welcome tab on install with the live fixture demo and three toggles; one-time coach mark on the pill | `background.js` `onInstalled`, new `onboarding/`, `engine.js` |
| UX-19 | Draggable pill corner, remembered globally; hidden in print | `engine.js`, `overlay.css` |
| UX-20 | Evaluation harness: local interaction counters behind a study flag, JSON export | `engine.js`, `popup.js`, `options.js` |


## Visual system (17 Nov 2026, DRAFT until the owner signs off)
One system across the panel, the popup and Settings, set in `extension/ui/view.js` (`V.CSS`): three type sizes and two weights, flat sections separated by a rule, key-value rows for facts and records, chevron disclosures for everything folded, inline SVG glyphs, severity as shape plus colour, and no emoji or filled pills. The context card (docs/CONTEXT-DATA.md) puts the kind of evidence first ("Public records", "Official statistics"), then the sentence, then the chart. Charts place points by date, draw a missing period as a gap, start at zero, label the latest value and at most one other, and never use a severity colour.
