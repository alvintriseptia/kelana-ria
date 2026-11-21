# Release readiness checklist (six configurations)

This report records automated verification for [issue #15](https://github.com/alvintriseptia/kelana-ria/issues/15) (`§§2, 8–11`, `A01`, `A18`, `A20`, `A21`) across all six playable configurations on `2026-11-21`, separating **`simulated` / `recorded-sandbox`** software checks from pending **`live` / `field` / `owner`** sign-off gates (`#6`, `#7`, `#13`, `#14`).

## Six-configuration release matrix (`A01`)

| Board | Format | Players | Prepared fallback edition | Points outside Compact | Automated software & mobile QA (`simulated`) | Live API & field status |
| --- | --- | --- | --- | --- | --- | --- |
| Jakarta (Compact) | Claim the City | 1 (Solo) | `compact-solo-trial-v1` (+ `compact-solo-kebayoran-v1`) | 0 (Compact baseline) | **Pass** (`release.test.mjs`, `qa:solo`, `qa:release`) | **Untested** (`#6`, `#7`, `#14`) |
| Jakarta (Compact) | Claim the City | 2 (Berdua) | `compact-duo-trial-v1` | 0 (Compact baseline) | **Pass** (`duo.test.mjs`, `release.test.mjs`, `qa:duo`, `qa:release`) | **Untested** (`#6`, `#14`) |
| Jakarta (Compact) | Hide & Seek | 2 (Berdua) | `compact-seek-trial-v1` | 0 (Compact baseline) | **Pass** (`seek.test.mjs`, `release.test.mjs`, `qa:seek`, `qa:release`) | **Untested** (`#6`, `#14`) |
| Jakarta (Wide) | Claim the City | 1 (Solo) | `wide-solo-trial-v1` (+ `wide-solo-kota-v1`) | 5 (`wide-solo-trial-v1`), 6 (`wide-solo-kota-v1`) | **Pass** (`release.test.mjs`, `qa:release`) | **Untested** (`#6`, `#14`) |
| Jakarta (Wide) | Claim the City | 2 (Berdua) | `wide-duo-trial-v1` | 5 | **Pass** (`release.test.mjs`, `qa:release`) | **Untested** (`#6`, `#14`) |
| Jakarta (Wide) | Hide & Seek | 2 (Berdua) | `wide-seek-trial-v1` | 5 | **Pass** (`release.test.mjs`, `qa:release`) | **Untested** (`#6`, `#14`) |

Unsupported combinations (`players=1` with `hide-and-seek` per `A05`, and unknown board values such as `board=bandung`) remain rejected on both the chooser and API (`400 invalid-request`). A zoomed-out Compact edition proposed on `jakarta-wide-board-v1` is rejected with `insufficient-wide-checkpoints`.

## Acceptance and QA summary

| Check | Coverage | Mode | Result | Evidence |
| --- | --- | --- | --- | --- |
| Workspace build & contracts | TypeScript references + Vite bundle | Build | **Pass** | `npm run build` |
| API rules, validation & all 6 configurations | `A01`, `A02`–`A15`, `A17`, `A19`, `A20`, `A22`–`A31` | Fixture / simulated | **Pass** (`66/66`) | `npm test --workspace @kelana-ria/api` (`apps/api/test/release.test.mjs` et al.) |
| Factory repository contract tests | Issue/skill/merge gates | Unit | **Pass** (`17/17`) | `python3 -m unittest discover -s factory -v` |
| Mobile shell, installability, accessibility & cold-load budgets | `§8`, `A05`, `A18` | Mobile Chromium (`390 × 844`, `4×` CPU) | **Pass** | `npm run qa --workspace @kelana-ria/web` — median LCP `1172 ms` (`<= 2500 ms`), CLS `0` (`<= 0.10`), transferred JS `5,719 B` (`<= 102,400 B`) |
| Six-configuration mobile smoke journeys & reload persistence | `A01`, `A18` | Simulated mobile Chromium (`390 × 844`) | **Pass** (`6/6`) | `npm run qa:release --workspace @kelana-ria/web` (`apps/web/qa-results/release-report.json`, `release-wide-solo-win.png`, `release-wide-duo-finish.png`, `release-wide-seek-finish.png`) |
| Detailed single/duo/seek/marketplace regression suites | `A02`–`A12`, `A15`, `A19`, `A20`, `A23`–`A31` | Simulated / `recorded-sandbox` | **Pass** | `qa:solo`, `qa:duo`, `qa:seek`, `qa:packs` |
| Inspiration credit on mobile rules | `A18` | Mobile Chromium | **Pass** | Verified `Adam Chase`, `Sam Denby`, `Ben Doyle`, and visible link to `https://nebula.tv/jetlag` in `Panduan` dialog (closing presentation slide verified separately before public demo) |
| Sandbox creator sale reconciliation | `A28`–`A31` | `recorded-sandbox` | **Pass** | `apps/api/test/checkout.test.mjs` + `npm run qa:packs --workspace @kelana-ria/web` (1 settled order -> 1 pass -> 1 paid room -> 1 earnings entry; live Midtrans sandbox requires `MIDTRANS_SERVER_KEY`) |
| Live AI generation & Geoapify walking-route capture | `§7`, `A13`, `A14`, `A16` | Live provider accounts | **Untested (Blocked)** | Tracked in [#6](https://github.com/alvintriseptia/kelana-ria/issues/6) (adapters & rehearsal PR #28 ready) |
| First-time uncoached player comprehension | `§§8–10`, `A11`, `A16`, `A27` | Human observation | **Untested (Blocked)** | Tracked in [#7](https://github.com/alvintriseptia/kelana-ria/issues/7) |
| Product owner closure & trial preset decisions | `§11` | Owner decision | **Untested (Blocked)** | Tracked in [#13](https://github.com/alvintriseptia/kelana-ria/issues/13) |
| On-site Jakarta board & one-day outing calibration | `§§2, 9–11`, `A17`, `A21` | Physical field playtests | **Untested (Blocked)** | Tracked in [#14](https://github.com/alvintriseptia/kelana-ria/issues/14) |

## Quick handoff checklist for remaining external gates

1. **[#13](https://github.com/alvintriseptia/kelana-ria/issues/13) (Owner decisions):** Confirm offline-rival closure handling, impossible-solo-goal closure handling, and approved trial durations/prices/bonuses per board, then record in PRD §11.
2. **[#6](https://github.com/alvintriseptia/kelana-ria/issues/6) (Live APIs):** After merging PR #28, run `npm run capture:integration --workspace @kelana-ria/api -- --require-live` with live Cloudflare Workers AI + Geoapify credentials and record phone tile/routing usage.
3. **[#7](https://github.com/alvintriseptia/kelana-ria/issues/7) (First-time player):** Observe one uncoached player on simulated Compact Claim (mission comprehension before GPS, denied check-in retry, list fallback on tile failure, final result explanation).
4. **[#14](https://github.com/alvintriseptia/kelana-ria/issues/14) (Field checks):** Measure actual walking, transit wait, GPS accuracy, observable prompts, and one-day elapsed durations on Compact and Jakarta-wide (including two-turn Hide & Seek regrouping).
5. **[#15](https://github.com/alvintriseptia/kelana-ria/issues/15) (Final release sign-off):** Once `#6`, `#7`, `#13`, and `#14` close, update this table with links to live and field evidence and close `#15`.
