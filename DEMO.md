# Subtext: run the demo and start testing with the API

Everything below runs on your own machine. You need Node 18+ (20+ recommended) and about five minutes.

## Start here: four short readings, no AI key

Run:

```bash
npm run demo:investigate
```

A temporary offline Chromium window opens four clearly labeled demonstration pages. It uses its own temporary browser profile. Start in the open panel:

1. **Solar roof:** click **Compare SEC filing**. The example article has no link to the filing. Subtext recognizes the dated event and opens the shareholder letter, which explains why an investor as well as a homeowner was an audience for this unveiling. **See the two sides** shows the source passages. **Who else had money at stake?** opens the bond disclosure from the separate merger proxy.
2. **Semaglutide:** open Subtext and click **Compare study abstract**. The relative and absolute results describe the same trial from different angles.
3. **Annual plan:** open the panel with the offer on screen. Look for the annual amount and the measured difference between starting a trial and continuing without it.
4. **Pricing worksheet:** open the panel on the standalone post. Read why requests for the file can inflate the comment count a passerby might read as agreement.

The articles and offers are illustrative; the filings and abstract are saved original public responses. The extension does the comparison at click time. On a fresh checkout run `npm run demo:investigate -- --refresh` once to save them locally, then run the demo. The normal demo is offline; use your regular unpacked extension to compare live records on other sites. Close the temporary browser when done.

## 1. Get the code
Clone the repository, then install:
```bash
git clone https://github.com/JoshCS/subtext.git && cd subtext
npm install
npx playwright install chromium
```

## 2. Run the demo (visible browser, extension loaded, test pages in tabs)
```bash
npm run demo
```
A Chromium window opens with Subtext installed and three tabs: a dark-pattern shop, a hyperpartisan "institute" article with misleading charts, and a clean recipe page served under the address theguardian.com. All three are synthetic test pages with invented text; the recipe page is not the real site and says so in a banner. Click the pill bottom-right (or the Subtext toolbar icon, then "Open panel on page") for the report panel beside the page; rest the mouse on a flagged element for the reason. Nothing is outlined. On the shop tab, scroll to the bottom, move the mouse out of the page, and reload to trigger the behaviour detectors.

Alt+Shift+S opens and closes the panel. Hover a flagged element for its tooltip. Each finding has "Not accurate" and "Don't flag this again"; the panel footer has "Don't scan this site". Corrections stay on this device and export from settings.

`npm run demo:real` also opens a few real news and shopping sites so you can compare. Any site you visit in that window is scanned.

## 3. Use it in your everyday browser
Chrome / Edge / Brave / Arc: open the extensions page, enable Developer mode, **Load unpacked**, choose the `extension/` folder. Safari: not built or tested yet; see README (Xcode converter).

## 4. Test the AI layer

### 4a. Check your keys and model ids (one tiny request per provider, under a cent)
```bash
export ANTHROPIC_API_KEY=sk-ant-…      # whichever you have; both is best
export OPENAI_API_KEY=sk-…
npm run ai:check
```
Prints the model that answered, the pressure rating, a few findings with their quotes, tokens and cost. If a model id is rejected (OpenAI ids and prices in this repo have not been checked against a real key and may need adjusting), pass another: `node scripts/ai-check.js --openai-model gpt-5.4`.

### 4b. In the browser
In the demo window (or your browser), click the Subtext icon → ⚙ → choose provider, paste the key, Save. Open a page and press **Investigate**. The button reports question selection, source reading, drafting and review. The report leads with one specific interpretation and mechanism; **Why this reading?** exposes the exact passages. The cost covers all three model stages. Turn off **Use AI inquiry** in Settings to use the previous one-pass findings and chart-image analysis.

### 4c. Batch evaluation against the heuristics
```bash
npm run eval:ai                      # both providers on the three fixture pages
node eval/run-ai.js --provider anthropic --url https://www.example.com/some-article   # any real page
npm run eval:compare                 # grounding of quotes, overlap with heuristics, provider agreement
```
Output JSON lands in `eval/out/`. `compare` reports, per page and provider: how many AI findings, what share of their quotes actually occur on the page (should be 100%; anything less is the model hallucinating evidence), which categories overlap with the heuristic layer, and whether Claude and ChatGPT agree on the pressure level.

### 4d. What to look for first
1. **Grounding**: every AI quote should exist on the page. If not, the verifier pass (roadmap v0.5) becomes urgent.
2. **Over-flagging**: the research says LLMs over-flag; count AI findings on the clean recipe page. Zero or one is the target.
3. **Symmetry**: run the same prompt on a left-leaning and a right-leaning article of similar tone and compare the rhetoric/emotion findings.
4. **Cost**: note tokens per page per model; a typical article is ~4,000 input tokens.

## 5. Other useful commands
```bash
npm test                 # validate rules + end-to-end suite (headless)
npm run test:screens     # same plus screenshots in test/out/
npm run calibrate        # scoring calibration on synthetic pages
npm run package          # zip the extension into dist/
```

### Try the reading on three different kinds of evidence

- **Ownership and editorial policy.** Compare this [Post opinion column](https://www.washingtonpost.com/opinions/2025/02/28/free-markets-personal-liberties-trump-threat/) with the [newsroom’s report on the announcement](https://www.washingtonpost.com/style/media/2025/02/26/washington-post-bezos-opinions-section/). Both have the same owner. Only the opinion article gets the dated opinion policy in its local reading. The columnist attacks Trump by arguing that he violates the two values Bezos had just endorsed. The conclusion criticizes Trump; the terms of the debate fit the published remit. That distinction is more informative than a political label.
- **A forecast with a documented stake.** On the [SEC HTML filing of Musk’s September 2025 remarks](https://www.sec.gov/Archives/edgar/data/1318605/000110465925090888/tm252289d17_defa14a.htm), the local report links the transcript and the [CEO award proposal](https://www.sec.gov/Archives/edgar/data/1318605/000110465925090866/tm252289-12_def14a.htm). Look for the condition on the valuation and the audience for the filing. This is one curated claim, not a general fact-checker. An access-denied page is not the filing.
- **Sales layout.** On the demo shop, leave the discount dialog visible, then press Deep analyze. Two differently sized buttons can both be available; the measured area shows which offer gets more space. It does not establish how many people click it.

To compare a current model with the old behavior on the same six synthetic inputs, run `npm run eval:readings -- --help`. The default demo profile persists; if a demo is already open, close that demo before relaunching `npm run demo` to load the edited worker.

## Turn the AI on in the demo

`npm run demo:ai` opens the everyday demo with Investigate switched on, using your own Anthropic key, read from the file you name in `SUBTEXT_ANTHROPIC_KEY_FILE` (for example `SUBTEXT_ANTHROPIC_KEY_FILE=/path/to/key-file npm run demo:ai`). The key goes into the extension's own storage, which the parts of Subtext running inside web pages cannot read, and it is never printed. Nothing is sent to Anthropic until you click Investigate; the button shows the estimated cost, and Cancel stops a run (requests already sent are still billed). To use Deep analyze, the single AI request that also reads charts, turn off "Investigate with sources" in Settings.

## General inquiry, beyond the four saved demonstrations

The default AI action now plans a question and can retrieve supported public records or same-origin methodology/disclosure pages. It is not a general web-search agent. Corporate sources, comparison eligibility/compensation, social exchanges and research evidence have distinct practitioner questions; they are guidance to the model, not keyword detectors. A second inference pass checks the draft against the same evidence and can correct or reject it.

`npm run eval:inquiry -- --run --baseline-with-sources` runs the synthetic evaluation through the Codex CLI by default, if it is installed and logged in. It compares the inquiry, a page-only one-pass reading and a one-pass reading given the same opened documents. It consumes account credits, uses invented cases, disables tools in the model session, and saves outputs only under ignored `eval/out-inquiry/`. This tests model reasoning with supplied fixture passages; it does not establish live retrieval quality or performance of the configured extension provider. Use `--backend anthropic` or `--backend openai` with the corresponding environment key to test those APIs.

`node eval/inquiry-report.js eval/out-inquiry/<run>/result.json` builds a local HTML viewer of the saved outputs. It makes no model calls. Inspect missed connections and incorrect inferences alongside good readings; receipt presence and a review pass are not accuracy scores.
