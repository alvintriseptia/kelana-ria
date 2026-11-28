# Kelana Ria

One Codex session owns one GitHub issue at a time. The [PRD](docs/Exploration_Game_MVP_PRD.md) defines the game. The [acceptance index](docs/acceptance.md) links each scenario to its owning issue. Label trial rules, simulated evidence, and field observations.

## Delivery

Use Python 3.11+, Git, and authenticated GitHub CLI with repository read/write and Actions read access. Start from a clean, current control checkout.

```sh
git switch main
git pull --ff-only origin main
python3 factory/agent.py pickup
python3 factory/agent.py context ISSUE_NUMBER
```

The [GitHub delivery skill](.agents/skills/github-delivery/SKILL.md) defines worktree preparation, verification, exact-head review and squash merge, and recovery. Never merge with failing or pending required checks. After a verified merge, clean up its completed worktree and continue the ready queue without pausing after each PR. When there is no unclaimed ready work left, report outstanding evidence and blockers together.

Use the full issue and the relevant guidance. Follow the packet's source, test, dependency and PRD pointers to start reading. Widen the search when evidence warrants it. Run workspace checks with the Node version in `.nvmrc`, factory unit tests, and all applicable issue checks listed in the delivery skill.

| Affected work | Required guidance |
| --- | --- |
| Player or Studio screens, accessibility, cards, motion, maps, performance | [Mobile PWA](.agents/skills/mobile-pwa/SKILL.md) |
| Editions, session state, clocks, claims, clues, hidden information, scores | [Game rules](.agents/skills/game-rules/SKILL.md) |
| AI, routing, content providers, payments | [Integration evidence](.agents/skills/integration-evidence/SKILL.md) |

## Product and evidence rules

- Use [the work issue template](.github/ISSUE_TEMPLATE/work.yml) for approved plans. List dependencies alone under `## Dependencies` as `None` or comma-separated issue references. Set ready or blocked status through the delivery skill.
- Keep game engines generic. Author official data as validated `RulebookPack` and `GeoSnapshot` with the same schema and pre-publish validation as creator packs.
- Keep player and Studio controls tactile and readable. Use existing art and shape plus color to signal state, keep touch targets usable, and test zero horizontal overflow at 390 × 844. Keep each MapLibre instance mounted and update its data in place.
- Remove replaced pre-release flows, code, tests and UI copy. Preserve data privacy, verified rule gates, and the normal entry points for supported behavior.
- Reuse the existing claim and PR when resuming a stopped session. Keep dirty, interrupted, or blocked work recoverable on its branch.
- Activate cards only from Kartu. Keep card details and play controls there, including Ganti Tantangan, Veto, and Randomize. Keep challenge and answer panels focused on the current task.

Record GitHub delivery evidence and separate optional efficiency telemetry with the [Factory baseline](docs/qa/factory-efficiency-baseline.md).

Use the [Factory V2 iteration guide](docs/qa/factory-v2-iteration.md) for execution profiles, checkpointing, repeated-failure recovery, and the end-of-iteration report.
