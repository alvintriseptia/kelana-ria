# Kelana Ria

Kelana Ria is a mobile-first exploration game set in Jakarta. The client and API share the public game configuration defined by the [product requirements](docs/Exploration_Game_MVP_PRD.md).

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | The browser PWA. Keep map rendering and other browser dependencies here. |
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

Run `npm run dev` to open the game chooser locally. For installation and offline checks, serve the production build with `npm run preview --workspace @kelana-ria/web` on localhost or an HTTPS origin. Serve the web build at the root path. The service worker verifies the original build bytes before caching the shell.

To reproduce the mobile checks after building:

```sh
npx --no-install playwright install chromium
npm run qa --workspace @kelana-ria/web
```

The checks exercise the chooser, keyboard flow, Chromium installability and offline launch. They also measure three cold loads at 390 × 844 with a 4× CPU slowdown and throttled mobile network. Screenshots, traces and the run report are written to `apps/web/qa-results/` and uploaded with PR checks. Use the [agent guide](AGENTS.md) to claim the next issue.

## Play the Compact solo fixture

After building, start the API in one terminal and the web server in another.

```sh
npm start --workspace @kelana-ria/api
npm run dev
```

Choose Solo, Claim the City and Jakarta (Compact), then open **Lihat ringkasan** and **Coba simulasi**. Use **Simulasikan lokasi di sini** to test check-ins without traveling. The board, challenges and location samples are fixtures. The local server stores countdowns, scores and results in `apps/api/.data/solo.sqlite`. Set `SOLO_DATABASE_PATH` to choose another database. The PWA caches the chooser shell. The outing requires a server connection for check-ins, claims and recovery.

Run `npm test --workspace @kelana-ria/api` for server rules, edition validation (`compact-board-v1`), two feasible Compact editions with attributed route snapshots, and same-configuration fallback checks, and `npm run qa:solo --workspace @kelana-ria/web` for the mobile win, loss, closure notice and recovery paths. The browser test starts a fixture API with an isolated database and controlled clock. It writes screenshots and a result report alongside the chooser QA evidence.

## Play the Compact two-player fixture

With the API and web server running, choose **Berdua**, **Claim the City**, and **Jakarta (Compact)**. Open the summary, choose **Coba simulasi berdua**, and create a room. Open its invitation in a second browser profile so each player has a separate seat. Both players check in at CSW–ASEAN and mark themselves ready before the host starts. The room shows who owns each landmark and how many landmarks each player has in every zone.

Run `npm run qa:duo --workspace @kelana-ria/web` against a production build to exercise two independent browser profiles. The test records both views and the public event sequence in the mobile QA artifact.

## Review, publish, and settle a creator pack (Test payment)

Open the summary for Jakarta (Compact) Claim the City and choose **Paket kreator Jakarta** (or open `/?play=creator-packs`). Switch between **Penulis**, **Peninjau** and **Katalog Publik** to save a draft, submit it for editorial review, return a correction request, publish the revised version, purchase one sandbox session (**Test payment**), settle it to unlock one paid room and one creator earnings entry, invite a second player on the same pass without starting the clock before readiness, and pause new sales after a confirmed checkpoint closure while keeping existing orders and earnings visible.

Set `MIDTRANS_SERVER_KEY` in the API runtime environment to enable live Midtrans Snap sandbox requests (`POST /snap/v1/transactions`, `GET /v2/{order_id}/status`, and SHA-512 verification on `POST /api/packs/midtrans-notification`); optionally override `MIDTRANS_SANDBOX_SNAP_URL` and `MIDTRANS_SANDBOX_API_URL`. When `MIDTRANS_SERVER_KEY` is unset, the API runs in clearly labeled `recorded-sandbox` mode so checkout, idempotent settlement, and paid room unlocking can still be verified offline and in CI without committing secrets. Run `npm run qa:packs --workspace @kelana-ria/web` to verify all roles, checkout settlement, paid room invite, and pause flows in isolated browser profiles.
