# Reporting evasion, false positives and security issues

Subtext publishes all of its detection rules on purpose (see docs/THREAT-MODEL.md, section D). If you find:

- a way a page can evade a detector while keeping the manipulative behaviour,
- a planted phrase or structure that produces a false positive on an honest page,
- a privacy or security problem in the extension itself (data leaving the browser, key handling, injected content),
- an error in the ownership or funding data about a real organisation or person,

please report it.

## Where to report

- **Anything that could expose users before a fix ships, or a data error about a real person:** use GitHub private vulnerability reporting, https://github.com/JoshCS/subtext/security/advisories/new. The report is not public.
- **Everything else** (evasions, false positives, corrections to the ownership data that are not sensitive): open an issue at https://github.com/JoshCS/subtext/issues. Say which page or dataset row it concerns and link a public source for a correction.

There is no e-mail address for reports. Nothing sent through the extension reaches anyone: "Not accurate" stays on your device.

## What to expect

This is a proof of concept. No response time is promised. The aim, from docs/LICENSING.md (governance section), is that a correction with a public source is applied within seven days and the row's history stays visible in git. A wrongly listed site is removed through `data/lists/allowlist.json` when the upstream list has not acted.
