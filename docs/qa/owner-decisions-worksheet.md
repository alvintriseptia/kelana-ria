# Product owner decisions worksheet (Issue #13)

Record decisions on [issue #13](https://github.com/alvintriseptia/kelana-ria/issues/13) (`§11`), then track the resulting PRD §11 update in a reviewed PR.

## Decision 1 · Locked Hide & Seek point closes while rival is offline
- **Context:** PRD §11 notes that joint void and voluntary forfeit are defined, but the outcome when a locked hiding point closes publicly while the other player is offline is unsettled.
- **Proposed options:**
  1. **Unilateral closure report -> immediate match void (recommended for safety):** Either player can report an inaccessible locked point, immediately ending the round as `void` (no winner) with the closure logged for board review so neither player has to wait at an unsafe/closed site.
  2. **Pending void until reconnect:** Hold the round until the offline player confirms, risking an expired clock.
- **Owner decision:** _Pending_

## Decision 2 · Closed Claim checkpoints make the solo win target impossible
- **Context:** If checkpoints close mid-round so fewer than 4 landmarks or fewer than 2 zones remain open for solo Claim.
- **Proposed options:**
  1. **Offer immediate `End without result (void)` (recommended):** Keep already-claimed landmarks visible in recap, award neither win nor loss, and log the closure for board review.
  2. **Auto-lower solo targets mid-round:** Complicates fair comparison across replays of the same edition code.
- **Owner decision:** _Pending_

## Decision 3 · Clocks, ties, and initial trial timing presets
- **Working defaults in PRD §§2–5, 11:**
  - Strict server-received deadline, no automatic pause, multiplayer ties draw, explicit active exit forfeits.
  - **Compact (`compact-board-v1`):** Claim `60 min` (solo target `4` landmarks across `>= 2` zones); Hide & Seek `30 min` head start / `60 min` search / `30 min` regroup.
  - **Jakarta-wide (`jakarta-wide-board-v1`):** Claim `120 min` (solo target `4` landmarks across `>= 2` zones); Hide & Seek `60 min` head start / `120 min` search / `60 min` regroup.
  - **Hide & Seek deck/bonuses:** Max hand `3`, Time bonus `+2 min`, Question delay `2 min`, objective window `2 min`, photo window `4 min`.
- **Owner approval & applicable board versions:** _Pending_
