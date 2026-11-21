---
name: game-rules
description: Use for changes to edition validation, server-side session transitions, clocks, claims, hidden information, clues or scoring.
---

# Exercise the relevant PRD scenarios

Locate the acceptance IDs on the issue and their exact rows in the PRD. Identify the actor, public and private inputs, server receipt time, phase and expected committed events. Use a deterministic clock, fixed editions and controlled locations. Keep game engines generic and rule-based — never hardcode city names, stations, timers, question catalogs, decks, powerups, or curses in engine code. Author official POC games as validated `RulebookPack` + `GeoSnapshot` assets using the same schema and pre-publish validator as community creator packs.

Run the rule or session tests for the changed transition. Include submissions immediately before and exactly at the deadline, duplicate action IDs, a lost acknowledgment and reconnect after a rival acts. For claims, exercise one owner and the zone counts on two clients. For hiding, inspect the actual seeker payload during briefing, head start and reconnect, then verify reset of private state on role swap. Compare both clients' terminal state.

In the PR, link the issue's acceptance IDs to commands and observed results. Use the canonical rules to explain why each winner, draw or void occurs. If a fixture cannot resolve an open product decision, record it on the decision issue. Real-world route feasibility and balance need the field evidence in the release milestone.
