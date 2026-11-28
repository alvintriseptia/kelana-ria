# Factory delivery efficiency baseline

This is the V1 measurement reference for [issue #233](https://github.com/alvintriseptia/kelana-ria/issues/233). Match task complexity, domain, model, execution profile and client when comparing later changes. Keep historical PR windows, measured task windows and simulated context reads in separate cohorts.

## Collect a delivery measurement

1. Record the UTC start when taking the issue and the UTC end at merge, failure or interruption. Use the authoring branch's reviewed head and the integration base. Record the total Factory CI workflow attempts for that issue, whether the first completed attempt passed, and how many deliberate repair attempts were made. A PR rerun is a CI attempt. A rejected check followed by a change to fix it is a repair. Use null for counters you could not verify.
2. Compare metrics using `python3 factory/metrics.py report PATH_TO_LOCAL_RUNS.jsonl`. Keep the JSONL in an untracked local directory. When sharing results, prefer the aggregate or an excerpt. The local log keeps only allowlisted public issue and revision identifiers, coarse categorization, timestamps, and numeric counters. Keep raw prompts, source, logs, account names, credentials and personal data out of the measurement input.
3. If the client reports actual counters, include the documented source and each available count once. Cached input and reasoning output are breakdowns of input and output. When they are available, uncached input is input minus cached input. Keep unavailable breakdowns null. Count UTF-8 bytes of actual context packets or visible tool output separately. Count each shell/tool invocation under a consistent convention for both measurements.

For example, this is a **simulated** interrupted-record command.

```sh
python3 factory/metrics.py record /tmp/kelana-factory-runs.jsonl <<'JSON'
{"schema_version":1,"kind":"delivery","issue":233,"client":"cloud","profile":"standard","complexity":"complex","domain":"factory","started_at":"2026-01-01T01:00:00Z","ended_at":"2026-01-01T01:07:00Z","outcome":"interrupted","ci_attempts":0}
JSON
python3 factory/metrics.py report /tmp/kelana-factory-runs.jsonl
```

The v1 record uses nullable `issue`, `pr`, `base_sha`, `head_sha`, `client`, `profile`, and `model` fields where evidence permits. Merged records require both GitHub identifiers and both revisions. Accepted outcomes are `merged`, `failed`, `interrupted` and `completed` for a rehearsal. The report derives elapsed seconds from timestamps. `tokens` is an object containing `input_tokens`, `cached_input_tokens`, `output_tokens`, and `reasoning_output_tokens`. Its provenance is `token_source` with `cli-exec`, `cli-status`, or `documented-export`. `proxies` contains `context_bytes`, `tool_output_bytes`, and `commands`. Use `proxy_source: "counted"` for directly observed counts. The checked-in [historical observations](../../factory/fixtures/v1-deliveries.jsonl) are complete serialized examples.

## Supported telemetry

- The Codex CLI supports `/status` for usage summaries. Non-interactive `codex exec --json` documents per-turn usage for input, cached input, output, and reasoning output. For a single turn you already planned to run, pipe its JSON output directly into `python3 factory/metrics.py cli-usage`, then copy the sanitized counters into the record. For multiple turns, sum distinct, comparable measured turn counts from the same delivery and mark incomplete counters unavailable. [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) · [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- For this Cloud/web workflow, the applicable official docs describe aggregate allowance through Settings or the usage dashboard. We observed no supported per-task token export in this session. OpenAI also documents usage access through the Compliance API and eligible Enterprise/Edu desktop views that may show detailed chat usage. Those surfaces depend on account eligibility and permissions. Use null for per-task Cloud/web tokens when unavailable. This baseline uses the existing subscription and GitHub access. [Codex plans and usage](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan) · [Desktop usage analytics](https://help.openai.com/en/articles/20001478-reviewing-work-and-codex-usage-and-using-personal-analytics-in-chatgpt-desktop)

The primary measure is **unique merged issues per observed allowance unit in a matched cohort**. Optionally pass `--allowance PATH.json` to the report with a separate manual observation containing `started_at`, `ended_at`, `unit` (`credits` or `percentage-points`), `before_remaining`, `after_remaining` and `isolated_same_reset_window`. Isolated means the same allowance period and one comparable cohort with its participating deliveries fully inside the window, with no concurrent activity drawing on that allowance. The report leaves the efficiency ratio unknown if those conditions fail or no decrease can be measured. Keep allowance units separate across plans, windows and recording methods.

With allowance unavailable, use **merged issues per recorded delivery hour** as the throughput proxy. Secondary measures are observed input/output tokens per merged record, first-pass CI rate, CI and repair attempts, and elapsed time. Pair throughput with outcomes and completed quality gates. Context and tool-output bytes are independent proxies for input volume. A 25–40% allowance reduction is an experimental target for matched work.

## Historical evidence

| Cohort | Issue and delivery | PR-open to merge | Factory CI attempts |
| --- | --- | ---: | ---: |
| Small copy/CSS | [#205 / PR #215](https://github.com/alvintriseptia/kelana-ria/pull/215) | 5m 55s | [1, passed first time](https://github.com/alvintriseptia/kelana-ria/actions/runs/46092027098) |
| Scoped Studio UI | [#209 / PR #219](https://github.com/alvintriseptia/kelana-ria/pull/219) | 39m 25s | [1 failed](https://github.com/alvintriseptia/kelana-ria/actions/runs/46096645142), [1 passed](https://github.com/alvintriseptia/kelana-ria/actions/runs/46099479755) |
| Complex contracts and Studio location context | [#163 / PR #226](https://github.com/alvintriseptia/kelana-ria/pull/226) | 6m 41s | [1, passed first time](https://github.com/alvintriseptia/kelana-ria/actions/runs/46105578750) |

GitHub times cover the PR interval only. The records have no historical agent timing, model/profile telemetry, allowance, repair counts, or token measurements. Each row is a separate example. Use the fixed rehearsal below for paired context-volume comparisons.

## V1 audit and reproducible rehearsal

V1 repeats the install/build/test and queue/claim/handoff instructions in AGENTS and the delivery skill. At the baseline revision these two files total 8,337 B. The Studio implementation and browser harness total 263,005 B before adding guidance or an issue body. Full reads send the whole file even for a local change. The baseline workflow defines 12 run steps in the workspace job after tool setup, including builds, provider rehearsal, Chromium installation, mobile checks, and release tests. Full CI runs preserve that coverage. The #209 timeline shows a concrete retry cost, with 31m 17s between the end of its failed run and the start of the next run. GitHub timestamps cannot attribute the gap to one activity.

Run a controlled full-file read of the baseline against a local Git checkout. The rehearsal counts commands and captured tool output before any display truncation. It reads the repository and prints only aggregate measurements.

```sh
python3 factory/metrics.py rehearse 39e39ed68fdc8ce8b627b7627ca87a51bcf86d17 > /tmp/kelana-factory-rehearsal.jsonl
python3 factory/metrics.py report factory/fixtures/v1-deliveries.jsonl /tmp/kelana-factory-rehearsal.jsonl
```

| Simulated context read | Commands | Captured bytes |
| --- | ---: | ---: |
| Small CSS and contrast QA | 8 | 45,842 |
| Scoped Studio UI and visual harness | 8 | 300,526 |
| Complex board map, contracts and game QA | 10 | 180,436 |

These are controlled Git reads, measured on the exact revision shown. They omit GitHub issue/PR text, other tool output, model time, and delivery work. Use the same task and source revision for the comparison with targeted context packets. [Factory CI](../../.github/workflows/factory.yml) · [Delivery skill](../../.agents/skills/github-delivery/SKILL.md)
