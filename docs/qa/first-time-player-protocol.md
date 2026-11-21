# First-time player observation protocol (Issue #7)

Use this 15-minute uncoached protocol to collect real comprehension evidence for [issue #7](https://github.com/alvintriseptia/kelana-ria/issues/7) (`§§8–10`, `A11`, `A16`, `A27`).

## Setup (before handing over the phone)
1. Start the API and web build (`npm start --workspace @kelana-ria/api` + `npm run preview --workspace @kelana-ria/web`).
2. Confirm the participant has not seen the app before. Tell them: *"Think aloud as you go. I won't guide you unless you ask to stop."*
3. Record device model, OS, browser version, and whether movement is **simulated**.

## Uncoached task script

| # | Prompt to participant | What to observe before offering help | Pass / Confusion notes |
| --- | --- | --- | --- |
| 1 | Open the link and explore the setup screen (`Pilih permainan` -> `Lihat ringkasan`). Do not grant location yet. | Can they state the goal (`4 landmark` across `2 zona` in `60 menit`) and start point (`CSW–ASEAN`) before any location prompt? | |
| 2 | Open `Coba simulasi`, tap `Check-in di titik awal`, tap `Check-in`, and **Deny** the browser location permission. | Do they understand why check-in failed, see that progress is preserved, and recover using `Simulasikan lokasi di sini` or retrying after granting permission (`A11`)? | |
| 3 | Start the round, then block map requests (DevTools Network block on `solo-schematic` / `/api/map/*`) and tap `Lihat peta`. | Do they recognize the map fallback notice and continue choosing checkpoints from the equivalent text list (`A16`)? | |
| 4 | Claim 4 landmarks in `Blok M`, then observe the score before claiming a 5th landmark in `Senayan`. | Do they understand why 4 claims in 1 zone stayed active and why the 5th won (`A27`), and can they explain the final result screen? | |

## Post-session capture
- Post device details, task outcomes, and exact quotes/screens of confusion on [issue #7](https://github.com/alvintriseptia/kelana-ria/issues/7).
- File a separate follow-up issue for each observed usability bug (naming the screen and task).
- Remove the `blocked` label on `#7` once evidence is recorded.
