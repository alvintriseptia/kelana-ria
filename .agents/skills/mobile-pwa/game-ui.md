# Design a Kelana Ria game flow

Kelana Ria is an illustrated city exploration game. Keep the map and the consequences of each move easy to read on a phone outdoors. Use Stormbound as a reference for how the board, card hand, targeting, and feedback work together. Use Kelana Ria’s own card frames, icons, artwork, and map treatment. [Stormbound screenshots](https://apps.apple.com/us/app/stormbound/id1234446615)

Jakarta is the proof-of-concept edition. Shared UI owns the typography, controls, card frames, and interaction patterns. Use the selected version of the `RulebookPack` and its `GeoSnapshot` for geography, names, rules, timers, and card availability. Associate local illustrations with their edition. Exercise shared layouts with another city or a clearly labeled synthetic edition so they can accommodate different names, map extents, and rules. Use the [game rules skill](../game-rules/SKILL.md) when the flow changes a game rule or session state.

## Design and deliver the interaction

1. **Name the player’s goal.** Start from the issue, the selected edition, and the viewer’s role. Identify what they can see, what decision they’re making, and what confirms that the action succeeded. For Studio, start from the creator’s immediate task, such as defining a boundary or editing one landmark.
2. **Storyboard the sequence.** For each step, identify what triggers it, what the screen shows, what the player can do, and what the server confirms. Include waiting, dismissal, failure, timeout, and reconnect where applicable. Use the same vocabulary as the live controls and the selected edition.
3. **Make a small clickable prototype for a new or substantially changed flow.** Start with one complete path and an important recovery state at 390 × 844. Use labeled practice data and separate it from live sessions. Review the interaction on a phone and record design decisions in the delivery issue. For a localized UI change, a short before-and-after sequence can establish the behavior.
4. **Connect it to the real game.** Reuse the current map, controls, and server actions where they fit. Keep local preview and selection responsive. Show committed map, card, and score changes when the authoritative state arrives. A sequence must remain usable if the motion is interrupted or disabled.
5. **Verify the feeling as well as the rules.** Capture the complete phone-size interaction, including its final state. Check that a player can describe the next action, understand what happened, and resume after a failure. Record simulated and field evidence separately.

Use a readable surface, compact illustrated cards, distinct shapes and labels for game states, and one prominent action at each step. Keep top-level navigation calm so the current move has room to stand out. Use motion to connect the input to its result.

## Worked example for a card draw

Use this sequence when the edition grants a draw with a choice. If the edition adds a card automatically, animate the addition to the hand and display the result according to its visibility rules.

| Step | Player experience |
| --- | --- |
| **Earn and open** | When the game grants a draw, make the deck or draw indicator the visible source. Open a focused pop-up above the board when the player opens the draw or the game flow calls for it. Display the required number of choices and any deadline from the real offer. |
| **Deal** | Move card backs from the deck or draw indicator into the pop-up and settle them in offer order. Keep the entry short and make the card positions easy to scan. The draw offer is already committed before the deal animation begins. |
| **Reveal and inspect** | Flip a card when the flow benefits from a reveal, either on entry or with a tap or keyboard action. Reveal only card information the current player can inspect. Present the card name, effect, and any conditions in readable text. Reveal and inspection can be separate from selection. |
| **Choose** | Lift or outline selected cards and show the live selection count. Let the player change their choices. Keep the required count and any reason confirmation is unavailable visible. Support ordinary tap and keyboard controls so everyone can complete the flow. |
| **Confirm** | Show a clear confirmation action such as **Simpan 2 Kartu** once the selection meets the offer’s rules. Submit the selection once, show the pending state, and keep the selection available if a retry is allowed. |
| **Resolve** | When the server confirms, move the kept cards into the hand and dismiss the rest according to the rules. Update the hand and return focus to the relevant control or next action. For a lost acknowledgement, restore the current offer or confirmed hand from the server before showing a result. |

Use the server’s deadline throughout. On reconnect, restore the current offer and available choices without dealing an already seen batch again. Follow the edition’s timeout rule if the offer expires. Keep private card faces out of other players’ views, alerts, and replay displays.

## Apply the same approach across the app

- **Cards on the map.** Keep the board visible while the player inspects a targeted card. Show its effect, highlight legal targets with a shape or outline, and show the selected target before confirmation. Resolve with a visible change where the player acted. For example, **Perisai Klaim** adds a shield to the confirmed landmark.
- **Map questions.** Preview the proposed geometry before sending a supported question. A Radar preview uses a clearly labeled pending circle. The hider confirms the answer manually and the seeker sees the deduction change when the game receives it. Keep the map camera and the persistent MapLibre instance across drawer changes, game updates, and target selection.
- **Landmarks and menus.** Let the map carry the landmarks and their states. Open details for the selected pin, and show the landmark directory as a fallback if the map is unavailable. Keep Refresh and Exit under top-right **More**.
- **Catalog and tutorial.** Present each playable edition as an illustrated card. Put its actual rules and playable story on the detail screen. Give each tutorial step one action and show its consequence, such as a pin locking or a confirmed clue narrowing the search area.
- **Creator Studio.** Choose the format and template before entering the editor. Give the map space and put the selected point’s fields and validation in a focused drawer. Show saves and previews where the creator can see their effect.
- **Results.** Show a clear outcome and the score or objective that decided it. Reveal a few meaningful moments as a recap, with a separate action to share if the game supports public results.

## UI Architecture, Motion and Verification

Kelana Ria uses **Preact 11 + `@preact/signals`** incrementally per route via [`apps/web/src/ui/mount.tsx`](../../../apps/web/src/ui/mount.tsx), while keeping the landing page (`/`) lightweight vanilla TypeScript + lazy **GSAP (`ScrollTrigger`)** so `/catalog` stays under the `100 KiB` cold-load JS budget. Mount imperative MapLibre GL JS views once inside [`apps/web/src/ui/MapHost.tsx`](../../../apps/web/src/ui/MapHost.tsx) and update layers/markers in-place across signal updates so the canvas never tears down.

Standardize motion by surface:
- **Landing page (`/`):** Use **GSAP + `ScrollTrigger`** ([`apps/web/src/landing-gsap.ts`](../../../apps/web/src/landing-gsap.ts)) for cinematic scroll-storytelling chapters, SVG route reveals, and responsive `gsap.matchMedia()` choreography. Keep GSAP dynamically imported only on `/` and completely excluded from `/catalog` chunks and `sw.js` precache.
- **In-game & interactive player UI:** Use **Motion** (`motion` vanilla DOM API via [`apps/web/src/game-motion.ts`](../../../apps/web/src/game-motion.ts)) for interruptible spring physics (`snappy`, `tactile`, `bouncy`, `dramatic`, `sheet`), tactile card press/deal/flip/lock feedback, staggered list reveals, error shakes, and numeric count-ups. On `/catalog` (and shared toasts imported by `/catalog`), lazy-import `./game-motion` only after first user interaction or toast display so the `/catalog` cold-load shell bundles zero `motion` bytes.
- **Persistent FX layer:** Mount [`GameFxOverlay`](../../../apps/web/src/game-fx-overlay.tsx) (`pointer-events: none`, `aria-hidden="true"`) once inside active game shells outside re-rendered HUD/dock subtrees for sequence-deduped floating score/time deltas, stamp bursts, and non-blocking phase/role banners. Pair visual FX with accessible status announcements (`role="status"` / `aria-live`) elsewhere.
- **Default to lightweight 2D transforms & opacity:** Keep layout, hit targets, and state updates usable during motion. Three.js is optional only for a specific scene where depth improves understanding and a phone prototype demonstrates a clear benefit. Keep MapLibre responsible for the live map.

Honor `prefers-reduced-motion: reduce` (`motionAllowed()`) with immediate reveals, zero `[data-game-motion]` replay flashes, skipped `GameFxOverlay` visuals, and clear static selected states. Make card pop-ups and dialogs keyboard operable, give them clear accessible names, and place or restore focus appropriately. Announce significant results and actionable deadlines. Ensure touch targets and labels remain usable outdoors.

For changed flows, verify the normal path, reduced motion, and keyboard use. Exercise rapid taps, rejected or expired choices, reconnect after confirmation, and duplicate game updates where relevant. Play feedback once per new committed event (`data-game-motion="${kind}:${sequence}"`). Confirm the UI remains readable at 390 × 844 and 320 × 640, the map stays mounted, the final visible state matches the server, and the player can still act if motion is disabled. Follow the [mobile PWA verification steps](SKILL.md) for tests and evidence.

## Active gameplay concept

Open the [clickable Claim the City and Hide & Seek prototype](../../../docs/qa/gameplay-concept/README.md) for the screen hierarchy, existing role controls, and phone-size reference frames. The practice edition tests long place names, a collapsed board, card targeting, and retry. Use live room data for rules, scores and eligibility during production implementation. Preserve the current tab names and use the same place actions in the map and its list fallback.

Use the [player basemap and token evidence](../../../docs/qa/gameplay-concept/map-evidence.md) alongside the prototype when designing Claim territories, Seek deductions, or in-game controls. Reuse the player's pastel style and token family and check the overlays against MapLibre at both phone sizes.

| Event | Motion target | Static state and recovery |
| --- | --- | --- |
| Primary action | Brief press and release, 80–180 ms. Keep optional spark local. | Button press acknowledges input. Show pending separately. |
| Inspect or choose a card | Lift 4–8 px and settle, 120–220 ms. | Outline, check mark and pressed state. Keep confirm reachable. |
| Private reward arrives | Stagger backs, reveal and settle in offer order, 350–650 ms total. | Display faces immediately with reduced motion. On reconnect, restore the offer and selection without replaying a deal. |
| Keep or cast | Move kept card toward its hand or legal target, then confirm briefly, 200–450 ms. | Update the actual hand and target. Restore pending inputs or show an expired offer. |
| Claim, lock or steal | Pop the pin and stamp its shape, 250–600 ms. Keep the delta under 1.2 s. | Owner, state shape and objective progress update on confirmation. |
| Zone changes hands | Pulse the affected area, 300–650 ms. Keep the banner under 1.9 s. | Zone state, owner label and announcement. |
| Score or time changes | Animate the confirmed delta and count toward the authoritative value, 200–450 ms. | Show the final value immediately. |
| Radar and other map clues | Dashed pre-send geometry. Use a short wave on a confirmed deduction, 250–500 ms. | Label and distinguish preview, awaiting answer and confirmed geometry. Keep the hidden position private. |
| Question or answer | Press, pending text, then a brief stamp once the room confirms, 150–400 ms. | Label what is pending, record the result and keep the retry action available. |
| Role or phase changes | Badge or compact banner transition, 250–500 ms. | Update the HUD and role-specific controls immediately. |
| Sheet opens or switches | Translate and settle, 150–280 ms. | Keep the map mounted. Restore focus and panel scroll position. |
| Rejected or expired action | Brief outline or restrained shake, 180–320 ms. | Show a recovery message and retain the valid parts of the selection. |

Run motion from local input or a new committed sequence as specified above. Duplicate events, rollback, offline recovery and initial hydration hydrate semantic state. Use a single transient result at a time and clear decorative effects when reduced motion changes. Keep the board and menus available while effects run.
