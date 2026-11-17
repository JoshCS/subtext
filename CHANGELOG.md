# Changelog

Notable changes to Subtext are listed in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Version numbers follow the `version` field in `extension/manifest.json`.

## [Unreleased]

## [0.2.0] - 2026-11-17

First public version. It is a proof of concept. No person has labelled its results.

Some data files are held out of the public copy until they are reviewed. The warning-list check and a few other lines are inactive without them. See "Data held out of the public copy" in the README.

### Added

- The extension for Chromium browsers (Chrome 110 or newer), loaded unpacked from `extension/`. Safari and Firefox are not built or tested.
- A report panel on the page, a small pill, a toolbar badge and a hover tooltip. No letter grade or score is shown.
- Text checks: 86 regex rules. Most are held back until they prove reliable.
- Structure and behaviour checks, such as countdown timers that reset, cookie banners with a buried reject button and pre-checked boxes.
- Chart checks on inline SVG charts, such as a bar axis that does not start at zero.
- Tracker checks against a hand-kept list of 511 vendor domains.
- Source information for 134 outlets: owner, funding and a coarse lean from outside raters.
- A scan of the site's privacy policy and terms for 30 clause types.
- Shop facts and a purchase-path finding on pages that sell.
- Compare, which puts a sentence from the page beside a cited SEC filing, study abstract or trial registration.
- Show context, which looks up public records and statistics about the page's subject.
- Optional Investigate and Deep analyze, which use your own Claude or ChatGPT API key. The ChatGPT path has not been run with a real key.
- A local casebook for saving and comparing steps across pages.
- Tests that run the extension on 20 invented fixture pages in headless Chromium.

