# Story context research: what we know so far

Status: prototype, not in the extension's interface. See `extension/context.js` and `eval/context-run.js`. The test cases that script reads (`eval/real/context-cases.json`) are not in the public copy.

## The rule
The model proposes; code decides. A line reaches a reader only if a program opened every source and found the quoted words on it, the type's evidence bar is met, it names a stake in the page's main claim, and it states facts rather than motives. Otherwise the reader sees one sentence saying what was checked and that nothing was found. That is the expected result on most pages.

## Why this design
- A model will always find a pattern or a motive if asked. So the model never answers "is this manipulation?". It answers narrow questions about records.
- Research on context notes found they can lower trust in true news as well as false (Hoes et al. 2024). Saying "be suspicious" is not the goal. Saying who paid, with a link, is.
- Stating a motive about a named person or firm carries legal risk; stating a dated, sourced fact does not carry the same risk.

## Results so far, 5 November 2026 (AI-checked only; no person has reviewed these)
- **First set (24 stories, tuned on).** After changes: 0 of 11 controls got a line, 5 of 10 documented cases were found. An independent reviewer opened every source for the 6 lines shown: 2 supported, 3 partly, 1 not supported. So a quote being on a page is not enough, and a second reader was added.
- **Second set (28 stories, never seen).** First pass on it: 14 documented cases, 2 lines shown, 1 on the arrangement on record; 1 of 13 controls got an unnecessary line. The research had found the truth on about 8 more, but the checks refused it.
- **Same candidates, after adding a repair step and widening the accepted sources, with no new research:** 6 of 14 documented cases got a line about the arrangement; 2 of 13 controls got one. This second number was tuned on the set, so it is not an unseen result. These rewritten lines have not had an independent source check.
- **After an independent code review tightened the checks.** Sources now count by where they live, not what the model calls them, and motive words are refused anywhere in a line. Same saved candidates: 5 of 14 documented cases and 1 of 13 controls. Examples that passed: the AP on who funded the Judicial Crisis Network, PolitiFact on who registered "Progress 2028", the Justice Department on who funded Tenet Media, Fortune on Oracle funding the Google Transparency Project. The control line, about a Chamber of Commerce letter, is true but tells a reader nothing, so a usefulness check is still missing.
- **Cost.** About $0.35 a story with Sonnet 5.5, about 2 minutes.

## What this cannot show yet
- Famous cases may be known from training, so recovery may be flattered. Nine of the second set date from 2024 to 2026 to reduce this.
- Nothing has been measured on whether these lines change what readers believe. Research suggests context can lower trust in true stories, so that test is required before this ships to the public.
- Every fact currently needs a page a program could read. Sites that block scripts lose true lines.

## Held
- Timing lines stay held. On a control page, a true election date beside a press release read as a suggestion of purpose.
- Recurrence: live search almost never meets the bar. It comes from the cited library in `extension/data/story-patterns.json`.

## Recurring story types
`extension/data/story-patterns.json` is a cited library of 17 story types: 6 both-sided, 3 right, 1 left, 3 corporate, 1 government, 3 non-political. Each has dated earlier instances, what became of them, an ordinary explanation and what a match does not show. The model never invents a pattern; it can only say that a page's main point fits a definition a person can read, and code then checks the quote and the calendar. The left side is thin: 1 against 3. That needs more looking, not a forced balance.

On the 49 stored stories, Sonnet 5.5 matched 0 of 24 controls and 4 of 25 documented pages, all sensible, at under 2 cents a page. Haiku matched 0 controls and 4 documented pages but fitted two of them to the wrong type, so matching needs the stronger model.

This is not yet a fair test. Some documented pages are themselves entries in the library, which is circular, and the controls include few stories on the same topics as the patterns. The next test needs accurate stories about crime, border crossings and voting, published near elections, which must not match, or must carry wording that says the story may well be right.
