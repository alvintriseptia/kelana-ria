# Kelana Ria

A started Codex session owns one GitHub issue at a time. The PRD in [docs](docs/Exploration_Game_MVP_PRD.md) defines the game. Each acceptance scenario has an [owning issue](docs/acceptance.md). Keep trial rules, simulated runs and field observations labeled.

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
| Player screens, maps, accessibility or loading performance | [Mobile PWA](.agents/skills/mobile-pwa/SKILL.md) |
| Sessions, clocks, claims, clues or scores | [Game rules](.agents/skills/game-rules/SKILL.md) |
| AI, routing, content providers or payments | [Integration evidence](.agents/skills/integration-evidence/SKILL.md) |

## Verify and deliver

Run `python3 -m unittest discover -s factory -v` from the issue worktree. Add the issue-specific checks from the relevant skill. Open a PR against main with a standalone `Closes #N` line and links to evidence. Monitor CI and fix recoverable failures.

From clean current main, use `python3 factory/agent.py merge PR_NUMBER REVIEWED_SHA` only for supporting documentation or edits to approved neutral copy. Read the diff for accuracy and meaning first. You review gameplay, code, payments, CI, skills, policy and PRD changes as maintainer. The session can continue with other ready issues while a PR awaits your review.

## Recover work

For an explicitly handed-off or interrupted issue, confirm the previous session has stopped, then run `python3 factory/agent.py resume ISSUE_NUMBER` from current main. Reuse its branch and open PR. Read issue comments, commits and CI before continuing. An existing claim always wins over another pickup. Keep the branch when a task blocks so its history survives.
