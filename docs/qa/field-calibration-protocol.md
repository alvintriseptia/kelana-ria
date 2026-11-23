# Jakarta field calibration protocol (Issue #14)

Use this log sheet to record real on-site Jakarta observations for [issue #14](https://github.com/alvintriseptia/kelana-ria/issues/14) (`§§2, 9–11`, `A17`, `A21`). Always keep **observed** timings separate from **modeled estimates**.

## Session metadata
- **Date & weather:**
- **Device & OS:** (typical Android phone preferred per PRD §6)
- **Board & version:** `compact-board-v1` / `jakarta-wide-board-v1`
- **Configured check-in thresholds tested:** radius `100 m`, max accuracy `50 m`, max fix age `30 s`

## 1. Checkpoint access, GPS, and observable prompt verification (`A17`)

| Checkpoint ID | Pin coordinates verified? | Public approach & hours | Reported GPS accuracy (m) | Prompt detail visible without ticket/admission? | Review date & source |
| --- | --- | --- | --- | --- | --- |
| `csw-asean` | | | | Start point | |
| `m-bloc` | | | | | |
| `taman-literasi` | | | | | |
| `blok-m-plaza` | | | | | |
| `plaza-senayan` | | | | | |
| `velbak-kebayoran` | | | | | |
| `stasiun-palmerah` | | | | | |
| `dukuh-atas` | | | | | |
| `stasiun-manggarai` | | | | | |
| `taman-fatahillah` | | | | | |

## 2. Elapsed outing & regroup calibration (`A21`)

| Route tested | Mode(s) used | Modeled estimate (min) | Observed travel + wait (min) | Observed on-site challenge / photo time (min) | Total elapsed Start -> result (min) | Fits advertised one-day preset? |
| --- | --- | --- | --- | --- | --- | --- |
| Compact Opening A (`CSW–ASEAN -> M Bloc -> Blok M -> Senayan`) | | `37` (`43` w/ miss) | | | | |
| Compact Opening B (`CSW–ASEAN -> Velbak -> Kebayoran -> Palmerah`) | | `47` (`53` w/ miss) | | | | |
| Jakarta-wide multi-stop (`CSW–ASEAN -> Dukuh Atas -> Manggarai -> Kota Tua`) | | `<= 120` | | | | |
| Hide & Seek two-turn return + regroup (`CSW–ASEAN`) | | `30` (Compact) / `60` (Wide) | | | | |

## 3. Claim the City question comparison (`A17`, `A21`)

Use the [desk-reviewed sample cards](../guides/claim-challenge-research.md#sample-cards-for-compact) on the next Compact field visit. Verify a safe, step-free, unticketed vantage and usable GPS first. Record the sign or feature, date, lighting, crowding and any temporary closure. Switch to the text fallback if the primary cue is inaccessible. Stop a task if a safe approach is unavailable. Ask before collecting any participant image.

Give uncoached first-time players either the current prompt, the candidate, or its fallback at the same site. Alternate which prompt comes first across participants and avoid showing the same participant the answer before their first attempt at another variant. Start the challenge clock when the task opens after check-in. Record travel, GPS, observation, and any photo transfer or approval as separate intervals. Offer the written hint only if the player asks or reaches the agreed observation limit, and record when it was used.

| Point / prompt / variant | Vantage and evidence review date | Observe / submit time | Correct first try? Hint used? | Could they point to evidence and explain it? | Enjoyment (1–5) and friction |
| --- | --- | --- | --- | --- | --- |
| Taman Literasi · stepped seating | | | | | |
| M Bloc · adjacent upper balconies | | | | | |
| Velbak · direction to the railway | | | | | |

After recording the answer, present the learning reveal. Ask the player to explain it in their own words and record what they remember at the next stop. Compare first-try accuracy, hint use, median time, and reports of ambiguity between variants. Look for a difference greater than 20 seconds or a clear accuracy gap as a signal to review difficulty. Compare enjoyment and the ability to name both the clue and the new fact. Record the sample size and individual outcomes so a small trial does not imply general balance. Report accessible and inaccessible cases separately and label any simulated result.

## Post-field update
Attach completed observations to [issue #14](https://github.com/alvintriseptia/kelana-ria/issues/14), update board timing presets / prompt copy via a reviewed PR if calibration changes defaults, and remove the `blocked` label.
