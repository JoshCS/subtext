# Publishing: how the public copy is made

The public repository is not this working repository pushed as it is. It is a copy written by one script from an explicit list of files, with some data held out. This page says what is held, how to make the copy and how to check it.

The public repository is https://github.com/JoshCS/subtext. It starts from a fresh history: one commit made from the exported folder. The working history is never pushed.

## What is held out, and why

Nothing in this table is in the public copy or in a zip built from it. The extension works without these files; the features that read them stay quiet.

| Held | Why | Inactive without it |
|---|---|---|
| `extension/data/known-bad.json`, with `GPL-3.0.txt`, `COI-open-data-licence.txt` and `NOTICE-lists.md` beside it | Rows from five outside lists under different terms, GPL-3.0 among them. Waiting for a licence review; the terms of the feeds behind one list are not documented here. | The "Warning list" line |
| `extension/data/operators.json` | Built from ad exchanges' sellers.json files, which state no licence. Some rows name individuals. | The company on a site's ad-exchange contracts |
| `extension/data/tracker-lists.json` | One of its two sources may include data under non-commercial terms. | The "More trackers" line from public tracker lists |
| `extension/data/buyouts.json` | 110 ownership leads with no source link of their own. | The "Private equity" line in the Source card |
| `extension/data/owner-interests.json` | Statements about named owners researched by AI and not checked by a person. | Links between a page's subject and its owner's other interests or wealth |
| `extension/data/story-patterns.json` | Statements about named people, with short quotations, researched by AI and not checked by a person. | Nothing in the extension: no code loads it |
| `data/owners-overrides.json`, and the rows of `extension/data/owners.json` built from it (20 today) | Owner rows researched by AI and not checked by a person. | The owner line for those sites |
| The `notes` text of five rows in `extension/data/outlets.json`: ZeroHedge, Infowars, Occupy Democrats, Palmer Report, The Grayzone | Critical descriptions at medium confidence with one Wikipedia source. The rows stay. | Nothing |

Also never copied:

- working notes and instructions for coding agents;
- `docs/reference-readings.json` and `eval/real/context-cases*.json` (AI-written descriptions of real pages and named people);
- recorded pages, run outputs and outside test sets (`eval/corpus*/`, `eval/out*/`, `eval/external/`, most of `eval/pool/`): other people's content;
- `research_notes/` and the frozen page list in `eval/pool/`, until a decision is made about them;
- `Open Subtext Demo.command`, a launcher for one Mac;
- the draft website in `site/`, generated screenshots in `test/out/`, `dist/`, `node_modules/`, and `docs/category-playbook.json` and `reports/`, which only repeat other files.

Because of this, most scripts in `eval/` have nothing to read in the public copy, and the real-page figures in `docs/CALIBRATION.md` and `docs/RELIABILITY.md` cannot be reproduced from it.

## How to export

```bash
node scripts/export-public.js /path/to/new-empty-folder
```

The folder must be outside this repository. The script:

1. copies the files named in `scripts/public-allowlist.txt` and nothing else. A file that is not on the list is not copied and is printed as skipped, so a new file cannot go out unnoticed. To publish a new file, add its path to the list;
2. removes the held rows and notes from the copies of `owners.json` and `outlets.json` and prints exactly what it removed. A row is removed from `owners.json` only when it equals its entry in the overrides file;
3. scans the result (next section).

`--replace` overwrites an earlier export in the same folder and keeps its `.git` folder.

The scan needs a private file, `.export-private-patterns.json`, in the repository root (or at the path in `SUBTEXT_EXPORT_PRIVATE_PATTERNS`). It lists the names that must not appear in the public copy. It is ignored by git and is never copied. Without it the script stops. `--generic-scan-only` runs the scan without it and says so. The file's format is described in `scripts/export-public.js`.

## How to check

The export ends with the scan. You can run it again at any time, for example after running the tests in the exported folder:

```bash
node scripts/export-public.js --scan /path/to/folder
```

It exits with code 1 if the folder has:

- a file that is not on the allowlist (the tests leave `dist/`, `test/out/` and `eval/out-investigation/` behind: remove them first);
- a held file, under any folder;
- a symbolic link. A link is committed with its target path, and a link to a local `node_modules` would publish a home folder path. To run the tests in the exported folder without installing, set `NODE_PATH` to an existing `node_modules` folder instead of linking it;
- a file over 5 MB;
- something shaped like a key, token or cookie;
- a home or temporary folder path, this machine's account or machine name, an e-mail name from the git history, a name from the private file, or an e-mail address that is not on a reserved example domain.

Then, in the exported folder:

```bash
npm install && npx playwright install chromium   # or NODE_PATH=/path/to/node_modules
npm run validate
npm test
npm run test:ui
npm run package
```

Where a check needs a held file, the test prints `skipped: <file> is not in this copy` and runs the rest. In the working repository, with every file present, no check is skipped.

## The release zip

Build the zip that people download from the exported folder, not from the working repository. `npm run package` zips whatever is in `extension/`: in the working repository that includes the held data.
