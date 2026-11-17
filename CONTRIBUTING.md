# Contributing to Subtext

Subtext is a proof of concept. No person has labelled its results yet. Reports from real pages are the most useful help.

This page covers five things: reporting a wrong label, correcting data, adding a check, running the tests, and the licence of your work.

## Report a wrong or misleading label

Use the [issue forms](https://github.com/JoshCS/subtext/issues/new/choose). Pick "Wrong or misleading label on a page". Give the page address, the label as the panel shows it, and why it is wrong there.

- Remove personal tokens from the address first.
- "Not accurate" in the panel stays on your device. It does not reach this project, so an issue is the only way to tell us.
- A page that slips past a check is also worth an issue.

## Report a security problem or an error about a person

Do not open a public issue. Use GitHub private vulnerability reporting, as [SECURITY.md](SECURITY.md) describes.

## Correct or add an outlet row

The outlet table is `extension/data/outlets.json`. Every row needs a public source link. A correction without one cannot be applied.

To report an error, use the form "Correction to outlet or owner data". To fix it yourself:

1. Edit or append the row. Its fields are `domains`, `name`, `type`, `country`, `owners` (each with `name` and `kind`), `funding`, `lean`, `notes`, `sources` and `confidence`.
2. Use an owner `kind` from `ownerKinds` and a `lean` from `leanScale`. Both lists are at the top of the file.
3. Put at least one public link in `sources`. Use only facts a reader can check there.
4. Run `npm run validate`. It fails on a repeated domain, an unknown owner kind, an unknown lean or a row with no source.
5. Adding or removing a row changes a count stated in `README.md`. See "Counts the tests pin" below.

`extension/data/owners.json` is built from Wikidata by `scripts/build-owners.py`. Do not edit it by hand. Correct the fact at Wikidata, or open an issue.

## Add a check

1. Add a row to `docs/TAXONOMY.md`: technique, mechanism, signal and detection.
2. Add the rule to `extension/rules/text-rules.json`, or add a check to a detector in `extension/content/detectors/`.
3. Add a label and a one-line reason for the rule id to `extension/rules/labels.json`. Validation fails for a rule with no label.
4. Add a positive example to a fixture page in `test/fixtures/`. Add the rule id to that page's `expect` list in `test/run.js`. Make sure `clean.html` stays quiet.
5. Run `node scripts/validate-rules.js && node test/run.js`.

A text rule needs `id`, `category`, `name`, `pattern`, `severity` (0 to 3), `explain` and `tip`. The `category` must exist in the same file, and so must each id in `biases`. Optional fields the detector reads are `flags`, `scope`, `minCount`, `nearPattern`, `notNearPattern`, `absentPattern`, `requiresUnsourced` and `requiresSale`.

Label rules, which validation enforces:

- A label has at most three words.
- A reason has at most twelve words.
- A reason does not use the words "fraud", "propaganda" or "scam", or the phrase "against you".

A new rule starts held, so readers do not see it. Add its id to `extension/rules/reliability.json` only with evidence from pages it was not tuned on. [docs/RELIABILITY.md](docs/RELIABILITY.md) explains the tiers.

Write a rule for what the page does, and show evidence. Do not state a motive. Write rhetoric and emotion rules for the move, not for a political side.

## Run the tests

You need Node 18 or newer.

```bash
npm install
npx playwright install chromium   # once
npm run validate                  # every rule file, outlet row and hand-kept list
npm test                          # validation, then the extension on the fixture pages
npm run test:ui                   # panel, tooltip and action scenarios
```

`npm test` loads the real extension in headless Chromium on the 20 fixture pages in `test/run.js`. 17 of them are traps that must stay quiet. Fixture pages are invented.

To try a change by hand, load the `extension/` folder at `chrome://extensions` with Developer mode on. Press Reload there after each change.

### Counts the tests pin

`node test/regress.js` reads `README.md` and fails when a stated count is out of date. Update the README in the same change when you add or remove:

- a text rule ("86 regex rules");
- a policy clause ("30 clause types");
- a tracker domain ("511 vendor domains");
- an outlet ("134 outlets", and "25 of its 134 rows");
- a fixture page ("20 fixture pages", "17 of them traps").

The same test requires that `SECURITY.md` holds no e-mail address and names both GitHub reporting routes.

## What is not in the public copy

Some data files are held out of this repository until their licences or contents are reviewed. [docs/PUBLISHING.md](docs/PUBLISHING.md) lists each file and the reason. The main ones are the warning list, the ad-exchange operator table, the public tracker lists and the owner-interest notes.

What this means for you:

- The extension runs without these files. The features that read them stay quiet.
- A test that needs a held file prints `skipped: <file> is not in this copy` and runs the rest. A skipped line is not a failure.
- The recorded real pages behind the figures in `docs/CALIBRATION.md` and `docs/RELIABILITY.md` are other people's content. They are not here, so those figures cannot be reproduced from this repository. Most scripts in `eval/` have nothing to read.

## Do not commit other people's content or personal data

- No recordings, saved copies or screenshots of real web pages. Keep captures in the ignored `eval/out*/` folders.
- No saved responses from outside services. Tests use invented pages and made-up responses.
- No API keys, passwords or personal file paths.
- No personal data about private people.
- No datasets under non-commercial terms.

## Licence of contributions

There is no contributor licence agreement. You keep your copyright. Your contribution is accepted under the same licences this repository uses:

- AGPL-3.0-or-later for code ([LICENSE](LICENSE));
- CC BY-SA 4.0 for rules, data, docs and test pages ([LICENSE-DATA](LICENSE-DATA)).

By opening a pull request you confirm that you have the right to submit the work under these licences. The project plans to ask for a `Signed-off-by` line on each commit (`git commit -s`). It is welcome now and is not checked yet. [docs/LICENSING.md](docs/LICENSING.md) has the details.
