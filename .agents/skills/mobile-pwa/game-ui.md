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

## Motion and verification

Default to lightweight 2D. Use CSS transforms and opacity for short deals, flips, selection, and board feedback. Use the Web Animations API when a sequence needs explicit timing or cancellation. Keep layout, hit targets, and state updates usable during motion. Three.js is optional for a specific scene where depth improves understanding and a phone prototype demonstrates a clear benefit. Keep MapLibre responsible for the live map.

Honor `prefers-reduced-motion` with immediate reveals and clear static selected states. Make the card pop-up keyboard operable, give it a clear accessible name, and place or restore focus appropriately. Announce significant results and actionable deadlines. Ensure touch targets and labels remain usable outdoors.

For changed flows, verify the normal path, reduced motion, and keyboard use. Exercise rapid taps, rejected or expired choices, reconnect after confirmation, and duplicate game updates where relevant. Play feedback once per new committed event. Confirm the UI remains readable at 390 × 844, the map stays mounted, the final visible state matches the server, and the player can still act if motion is disabled. Follow the [mobile PWA verification steps](SKILL.md) for tests and evidence.
