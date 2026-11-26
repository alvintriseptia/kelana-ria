# Real-World Exploration Game
## Product requirements · 20 November 2026 · Detailed review draft

**Product decision.** A mobile game that turns real public places into a game board. Play alone or with a friend. Choose a format, then use clues or checkpoint challenges to decide where to go. AI prepares a fresh edition before each game. Local game writers can publish reviewed Jakarta packs. A host can choose a free official edition or buy one session of a creator’s pack.

**Inspiration credit.** Inspired by *Jet Lag: The Game*, created by Adam Chase, Sam Denby, and Ben Doyle. This is an independent project. [Official series](https://nebula.tv/jetlag) · [Creator credits](https://www.youtube.com/watch?v=PHjkSKQSzv4)

**Brand and first release.** The product name should work wherever people can play. Jakarta is the first setting. Its public spaces supply checkpoints, and walking, MRT, KRL and Transjakarta give players different ways to reach them. A plaza entrance or a signed park gate can be considered under the same access and field-review criteria as a station-area checkpoint. Use Jakarta in board descriptions and operator names in route guidance. The final brand name is open.

**Status.** The product direction, two formats, two player counts, two map sizes, three transit networks and AI-generated editions are agreed. The product owner approved the finding condition, hiding-place lock deadline, and exclusive first-completion scoring on 20 November 2026. Other operational defaults are proposed for engineering and QA review. Values marked **trial** are reproducible development settings pending field calibration. The product continues beyond Hackvember. November 27 is an optional showcase. Release readiness depends on the acceptance evidence below. Build status and field balance are unverified. The UK-inspired two-turn Hide & Seek design below supersedes the earlier one-turn proposal. Its local deck, draw rates, timing and photo prompts are trial rules for a proof of concept. For the Claim the City proof of concept, landmark claims determine control of named play zones. Section 5 defines both win conditions. On 20 November the product owner confirmed that the creator marketplace is P0. Its operating defaults in section 8.1 are proposals.

**How to review.** Sections 3–6 define the game players will experience. Section 7 defines what the generator may change. Sections 8–11 cover screens, failure cases, acceptance and rollout. Decisions with the greatest effect on gameplay are collected at the end.

## 1. Who plays and why

The initial player already rides Jakarta transit and has time for an outing. Today they can follow a walking tour or plan a trip to a destination. This game gives them a different reason to board, transfer or get off. For example, a player at Velbak can secure a nearby claim or spend their remaining time trying to reach an uncontested zone via KRL. The same choice can become a bluff when a friend is seeking.

| Player | Job to be done | Observable success |
|---|---|---|
| Solo explorer | Start a real outing without organizing a group, make decisions, and know whether I won | Completes setup alone, chooses a route, receives a definite result |
| Pair of friends | Share a fair competition while traveling separately | Both see the same rules and result. Each can explain at least one decision influenced by the other |
| Returning player | Reuse a familiar map and have a reason to travel differently | A new edition changes a viable opening, clue choice or recovery route |
| Local game writer | Turn firsthand knowledge of Jakarta landmarks into a playable pack and offer it to players | Submits a pack, sees the review outcome and can reconcile a completed order to earnings |

**Scope boundary.** Walking, MRT Jakarta, KRL and Transjakarta are eligible within the selected board in Jakarta. Normal fares are paid by players. Real departures and missed connections are part of play. Public matchmaking, groups larger than two, live vehicle ETAs, automated fare payments, continuous opponent tracking and new cities are outside this release.

## 2. Vocabulary and playable configurations

In player-facing copy, show the format and board as separate labels, for example **Hide & Seek · Jakarta (Compact)** or **Claim the City · Jakarta (Wide)**. Hide & Seek requires two people. Claim the City supports one or two.

- **Board:** a versioned boundary, starting point, allowed transit segments and catalog of public checkpoints. **Transfer:** changing services or walking between operators. A transfer alone earns nothing.
- **Checkpoint:** one published, identifiable street-level interaction point with a coordinate, radius, access notes and stable ID. A station name describes an area. It is insufficient to identify the exact point where players must stand.
- **Edition:** an immutable set of active checkpoints, public rules, challenges, bonuses, question types and timing for one configuration. **Session:** one live playthrough, including players, secret, events and score. Replaying an edition starts a new session. For Hide & Seek, one session is one match with two hiding turns, one per player. Claim the City uses a single scoring period.
- **Check in:** deliberately request foreground location and verify presence. **Claim:** complete the checkpoint challenge and acquire ownership. **Investigate:** check whether the current checkpoint is the hiding place.

| Board | Hide & Seek · two players | Claim the City · solo | Claim the City · two players |
|---|---|---|---|
| Compact | Find a friend | Claim landmarks across zones | Control the most zones |
| Jakarta-wide | Find a friend | Claim landmarks across zones | Control the most zones |

**Compact board proposal.** Start at CSW–ASEAN. Candidate checkpoint areas are Blok M, Senayan, Mayestik, Rawa Barat, Velbak/Kebayoran and Palmerah. Velbak/Kebayoran has one canonical game point even though the area links transit operators. Publish a pin, landmark description and accessible approach for each approved point.

**Jakarta-wide proposal.** Use CSW–ASEAN as the initial shared start for comparability. Add candidate areas around Dukuh Atas/Sudirman, Tanah Abang, Manggarai and Jakarta Kota. The wide edition must activate at least two approved checkpoints outside Compact with usable routes to them. A zoomed-out Compact edition fails acceptance. Players may travel through intermediate stops inside the board. The start cannot be a hiding place or claim.

**Board publication.** A checkpoint is eligible only when its record identifies a public interaction point, usable approach, allowed hours, branch tag, source and review date. Hiding points must also be reasonable places to wait. A reviewer checks the physical detail and accepted answers for every observation challenge. Show both boards as MVP requirements. Missing field evidence is tracked per point and board. Each claimable landmark belongs to exactly one published play zone. Show the zone name and boundary before play. The board author defines these areas around recognizable places. They need not follow administrative district boundaries.

**One-day MVP scope.** Design each game for a single outing that players can finish in one day. The proof of concept tests whether they can travel between places, make route choices, complete challenges or deductions, and reach a result in the time shown before Start. Count walking, waits, transfers and time on site. For Hide & Seek, count both players’ head starts and searches, plus regrouping between turns. Scope the MVP to single-day games. Field playtests will establish realistic durations for each board and format.

**Reference presets for controlled QA only.** Use the following fixtures so engineering and QA can reproduce the same cases before field timings exist. A real edition must pass the route checks in section 7 with its own board data. At the trial limits below, two full hiding turns use up to 3 hours on Compact or 6 hours on Jakarta-wide, plus regrouping at the shared start. Show a board-specific regroup estimate in the outing preview. Validate it from every eligible end point before publishing.

| QA setting | Compact | Jakarta-wide |
|---|---|---|
| Hide & Seek head start / search limit per player | 30 min / 60 min | 60 min / 120 min |
| Claim duration in either player mode | 60 min | 120 min |
| Trial maximum cards held by the hider | 3 | 3 |
| Distance equality tolerance on stored walking comparisons | 100 m | 100 m |
| Trial solo Claim goal | 4 distinct landmarks across at least 2 zones | Same starting goal, subject to route validation |

## 3. Setup, time and session lifecycle

1. Choose format, player count and board. Show a short objective, meeting point, allowed travel, suggested outing time and expected use of mobile data and normal fares before location permission. Offer Claim the City for solo play. Hide & Seek requires both a hider and a seeker to join. Marketplace players can instead start from a pack listing, see supported settings and unlock a room as described in section 8.1.
2. Generate or retrieve a valid edition. Preview active checkpoints, win condition, question or score rules, check-in method, time budget and any special rule. Show the solo Claim landmark and zone targets. Keep the hiding place, answer keys and each player’s private actions secret.
3. In solo Claim, check in at the published start on one device and tap Start. A failed check-in leaves the clock stopped. Repeated Start requests return the same session and deadline. In multiplayer, the creator shares a private invite code. The first guest occupies seat two. For Hide & Seek the host assigns roles before either player marks ready. Both players review the same edition and check in at the start. A settings or role change clears readiness. After both are ready, the host starts; a duplicate Start returns the original session state.
4. The server records the start and deadlines. Show local WIB time and a countdown. Backgrounding, refresh, disconnection or leaving the screen does not pause the clock. During the head start the seeker sees the countdown, public briefing and public board. Search actions unlock at release after start-point verification. Solo play skips the private lobby and multiplayer release wait.
5. Finish with the reason, winner or draw, and a short event recap. Results are read-only. Reuse a round code to start a fresh session with the same public rules. A multiplayer invite grants access to one room only.

| State | Permitted transition | What the player sees |
|---|---|---|
| Setup / generating | Valid edition → preview. Invalid or unavailable → retry or choose a checked fallback | Generation status and whether the edition is live-generated or prepared |
| Preview / lobby | Ready at start → active Claim or Hide & Seek head start | Public rules, roles, ready status and map |
| Head start | Timely private lock → seeking at the scheduled release. No valid lock → void match | Hider can travel and lock. Seeker waits at the start. Both see the same release time |
| Seeking / claiming | First hiding turn ends → regroup and swap. Second hiding turn or Claim ends → result | Turn or match progress, actions, clock and result |
| Finished / void / abandoned | Replay → new session | Reason for ending, result when applicable, replay option |

**Clock boundary.** An action is eligible when the server receives a valid submission strictly before its applicable deadline. At the deadline or later, expiry applies. Order simultaneous eligible actions using the server’s committed event order. Losing an acknowledgement never takes away an already committed action. Evaluate already-reached terminal conditions before exit or void requests. A voluntary multiplayer exit after start forfeits to the other player. A disconnected player keeps their seat while the current phase runs. Hide & Seek regroup expiry is defined below. Solo exit is recorded as abandoned. A host can cancel an unstarted lobby without awarding a result.

## 4. Hide & Seek rulebook

**Objective.** Each friend hides once and seeks once. The player with the longer adjusted hiding time wins the match. Tie scores draw. Both use the same board, head start, search limit, prompt menu and deck composition. A hiding turn measures time from scheduled seeker release to discovery or the search limit. The head start and regrouping count toward the outing only.

**Turn sequence.** Meet at the published start and assign the first hider. During the head start the hider chooses a reachable public hiding point, travels and privately locks it with a verified check-in. The seeker waits at the start. A missed lock voids the match. At release the seeker verifies the start once, then travels freely using allowed services and walking. The hider stays at the locked point, receives questions, answers truthfully and manages a private hand. The hider sees the checkpoint named in a request and its time. Neither player receives a live opponent location feed.

**Finding and changing roles.** The seeker can investigate any eligible point with a verified check-in. A miss rules it out. A match with the locked point ends that turn immediately, under the previously agreed finding rule. At timeout, award the full search limit as elapsed hiding time and reveal the point. After turn one, both return to the shared start and check in. Swap roles, reset cards, questions and deductions, and retain the first score. Publish a regroup allowance based on the longest modeled return plus a field-tested buffer. If the second turn cannot start within it, end as incomplete and show the completed turn without a match winner. An explicit voluntary forfeit still ends the match under section 3.

**Choosing a clue.** The seeker has a menu. Each request names its reference checkpoint, inputs, reward and response deadline. The reference is the last verified seeker checkpoint when sent. One request may be pending. A completed combination of family, reference and inputs can be reopened for free but never earns another draw that turn. Both players see the answer history. Check-ins, route selection and investigation stay available while waiting. The server can check objective replies privately and invite correction. Only the hider’s confirmed answer is delivered in ordinary play. Field review must establish that photo prompts can be answered from every eligible hiding point.

| Question family | Original Jakarta trial prompt or rule | What the seeker learns |
|---|---|---|
| Radar | Choose a published radius around my reference point. Does your locked point fall inside the circle? | Yes or no using straight-line distance, including the boundary |
| Photo | From your waiting spot, photograph the roofline of a public structure visible from there | The seeker interprets the image and can compare it with what they see on arrival |
| Warmer or colder | Compare my two latest distinct check-ins. Which put me closer to you? | Direction of change using the board’s distance table and published tie tolerance |
| Matching | Does your point have the same board-assigned transit branch as mine? | Whether the two printed branch labels match, including at interchanges |
| Measuring | Which of us is closer by the board’s stored walking distance to the public landmark I selected? | Seeker, hider or about equal |
| Nearest landmark (“tentacles”) | Within a chosen circle centered on my reference, show the listed landmarks. If your point is inside, which listed landmark is closest to you? | Outside the circle, or the nearest landmark by straight-line distance. On a tie, report all tied names |

**Question price and hider hand, trial.** The hider starts each turn with an empty hand. Photo earns one draw. Radar and warmer/colder draw two, keep one. Matching and measuring draw three, keep one. Nearest landmark draws three, keep two. Show these costs before sending. For the first trial each hider receives a freshly shuffled deck with four copies of each of the three original effects below. Draw without replacement, recycle the shuffled discard pile when needed, then discard to a hand of three. Award each accepted answer once. If the hider disconnects or leaves a draw unresolved, auto-keep the first eligible draws in order and discard excess newest cards. Both turns use identical limits.

| Effect | Hider decision and resolution |
|---|---|
| Time bonus | Hold for +2 scoring minutes per copy still in hand at turn end. Bonuses never extend play |
| Question delay (curse) | Between requests, discard to block new questions for 2 minutes. The seeker can travel or investigate. An active delay cannot stack |
| Hand swap (power-up) | Between requests, discard this card and another held card to draw two and keep one. An accepted play consumes its cost exactly once |

For example, 28 minutes hidden plus two retained bonus cards scores 32 minutes. A rival who hides for 31 minutes with an empty hand loses by one minute. Card names, text, quantities and rewards above are local trial designs.

**Answers, photos and timing.** Trial response window: 2 minutes for objective questions and 4 for a photo, capped by the search deadline. On an objective timeout, deliver the computed answer without a reward. On an unavailable photo, denial of camera access, or photo timeout, offer an immediate objective substitute without a second reward opportunity for that request. For a submitted photo, remove location metadata, show a preview, restrict access to the two players, and delete it at match end. Use public features visible from the waiting point and avoid identifiable people. Confirmed objective clues support deductions. The seeker interprets photo evidence. Discovery or expiry closes all pending questions, draws and card actions. Resolve an earned draw before scoring, using its automatic selection if needed.

**Worked decision.** At a transfer the seeker suspects two branches. They can use radar before boarding to rule out one side of the map, giving the hider a choice of cards. Or they can ask for a photo for a smaller reward, then decide whether a visible roofline is distinctive enough to change trains. The seeker can also skip the question and investigate directly.

## 5. Claim the City rulebook

**Objective.** Two players compete to control the most play zones. Solo players aim for the landmark and distinct-zone counts shown in the briefing. Each active landmark counts once and its zone is visible before travel.

**Landmark challenges.** Label each claimable point with the place players will explore. Show nearby transit separately for route planning. Every claim requires a task about a distinctive feature observable from that point. Give each player in an edition the same prompt at that point. AI can select approved tasks and vary the active landmark set within the published zones. A reviewer owns the observation, choices and answer key.

| Proposed board and place | Example player task | Evidence needed before release |
|---|---|---|
| Compact · Taman Literasi Martha Christina Tiahahu, Blok M | At the amphitheater overlook, pick the sketch that matches the arrangement of seats around the performance space | Confirm a publicly accessible observation point, current layout and one unambiguous match. Supply original sketches and equivalent text choices |
| Jakarta-wide · Taman Fatahillah, Kota Tua | From the marked spot on the square, face the former city hall. Identify the detail directly above its central entrance from three descriptions | Verify the exterior sightline, exact feature and plausible alternatives from that point without museum admission |

These are candidate tasks. The city documents the [park facilities](https://dcktrp.jakarta.go.id/beranda/pengumuman/165) and the [former city hall](https://storage.jakarta-tourism.go.id/public/documents/RH8Ryc5jlzV6OM0ume4wlpcAo1kg8t-metaVEhFIE9GRklDSUFMIEpBS0FSVEEgVE9VUklTTSBHVUlERUJPT0sgLSBFTkdMSVNILnBkZg%3D%3D-.pdf). Verify the actual viewpoint, physical detail, hours and access before activating either task.

1. Travel to an active point and check in. Show the prompt for a verified, publicly observable detail. The MVP uses a single-choice answer with a reviewed answer key. The player can leave the challenge and navigate elsewhere.
2. On submission, verify current presence again if the location sample has expired. A wrong answer awards zero and allows a retry after a trial 30-second cooldown at that point. The clock continues. Award ownership only on a correct, eligible submission.
3. The first valid multiplayer completion atomically assigns the checkpoint to one player. A check-in or open challenge never reserves it. Once claimed, it is closed to the rival. The losing submission receives the owner and updated board. The rival gains no claim from that submission. This makes the cost of a contested route visible and keeps scoring explainable.
4. After accepting a claim, count each player’s permanently owned landmarks in that zone. The leader controls it. Equal counts, including 0–0, leave it neutral. Publish landmark ownership, counts and zone control to both devices in the same update. Unclaimed landmarks never count toward a player’s total.
5. In solo play, win immediately when both minimums are met before expiry. At expiry or exhaustion, an unmet minimum means a loss. Multiplayer ends at expiry or when all active landmarks are owned. Compare the number of zones controlled, then total landmarks held across the board. Equal totals on both measures yield a draw.

**Solo progress.** With the trial goal of four landmarks across at least two zones, four in one zone leaves the game active. A fifth claim in another zone wins. Show both counters after each claim.

**Worked zone change.** In an illustrative Blok M zone with three active landmarks, A claims Taman Literasi and leads 1–0. B claims another landmark and the zone goes neutral at 1–1. B takes the third and controls the zone 2–1. A still owns Taman Literasi. The additional landmarks and boundary need field review.

### How Claim the City compares with Jet Lag

The main references are [Taiwan: Rail Rush](https://nebula.tv/jetlag/season/17) for competing over a transit map and [Schengen Showdown](https://nebula.tv/jetlag/season/13) for hidden challenges and decisions about rival territory. Claim the City is our Jakarta adaptation. The inspiration credit at the front applies to both game formats.

| Experience | Coverage in the current rules |
|---|---|
| Commit to a route under uncertainty | Players see the landmark, zone membership and current control before traveling. The on-site task opens at check-in. A missed connection or a rival’s published claim can change which trip is worthwhile. |
| Complete a challenge rooted in the place | Partial. The two candidate tasks test on-site observation with a single-choice answer. Whether players enjoy the activity itself still needs field evidence. |
| Read a rival and deny a scoring opportunity | Two players can contest a fresh landmark or neutralize the rival’s lead in a zone. Claims are public and travel between claims stays private. |
| Defend or retake territory | Winning another unclaimed landmark can neutralize or flip a zone. Each landmark stays with its first claimant. |
| Play alone in one outing | Solo players choose a route that can satisfy both landmark and zone targets before the deadline. |

**Playtest question.** In a two-player game, record one decision before a rival claims a landmark and the next destination each player chooses afterward. Ask what made the on-site challenge memorable. If both players simply follow their original routes and remember only answering a quiz, the test establishes that scoring works but leaves the intended travel-game experience unproven.

## 6. Check-ins, travel and fairness

| Situation | Player-facing behavior |
|---|---|
| In range and location accurate enough | Show checkpoint name, distance and the action being confirmed. Verify the configured radius against that checkpoint’s point |
| Permission denied, inaccurate or stale fix | Keep rules and map available. Explain the issue, show a retry and preserve game state. A manual pin cannot count as a scored check-in |
| Station platform, vehicle passing a point, or two nearby pins | No automatic claim, visit or lock. Use an explicit action naming the checkpoint, a fresh fix, and any required challenge. Overlapping interaction areas require review before board publication |
| Weak connection or interrupted submission | Show pending status until a server response. Retry the same action ID. Fetch authoritative state on reconnect. Offline actions cannot assign retroactive ownership |
| Route delayed, missed connection or public area closes | Players choose another legal route. Ordinary transit delays keep the clock running. If a target or start becomes inaccessible, offer **Report issue / end without result**; in a two-player game both must confirm a void. Keep the board issue for review |
| Player wants to take a break | Show elapsed and remaining time before the player exits. A player can stop at any time. Normal station rules and passengers take priority |

**Field settings, configurable per board.** Suggested QA fixture only: 100 m radius, maximum reported accuracy 50 m, maximum fix age 30 s. Use inclusive thresholds for distance and accuracy. Match the received sample to its timestamp. These values require field checks at street level on a typical Android phone. Store checkpoint ID and success for gameplay; discard raw coordinates and precision after the check. Showing visited checkpoints is sufficient for the round recap.

Travel restrictions operate by the visible board and player agreement. Only designated public points trigger game actions. The MVP does not record continuous route histories or store raw GPS tracks to police how players travel. In multiplayer Claim the City, an active match may optionally share ephemeral, in-memory foreground player positions (`opponentTracking` rulebook setting, defaulting to periodic GPS with last-check-in fallback) over the room event stream so rivals can read board positioning during play; raw coordinates are never written to SQLite or recaps and are wiped immediately when the match ends. Hide & Seek never broadcasts hider live coordinates—hider location remains strictly private behind server-verified clues. Show the difference between routes available to travel and checkpoints eligible for scoring or hiding.

## 7. AI editions and transit data

**Responsibility.** The model designs a variation. The game computes distances, arbitrates events, keeps the hider’s selection private, judges objective answers and computes winners. A transit route in an edition is a feasibility example. Players may choose another legal route. A human hider never has to follow a generated itinerary.

| Part of an edition | Required content | Visibility |
|---|---|---|
| Identity and settings | Edition ID, board version, format, player count, allowed modes, start, duration and public rule text rendered from validated parameters | Same briefing on both devices |
| Map and challenge set | Active checkpoint IDs, display names, branch membership, Claim zone IDs, verified prompt/fact IDs and available hours | Map, zone names and branch tags public; reveal prompts at check-in and keep answer keys private |
| Hide & Seek settings | Two turns, eligible targets, menu inputs and prices, fact and distance tables, response windows, deck, role order, regroup and search limits | Both players see rules and prices. Hide locks, private hands and undelivered answers from the seeker |
| Claim settings | Approved zone IDs and boundaries, active landmark membership and both solo minimums when applicable | Public before play starts and fixed throughout the session |
| Validation record | Data versions, route estimates, coverage windows, fallback origin and validation outcome | Source attribution and estimated-time label visible; diagnostics available to engineering |

**Generation sequence.**

1. Select the board, format, party size and configured duration. Load approved checkpoint facts, allowed connections and travel ranges for the intended play window. Travel cost includes entry, waiting, riding, interchange walks, exit and challenge time.
2. Ask the AI API for structured parameters from the allowed catalog. Reject invented IDs, unsupported rule types, contradictory objectives, invalid targets and challenges without a reviewed answer. Render scoring and deadlines from validated values. AI-written flavor text cannot override those values. For each Claim prompt, require the approved fact and answer key to belong to the active checkpoint. Reject a valid prompt assigned to the wrong landmark.
3. For each Hide & Seek board, validate both turns, the return journey, reachable hiding choices, objective partitions, on-site photo feasibility, response windows and card effects. Require at least one feasible deduction and investigation path for each eligible target within a search turn, without relying on a lucky card or recognition of a photo. Test radius boundaries, missing data and ties. Offer menu inputs from public board data so their availability cannot disclose the lock. AI selects reviewed variants before the match. Rules, rewards and answers stay fixed for both players.
4. For Claim the City, evaluate at least two feasible plans with different first checkpoints using normal waiting estimates. For solo play, both openings must have a feasible continuation to the published landmark and distinct-zone targets. Require multiple distinct claims to win and allow a winning route that leaves at least one active checkpoint unvisited. Publish the available destinations together so the player can choose their own order. Add one missed connection to a representative plan, then check that the player can still reach another scoring checkpoint in time. In multiplayer, test the case where a contested point is taken en route. These checks estimate playability; they cannot guarantee live service. Reject unassigned or multiply assigned landmarks. Require multiple active zones with enough reachable landmarks to contest their leads. AI may choose approved landmarks and prompts within these limits. Zone membership and winner rules come from the board and rulebook.
5. A successful edition gets a code and immutable data snapshot. Reopening the code yields identical public rules, even after catalog changes. Keep session secrets and game progress out of the edition code. Never embed the hidden target or answer key in seeker-visible responses. Before starting a replay or prepared edition, recheck board availability for the new play window. If access has changed, explain why that edition cannot start and let the player choose another. Preserve the original edition and completed results.
6. **Proposed failure policy.** Give live generation a 15-second total budget, with at most one retry for invalid output inside that budget. Then offer a labeled prepared edition for the same board, format and player count. If none is usable, offer Retry or Change settings. Never silently switch board or format. Maintain a validated fallback for each of the six supported combinations.

**Freshness.** Compare the new edition with the last edition played on that device under the same configuration, when available. For Claim, a different set of active landmarks must change a viable scoring plan. For Seek, a different candidate grouping or clue set must change at least one useful deduction. If only wording changes, treat the edition as a repeat. A repeat can be offered transparently when the catalog is exhausted.

**Integrations and dependencies.** Cloudflare Workers AI with GLM-4.7-Flash is the proposed AI API. Geoapify walking routes are the public non-AI API for street-to-checkpoint or checkpoint comparisons. Store approved walking results with their provider, retrieval date and attribution. If a fresh call fails, use the relevant approved snapshot; a missing comparison disables editions dependent on it. Transjakarta static GTFS and operator references support board preparation. Review reuse rights before importing other operators’ data or graphics. Record KRL/MRT connections independently when a source is for reference only. No exact player coordinates or private room details need to enter AI prompts.

Prior research identified a Workers AI free allocation of 10,000 neurons/day, an MIT-licensed proposed model and a Geoapify commercial free tier of 3,000 credits/day with Geoapify and OpenStreetMap attribution. Attribute Transjakarta’s CC BY 4.0 feed and indicate modifications. Verify account access, actual model availability, current limits and representative live responses during the integration spike. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) · [Model license](https://huggingface.co/zai-org/GLM-4.7-Flash) · [Geoapify plan and attribution](https://www.geoapify.com/get-started-with-maps-api/) · [Transjakarta GTFS](https://ppid.transjakarta.co.id/informasi/berkala) Cloudflare lists the model for Workers Free. Geoapify’s guide permits commercial apps with attribution, while its terms qualify free production use. Record the applicable production limits and rights for stored route results before public release. [Workers Free model availability](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/) · [Geoapify terms](https://www.geoapify.com/terms-and-conditions/)

## 8. Mobile experience and privacy

**Client decision.** The player client is an installable progressive web app (PWA). A player can start or join from a normal mobile browser link. Installing to the home screen is optional. Reopening a room restores server-confirmed progress using the existing player credential.

**Recommended map stack.** Use MapLibre GL JS to render the board and Geoapify vector tiles for Jakarta streets and labels. Draw our own game layers from approved board data. At city scale, emphasize transit branches, transfers and zones. Zooming in reveals landmark names and check-in points. In Hide & Seek, draw a radar circle centered on the seeker's recorded question reference after the answer is delivered. The seeker-facing map data must exclude the private target. In Claim, pair zone fill with an ownership label or icon so a tied zone is distinguishable without color. Use original graphics and the existing inspiration credit. [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) · [Geoapify vector tiles](https://www.geoapify.com/map-tiles/)

**Map budget and first test.** Keep the prototype on Geoapify Free. Map tiles and walking routes draw on the same 3,000 daily credits. A tile request costs 0.25 credits. The free plan permits commercial use with Geoapify and OpenStreetMap attribution. Include the linked map attribution and MapLibre’s required license notices. Run one simulated Compact Claim session on a phone, record tile and routing usage, and verify the checkpoint list remains usable when tile requests fail. An outage of the game server follows the pending and reconnect rules in section 6. [Free-plan conditions](https://www.geoapify.com/pricing/) · [MapLibre license](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)

| Screen | Required information and primary action |
|---|---|
| Choose game | One-sentence objective per format, supported player counts per format, board extent, estimated outing and controlled start location |
| Round briefing | Objective, deadline or duration, scoring and question prices, allowed transit, active checkpoints, access notes, edition origin and replay code. Show both targets for solo Claim and role objectives for Hide & Seek |
| Lobby | Join link/code, seats, role assignment, start check-in, readiness, waiting for partner, expired or full room feedback |
| Active map and equivalent list | Remaining time, score or current turn, landmark ownership, zone counts and control, or remaining hiding candidates, legal actions, previously confirmed actions. Marker shapes and text distinguish states without depending on color |
| Checkpoint action | Checkpoint name, required task, distance or reason access is unavailable, progress during submission and final accepted/rejected outcome |
| Hider / seeker views | Hider sees lock, incoming requests, reply and private hand. Seeker sees question menu, price, reference, delivered clues, pending status, active effects and investigation. Regroup shows the score and return directions |
| Results | Outcome, reason, per-player award breakdown or hiding-place reveal and clue history, final timestamps, replay action. A void shows its reason and awards no winner |

Use short Bahasa Indonesia labels for the initial Jakarta interface (proposed). Provide equivalent text actions for map controls, readable countdowns and screen-reader feedback for score or phase changes. When map tiles fail, the checkpoint list, briefing and confirmed game state remain usable. A joining player sees only their role’s permitted information. An invite code admits an empty seat; reclaiming an occupied seat requires that player’s existing private device credential. Never expose secrets via a generic room response.

### 8.1 Creator marketplace · P0

**Pilot journey.** An invited local writer submits a Jakarta pack. A reviewer checks the game in its public setting. A host discovers the published pack, buys one session and plays it solo or with a friend where the format allows. The writer can see the sale and their share. The proposed first paid pilot is a Compact Claim pack that supports both player counts. The free official boards continue to offer both game formats.

| Step | Player or creator experience | Acceptance rule |
|---|---|---|
| Write and submit | The writer enters their byline, title, format, board, supported player counts, price in IDR, checkpoint tasks, private answer keys and on-site verification notes. They can save a draft and revise a returned submission. | Drafts are private. The pilot can use approved checkpoints with original tasks. The reviewer checks public access, observable answers, feasible gameplay and content rights before publishing a version. |
| Browse and preview | The listing shows author, price for one session, start point, area, duration, eligible group size and transit fares paid separately. | Preview is available before purchase. The selected version passes the same board and edition checks as official games. Private answers and hiding information stay secret. |
| Buy and play | The host selects an eligible configuration and buys a pass for that room. A friend joins by invite under the same purchase. Solo Claim uses one seat. | The server verifies the order, amount, currency and settled payment before granting access. A return from checkout, pending order or expired order cannot unlock play. Reopening a paid room restores access. The game clock starts through the ordinary ready and check-in flow. |
| Record earnings | The writer sees one sale, the pack version, gross price, agreed deductions and creator share. | The pass and earnings entry reconcile to the same order exactly once, including on notification retries. Sandbox earnings are visibly labeled. The creator sees no player location or private clue data. |
| Handle a broken pack | Players can report a closed checkpoint or unusable task. A reviewer can pause sales for the affected version. | Stop new orders while paused. Preserve order history. Offer support to affected paid rooms. Before taking real money, approve refund handling, creator terms, the earnings formula and payout arrangements. |

**Payment proposal for the demo.** Use Midtrans Snap sandbox for a test purchase and independently verified payment status. Display “Test payment” at checkout and in earnings. If the provider is unavailable, retain the order state and use a labeled recorded purchase in the demo. Production marketplace eligibility, fees, account access and commercial terms still need verification before live sales. The proposed pilot uses invited writers and editorial review. Open seller registration and automated cash payouts can follow. [Midtrans sandbox](https://docs.midtrans.com/docs/testing-payment-on-sandbox) · [Payment verification](https://docs.midtrans.com/reference/handle-notifications)

## 9. Release acceptance and test scenarios

The product engineer can run these checks with controlled clock, checkpoint and provider fixtures. Record live integration checks separately. Use simulated GPS for the first pass. Run Compact solo Claim from the CSW–ASEAN start with a test edition whose target is four landmarks across two zones. Try a claim outside its check-in radius, move inside, answer the challenge, and retry the successful request. Expect one claim. Reach the fourth distinct landmark across two zones and confirm a win survives refresh.

For multiplayer QA, one tester operates two isolated browser profiles in the same private test room. Set each profile’s coordinates independently. Test a contested claim, or lock a hider’s point privately, ask for radar from the seeker profile, then move the seeker to the correct point and investigate. Compare the views before and after discovery. For marketplace QA use a sandbox purchase that unlocks the same test room for the invited guest. Label these runs as simulated and keep their results and earnings separate from public play.

A simulated pass establishes check-in, scoring, role visibility and session behavior. Later field checks measure entrance-to-pin walking time, transfer waits, GPS reliability, whether challenge answers are visible on site and whether the advertised one-day duration is realistic. A two-person pilot can then assess independent seeker deduction and enjoyment. [Chrome DevTools location overrides](https://developer.chrome.com/docs/devtools/sensors)

| ID | Given / when | Expected result |
|---|---|---|
| A01 | For every cell in the section 2 matrix, start a valid session and play to a terminal state | Correct board, format, roles, clocks and outcome persist on refresh; Jakarta-wide has eligible points outside Compact |
| A02 | Two players are ready and the host taps Start twice | One start timestamp, edition and session. A third device cannot occupy a seat |
| A03 | The hider checks in at Kebayoran, confirms a lock and tries to switch to Palmerah | First valid lock is final. Seeker receives neither location nor early-release signal |
| A04 | Head start expires with no lock, or a lock reaches the server exactly at release | Round is void. Both clients see the same reason |
| A05 | A player chooses solo, opens a solo Hide & Seek link or attempts to start Hide & Seek alone | Setup offers solo Claim. Unsupported configurations cannot generate or start a round. A two-player room waits for the second participant |
| A06 | Repeat a completed clue, reconnect during a draw, or open a question without required public data | Return the existing answer and hand without an extra draw. Invalid inputs cannot send a request |
| A07 | Seeker investigates the target just before expiry, then repeats the request after expiry | First accepted result stands. A first submission received exactly at expiry loses to the deadline |
| A08 | Two correct submissions for Palmerah arrive together, or an acknowledgement is lost | One owner, one increase in the relevant zone count and one ordered claim event. Both devices converge on the same state |
| A09 | In a three-landmark zone, A claims first, B claims second, then B claims third and retries | Control changes from A to neutral to B. Counts finish 1–2. The retry has no effect and A retains the first landmark |
| A10 | Rivals finish 2–1 on zones despite the leader holding fewer landmarks, or finish level on zones | More zones wins first. For equal zones, more landmarks wins. If both counts tie, draw |
| A11 | GPS is denied, stale, too inaccurate or outside radius | Preserve progress, explain the cause, allow retry. No verified visit, discovery or ownership |
| A12 | Device reconnects after rival claimed a point or time expired | Restore latest authoritative result. A stale screen cannot overwrite it |
| A13 | AI proposes a nonexistent route, unreachable target, invalid zone membership or unsupported challenge | Reject before preview. Retry or serve the labeled fallback for the same settings |
| A14 | AI fails mid-session or walking API is unavailable during preparation | Frozen active round still runs. Preparation uses an approved snapshot or a valid fallback |
| A15 | Seeker inspects public briefing, map, reconnect or room events before release | No target, answer key, hidden route, private lock timestamp or identifiable hider check-in |
| A16 | Demo movement is simulated; network then becomes unavailable | Simulation remains labeled. A prepared edition is identified as prepared. Recorded evidence of API calls is distinguished from a live request |
| A17 | An edition assigns a reviewed Blok M task to Kota Tua, or a landmark lacks a field-reviewed answer | Reject the assignment before briefing. A player can claim only after a verified visit and a correct answer to that site’s task |
| A18 | Open the mobile rules before starting either format, then review the demo closing slide | Both display the inspiration credit above. The mobile credit links to the official series. Use original or appropriately licensed rule text, artwork, footage and audio |
| A19 | A solo player starts outside the start radius, retries in range, and taps Start twice | Clock starts only on the first valid Start and keeps its original deadline |
| A20 | An approved checkpoint closes before a replay or prepared edition starts | Explain why it is unavailable. Previous results remain readable and the original edition is preserved |
| A21 | Play a complete session on the proposed board during one outing | Record elapsed time from Start to result, including travel, waits and on-site play. Demonstrate a feasible win within the advertised duration and record any timing changes needed. Hide & Seek includes the head start and search |
| A22 | A solo Claim edition has one viable opening, allows one landmark to win, or requires visiting every active landmark | Reject the edition in generation and fallback validation. A valid board supports different first stops and a multi-stop win with an unvisited alternative |
| A23 | Hider answers radar, then a photo, while the seeker changes checkpoints | The original reference controls the radar answer. The photo arrives privately without location metadata. The correct reward is issued once per answer |
| A24 | A hider plays a question delay or holds a bonus through discovery | A delay blocks new requests only. The turn score adds retained bonuses without changing the deadline |
| A25 | Friends complete two turns including one timeout, or fail to regroup | After a valid swap, private hands reset and first score survives. Compare adjusted scores only after both turns. A regroup timeout has an incomplete result |
| A26 | An objective or photo answer times out, or a late reply arrives after discovery | Apply the documented fallback once while play is active. A late reply cannot reveal a photo or earn a post-turn draw |
| A27 | Solo claims four landmarks in one zone, then a fifth in a second zone before expiry under the four-across-two trial goal | The fourth claim keeps play active. The fifth wins. Expiry before the fifth gives a loss |
| A28 | A writer submits a draft, receives a requested correction, and resubmits | Only the approved version is listed. It credits the writer and protects answer keys. |
| A29 | A host completes a sandbox purchase, refreshes and invites a second player | Both devices enter the same paid room. One charge unlocks one session. The game clock waits for player readiness. |
| A30 | Checkout returns before settlement, then the verified success notification arrives twice | Pending and expired orders give no access. A verified settlement creates one pass and one earnings entry. A different room cannot reuse it. |
| A31 | A listed pack has a confirmed closure | The reviewer can pause new sales. Existing orders remain visible for support and earnings reconciliation. |

## 10. Delivery, measures and demo

**P0.** Ship the installable PWA, both boards, two-player Hide & Seek and solo or two-player Claim, validated editions and same-configuration fallbacks, game resolution, mobile map/list, reconnect, the required AI and non-AI integrations, and the reviewed creator marketplace with sandbox checkout and creator earnings. **P1.** One-tap replay of a completed match or richer route recap. **After MVP.** Larger parties, public matchmaking, open seller registration, automated creator payouts and additional cities.

| Sequence | Reviewable outcome | Dependency and evidence |
|---|---|---|
| 1 · Compact Claim | Two editions from the same board change a viable first route. One solo session runs from briefing through results | Approved trial board, point facts and API credentials. Demonstrate generation, validation and fallback |
| 1b · First marketplace sale | An invited writer submits one Compact Claim pack, a reviewer publishes it, and a host unlocks a playable room | Reviewed pack, sandbox merchant access and a test price/share. Demonstrate A28–A31 and reconcile one sale to creator earnings |
| 2 · Private competition | A second phone joins and a contested claim resolves correctly | Shared session state. Demonstrate A02, A08, A09 and A12 |
| 3 · Hide & Seek | Two friends complete both turns, trade clues for cards and compare adjusted times | First test radar, photo, draw, one playable effect, discovery and swap together. Then exercise all six families and the three card effects. Demonstrate A03–A07, A15 and A23–A26 |
| 4 · Jakarta-wide and release | Both formats work with the wider boundary, real checkpoint options and calibrated presets | Reviewed wider data, all six smoke checks, mobile QA, deployment and rehearsal |

**Metrics.** During QA require all six configuration checks, zero duplicate awards and zero secret disclosures in the specified cases. During pilot use counts with denominators: rounds started/completed/abandoned by configuration, first-attempt check-ins accepted, median active time and fallback sessions out of all previews. Record whether players can name a decision they would change in another edition. Set public retention or replay targets after observing a baseline. For the marketplace, count submissions, publications, settled orders, paid rooms started and paid rooms completed. Report sandbox activity separately.

**Optional showcase walkthrough.** Show a live AI-generated Compact Claim edition and an attributed walking-route result. Have two devices watch a zone change from contested to controlled, then show why the final zone and landmark totals determine the result. Use a clearly labeled route replay if indoors. Show a seeker choosing a clue, the hider replying and drawing, a route decision, and the two-turn score. Label any seeded or recorded sequence. Keep a tested prepared edition and labeled recorded integration run available for outages. An untested configuration stays marked unverified in the release checklist. End the demo with the inspiration credit printed at the top of this PRD. Use the same credit in any public Hackvember submission description. For the marketplace segment, show the creator byline and pack preview, a sandbox purchase, the friend joining on the same pass, and the matching creator earnings entry.

## 11. Decision record and outstanding evidence

| Decision | Working default in this draft | Approval or evidence |
|---|---|---|
| What counts as finding a hider? | Verified investigation at the designated point. The hider locks once; failure to lock on time voids the round | Approved 20 November 2026 |
| What happens when a claim is lost en route? | Exclusive ownership with zero consolation points. The rival can immediately reroute | Approved 20 November 2026. Observe how players respond during the pilot |
| What determines the Claim winner? | Two players compare zones controlled, then total landmarks. Solo meets both published minimums | Approved for proof of concept. Four landmarks across two zones is the trial solo target |
| Is the marketplace in the MVP? | Yes. Creator submission, review, listing, purchase, room access and earnings are P0 | Scope approved 20 November 2026. Invite-only onboarding, one-session pricing and sandbox demo checkout are proposed. Commercial terms and payout timing are open |
| How strict are clocks and ties? | Server-received deadline, no automatic pause, multiplayer ties draw, explicit exit forfeits | Product owner approval |
| Where and how long can people play? | Candidate areas in section 2. Product owner chooses trial head start, search and claim duration, regroup allowance, question prices and bonus values per board before publishing a playable edition | Measure CSW → Velbak → Kebayoran → Palmerah, then at least one longer route on Jakarta-wide. The compact trip alone cannot calibrate both |
| Which physical prompts are reliable? | Reviewed observation and public point for each live challenge. One reviewed fallback per configuration | Content review, on-site access and GPS evidence; retain observed and estimated timings separately |
| What sets release timing? | Proceed by playable milestones. Begin with simulated Compact solo Claim, then test private competition and the marketplace journey. Each public game still fits within one day | Product owner confirmed flexible delivery on 20 November 2026. Record software, integration and field evidence as each becomes available |

### Release review · 20 November 2026

| Open item | What closes it |
|---|---|
| Board evidence | Start Compact at CSW–ASEAN with multiple active landmarks. Field-check two alternative openings across trial runs. Record actual travel, waits, landmark tasks, GPS and elapsed time for a complete multi-stop route to the solo target. One landmark visit can validate its prompt only. Repeat on Jakarta-wide with the required points outside Compact. Mark real observations separately from estimated waits |
| Balance in Hide & Seek | Play a full two-turn match on each board. Record elapsed outing time including regroup, whether a clue changed a transit decision, whether a hider effect mattered, and whether roles offered comparable scoring chances. Trial timings and deck balance need field evidence |
| Closures during an active game | The draft covers a joint void and a voluntary forfeit. Product owner to settle the outcome if a locked hiding point closes and the other player is offline, or if closed Claim points make a solo target impossible. Both players can leave immediately |
| Live APIs and recovery | Capture one accepted AI edition and one real walking-route response for its board. Rehearse an unavailable provider and a clearly labeled prepared edition. Keep account access, commercial conditions, quota and attribution with the evidence |
| Release confidence | Record pass, fail or untested against all six configurations. Run Compact solo Claim first with simulated locations. Release each board for public play once its route, GPS, landmark and session-duration checks have field evidence |
| Marketplace evidence | Record one creator submission through a completed paid-pack session in sandbox. Reconcile the order, pass and creator share. Confirm engineering capacity for this added P0 journey before promising demo coverage. |
| Credit and rights | Verify A18 on a phone and in the deck. Credit the creators for inspiration. Reuse of third-party creative material requires its own rights basis. Map and data attribution stays with the relevant map or data display. [Indonesian Copyright Law, Article 41](https://www.wipo.int/wipolex/en/legislation/details/15600) |

**Research informing the design.** [Taiwan Rail Rush](https://nebula.tv/jetlag/season/17) · [Hide and Seek Across Switzerland](https://www.youtube.com/watch?v=E8UmTJVDnUI) · [Geocaching HQ on observable questions](https://www.geocaching.com/blog/2024/10/six-tips-to-create-an-adventure/) · [Representation and evaluation of generated game content](https://www.pcgbook.com/chapter02.pdf) · [Jakarta integrated transit map](https://transportforjakarta.or.id/peta/) · [Kebayoran Skywalk](https://smartcity.jakarta.go.id/en/blog/menjelajahi-skywalk-kebayoran-lama/) · [Official UK season](https://nebula.tv/jetlag/season/16) · [Official expansion rules](https://rules.jetlagthegame.com/expansion/) · [UK question reference, community](https://jetlag.fandom.com/wiki/Hide_%2B_Seek:_UK/Questions)
