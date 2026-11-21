---
name: github-delivery
description: Use when taking a Kelana Ria issue from the ready queue, resuming interrupted work, opening a PR or checking routine merge eligibility.
---

# Deliver one issue

1. Run the pickup command in AGENTS.md. Ready issues use the issue form with a Dependencies heading containing `None` or comma-separated issue numbers such as `#2, #5`. A dependency closes as completed. Priority 1 precedes 2, and older issues go first within a priority. GitHub creates the numbered remote branch atomically. If another session has claimed it, pickup continues.
2. Use the exact branch reported. For example, for issue 42 run the following from the control checkout. For recovery, use the existing worktree if present. If the local branch survived a removed worktree, run `git worktree add ../kelana-issue-42 agent/issue-42` and fast-forward from its upstream after inspecting any local commits.

   ```sh
   git fetch origin refs/heads/agent/issue-42:refs/remotes/origin/agent/issue-42
   git worktree add --track -b agent/issue-42 ../kelana-issue-42 origin/agent/issue-42
   cd ../kelana-issue-42
   gh issue view 42 --comments
   ```

3. Read the referenced PRD scenarios. Deliver the observable outcome, run the repository suite and the issue-specific checks, and record commands, device/profile and results. Keep credentials and private game data out of evidence.
4. Push the numbered branch. Look up an existing PR with `gh pr list --head agent/issue-42` before creating one. Use the PR template and a standalone `Closes #42` line. Watch `gh pr checks PR_NUMBER --watch`. When a change requires human input, comment the exact question or missing evidence on the issue, add the blocked label, and return to the queue. Remove blocked and resume the same branch when the input arrives.
5. For a routine PR, record the full head SHA. In the issue worktree, inspect every change with `git diff origin/main...REVIEWED_SHA`. Pass that same SHA to the merge command. Eligible docs are supporting notes under docs/qa or docs/guides with lowercase, hyphenated Markdown filenames. Eligible UI copy consists of existing neutral keys in apps/web/src/locales/id.json that main already lists in factory/copy-keys.json. The first UI PR proposes those keys for maintainer review. Read the old and new strings in context. Route changes in meaning, rules, accessibility, permission, payment, placeholders or markup to the maintainer. Mixed docs and copy also receive maintainer review.
6. Run the merge command from AGENTS.md in the clean control checkout after updating main. The command checks the full diff, current revision, named GitHub Actions result and reported checks before requesting a squash merge. A failed pre-merge check leaves the PR open. If main moved, update the issue branch and wait for a fresh successful run. GitHub pins the PR head on merge. On this private plan another writer can advance main between the final base check and merge. The command checks the resulting parent and reports that race. If it occurs, verify the merged revision and record the result on the issue. Never bypass a failed gate with a direct push or another merge command.
7. Confirm GitHub closed the issue and record any evidence requested there. For product work, leave the checked PR open for maintainer merge. Return to pickup. Human field and account-access dependencies have their own blocked issues.

# File approved plans as delivery issues
When creating new work from a design or planning session, file the plan directly as ordered GitHub issues instead of writing unlinked local spec documents:
- Use the four headings from `.github/ISSUE_TEMPLATE/work.yml`: `## Outcome`, `## Dependencies`, `## Requirements`, and `## Verification`.
- Keep `## Dependencies` strictly to `None` or comma-separated issue numbers (for example `#35` or `#35, #36`) with no extra prose under that heading so `factory/agent.py` can parse it.
- Apply `ready` and `priority:1` or `priority:2` labels (or `blocked` when awaiting external human input) so the factory queue can claim work in order.
