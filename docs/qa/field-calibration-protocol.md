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

## Post-field update
Attach completed observations to [issue #14](https://github.com/alvintriseptia/kelana-ria/issues/14), update board timing presets / prompt copy via a reviewed PR if calibration changes defaults, and remove the `blocked` label.
