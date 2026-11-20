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
