# Notifications during a match

Delivery policy for [issue #87](https://github.com/alvintriseptia/kelana-ria/issues/87) and implementation [#91](https://github.com/alvintriseptia/kelana-ria/issues/91). Players need a prompt when a new decision is available, an acknowledgement after their own action, and a way to catch up after leaving the app.

## What players see

| Surface | When it is appropriate |
| --- | --- |
| **Action prompt** | The player can act now and the decision is time-sensitive. Link directly to the relevant panel, show the current deadline there, and keep it available until resolved. |
| **Brief alert** | A meaningful change just happened for this player. Show one concise line and an optional panel action. Keep the map, clock, and current selection usable. |
| **Recent activity** | Players may want to understand what changed, including routine ownership changes and events missed while away. Use authorized summaries in chronological order. |
| **Map, panel, or action feedback** | The state already explains itself beside the player's action. Routine updates and acknowledgements can stay in the affected view. |

An alert belongs to an authorized room participant. It uses the current seat, team or turn role as appropriate. Use the engine's accepted transition or resolved status as the trigger. A preview, attempted submission, network retry, map refresh or local countdown reaching zero can update local UI while it awaits the engine.

## Hide & Seek

The authoritative inputs are the room phase and turn, committed question state, completed turns and outcome, plus the hider-only deck and action state. Question timers use each question's deadline. [Room and question contract](../../packages/contracts/src/rulebook-seek.ts) · [Seek transitions](../../apps/api/src/seek-engine/seek-engine.ts) · [Deck visibility](../../apps/api/src/seek-engine/deck-engine.ts)

| Committed change | Audience | Alert and timing | Destination and permitted copy |
| --- | --- | --- | --- |
| Match starts or next head start begins | New hider and seekers | Show each player's role once as the phase changes. The hider's setup action is prominent until the position is locked. Seekers see the release clock. | The hider goes to the map to choose a hiding point. Seekers see when searching begins. |
| Hider locks a hiding position | Hider | Confirm in the current map action. | “Titik sembunyi terkunci.” The pin and check-in details belong in the hider's authorized map. |
| Seekers are released | Current seekers | One action prompt while seeking is active. Hider sees the new timer in place. | Map or clue panel. “Waktu mencari dimulai.” |
| Question becomes pending | Current hider | Immediate action prompt. If several questions are open, show the earliest deadline and a count of other open questions. The asker's own send gets a local acknowledgement. | **Pertanyaan** opens the unanswered list. “Ada pertanyaan baru. Jawab sebelum waktu habis.” The normal question detail shows the family and prompt. |
| A pending question approaches its deadline | Current hider | Keep the absolute deadline in **Pertanyaan**. Make one in-app reminder when a question with an original response window over 30 seconds crosses 30 seconds and is still answerable. | “Waktu jawab hampir habis.” Recompute against the server clock and remove the reminder as soon as the question resolves or the turn closes. |
| Question resolves as answered | Current seekers, with the asker first in priority | Brief alert and one activity entry while this turn is active. Hider sees confirmation in the answer panel. | “Jawaban sudah masuk. Lihat petunjuk.” Open the authorized clue or updated deduction map. Photo stays inside the normal guarded viewer. |
| Question times out, is vetoed, cannot be answered or closes | Hider and relevant current seekers | Show the final state once. Timeout can lead to an objective deduction from the engine. A photo timeout can leave no clue. Alert the asker on a still-relevant timeout or closure. Turn-close bulk changes belong in activity. | “Waktu jawab habis. Periksa pertanyaan.” Choose the next available action from the resolved state. |
| Draw, card use, or curse changes an available action | Active hider for a choice draw. Affected actor or target for a legal card effect. | A choice with a deadline goes in **Kartu**. An automatic draw updates the hider's hand and confirms in that panel. A curse that requires an action shows the requirement to its allowed target. | “Pilih kartu untuk disimpan.” “Ada efek aktif. Lihat cara menyelesaikannya.” Other seats receive only a public effect already visible in their authorized game state. |
| Turn completes or enters regroup | All active participants | One turn summary. If regroup applies, show an action prompt for players whose regroup step is still pending. | “Giliran selesai.” “Buka titik kumpul untuk giliran berikutnya.” The destination comes from the current room state. |
| Match reaches a terminal outcome | Participants | One results transition and activity entry. Clear prompts from the closed match. | **Hasil** shows the standings and completion reason already allowed by the result view. The alert says “Permainan selesai.” |

## Claim the City

The engine records ownership, challenge, card and finish events and calculates current zone control. Use the committed ownership and standings together. Keep private action details out of the notification projection. [Claim room and event contract](../../packages/contracts/src/rulebook-claim.ts) · [Claim transitions and scoring](../../apps/api/src/claim-engine/claim-engine.ts)

| Committed change | Audience | Alert and timing | Destination and permitted copy |
| --- | --- | --- | --- |
| Room starts | Participants | One start prompt if the match is active. | Map. “Ronde dimulai. Pilih landmark untuk bermain.” |
| Player claims or locks an unowned landmark | Actor and room participants | Actor gets feedback at the pin with the new ownership state. Other players see the public map and recent activity. | “Landmark terkunci.” Activity may show the public landmark, team and status. |
| Landmark changes hands | Former owner's team, acting player, others as permitted by public ownership | Brief alert for the affected prior team while the round is active. Show acting player's confirmation in the current panel. Other players get map state and activity. | “Landmark timmu direbut.” Open the landmark with its current state. Offer a new claim only when the game allows it. |
| Zone becomes controlled by a different team or goes neutral | Participants | Update **Skor** and activity for all. Show at most one brief alert to a directly affected team when it changes the team's position. Merge it with a steal from the same move. | “Penguasaan zona berubah.” Open the current score. The active public standings determine how to describe the result. |
| Challenge fails, expires or is forfeited | Attempt owner. Eligible opponents only when the pack grants a steal opportunity. | Owner sees recovery or expiration at the challenge. A public steal opportunity stays on the map or in recent activity. | “Tantangan berakhir. Pilih langkah berikutnya.” Share only the published vulnerable state with rivals. |
| Proof review becomes available or resolves | Eligible rival reviewers and proof submitter | Use the existing pending review panel for eligible rivals, with a brief prompt if there is an active decision. Confirm resolution to the submitter. | “Ada bukti untuk ditinjau.” Open the secured review panel. The alert contains no image or proof identifiers. |
| Tactical card is earned, played or clears a curse | Owner or affected player | Confirm a draw in **Kartu**. Prompt a target when a legal action is available. Only the public board consequence may appear for other players. | “Ada efek aktif.” Link to **Kartu** or the appropriate action. A scouted challenge, hand, answer and private detour remain in the authorized panel. |
| Approaching round deadline and terminal state | Current players, then participants | Keep the round timer visible. Use one results transition after the engine commits the outcome. | “Ronde selesai.” Open **Hasil**, where players can see goal progress, the winner, a tie or another terminal reason. |

## Delivery and recovery

- **Open app.** Keep one action prompt for the nearest unresolved deadline. Use a brief polite announcement for an important update and a single accessible announcement for its state change. Preserve keyboard focus and the player's active map action. Let the player dismiss brief alerts. A result or new role replaces prompts that were tied to the previous phase.
- **Reconnect or reload.** Fetch current authorized state first. Use the recent activity list or one “Ada beberapa perubahan” summary for events missed while away. Restore the earliest still-actionable prompt from the refreshed state and the server clock. In a fresh browser with no previous cursor, show current state and recent activity as the baseline.
- **Ordering and deduplication.** Give projected events a stable server identity and ordered sequence within a room. Keep the last presented sequence or event set per room and authenticated seat, including across a reload. Match the initiating action acknowledgement and the polled copy to the same event. Keep a pending prompt tied to its current target and deadline so timestamp changes and re-renders preserve its identity. Discard older snapshots and expire alerts whose turn, state or deadline has changed.
- **Multiple updates.** Sort actionable prompts by server deadline, then event order. Keep all permitted records in activity, coalesce routine Claim updates, and show one combined alert when ownership and zone control changed on the same move. Match completion takes precedence over live alerts. Keep any other live actions reachable in their panel.
- **Background.** In-game alerts and reconnect should work without browser notification permission. A later background channel can ask per player only after they choose to receive room alerts. Candidates are a newly pending hider question, release for seekers, and a required regroup. Send at most one notification per event to an opted-in player while the action is still current. Use “Kelana Ria” and “Buka permainan untuk melihat aksi berikutnya” on the lock screen. Revoke at opt-out, room exit or expiry. A broadcast Claim, score change, photo, hand update or answer belongs inside the app.
- **Payload boundaries.** Project headlines and destinations for the recipient on the server. Check membership and current state again when opening a destination. Keep GPS coordinates, hiding anchors, found codes, answer data and overlays, photo IDs, and private card contents out of alert and activity payloads. Load allowed game details in their normal authenticated panels. Retain only the minimal display context needed for the activity.

## Scenario review

These are desk walkthroughs against the Rulebook contracts. The phone and reconnect tests belong to [#91](https://github.com/alvintriseptia/kelana-ria/issues/91).

| Walkthrough | Expected result |
| --- | --- |
| Seeker A sends Radar and the hider opens it | A sees the send acknowledgement. The hider gets one pending prompt. A replayed poll leaves the prompt and clock in place. Another seeker sees the ordinary question state. No alert has the pending answer or its geometry. |
| Hider answers just before cutoff and earns a card choice | Seekers get the answered notice and open their clue. The hider gets answer confirmation and a private choice prompt. Replaying the response keeps one activity entry and one card-choice prompt. |
| Hider reconnects after a photo timeout and with a later question still pending | Add the timeout to activity. Restore the pending question directly with its remaining time. The photo timeout offers no photo, and the reminder for the expired question is gone. |
| A turn ends while two alerts are queued | The result or regroup replaces the old prompts. Players see their new roles when the next head start commits. A previous turn's question alert does not reopen that turn's controls. |
| Claim players A, B and C make several routine claims while B is away | Pins and scores reflect the latest state. Open sessions get recent activity, and B gets a catch-up summary when returning. Routine moves do not cover the map with alerts. |
| B takes A's landmark and flips the zone, with C unaffected | B gets confirmation in the action panel, A gets one combined alert, and C sees the public changes in activity and score. A second poll keeps the same activity without a second alert. |
| C scouts a private challenge while A sends proof for rival review | A's eligible rivals see the pending review action. The proof loads only in the secured panel. C's scout result stays with C. The alert feed contains neither proof nor challenge material. |
| Match closes before a background candidate is delivered | The worker drops the expired candidate. On open, the player goes to current results. A notification payload contains neither board details nor identifiers that reveal a location or private clue. |
