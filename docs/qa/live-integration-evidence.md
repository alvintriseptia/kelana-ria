# Live generation and walking-route integration evidence

This note tracks provider adapters, quotas, attribution, data rights, and redacted verification evidence for [issue #6](https://github.com/alvintriseptia/kelana-ria/issues/6) (`§7`, `§8`, `A13`, `A14`, `A16`) against board `compact-board-v1`.

> **Evidence status (21 November 2026):** HTTP provider adapters, credential redaction, retry-on-invalid-output, outage fallback rehearsal, and mobile tile/list fallback telemetry are implemented and verified in **`recorded-rehearsal`** and **`simulated`** modes. **Live** provider capture remains **pending** external `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `GEOAPIFY_API_KEY` credentials and a live phone tile/routing usage run.

## Provider access, quotas, attribution, and data rights

| Integration | Model / Endpoint | Quota & Credit Model | Attribution & License | Privacy & Commercial Conditions |
| --- | --- | --- | --- | --- |
| **Cloudflare Workers AI** | `@cf/zai-org/glm-4.7-flash` via `POST /client/v4/accounts/{accountId}/ai/run/{model}` | Workers Free allocation: `10,000 neurons/day` (verify Workers Free vs Workers Paid model eligibility on the live account per the 2026-07-28 changelog). 15-second total generation budget with at most 1 retry on invalid output. | Model weights: MIT (`zai-org/GLM-4.7-Flash`). | Prompt sends public board catalog IDs and zones only. Zero player coordinates, device credentials, room secrets, or private answer keys enter prompts or logs. |
| **Geoapify Routing API** | `GET /v1/routing?waypoints=...&mode=walk&apiKey=...` | Geoapify Free shared pool: `3,000 credits/day`. Walking route request: `1 credit/request`. Full `compact-board-v1` walking refresh (`13` unique walking pairs): `13 credits` (`0.43%` of daily free quota). | Required visible attribution: `© Geoapify · © OpenStreetMap contributors`. | Free guide permits commercial apps with attribution, while Geoapify terms qualify free production use and stored-route reuse; confirm account terms before public launch. |
| **Geoapify Vector Tiles & MapLibre GL JS** | Vector tiles + MapLibre GL JS (map layer) | Shares the same `3,000 credits/day` Geoapify Free pool at `0.25 credits/tile request`. | Linked `© Geoapify` and `© OpenStreetMap contributors` attribution plus MapLibre GL JS BSD-3-Clause notice when enabled. | When tile requests fail, the checkpoint list, briefing, and confirmed server state remain fully usable. |
| **Transjakarta Static GTFS** | Static board preparation reference | Offline preparation feed | `Transjakarta GTFS (CC BY 4.0)` with modifications indicated. | Non-Transjakarta KRL/MRT connections are recorded independently when operator sources are reference-only. |

## Verified deterministic rehearsal and outage evidence (`recorded-rehearsal` / `simulated`)

All runs below executed on `2026-11-21` with **zero live provider credentials** in the environment and are explicitly labeled `recorded-rehearsal` / `simulated`.

### 1. HTTP adapter and redaction unit suite
- **Command:** `npm test --workspace @kelana-ria/api`
- **Result:** `68/68` tests passed (including `apps/api/test/providers.test.mjs`).
- **Verified boundaries:**
  - Valid Workers AI markdown-fenced and OpenAI-style JSON responses accepted and validated against `compact-board-v1` with `>= 2` distinct viable openings (`A13`, `A22`).
  - Valid Geoapify GeoJSON walking responses (`distance` in meters, `time` in seconds) merged with approved MRT/KRL/Transjakarta legs and attributed as `Geoapify · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0)`.
  - Malformed Workers AI JSON triggers one retry within the 15-second budget and succeeds on attempt 2 (`A13`).
  - HTTP `503` outages on both providers and malformed Geoapify GeoJSON fall back to the labeled prepared same-configuration edition (`origin: "prepared"`, `fallbackReason: "ai-unavailable"`, `routeSource: "snapshot"`, `compact / claim-the-city / 1`) while an active frozen round makes `0` external provider calls (`A14`, `A16`).
  - Prompt contains zero answer keys, zero player coordinates, and zero secrets; redacted event logs contain `[REDACTED_ACCOUNT]` and `apiKey=[REDACTED]` with zero raw credentials.

### 2. Redacted capture & outage rehearsal CLI
- **Command:** `npm run capture:integration --workspace @kelana-ria/api`
- **Mode:** `recorded-rehearsal` (`liveCredentialsPresent: false`; missing `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GEOAPIFY_API_KEY`).
- **Observed summary:**
  - Rehearsed generation + walking refresh: `captureOk=true`, `editionId=compact-solo-rehearsal-v1`, `openingsCount=6`, `routingCredits=13` (`13` walking legs at `1 credit` each), `0` raw credentials in `apps/api/.data/integration-evidence.json`.
  - Rehearsed HTTP `503` outage: `outageFallback=prepared`, `fallbackReason=ai-unavailable`, `routeSource=snapshot`, `editionId=compact-solo-trial-v1`, configuration preserved (`compact`, `claim-the-city`, `1`).

### 3. Mobile phone QA (`simulated`, `390 × 844`, Chromium `159.0.8154.6`)
- **Commands:**
  - `npm run qa --workspace @kelana-ria/web`
  - `npm run qa:solo --workspace @kelana-ria/web`
- **Profile:** Viewport `390 × 844`, `deviceScaleFactor: 2`, `4×` CPU slowdown, `150 ms` latency, `1600 kbps` down / `750 kbps` up, fresh context with cache disabled (`apps/web/qa/profile.mjs`).
- **Observed results:**
  - Cold-load budgets (`3` runs): median LCP `1156 ms` (budget `<= 2500 ms`), CLS `0` (budget `<= 0.10`), transferred JS `5,700 B` (budget `<= 102,400 B`). Zero map renderer or provider calls on chooser cold load.
  - Provider outage rehearsal on phone (`apps/web/qa-results/solo-report.json`): briefing visibly labeled `Simulasi`, `Edisi siap pakai (cadangan)`, `Cuplikan rute tersetujui`, and `Geoapify · © OpenStreetMap contributors · Transjakarta GTFS (CC BY 4.0)`; `activeRoundCalls: 0`.
  - Map/tile failure fallback: intercepted map asset request (`mapAssetRequestsIntercepted: 1`), verified checkpoint list remained usable through win, offline reload, and expiry (`listFallbackVerified: true`).

## Pending live capture to close #6

Once external provider credentials are provisioned in the runtime environment (never committed to Git):

```sh
export CLOUDFLARE_ACCOUNT_ID="..."
export CLOUDFLARE_API_TOKEN="..."
export GEOAPIFY_API_KEY="..."
npm run capture:integration --workspace @kelana-ria/api -- --require-live
```

1. Confirm `mode: "live"` in the generated redacted `integration-evidence.json`, verify `captureResult.ok === true`, and attach the redacted summary (timestamps, model, board version `compact-board-v1`, route attribution, credit count, and live account quota/tier confirmation) to [issue #6](https://github.com/alvintriseptia/kelana-ria/issues/6).
2. Run one simulated Compact Claim session on a physical phone against the live Geoapify tile/routing key, record actual tile and routing credit consumption, and confirm list fallback when tiles are blocked.
3. Update this document with the live capture date, verified account tier/terms, and phone telemetry, then remove the `blocked` label on `#6` and close it via PR.
