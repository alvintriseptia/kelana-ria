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

The TypeScript build compiles the contracts before their consumers and writes each workspace's output to its own `dist/` directory. For a focused build, run `npm run build --workspace @kelana-ria/web` or substitute `@kelana-ria/api`. Run `npm run clean` to clear compiler outputs.

Add dependencies to the workspace that imports them, for example with `npm install <package> --workspace @kelana-ria/web`. Commit the root lockfile with dependency changes. Both apps import public types from `@kelana-ria/contracts` using `import type`.

## Development

Use the [agent guide](AGENTS.md) to claim an issue and deliver a linked PR. The [PWA shell issue](https://github.com/alvintriseptia/kelana-ria/issues/3) owns the first runnable player screen, installability checks and mobile performance baseline.
