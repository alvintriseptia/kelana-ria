# Kelana Ria

Kelana Ria is a mobile-first exploration game set in Jakarta. The client and API share the public game configuration defined by the [product requirements](docs/Exploration_Game_MVP_PRD.md).

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | The browser PWA (Vite 8 + TypeScript 7, Preact 11 + `@preact/signals` islands via `apps/web/src/ui/mount.tsx` and persistent `MapHost.tsx`, plus lazy GSAP on `/`). Keep map rendering and other browser dependencies here. |
| `apps/api` | Authoritative sessions and server integrations. Keep private state and answer keys server-side. Read provider credentials from the runtime environment. |
| `packages/contracts` | Types both apps can see. The first contract describes board, format and supported player counts. |

## Build from a fresh checkout

Use the Node 24 version in `.nvmrc` and npm 11. Run these commands from the repository root.

```sh
npm ci
npm run build
python3 -m unittest discover -s factory -v
```

The build compiles contracts before their consumers and bundles the deployable static web app in `apps/web/dist/`. For a focused build, run `npm run build --workspace @kelana-ria/web` or substitute `@kelana-ria/api`. Run `npm run clean` to clear compiler outputs.

Add dependencies to the workspace that imports them, for example with `npm install <package> --workspace @kelana-ria/web`. Commit the root lockfile with dependency changes. Both apps import public types from `@kelana-ria/contracts` using `import type`.

## Development

Run the API and `npm run dev` to open the game catalog locally. For installation and offline checks, serve the production build with `npm run preview --workspace @kelana-ria/web` on localhost or an HTTPS origin. Serve the web build at the root path. The service worker verifies the original build bytes before caching the shell.

Each edition page has a shareable address with its pack ID and version. Set `ALLOW_RULEBOOK_SANDBOX_CHECKOUT=1` on a test server to use the catalog’s test payment flow. Public sessions can launch free editions.

Studio drafts are tied to the browser’s creator session. To enable the separate reviewer queue, set a private `RULEBOOK_REVIEWER_KEY` on the API server and use it to open **Peninjau** from Studio. Keep the key outside the frontend build and use HTTPS for deployed servers.

To reproduce the mobile checks after building:

```sh
npx --no-install playwright install chromium
npm run qa --workspace @kelana-ria/web
```

The checks exercise the chooser, keyboard flow, Chromium installability and offline launch. They also measure three cold loads at 390 × 844 with a 4× CPU slowdown and throttled mobile network. Screenshots, traces and the run report are written to `apps/web/qa-results/` and uploaded with PR checks. Use the [agent guide](AGENTS.md) to claim the next issue.

## Play Claim the City & Hide & Seek (Unified Rulebook Engine)

After building, start the API in one terminal and the web server in another.

```sh
npm start --workspace @kelana-ria/api
npm run dev
```

Visit `/` for the landing page or `/catalog` for the Game Catalog. Open any official **Claim the City** or **Hide & Seek** edition (authored as validated `RulebookPack` + `GeoSnapshot` JSON under `apps/api/packs/official/`), choose **Main Solo** or **Main Grup**, and share the room code or QR invite with friends on separate devices. The local server stores packs, accounts, sessions, scores, and recaps in `apps/api/.data/kelana.sqlite` (configurable via `KELANA_DATABASE_PATH` or `SOLO_DATABASE_PATH`).

Run `npm test --workspace @kelana-ria/api` for server rules, Rulebook validators, Claim & Hide & Seek engine transitions, Auth OTP, persistence, SSE, entitlements, Midtrans webhook security, and HTTP provider adapters. Run the Playwright mobile QA suites against a production build:

- `npm run qa --workspace @kelana-ria/web`: mobile browser, cold-load budget, PWA installability, `Coba Panduan`, and landing page checks.
- `npm run qa:rulebook-claim --workspace @kelana-ria/web`: Solo & multiplayer Claim the City, live presence, teams/QR/leave, self-location proximity, rear-camera photo compression, and unified checkout.
- `npm run qa:rulebook-seek --workspace @kelana-ria/web`: multiplayer Hide & Seek, clue privacy, Thermometer, photo proofs, map fallback, role swap, and lobby turn order.
- `npm run qa:rulebook-studio --workspace @kelana-ria/web`: full Studio Kreator visual lifecycle, map editor, dry-run simulator, draft deletion, private draft playtest rooms, editorial review, publish, and Midtrans settlement.
- `npm run qa:player-errors --workspace @kelana-ria/web`: actionable inline errors, toasts, offline replay dedup, and reconnect recovery.

Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (optional `CLOUDFLARE_AI_MODEL`, defaulting to `@cf/zai-org/glm-4.7-flash`) plus `GEOAPIFY_API_KEY` in the API runtime environment to enable live edition generation and Geoapify walking-route refreshes. When those variables are unset, the API serves validated official Rulebook packs and deterministic route snapshots. Run `npm run capture:integration --workspace @kelana-ria/api` to write a redacted evidence bundle to `apps/api/.data/integration-evidence.json` (labeled `live` when credentials are configured, or `recorded-rehearsal` with a local HTTP stub otherwise; pass `-- --require-live` to enforce live credentials). See [live integration evidence](docs/qa/live-integration-evidence.md) for provider quotas, data rights, and recorded rehearsal results.

## Run an interactive Hide & Seek QA room

```sh
npm run build
ALLOW_HIDE_SEEK_QA=1 SOLO_DATABASE_PATH=:memory: npm start
```

Open `http://127.0.0.1:8787/?play=rulebook-seek` and choose **Buat Ruang QA** on a free pack. Open the invite in a separate browser profile for the second seat. Each player can select **Lokasi simulasi kamu** in the lobby and under **QA** on the game board. GPS actions use that player's selected checkpoint. The host can advance the room clock by one minute, five minutes, or to **Akhir fase**. The clock runs normally between jumps, and each jump applies to both players in that QA room.

QA rooms are temporary and require explicit server opt-in. Run the two-seat browser test with `npm run qa:seek-mode --workspace @kelana-ria/web`.

## Studio Kreator & Midtrans sandbox checkout

Open **Studio Kreator** (`/?play=rulebook-studio`) and sign in with Email OTP to clone an official template, edit map landmarks/stations/zones, configure timers, challenges, clues, and cards, run a private live playtest (`Main Uji Coba (Draf)`), submit for editorial review, publish to `/catalog`, and test one-time pack checkout.

Set `MIDTRANS_SERVER_KEY` in the API runtime environment to enable live Midtrans Snap sandbox requests (`POST /snap/v1/transactions`, `GET /v2/{order_id}/status`, and SHA-512 verification on `POST /api/rulebooks/midtrans-notification`); optionally override `MIDTRANS_SANDBOX_SNAP_URL` and `MIDTRANS_SANDBOX_API_URL`. When `MIDTRANS_SERVER_KEY` is unset, the API runs in clearly labeled `recorded-sandbox` mode so checkout, idempotent settlement, and pack ownership entitlements can still be verified offline and in CI without committing secrets.

## Verify Jakarta-wide and all six release configurations

Both **Jakarta (Compact)** and **Jakarta (Wide)** official Rulebook packs are playable across Solo Claim, Group Claim, and Hide & Seek.

Run `npm run qa:release --workspace @kelana-ria/web` after building to execute all six configuration smoke journeys from `/catalog` to terminal state with reload persistence and inspiration credit (`A18`) checks, writing `apps/web/qa-results/release-report.json`. See [release readiness](docs/qa/release-readiness.md) for the full pass/fail/untested release checklist.

## Run a single-origin production server (phone & field testing)

After running `npm run build`, serve both the built PWA (`apps/web/dist/`) and `/api/*` from a single Node process (ready to sit behind HTTPS / reverse proxy for phone installability and live field checks):

```sh
npm start
```

Set `HOST=0.0.0.0`, `PORT=8787`, `SOLO_SECURE_COOKIE=1` (behind HTTPS), and optional provider keys (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `GEOAPIFY_API_KEY`, `MIDTRANS_SERVER_KEY`). Check `GET /api/health` for active provider/map modes and `GET /api/map/usage` for server-side Geoapify tile and routing credit estimates. Ready-to-run human and field protocols live in [`docs/qa/`](docs/qa/).
