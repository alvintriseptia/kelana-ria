# Kelana Ria

A started Codex session owns one GitHub issue at a time. The PRD in [docs](docs/Exploration_Game_MVP_PRD.md) defines the game. Each acceptance scenario has an [owning issue](docs/acceptance.md). Keep trial rules, simulated runs and field observations labeled.

## Factory rules for planning and game design
- **Put plans into GitHub delivery issues.** Do not write standalone unlinked design/plan specs into the repository. Convert approved plans into ordered GitHub issues using [`.github/ISSUE_TEMPLATE/work.yml`](.github/ISSUE_TEMPLATE/work.yml) (`## Outcome`, strict `## Dependencies` containing only `None` or `#N, #M`, `## Requirements`, `## Verification`) with `ready` and `priority:1` or `priority:2` labels so `factory/agent.py pickup` can claim them automatically.
- **Keep game rules data-driven, never hardcoded.** Game engines must stay generic and free of hardcoded city names, stations, timers, question catalogs, decks, powerups, or curses. Official POC games must be authored as validated `RulebookPack` + `GeoSnapshot` data using the exact same schema and pre-publish validator that community marketplace creators use.
- **Design every player & studio screen like a tactile mobile game, not a text-heavy admin form.** Prefer illustrated SVG/WebP assets, crisp visual card previews, compact iconography, color-independent shape badges, and interactive micro-tutorials over walls of prose. Enforce zero horizontal overflow (`scrollWidth <= innerWidth`) on `390x844` mobile viewports and keep persistent MapLibre map instances updated in-place (never tearing down and re-rendering the map on every click).
- **Autonomous merge through the ready queue.** Do not pause for maintainer review after each individual issue PR. Once you self-review the diff and all required `Factory CI` checks (`factory` and `workspace`) pass on a PR, squash-merge it into `main` (pinning the reviewed head SHA), clean up the finished worktree, pull `main`, and immediately claim the next ready issue. Continue until the ready queue is empty (or only `blocked` external-input issues remain), then present one consolidated review summary at the end. Never merge with failing or pending CI checks.

## Start a session

Use Python 3.11+, Git and an authenticated GitHub CLI with repository read/write and Actions read access. Keep a clean checkout at the latest main as your control directory. From there, run:

```sh
git switch main
git pull --ff-only origin main
python3 factory/agent.py pickup
```

Read the claimed issue and use the [GitHub delivery skill](.agents/skills/github-delivery/SKILL.md) to open a separate worktree and deliver it. When the queue is empty, report outstanding review or blockers and end the session. A future session can pick up newly ready work.

| When the issue touches | Load |
| --- | --- |
| Player and Creator Studio screens, cards, motion, maps, accessibility or loading performance | [Mobile PWA](.agents/skills/mobile-pwa/SKILL.md) |
| Sessions, clocks, claims, clues or scores | [Game rules](.agents/skills/game-rules/SKILL.md) |
| AI, routing, content providers or payments | [Integration evidence](.agents/skills/integration-evidence/SKILL.md) |

## Verify and deliver

For workspace changes, run `npm ci` and `npm run build` with the Node version in `.nvmrc`. The [workspace guide](README.md) lists package boundaries and focused builds.

Run `python3 -m unittest discover -s factory -v` from the issue worktree. Add the issue-specific checks from the relevant skill. Open a PR against main with a standalone `Closes #N` line and links to evidence. Monitor CI and fix recoverable failures.

Once all `Factory CI` checks succeed on the current PR head SHA and you have reviewed the full diff for accuracy and scope, squash-merge the PR into `main` (pinning the head SHA), pull `main`, and immediately continue to the next ready issue in the queue. Only stop for maintainer review after all ready tasks are complete (or when an issue requires external human input and is labeled `blocked`). Never bypass a failed CI gate.

## Recover work

For an explicitly handed-off or interrupted issue, confirm the previous session has stopped, then run `python3 factory/agent.py resume ISSUE_NUMBER` from current main. Reuse its branch and open PR. Read issue comments, commits and CI before continuing. An existing claim always wins over another pickup. Keep the branch when a task blocks so its history survives.
