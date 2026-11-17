# The Master List: techniques, mechanisms, signals, detection

This is the spine of Subtext. Every finding the extension can produce maps to a row here, and every row has a tier-1 warning label and tier-2 one-line reason in `extension/rules/labels.json`; every row names the technique, the psychological mechanism it exploits (see the bias glossary in `extension/rules/text-rules.json`), what it looks like on a page, and how it is detected today.

**Detection key** · **H** text heuristic (regex rule) · **S** structural/DOM check · **V** visual measurement (size, colour, contrast, motion) · **B** behaviour over time · **N** network/vendor fingerprint · **P** privacy-policy/terms scan · **D** bundled dataset · **A** AI deep analysis only · **—** not detected yet (roadmap)

Severity: 1 minor/common · 2 meaningful · 3 severe or outright deceptive.

---

## 1. Deceptive interface design (dark patterns)
Framework: Brignull (deceptive.design); Mathur et al. 2019; Gray et al. 2018; FTC 2022; EU DSA Art. 25.

| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Confirmshaming | Guilt, ego | "No thanks, I don't want to save money" | H | dark.confirmshaming | 3 |
| Trick question / double negative | Trick question, default | "Uncheck if you do not wish to not receive…" | H | dark.trick_question | 3 |
| Preselection (pre-checked opt-ins, add-ons) | Default effect, inertia | Checked boxes for newsletter, insurance, donation | S | dark.preselection | 2 |
| Sneak into basket | Sneaking, default | "We've added Priority Shipping" | H | dark.sneak_into_basket | 2 |
| Hidden costs / drip pricing | Drip pricing, sunk cost | Service fee, "+ taxes & fees" late in flow | H | bias.hidden_fees | 2 |
| Roach motel / cancellation friction | Obstruction, status quo | "To cancel, call…", notice periods, no refunds | H | dark.cancellation_friction | 3 |
| Subscribe without visible cancel path | Roach motel | Subscribe CTA, no "cancel" anywhere | S | dark.no_cancel_path | 1 |
| Forced registration / soft paywall gate | Forced action, data capture | "Sign up to continue", blurred text | H, S | dark.forced_registration, dark.content_gate | 2 |
| Disguised ads / native ad units | Halo, authority | "Sponsored" in 9px grey next to editorial | S, V, N | dark.disguised_ads, tracker.native_ads | 1–2 |
| Interrupting modal | Interruption, default | Pop-up appears unprompted after N seconds | B | dark.interrupting_overlay | 2 |
| Exit-intent pop-up | Loss aversion, FOMO | Overlay fires when cursor leaves | B | dark.exit_intent_popup | 2 |
| Nagging | Interruption, attrition | Repeated prompts (≥3 overlays) | B | dark.nagging | 3 |
| Bait and switch (deal vanished, pricier alternative) | Sunk cost, anchoring | "This offer has expired… try these instead" | H | dark.bait_switch_unavailable | 1 |
| Visually buried decline option | Default, framing | Big coloured accept, tiny grey "no" | V | design.asymmetric_choice | 2 |
| Hard-to-find close button | Obstruction | Tiny, low-contrast or off-screen × | — (v0.2) | | 2 |
| Misdirection / false hierarchy in forms | Default, attention | Upsell styled as the only "Continue" | — | | 2 |
| Price comparison prevention | Anchoring | Unit prices withheld, bundles incomparable | — | | 2 |
| Forced continuity (trial → paid) | Forced continuity, default | "Free trial, then billed annually unless cancelled" | H | bias.free_with_conditions, bias.default_optout_language | 2 |
| Privacy Zuckering (oversharing defaults) | Default, data capture | Public-by-default profiles, contact upload | — | | 2 |
| Fake "live chat agent" | Liking, social | Scripted bot with a human name/photo | N | tracker.chat_widget | 1 |
| Scroll jacking / back-button hijack | Obstruction | History spam, hijacked scroll | — | | 2 |
| Consent banner: no one-click reject | Default, obstruction | Accept vs "Manage settings" only | S | surveillance.consent_no_reject | 3 |
| Consent banner: reject visually subordinate | Default, framing | Reject smaller, text-only, low contrast | V | design.consent_asymmetry | 2 |
| Implied consent ("by continuing you agree") | Default | Legal boilerplate as consent | H | bias.default_optout_language | 2 |

## 2. Manufactured urgency & scarcity
| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Deadline language | Scarcity, loss aversion, present bias | "Hurry", "ends tonight", "last chance" | H | urgency.deadline_language | 2 |
| Live countdown timer | Scarcity, arousal | Ticking HH:MM:SS | B | urgency.live_countdown | 2 |
| **Evergreen countdown (resets on reload)** | Scarcity (fabricated) | Timer restarts per visitor | B (stored per URL) | urgency.fake_countdown_reset | 3 |
| Countdown vendor present | Scarcity (fabricated) | Deadline Funnel etc. scripts | N | tracker.urgency_widget | 3 |
| Low-stock message | Scarcity | "Only 3 left" | H | scarcity.low_stock | 2 |
| Static low-stock number (never changes) | Scarcity (fabricated) | Same "3 left" for weeks | — (v0.5 price/stock memory) | | 3 |
| High-demand / live viewers | Scarcity, social proof | "27 people viewing", "booked 12 times" | H | scarcity.high_demand | 2 |
| Price-increase threat | Loss aversion, anchoring | "Prices go up at midnight", "lock in" | H | urgency.price_increase_threat | 2 |
| Countdown framing words | Scarcity | "offer ends in", "cart reserved for" | H | urgency.countdown_words | 1 |
| Urgency copy styled red | Affect heuristic | Red text/background on urgency messages | V | design.red_urgency | 1 |
| Exclusivity / waitlist / doors closing | Scarcity, exclusivity, commitment | "Invite only", "join the waitlist", "cohort closes" | H | bias.exclusivity_access | 1 |

## 3. Social proof & bandwagon
| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Big-number proof | Social proof, bandwagon | "Join 2 million users" | H | social.join_millions | 1 |
| Bestseller / #1 / award badges | Social proof, authority, halo | "Best seller", "Editor's choice" | H | social.bestseller_badges | 1 |
| Live activity toasts | Social proof, FOMO | "Someone in Ohio just bought…" | H | social.activity_feed | 2 |
| Social-proof toast vendor present | Social proof (fabricated) | Fomo, Proof, Nudgify scripts | N | tracker.social_proof_widget | 3 |
| Bandwagon pressure | Bandwagon, FOMO | "Everyone is switching", "don't be left behind" | H | social.everyone_is | 2 |
| Testimonial / "as seen on" framing | Social proof, authority | Verified-buyer quotes, press logos | H | social.testimonial_markers | 1 |
| Fake / incentivised reviews | Social proof | Rating-shape anomalies, bursts, templated text | — (v0.5) | | 3 |
| Engagement counters on content | Social proof, variable reward | Likes/shares on every card | S | attention.engagement_feed | 1 |
| "Most popular" tier steering | Social proof, anchoring, default | Badge on the middle price tier | H, S | bias.decoy_tier_badge | 1 |

## 4. Attention & engagement engineering
Framework: Eyal's Hook model (as a threat model), Center for Humane Technology, Fogg behaviour model.

| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Infinite scroll | Variable reward, Zeigarnik, default | Page grows as you scroll | B | attention.infinite_scroll | 2 |
| Autoplay (video/audio) | Default, interruption | Media starts unprompted | B | attention.autoplay_media | 1–2 |
| Autoplay-next / "up next" | Zeigarnik, default | Countdown to next episode | H | attention.autoplay_next | 1 |
| Clickbait / curiosity gap | Curiosity gap, outrage | "You won't believe…", "here's why" | H | attention.clickbait_curiosity | 2 |
| Listicle / slideshow pagination | Curiosity gap, pageviews | "7 reasons…", one item per page | H | attention.listicle_headline | 1 |
| Engagement bait | Reciprocity, algorithm gaming | "Like and share if you agree" | H | attention.engagement_bait | 1 |
| Gamification: streaks, points, badges | Loss aversion, variable reward | "Keep your streak", "level up" | H | attention.gamification | 2 |
| Variable rewards: spins, mystery boxes, loot | Variable reward (slot-machine) | "Spin the wheel", "mystery gift" | H | attention.gamification | 2 |
| Notification / "you missed" bait | FOMO, variable reward | "You have 3 new notifications" | H | attention.fomo_notifications | 2 |
| Custom notification pre-prompt | FOMO, foot-in-door | Site's own "Allow notifications?" | S, H | surveillance.notification_preprompt, surveillance.notification_prompt_language | 1–2 |
| Tab-title bait | FOMO, interruption | Title flashes "(1) New message" when hidden | B | attention.title_bait | 1 |
| Engagement-ranked feed | Variable reward, filter bubble | Repeated cards with counters | S | attention.engagement_feed | 1 |
| Pull-to-refresh / manual slot-machine gesture | Variable reward | Mobile pattern | — | | 2 |
| Red notification badges / dots | Attention capture | Unread counters on every tab | — (v0.2 visual) | | 1 |
| Pop-up / email-capture vendor present | Interruption, data capture | OptinMonster, Privy, Sumo | N | tracker.popup_capture | 2 |
| Chat widget proactive bubble | Interruption, liking | "Hi there 👋" | N | tracker.chat_widget | 1 |
| Removal of stopping cues | Default | No page end, no "you're all caught up" | A | | 2 |

## 5. Cognitive bias exploitation (pricing & framing)
Framework: Kahneman/Tversky; Thaler; Ariely; Cialdini.

| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Price anchoring ("was", list price, % off) | Anchoring | Struck-through reference prices | H, S | bias.anchoring_price_compare, bias.anchoring_strikethrough | 1 |
| Inflated / never-charged reference price | Anchoring (deceptive) | "Was $129" that never was | — (v0.5 price memory) | | 3 |
| Charm pricing | Left-digit effect | $9.99, $19.97 | H | bias.charm_pricing | 1 |
| Per-day / "cup of coffee" reframing | Framing, hyperbolic discounting | "Just $0.27 a day" | H | bias.per_day_reframing | 2 |
| Buy-now-pay-later framing | Hyperbolic discounting, pain of paying | "4 interest-free payments of…" | H, N | bias.bnpl, tracker.bnpl | 2 |
| Decoy tier | Decoy effect, anchoring | Deliberately poor middle/upper tier | S (badge proxy) / A | bias.decoy_tier_badge | 1 |
| "Free" with strings | Zero-price effect, endowment | "Free trial*", card required | H | bias.free_with_conditions | 2 |
| Monthly price, annual billing | Framing, partitioned pricing | "$9.99/mo billed annually" | H | bias.monthly_display_annual_billing | 2 |
| Drip pricing / fees at checkout | Drip pricing, sunk cost | "Service fee", "taxes and fees" | H | bias.hidden_fees | 2 |
| Progress / "almost there" | Sunk cost, Zeigarnik, goal gradient | "You're 80% done", "one more step" | H | bias.sunk_cost_progress | 1 |
| Reciprocity gift / credit | Reciprocity | "Here's $5 on us" | H | bias.reciprocity_gift | 1 |
| Default enrolment / auto-renew | Default, status quo, forced continuity | "Unless you cancel", "auto-renews" | H | bias.default_optout_language | 2 |
| Loss framing | Loss aversion, framing | "Stop overpaying", "don't lose" | H | bias.loss_framing | 2 |
| Scarcity of access | Scarcity, exclusivity | Waitlists, invite-only | H | bias.exclusivity_access | 1 |
| Partitioned pricing (base + many small adds) | Partitioned pricing | Itemised extras | A | | 2 |
| Dynamic / personalised pricing | Framing, information asymmetry | Price differs by user | — (v0.5 price memory + A/B vendor) | tracker.ab_testing | 2 |
| Round-number / prestige pricing | Framing | $100 vs $99 on luxury | — | | 0 |
| Pseudo-set framing ("complete the set") | Completion bias | "Collect all 5" | H (gamification) | attention.gamification | 1 |
| IKEA effect / effort investment | Sunk cost | Long onboarding before the paywall | A | | 1 |
| Endowment via trial/saved cart | Endowment | "Your cart is waiting" | H | interpersonal.hoovering_winback | 2 |

## 6. Rhetoric & logical fallacies
Framework: classical fallacies; IPA propaganda devices (name calling, glittering generalities, transfer, testimonial, plain folks, card stacking, bandwagon).

| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Weasel attribution (unsourced "experts say") | Authority bias, false precision | "Studies show", "experts agree" with no link | H (suppressed when a link is near) | rhetoric.weasel_attribution | 2 |
| Absolutist language (dense) | Illusory truth, false dilemma | "Always", "everyone", "the only way" ×3+ | H | rhetoric.absolutism | 1 |
| Appeal to obviousness | Bandwagon, illusory truth | "Obviously", "everyone knows" ×2+ | H | rhetoric.obviousness_appeal | 1 |
| False dilemma | False dilemma | "You're either with us or…" | H | rhetoric.false_dilemma | 2 |
| Slippery slope | Slippery slope, fear | "It's only a matter of time before…" | H | rhetoric.slippery_slope | 2 |
| Ad hominem / name-calling | Ad hominem, tribalism | "Shills", "clowns", "so-called experts" | H | rhetoric.ad_hominem | 2 |
| Straw man | Straw man | "What they really want is…" | H (markers) / A | rhetoric.strawman_markers | 2 |
| Whataboutism / deflection | Whataboutism | "But what about…", "where was the outrage when" | H | rhetoric.whataboutism | 2 |
| Thought-terminating cliché | Thought termination | "Do your own research", "case closed" | H | rhetoric.thought_terminating | 1 |
| Loaded / leading question | Loaded question | "Isn't it convenient that…" | H | rhetoric.loaded_question | 1 |
| Anecdote as evidence | Availability heuristic | "My cousin…", "case in point" | H | rhetoric.anecdote_as_evidence | 1 |
| Appeal to nature / tradition | Appeal to nature | "All natural", "ancient wisdom" | H | rhetoric.appeal_to_nature_tradition | 1 |
| Unsourced precise statistic | False precision, authority | "87% of users" with no source | H | rhetoric.false_precision_stats | 1 |
| Corporate euphemism | Framing, agency hiding | "Right-sizing", "price adjustment" | H | rhetoric.euphemism_corporate | 1 |
| Passive voice hiding responsibility | Agency hiding | "Mistakes were made", "data was accessed" | H | rhetoric.passive_agency_hiding | 1 |
| "Just asking questions" / insinuation | Conspiracy framing | "Follow the money", "connect the dots" | H | rhetoric.just_asking_questions | 2 |
| Record / percentage-change framing | Cherry-picking, anchoring | "Record high", "up 300%" ×2+ | H | rhetoric.cherry_pick_markers | 1 |
| Relative risk without absolute | Relative vs absolute | "Risk up 60%" | H | rhetoric.percent_vs_points | 2 |
| Straw man / motte-and-bailey / gish gallop (structural) | Various | Argument structure | A | | 2 |
| Cherry-picked evidence / omitted context | Cherry-picking | What the text leaves out | A | | 2 |
| False balance / both-sidesing | Framing | Fringe view presented as equal | A | | 1 |
| Headline–body contradiction | Framing, curiosity gap | Headline claims what body walks back | A | | 2 |
| Glittering generalities / virtue words | Halo, transfer | "Freedom", "family", "common sense" as argument | H (partial: tribal/obviousness) / A | | 1 |
| Card stacking (one-sided selection) | Confirmation bias | Only supporting facts | A | | 2 |
| Appeal to fear | Fear, loss aversion | Threat language | H | emotional.fear_lexicon | 2 |
| Appeal to authority (vague credentials) | Authority bias | "Doctor recommended", "FDA registered" | H | claims.authority_credentials_vague | 2 |

## 7. Emotional manipulation & loaded language
| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Outrage vocabulary | Outrage, affect heuristic | "Slams", "destroys", "disgraceful" ×2+ | H | emotional.outrage_lexicon | 2 |
| Fear / threat vocabulary | Fear, loss aversion | "Catastrophic", "before it's too late" ×2+ | H | emotional.fear_lexicon | 2 |
| Tribal / us-vs-them labels | Tribalism, in-group bias | "The elites", "the woke", "MAGA cult" ×2+ | H | emotional.tribal_labels | 2 |
| Dehumanizing language | Dehumanization | "Vermin", "hordes", "flooding into" | H | emotional.dehumanizing | 3 |
| Guilt trip | Guilt, reciprocity | "If you really cared…", "shame on you" | H | emotional.guilt_trip | 2 |
| Sensational formatting | Outrage, arousal | ALL CAPS, !!!, ?! ×2+ | H | emotional.sensational_formatting | 1 |
| Emotional sequencing (fear → anger → offer) | Affect, priming | Order of sections/cards | A | | 2 |
| Moral reframing / purity language | Moral emotions | "Disgusting", "sacred", "betrayal" | H (partial) / A | | 1 |
| Victim narrative to recruit | Sympathy, identification | "They did this to people like you" | A | | 1 |
| Disgust appeals (health/food) | Affect heuristic | "Toxins", "chemicals" | H | rhetoric.appeal_to_nature_tradition | 1 |

## 8. Dark-triad & interpersonal manipulation analogs
Framework: coercive-control and narcissistic-abuse literature; Greene's *48 Laws of Power* read defensively.

| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Love bombing / flattery | Liking, ego, reciprocity | "You deserve this", "you've been selected" | H | interpersonal.flattery_love_bombing | 2 |
| Negging / status challenge | Ego, commitment | "This isn't for everyone", "are you serious enough?" | H | interpersonal.negging | 2 |
| Isolation from other sources | Isolation, conspiracy framing | "Don't trust the media/your doctor", "banned by big tech" | H | interpersonal.isolation_distrust_others | 3 |
| Future faking | Optimism bias, future faking | "Coming soon", "imagine when…" | H | interpersonal.future_faking | 1 |
| DARVO / victim reversal | DARVO, deflection | "Witch hunt", "we are the real victims" | H | interpersonal.darvo_victim_reversal | 2 |
| Gaslighting markers | Gaslighting | "That never happened", "you're overreacting" | H | interpersonal.gaslighting_markers | 2 |
| Hoovering / retention pressure | Loss aversion, sunk cost, guilt | "We miss you", "are you sure you want to cancel?" | H | interpersonal.hoovering_winback | 2 |
| Cult-style belonging / unity | Unity, in-group | "Join the movement", "we're a family" | H | interpersonal.cult_community | 1 |
| Manufactured enemy | Tribalism, fear, outrage | "They are destroying…", "war on our values" | H | interpersonal.manufactured_enemy | 2 |
| Foot-in-the-door micro-commitment | Commitment/consistency | "Just enter your email", quiz funnels | H | interpersonal.foot_in_door | 1 |
| Intermittent reinforcement | Variable reward | Streaks, random rewards | H | attention.gamification | 2 |
| Triangulation (compare you to others) | Social comparison | "People like you spend less" | H (partial) | surveillance.barnum_personalization | 1 |
| Moving goalposts | Commitment | Terms change after sign-up | — | | 2 |
| Word salad / obfuscation | Cognitive overload | Dense legalese at the decision point | A | | 1 |
| Selective honesty / token transparency (Law 12) | Trust, halo | One disclosed flaw to buy credibility | A | | 1 |
| Control the options (Law 31) | Choice architecture | Only the choices they want you to have | S (decoy), A | bias.decoy_tier_badge | 1 |
| Create compelling spectacles (Law 37) | Affect, attention | Visual overload, animation | V | design.animated_cta | 1 |
| Play on the need to believe (Law 27) | Unity, hope | Movement/cult framing | H | interpersonal.cult_community | 1 |
| Keep others dependent (Law 11) | Lock-in | Data hostage, no export | — | | 2 |
| Court attention at all costs (Law 6) | Outrage | Stunts, outrage bait | H | emotional.outrage_lexicon | 1 |
| Pose as a friend, work as a spy (Law 14) | Liking + data capture | Friendly UX collecting data | N, H | tracker.*, surveillance.email_capture_incentive | 1 |

## 9. Deceptive or unverifiable claims
| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Asterisked promise | Framing | "Free*", "*terms apply" | H | claims.asterisked_claim | 2 |
| "Unlimited" / "up to" hedges | Framing, anchoring | Fair-use clauses, "speeds up to" | H | claims.unlimited_hedge | 2 |
| Guarantee / can't-lose puffery | Optimism, trust badges | "100% guaranteed or your money back" | H | claims.guarantee_puffery | 1 |
| Grandiose superlatives | Halo, puffery | "Revolutionary", "world's best" ×2+ | H | claims.grandiosity_puffery | 1 |
| Miracle health / cure claims | Health misinfo, authority | "Cures", "detox", "doctors won't tell you" | H | claims.health_cure | 3 |
| Get-rich / guaranteed returns | Greed, optimism, scarcity | "$4,000 a week", "secret coin" | H | claims.financial_promises | 3 |
| Greenwashing without certification | Halo | "Eco-friendly" ×2+, no certifier named | H (absent-pattern) | claims.greenwashing | 1 |
| Trust badges & "secure" signalling | Trust badges, authority | Norton/McAfee images, "secure checkout" | H, S | claims.fake_trust_signals, claims.trust_badge_images | 1 |
| "Results may vary" disclaimer | Availability, framing | Fine print contradicting testimonial | H | claims.results_disclaimer | 1 |
| Vague professional endorsement | Authority, halo | "Doctor recommended", "FDA registered" | H | claims.authority_credentials_vague | 2 |
| Claim contradicted by terms of service | Framing | "Cancel anytime" vs ToS | — (ToS;DR, v0.5) | | 3 |
| Fake scarcity of a digital good | Scarcity | "Only 5 downloads left" | H | scarcity.low_stock | 2 |
| Before/after imagery | Availability | Transformation photos | A | | 1 |
| Unverifiable awards / "voted #1" | Authority | Award graphics with no issuer | H | social.bestseller_badges | 1 |

## 10. Source, ownership & funding
| Signal | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Owner kind: billionaire individual | Owner interests | Dataset lookup | D | source.ownership | 2 |
| Owner kind: private equity / hedge fund | Extraction incentives | Dataset | D | source.ownership | 3 |
| Owner kind: state-controlled | Government messaging | Dataset | D | source.ownership, source.lean_extreme | 3 |
| Owner kind: public company / family-controlled | Shareholder/family incentives | Dataset | D | source.ownership | 1 |
| Owner kind: nonprofit / reader-funded / trust / cooperative | Lower-conflict incentives | Dataset | D | source.ownership | 0–1 |
| Religious or political affiliation | Doctrine / party line | Dataset | D | source.ownership | 2 |
| Far-left / far-right by third-party raters | Tribal story selection | Dataset (links to raters) | D | source.lean_extreme | 2 |
| Satire site | Context collapse | Dataset | D | source.ownership (sev 0) | 0 |
| Unknown outlet | — | One-click lookups on 11 registries/raters | UI | | — |
| Low transparency (no byline/date/about/contact/corrections) | Accountability absent | Missing masthead signals on article pages | S | source.low_transparency | 1–2 |
| Organization-style name, no funding disclosure | Authority, astroturf | "…Institute", no donors/990 link | S | source.advocacy_no_funding_disclosure | 2 |
| Sponsored content disclosed | Commercial incentive | "Sponsored content", "Paid partnership" | H | source.sponsored_content | 1 |
| Company named on the page or its policy | Someone accountable is named | a legal name in the footer or legal pages | H | source.named_operator | 0 |
| Listed by someone else as risky | A named body already warned about this domain | the Czech authority, HaGeZi, manual entry citing a source | H | source.listed_warning | 2-3 |
| Vendor roles: identity matching, ad measurement, bot defence, fraud checks, reviews, funnel builders | What each outside company is there to do | vendor domain and URL | H | tracker.identity, tracker.ad_measurement, tracker.bot_defence, tracker.fraud_check, tracker.reviews_widget, tracker.funnel_builder | 0 |
| Commission disclosed | Who pays for the recommendation | "we may earn a commission", "as an Amazon Associate" | H | source.affiliate_disclosure | 0 |
| Section or series paid for by a named funder | Topic selection follows the money | "Supported by the X Foundation", "In partnership with Y" (funder quoted). Label meanings per the Guardian's own content-funding page (theguardian.com/info/2016/jan/25/content-funding): "Supported by" = editorially independent, funder may suggest topics; "Paid for by" / "Advertiser content" = advertiser-controlled | H | source.funded_section | 1 |
| Outlet dossier (opt-in, AI web search, cached per site): named funders and grants, known consumer practices (cancellation, pricing, data), with citations | Insider context | Sourced items | AI | ai.outlet_dossier | 0–1 |
| Affiliate links (disclosed / undisclosed) | Compensated recommendation | Amazon tags, affiliate networks | N | source.affiliate_links | 1–2 |
| Owner's other holdings mentioned in article | Conflict of interest | Cross-reference | — (v0.5) | | 2 |
| Unnamed operator (outlet unknown; one finding rolling up: no working privacy/terms/legal-notice link; no address, legal entity, registration number or organization markup; webmail-only or no contact route; platform-hosted; opt-in RDAP: domain under 90 days, registrant redacted when the page names nobody) | Nobody to hold accountable | Provenance checklist in the Source card, folded behind one line | S, N (opt-in) | source.unknown_operator | 0–2 (max of the signals; 0 for a personal page with a byline) |
| Syndicated / AI-generated content farm | Low accountability | Pattern of templated articles | A / — | | 2 |

## 11. Misleading data visualization
Framework: Tufte's lie factor; Cairo's *How Charts Lie*.

| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Bar chart with non-zero baseline | Framing (exaggeration) | Y-axis starts at 80 | S (SVG) / A | charts.truncated_bar_axis | 3 |
| Zoomed y-axis on line chart | Exaggeration | Narrow range fills chart | S / A | charts.zoomed_line_axis | 1 |
| Dual y-axes | Spurious correlation | Two scales, two series | S / A | charts.dual_axis | 2 |
| Inverted axis | Reversed reading | Values increase downward | S / A | charts.inverted_axis | 3 |
| Log scale unlabelled | Flattening growth | Geometric ticks, no "log" | S / A | charts.unlabeled_log_scale | 2 |
| Irregular / broken axis | Distorted slopes | Unequal value steps | S / A | charts.irregular_axis | 2 |
| Cherry-picked time window | Cherry-picking | ≤3 years shown | S (years) / A | charts.short_window | 1 |
| Very few points | Fragile trend | ≤4 x positions | S | charts.few_points | 1 |
| Pie / donut misuse | Poor angle perception | Arcs | S | charts.pie | 1 |
| Extreme aspect ratio | Slope distortion | Very wide or tall | S | charts.flat_aspect, charts.tall_aspect | 1 |
| Missing units / axis titles | Interpretation left to reader | Bare numbers | S | charts.no_axis_titles | 1 |
| No source cited | Unverifiable | No "Source:" nearby | S | charts.no_source | 1 |
| Cumulative instead of per-period | Hides decline | Always-rising curve | A | | 2 |
| 3D / perspective distortion | Area misperception | 3D pies and bars | A | | 2 |
| Area/volume for 1-D quantity | Square-cube misperception | Bubble sizes | A | | 2 |
| Relative % without absolute | Relative vs absolute | "Up 50%" from tiny base | H (text), A | rhetoric.percent_vs_points | 2 |
| Correlation implied as causation | Causal inference | Two lines, causal caption | A | | 2 |
| Misleading colour (red/green moral coding) | Affect | Colour choice | A | | 1 |
| Non-uniform bins / map class breaks | Distortion | Choropleth tricks | A | | 2 |
| Canvas/library chart (not inspectable) | — | Chart.js, Highcharts | S | charts.canvas_chart | 0 |
| Embedded chart iframe | — | Datawrapper, Flourish | S | charts.embedded_chart | 0 |
| Chart image | — | `<img alt="chart">` | S → A | charts.image_chart | 0 |

## 11b. Business model & incentives (what they get from you)
| Signal | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Business model inferred (ads, data, affiliate, subscription, sales, leads, donations, sponsorship) | Context for every other finding | Trackers, links, forms, CTAs | S, N | incentives.business_model | 0 |
| Free to use, paid with your data | Zero-price effect, data capture | No price, heavy ad/profiling vendors | S, N | incentives.you_are_the_product | 2 |
| "Do Not Sell or Share" link | Legal admission of sale/sharing | CCPA link in footer | S | incentives.do_not_sell_link | 2 |
| Data-broker / identity-graph vendors | Profile resale | LiveRamp, Oracle, Acxiom, Lotame… | N | tracker.data_broker | 3 |
| Lead-capture forms | Data capture, foot-in-door | Quote/estimate forms with phone/email | S | incentives.lead_capture | 1 |
| No privacy policy reachable | Accountability absent | Collects data, no policy link | S | incentives.policy_unavailable | 1 |
| Subscription renews automatically (terms) | Default effect | "automatically renewed", "recurring billing" in the terms | P | policy.auto_renewal | 2 |
| Payments non-refundable (terms) | No recourse after paying | "non-refundable", "all fees are final" in the terms | P | policy.non_refundable | 2 |
| Purchase path (one finding rolling up: irreversible-only payment such as crypto, wire or gift cards; "all sales final" / no refunds; a guarantee contradicted by the small print; no refund or returns page; checkout on an unrelated domain or through an affiliate network; a digital product with no presence linked elsewhere) | Loss aversion, sunk cost; no recourse after paying | Payment words and logos, buy-button targets, refund wording | S | incentives.purchase_path | 0–3 (max of the signals) |
| Warnings about the site online (opt-in, AI web search) | Reputation | Regulator actions, scam-tracker listings, consumer warnings, review scores, with links | AI | ai.online_warnings | 0–3 |
| Policy: sells personal data / sells or shares for ads | Data capture | Policy text | P (policy scan) | policy.sells_personal_info, policy.shares_or_sells_ccpa | 3 |
| Policy: third-party marketing sharing, brokers, profile building, cross-device, precise location, biometric, inferences, automated decisions, email tracking | Data capture, profiling | Policy text | P | policy.* | 1–3 |
| Policy: indefinite retention, forced arbitration/class waiver, unilateral changes, hard opt-out, sold with the company, children's data | Lock-in, obstruction | Policy/terms text | P | policy.* | 1–3 |
| Policy positives: no-sale statement, GPC honoured, deletion right | (good signal) | Policy text | P | policy.no_sale_statement, policy.gpc_honoured, policy.deletion_right | 0 |
| Terms grade (ToS;DR, opt-in) | Independent reading of terms | tosdr.org lookup | D | incentives.tosdr_grade | 0–3 |
| Owner's other holdings mentioned in article | Conflict of interest | Cross-reference | — (v0.5) | | 2 |
| Dynamic pricing / personalised offers | Information asymmetry | A/B vendors + price memory | — (v0.5) | | 2 |

## 11c. AI chat interfaces (new, from DarkBench and the CDT chatbot taxonomy)
| Technique | Mechanism | Where | Det. | Sev |
|---|---|---|---|---|
| Sycophancy (agreeing to please) | Liking, confirmation bias | Chat replies | A (needs transcript access) | 2 |
| User-retention nudges ("don't go", emotional farewells) | Loss aversion, guilt | Chat replies, companion apps | A | 2 |
| Anthropomorphisation / false intimacy | Liking, unity | Persona design | A | 2 |
| Brand bias / sneaking product placement | Halo, sneaking | Chat replies | A | 2 |
| Harmful compliance to keep engagement | Variable reward | Chat replies | A | 3 |
| Engagement loops in chat UI (streaks, "memories", notifications) | Variable reward, Zeigarnik | Chat product pages | H/S (same rules as feeds) | 2 |

## 12. Tracking, profiling & algorithmic steering
| Signal | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Session replay / heatmaps | Data capture (keystrokes) | Hotjar, FullStory, Clarity… | N | tracker.session_replay | 3 |
| Device fingerprinting | Cookieless tracking | FingerprintJS, PerimeterX… | N | tracker.fingerprinting | 2 |
| Social-media pixels | Identity-linked tracking | Meta, TikTok, Snap, Pinterest… | N | tracker.social_pixel | 2 |
| Ad-tech / programmatic | Cross-site profiling | DoubleClick, Criteo, Taboola… | N | tracker.advertising | 1 |
| Analytics | Behaviour measurement | GA, Mixpanel… | N | tracker.analytics | 1 |
| Marketing automation / CRM | Email-identity linking | HubSpot, Klaviyo, Braze… | N | tracker.marketing_automation | 1 |
| A/B testing / personalization | Optimized against you | Optimizely, VWO, Dynamic Yield | N | tracker.ab_testing | 1 |
| Push-notification vendor | Re-engagement channel | OneSignal, PushEngage | N | tracker.push_notifications | 2 |
| Consent manager | (neutral; check asymmetry) | OneTrust, Didomi… | N | tracker.consent_manager | 0 |
| Third-party volume | Exposure | ≥12 third-party domains | N | tracker.third_party_volume | 1–2 |
| Algorithmic personalization present | Filter bubble, mere exposure | "Recommended for you", "because you watched" | H | surveillance.personalized_feed | 1 |
| Pseudo-personalization (Barnum) | Barnum effect | "People like you", "your custom plan" | H | surveillance.barnum_personalization | 1 |
| Incentivised contact capture | Reciprocity, data capture | "10% off for your email" | H | surveillance.email_capture_incentive | 1 |
| Notification solicitation | FOMO, interruption | "Never miss a deal" | H | surveillance.notification_prompt_language | 1 |
| Consent: no one-click reject | Default, obstruction | Banner structure | S | surveillance.consent_no_reject | 3 |
| Consent click-count asymmetry | Obstruction | Clicks to reject vs accept | — (v0.5) | | 2 |
| Location / contacts prompts | Data capture | "Share your location" | — | | 1 |
| Emotional sequencing by the feed | Priming, affect | Order of items | A (partial) | | 2 |
| Recommendation reasons withheld | Opacity | No "why am I seeing this" | — (platform adapters) | | 1 |

| Consent-or-pay wall | Default effect, data as price | Inline CMP config (consentOrPay, subscriptionURL) or a banner offering reject-and-pay | S | surveillance.consent_or_pay | 2 |

## 13. Visual & design psychology
| Technique | Mechanism | On the page | Det. | Rule | Sev |
|---|---|---|---|---|---|
| Red urgency colour | Affect, arousal | Red on scarcity text | V | design.red_urgency | 1 |
| Consent reject visually subordinate | Default, framing | Size/contrast/style asymmetry | V | design.consent_asymmetry | 2 |
| Modal with buried decline | Default, framing | Size/contrast asymmetry | V | design.asymmetric_choice | 2 |
| Animated / pulsing CTA | Attention capture | CSS animation on buy button | V | design.animated_cta | 1 |
| Large sticky overlays | Interruption, obstruction | Pinned elements >12% viewport | V | design.sticky_overlays | 1–2 |
| Tiny / low-contrast "Sponsored" label | Concealment | 9px grey text | V | dark.disguised_ads | 2 |
| Fake progress / fake loading ("finding you the best deal…") | Effort heuristic | Spinner theatre | — | | 1 |
| Fake cursor / fake notification sounds | Attention capture | Ads mimicking UI | — | | 2 |
| Trust-colour mimicry (bank blue, official seals) | Authority, halo | Government-style design | A | | 1 |
| Reading-flow manipulation (F-pattern upsell placement) | Attention | Layout | A | | 1 |
| Scarcity colour coding (amber "low stock") | Affect | Colour semantics | V (partial) | design.red_urgency | 1 |
| Deceptive "X" that opens an ad | Misdirection | Fake close buttons | — | | 3 |

---

### Cross-cutting: Cialdini's principles → where they appear
Reciprocity (gifts, free guides, email incentives) · Commitment/consistency (quizzes, foot-in-door, streaks) · Social proof (counters, toasts, badges, feeds) · Authority (experts say, badges, credentials) · Liking (flattery, love bombing, friendly bots) · Scarcity (countdowns, stock, exclusivity) · Unity (tribe, family, movement).

### Cross-cutting: cognitive biases covered by the glossary
Anchoring · loss aversion · present bias · hyperbolic discounting · pain of paying · social proof · bandwagon · authority · curiosity gap · variable reward · Zeigarnik · FOMO · default · status quo · filter bubble · mere exposure · illusory truth · false dilemma · slippery slope · availability · appeal to nature · false precision · framing · agency hiding · conspiracy framing · outrage · affect heuristic · fear · dehumanization · guilt · reciprocity · liking · ego · commitment · foot-in-door · isolation · optimism · future faking · DARVO · gaslighting · sunk cost · endowment · halo · puffery · left-digit · partitioned/drip pricing · zero-price · forced continuity · goal gradient · exclusivity · greed · trust badges · roach motel · obstruction · confirmshaming · trick question · forced action · sneaking · bait and switch · unity · Barnum · personalization · cherry-picking · relative vs absolute · interruption · data capture · lock-in.
