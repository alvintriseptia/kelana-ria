# Factory V2 iteration and evidence

Use this guide at the start of an iteration or when transferring an interrupted issue. Use the issue context packet and domain guidance during each delivery. [Factory rollout issue](https://github.com/alvintriseptia/kelana-ria/issues/236) · [Delivery skill](../../.agents/skills/github-delivery/SKILL.md)

## Choose an execution profile

| Profile | Recommended effort | Apply when |
| --- | --- | --- |
| Small | Low | Localized docs, copy or CSS with stable behavior and a focused check. |
| Standard | Medium | Default for coding, UI, and uncertain scope before investigation. |
| High-risk | High | Architecture, shared contracts, game and persistence invariants, security, privacy, or cross-domain changes. Escalate when correctness is uncertain or repeated failures need deeper reasoning. |

The packet recommends a profile and caps optional source hints. Use `context ISSUE_NUMBER --profile high-risk` to widen the advisory profile when scope changes. Use `--limit`, `--domain` or pinned `git grep` to reach necessary evidence. Mandatory rules, full issue text, verification and merge review apply at every level.

On the CLI, use `/model --reasoning=high` if the chosen model supports it, or start a run with `codex --config 'model_reasoning_effort="medium"'`. Use `/compact` as needed after saving a checkpoint. The CLI also supports manual session resume. In Cloud or web contexts, use the effort control if the account and selected model expose it. Otherwise use the current setting and record the profile as an advisory workflow choice. A fresh task or manual resume with the existing branch and handoff is the fallback when context becomes difficult to manage. [Developer settings](https://learn.chatgpt.com/docs/developer-settings) · [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)

## Run and recover

1. From current clean main, pick up one ready issue or resume its existing claim with `prepare` after the previous session has stopped. Load its context packet, read the required guidance and follow targeted pointers. Use the full issue and validate the scope yourself.
2. Keep edits and tests on the claimed branch. Run focused checks during implementation, then the complete local and CI gates for delivery. Check completed dependencies, PR linkage, the current base, all required jobs, and the full diff at the reviewed head before merging.
3. Update progress when the approach, evidence, or blocker changes. Compare the current failure with the previous one using `python3 factory/agent.py retry-advice PREVIOUS.json CURRENT.json` when you have compact check reports. For a repeated error, inspect the relevant failure lines and revise the hypothesis before another attempt. Escalate effort or read additional source when useful. For an actual external dependency, record the actionable blocker on the issue. For an interruption due to time, allowance or context, keep the issue and branch available for resume.
4. Record a short `handoff` after each merge and before removing the worktree. Use the reviewed branch head and the integration base. On interruption, record the committed SHA, unfinished paths, test evidence and next decision. Preserve the original worktree or commit a safe checkpoint before ending that session. Keep raw logs and credentials outside shared handoff data.
5. Pull main and continue the ready queue. When moving to a different domain, reload just the new packet and its guidance. Keep shared context for related issues. If the environment needs a separate session, resume the existing claim from fresh main and reuse its worktree and PR.
6. At the end of the iteration, list delivered issues and PRs, the exact verification outcomes, any issues awaiting input, and measured efficiency with its units. Keep unavailable tokens and allowance null. [Baseline recording and matched allowance protocol](factory-efficiency-baseline.md)

For migration from V1, the test suite rehearses same-branch recovery with a local bare Git remote and fixture GitHub issue and PR state. An empty claim can move forward locally. A claim with work is preserved for explicit integration from main using the same PR. Dirty worktrees get recovery guidance and stay in place. Run the exact-head checks again after any branch update.

## Reproduce the comparison

```sh
python3 factory/agent.py rehearse-workflow
python3 -m unittest discover -s factory -v
python3 factory/agent.py verify --profile factory
```

The context rehearsal reads the fixed pre-V2 product revision with three workloads. The optimized path counts the issue packet, the full applicable guidance at the current revision, targeted excerpts from the same code and QA files, and linked PRD sections. GitHub setup and packet construction sit outside the excerpt-read timer. The historical baseline has PR timing and CI attempts. Current context and verification rehearsals require zero model inference.

## Measured rollout evidence

| Matched workload | V1 full reads | V2 packet, guidance and excerpts | V1 Git reads | V2 guidance and excerpt Git reads |
| --- | ---: | ---: | ---: | ---: |
| Copy/CSS, #205 | 45,842 B | 41,416 B | 8 | 10 |
| Studio, #209 | 300,526 B | 42,182 B | 8 | 10 |
| Contract/map, #231 | 180,436 B | 51,887 B | 10 | 11 |

These runs used the same product files at `39e39ed`, with V2 guidance at `e2d778c`. All targeted needles matched. Local V1 reads took 0.013–0.017 s. V2 guidance and excerpt reads after packet preparation took 0.018–0.020 s. The packet has additional GitHub and Git indexing work. The comparison demonstrates lower visible byte volume, with extra setup and reads in some cases.

Factory verification passed 39 tests. The V2 wrapper executed the same Factory command, retained 5,297 B of output and emitted a 319 B summary in a 1.92 s check. Tests and fixtures cover priority/dependencies, required Factory jobs and current reviewed head, separate domain profiles, retained context, dirty worktree recovery, repeated-error advice, and same-branch and same-PR resume. The fixture merge exercises the routine policy. The live #235 delivery exercised prepare, publish, CI and cleanup on its own claimed branch. [V1 baseline](factory-efficiency-baseline.md) · [Live #235 checks](https://github.com/alvintriseptia/kelana-ria/actions/runs/46127670421)

CLI capability was checked with Codex CLI 0.172.0-alpha.2 using `codex --config 'model_reasoning_effort="medium"' --help` and the corresponding `"high"` invocation. The local check demonstrates acceptance of the configuration flag, and the official guide documents behavior with eligible models. Cloud uses the manual workflow when the relevant control is unavailable.

Successful matched product deliveries, repair-count improvements and allowance savings remain unmeasured. The matched outcomes here are deterministic context and verification rehearsals. For a live comparison, take isolated before/after allowance readings within the same reset window, use the same client, plan, model, effort and complexity cohort, and record outcomes, CI results, retries and elapsed time. Use the proxy protocol where allowance remains unavailable. Treat the 25–40% target as a hypothesis. [Allowance protocol](factory-efficiency-baseline.md#supported-telemetry)
