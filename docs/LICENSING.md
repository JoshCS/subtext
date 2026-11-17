# Licensing and governance

*November 2026. Sources: the project's research notes (`research_notes/Subtext manipulation detection landscape/warning_ux_licensing_governance.md`, Part B); claims the notes could not verify are marked. The notes are not in the public copy of this repository. Not legal advice. No lawyer has reviewed this document or the licence choices in it.*

**Status, 17 Nov 2026.** The licence terms below were adopted on 5 Nov 2026. `LICENSE`, `LICENSE-DATA` and `NOTICE` are in the repository. Not done: trademark filing, the published trademark policy, DCO enforcement, SPDX headers and licence keys in the data files (section 6, steps 2 to 6 in part), the issue template for dataset corrections, and the `lastVerified` dates the charter in section 5 asks for. Several data files are held out of the public copy until their licences or contents are reviewed: `docs/PUBLISHING.md`.

## Recommendation

| Component | Terms |
|---|---|
| Extension code (`extension/` JS, CSS, HTML; `scripts/`, `test/run.js`, `eval/`) and any future hosted service | **AGPL-3.0-or-later** |
| Rule base and taxonomy (`extension/rules/*.json`, `docs/TAXONOMY.md`), label copy, bias glossary, privacy-policy rules | **CC BY-SA 4.0** |
| Datasets (`extension/data/outlets.json`, tracker vendor list) and test corpus (`test/fixtures/`) | **CC BY-SA 4.0** |
| Warning list (`extension/data/known-bad.json`; held out of the public copy) | **Not CC BY-SA.** known-bad.json is GPL-3.0 (HaGeZi rows) and Czech open data (Czech Trade Inspection Authority rows), with rows from phishing-filter (CC BY-SA 4.0), the ESMA register and the AMF blacklists (Licence Ouverte 2.0), distributed as a separate data file; our manual rows are CC BY-SA 4.0. Licence texts ship beside it: `extension/data/GPL-3.0.txt`, `extension/data/COI-open-data-licence.txt`, `extension/data/NOTICE-lists.md` (the Licence Ouverte text is not included yet). `scripts/package.sh` fails if the list is in the zip and any of the three is missing. The Czech licence requires naming the authority as the source without implying its endorsement, and no change of meaning |
| Documentation (`docs/`, README) | **CC BY-SA 4.0** |
| Name and logo | **Trademark with a published policy** (granted by neither licence) |
| Contributions | **DCO sign-off, no CLA** |

"Discourage silent commercial forks" is met by three tools together, not by a licence alone: AGPL forces anyone who distributes or hosts a modified Subtext to publish their changes, trademark forces them to rename, and attribution keeps the project's name on the rule base. None of this stops private use or modification, or an honest, renamed, source-published fork. That is the open-source bargain, and the 2023–2025 relicensing episodes show that reaching for more with a non-OSI licence costs more than it protects.

## 1. Licence choice

### Code: AGPL-3.0-or-later

- **OSI-approved**, so Subtext can call itself open source without qualification. Elastic's Shay Banon cited this when adding AGPL in 2024: OSI approval removes "FUD" about the term ([Unixism](https://unixism.net/2024/08/elasticsearch-is-open-source-again/); [InfoQ](https://www.infoq.com/news/2024/09/elastic-open-source-agpl)).
- **The network clause covers the planned hosted service.** Every store-published fork already trips the ordinary distribution trigger, so GPL and AGPL behave alike for the extension itself; AGPL additionally covers a shared-data or scoring backend.
- **Industry treats AGPL as sufficient.** Banon stated AGPL "is sufficient to block AWS from using the code" ([ITPro](https://www.itpro.com/software/open-source/elastic-returns-to-open-source-but-can-it-regain-the-communitys-trust-some-industry-players-arent-holding-their-breath)); Redis 8 added AGPLv3 on 1 May 2025 after its source-available move produced the Valkey fork ([The Register](https://www.theregister.com/2025/05/01/redis_returns_to_open_source/); [LWN](https://lwn.net/Articles/1019686)).
- **Non-OSI licences trigger foundation forks.** HashiCorp's August 2023 BSL change produced OpenTofu within weeks, Linux Foundation-hosted from 20 September 2023 ([OpenTofu](https://opentofu.org/blog/opentofu-announces-fork-of-terraform/); [TechTarget](https://techtarget.com/searchitoperations/news/366552676/Linux-Foundation-ups-ante-on-HashiCorp-hosts-Terraform-fork)). For a volunteer project, that is the whole downside.
- **Store compatibility.** Chrome Web Store policy bars obfuscation and allows minification; the notes found no licensing restriction ([CWS policies](https://developer.chrome.com/docs/webstore/program-policies/policies?hl=en)). That uBlock Origin ships there under GPLv3 is background knowledge, unverified in the notes. Apple is the open question: VLC was pulled from the App Store in January 2011 after a developer's copyright notice, the FSF having said GPLv2 conflicts with App Store terms ([Computerworld](https://www.computerworld.com/article/1347653/gplv2-blocks-vlc-from-apple-s-app-store.html)); whether Apple's current agreement resolves this was not confirmed. No Safari build exists yet; if one ships through the App Store, get counsel's view first; a GPLv3 section 7 additional permission is one option the notes did not cover.

### Rules, labels, taxonomy, datasets, docs: CC BY-SA 4.0

The rule base is the part most worth copying and least protected by a software licence: JSON rules and label copy are not "the program". CC BY-SA 4.0 requires attribution and ShareAlike on adaptations, so a competitor who improves and ships the rules must publish under the same terms. Limits:

- **Facts are not protected.** "Who owns this outlet" is a fact; the licence restrains copying of the project's selection, arrangement and prose (explanations, "why it matters" text, label copy), not the information itself. The notes record, unverified, that CC 4.0 expressly covers the EU sui generis database right, that ShareAlike reaches only "Adapted Material", and that CC does not recommend its licences for software ([legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode)). Where no database right exists, as in the US, copying a data table may be lawful even if impolite.
- **Inputs must be compatible.** Wikipedia-derived facts are CC BY-SA and fit. DuckDuckGo Tracker Radar is CC BY-NC-SA (`docs/DATA-SOURCES.md`) and cannot be folded into a BY-SA file; keep `trackers.json` independently curated.
- **Aggregation.** Keep rule and data files in their own directories with their own licence file, so the package is an aggregate of separately licensed works (standard reading; not verified in the notes).

### Comparison

| Licence | OSI | Network use | Commercial forks | Store distribution | Precedent |
|---|---|---|---|---|---|
| AGPL-3.0 | Yes | Yes (§13) | Allowed; must publish source of distributed or hosted modifications | CWS: no policy bar found; App Store: unresolved since VLC 2011 | Elastic 2024, Redis 2025; Grafana 2021 (unverified) |
| GPL-3.0 | Yes | No | As AGPL, for distributed copies only | As AGPL | Bitwarden SDK to GPLv3, Nov 2024 ([The Register](https://forums.theregister.com/forum/all/2024/11/04/bitwarden_gpls_password_manager/)) |
| MPL-2.0 | Yes | No | Allowed; proprietary files may sit beside ours (file-level copyleft) | Friendlier to App Store concerns | Terraform until 2023 |
| SSPL | No* | Yes, whole service stack | Effectively barred for hosted use | Untested | MongoDB; Elastic 2021; Redis 2024 → Valkey |
| BSL 1.1 | No* | Via Additional Use Grant | Barred for competing use until change date (≤4 years*) | Untested | HashiCorp 2023 → OpenTofu; MariaDB |
| ELv2 | No* | Forbids managed service* | Barred as a service | Untested | Elastic 2021 |
| FSL / Fair Source | No; says so | Two-year noncompete, then Apache/MIT | Barred for competing products for two years | Untested | Sentry, GitButler, PowerSync ([Sentry](https://blog.sentry.io/sentry-is-now-fair-source); [TechCrunch](https://techcrunch.com/2024/09/22/some-startups-are-going-fair-source-to-avoid-the-pitfalls-of-open-source-licensing/)) |
| PolyForm Noncommercial | No* | n/a | None permitted | Would bar paid distribution | None found |

\* Background knowledge the notes could not verify (opensource.org and licence texts were unreachable), including OSI's 2021 SSPL statement and MongoDB's 2019 withdrawal.

## 2. Trademark: the anti-silent-fork tool

Copyright licences force source disclosure; trademark forces forks to say who they are. Mozilla's 2004 policy restricted the Firefox name and logo to builds meeting its conditions, so Debian shipped Iceweasel until the 2016 settlement ([Wikipedia](https://en.wikipedia.org/wiki/Debian%E2%80%93Mozilla_trademark_dispute); [LWN](https://lwn.net/Articles/676799/)); GNU IceCat still ships renamed ([Wikipedia](https://en.wikipedia.org/wiki/GNU_IceCat)). That is the model: the fork exists, legally, and is visibly not Firefox. The counter-example is WordPress/WP Engine: aggressive enforcement by a company-controlled project drew a preliminary injunction (December 2024), interference and unfair-competition claims that survived dismissal (September 2025), and a September 2026 ruling (single source; it does not decide infringement) that Automattic is not an owner of the marks it asserted ([Engadget](https://www.engadget.com/general/wp-engine-wins-preliminary-injunction-in-wordpress-legal-battle-131527285.html); [WP Engine](https://wpengine.com/case-studies/ensuring-stability-and-security/); [webhosting.today](https://webhosting.today/2026/09/29/automattic-is-not-an-owner-of-the-wordpress-marks-it-asserted-in-court-a-judge-rules/)). Lessons: register the word mark and logo (after a conflict search; "Subtext" is a common word) in the home jurisdiction, held by the entity that will enforce them; publish the policy before it is needed; enforce evenly; add jurisdictions as budget allows.

Draft `TRADEMARK.md`:

> **Subtext trademark policy.** "Subtext" and the Subtext logo are trademarks of [holder]. The AGPL and CC BY-SA licences grant no trademark rights.
>
> **You may, without asking:** redistribute unmodified official releases under the name; say in plain text that your software is "based on", "compatible with" or "a fork of" Subtext; use the name in articles, talks, links and package names such as `subtext-rules-fr`.
>
> **You must not:** use the name or logo for a modified build (a store listing, hosted service or fork that changes rules, data or scoring) without written approval; imply endorsement; register domains, store names or handles suggesting you are the project.
>
> **Modified builds must rename.** Choose a name that does not contain "Subtext" and replace the icon. Keep the attribution notices the licences require.
>
> Questions: trademark@[project].

## 3. Contributor terms: DCO, no CLA

Contributors add `Signed-off-by` to each commit, certifying they may submit under the project's licences (the Linux kernel model since 2004; GitLab switched from CLA to DCO in 2017, Chef in 2016: [opensource.com](https://opensource.com/article/18/3/cla-vs-dco-whats-difference); [Kyle Mitchell](https://writing.kemitchell.com/2021/07/02/DCO-Not-CLA); [LF guidance](https://bestpractices.linuxfoundation.org/_sources/ip/contribution-mechanisms.rst.txt)). A CLA exists to aggregate rights so one party can relicense or sell commercial licences, the model behind MongoDB/Elastic-style businesses. Declining a CLA means Subtext cannot later be moved unilaterally to a source-available licence, because every contributor's copyright stays with them. That deliberately closes the door on dual licensing and is a trust signal to contributors and packagers. Some foundations require their own CLA as a hosting condition ([eBay](https://opensource.ebay.com/contributing/cla-or-dco)); weigh that when choosing a host.

## 4. AI-era copying

**Evidence.** Code models memorise and emit licensed code: 20,000 sampled outputs yielded 40,125 memorised snippets, most carrying licence text ([arXiv 2308.09932](https://arxiv.org/pdf/2308.09932)); early Copilot reproduced code without attribution ([arXiv 2302.13681](https://arxiv.org/pdf/2302.13681)). On 16 September 2026 a unanimous Ninth Circuit panel in *Doe v. GitHub* affirmed dismissal of the DMCA §1202(b) claim, holding Copilot "simply generated new code that never contained CMI" ([opinion](https://www.courthousenews.com/wp-content/uploads/2026/09/doe-vs-github-ninth-circuit.pdf); [Gibson Dunn](https://www.gibsondunn.com/ninth-circuit-clarifies-limits-of-dmca-liability-for-ai-generated-code/)). Commentators call it narrow (training-data and ordinary copyright questions remain open), but the main output-side lever is gone in that circuit ([The Next Web](https://thenextweb.com/news/ninth-circuit-github-copilot-dmca-copyright-ruling); [BakerHostetler](https://www.bakerlaw.com/the-copilot-litigation/)); any rehearing or certiorari is unknown. So assume code and rules will be absorbed into models and that licence enforcement against AI-laundered copies is weak; do not design around it. "No AI training" clauses would make the licence non-OSI (unverified) and are not technically enforceable against outputs; the EU TDM opt-out (unverified) is the standard non-consent signal.

**What works is operational.** SpamAssassin's experience: a public rule stays effective for months, secret rules get reverse-engineered anyway, and public review improves rules ([PublicRules](https://cwiki.apache.org/confluence/spaces/SPAMASSASSIN/pages/119545167/PublicRules)). A clone frozen at copy time decays. Copyright traps need long, repeated sequences: 100-token fictitious sequences repeated 1,000 times were detectable (AUC 0.748); 25–50-token sequences were barely detectable even at 100 repetitions ([Meeus et al., ICML 2024](https://proceedings.mlr.press/v235/meeus24a.html)). Short canary rows still catch verbatim dataset copying, not model memorisation. The notes did not research signed-release tooling or benchmark ownership.

**Copy-resistance checklist**

1. Ship rule and data updates on a public, frequent cadence; the living rule base is the moat.
2. Publish a signed release feed and name it as the canonical channel in store listings and README.
3. Own the evaluation: publish the labelled corpus, scoring script and results; be the reference benchmark.
4. Register and police the trademark.
5. Seed a few harmless fictitious outlet and tracker entries (reserved domains) and one or two long, repeated fictitious doc passages; record them privately; check suspected copies.
6. Keep a small hold-out set of heuristics unpublished or delayed (community practice; unquantified).
7. Put licence, trademark and attribution text in the data files and the about page, so stripping it is deliberate.
8. Build community: credits, public rule changelog, correction process. A clone cannot copy a community.

## 5. Governance

**Fiscal host.** Options in the notes (all unverified): Open Source Collective (501(c)(6); the separate Open Collective Foundation announced dissolution in February 2024); Software Freedom Conservancy, which can hold trademarks for member projects; the Linux Foundation, host of OpenTofu and Valkey. Pick Open Source Collective to receive donations and pay contributors with little process; pick SFC when a neutral entity should hold the mark and back enforcement (the lower-risk structure, per the WP Engine case); LF suits large corporate-backed projects. Until then the founder holds the mark and `TRADEMARK.md` says it will transfer to a neutral host.

**Maintainer charter (sketch).**

- *Symmetry rule.* Rules and outlet classifications apply identically across the political spectrum; every politically loaded rule needs test examples from both sides; where raters disagree, show both (as `DATA-SOURCES.md` requires).
- *Evidence standard.* No finding without a verbatim quote or element; no outlet row without a primary source; no `confidence: high` without a `lastVerified` date.
- *Public rule changelog.* Every change to `extension/rules/` or `extension/data/` gets an entry: rule id, change, reason, demonstrating fixture.
- *Correction and takedown.* An issue template for ownership-data corrections; acknowledge within seven days; mark the row `disputed` pending review; correct on primary evidence; log the correction publicly; never delete silently.

## 6. Adoption steps

1. `LICENSE`: the canonical AGPL-3.0 text copied verbatim from gnu.org (`https://www.gnu.org/licenses/agpl-3.0.txt`), not reproduced from memory.
2. `LICENSE-DATA`: CC BY-SA 4.0 legal code copied from creativecommons.org, plus a one-line `README` in `extension/rules/` and `extension/data/` naming the licence and attribution string.
3. `TRADEMARK.md` (draft above) and `NOTICE` (copyright line, attribution string, third-party data credits such as Wikipedia).
4. SPDX headers: `// SPDX-License-Identifier: AGPL-3.0-or-later` atop every `.js` and `.css`; a top-level `"license": "CC-BY-SA-4.0"` key in each JSON rule and data file (JSON has no comments), enforced by `scripts/validate-rules.js`; a footer line in each doc.
5. `package.json`: `"license": "AGPL-3.0-or-later"`, or the SPDX expression `"(AGPL-3.0-or-later AND CC-BY-SA-4.0)"` if the field should describe the whole package.
6. `CONTRIBUTING.md` with DCO instructions; enable the DCO check.
7. README: replace "No licence has been chosen yet" with a Licence section (code AGPL, rules/data/docs CC BY-SA, trademark pointer, how to fork honestly); update `docs/PLAN.md` item 2; state the licence and link the source and signed feed in store listings.
8. Before public release: counsel review of the App Store question and the trademark search.
