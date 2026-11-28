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
5. After all required `Factory CI` checks (`factory` and `workspace`) pass on the PR head SHA, inspect the full diff (`git diff origin/main...HEAD`) for accuracy, test coverage, and scope.
6. Squash-merge the green PR into `main` pinning its reviewed head SHA (`gh api -X PUT repos/alvintriseptia/kelana-ria/pulls/PR_NUMBER/merge -f sha=REVIEWED_SHA -f merge_method=squash`, or `python3 factory/agent.py merge PR_NUMBER REVIEWED_SHA` for routine docs/copy). Never bypass a failed or pending CI gate. If `main` moved, rebase/update the issue branch and wait for a fresh green CI run first.
7. Confirm GitHub closed the issue, remove the finished worktree, pull `main`, and immediately return to `pickup` to deliver the next ready issue. Continue until all ready issues are finished so the maintainer can review everything together at the end. Human field and account-access dependencies remain on their own `blocked` issues.

# File approved plans as delivery issues
When creating new work from a design or planning session, file the plan directly as ordered GitHub issues instead of writing unlinked local spec documents:
- Use the four headings from `.github/ISSUE_TEMPLATE/work.yml`: `## Outcome`, `## Dependencies`, `## Requirements`, and `## Verification`.
- Keep `## Dependencies` strictly to `None` or comma-separated issue numbers (for example `#35` or `#35, #36`) with no extra prose under that heading so `factory/agent.py` can parse it.
- Apply `ready` and `priority:1` or `priority:2` labels (or `blocked` when awaiting external human input) so the factory queue can claim work in order.

## Record delivery evidence

Record timing, CI attempts and observable usage with the [Factory efficiency baseline](../../../docs/qa/factory-efficiency-baseline.md). Report unavailable counters as null and byte measurements separately from tokens.
