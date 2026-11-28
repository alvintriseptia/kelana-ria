"""Record and compare sanitized, versioned Factory delivery measurements."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import sys

VERSION = 1
TOKEN_FIELDS = ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens")
PROXY_FIELDS = ("context_bytes", "tool_output_bytes", "commands")
COHORT = ("kind", "client", "model", "profile", "complexity", "domain")
BASE_FILES = ("AGENTS.md", ".agents/skills/github-delivery/SKILL.md",
              "factory/agent.py", ".github/workflows/factory.yml")
MOBILE_FILES = (".agents/skills/mobile-pwa/SKILL.md", ".agents/skills/mobile-pwa/game-ui.md")
REHEARSALS = (
    ("small", "copy-css", MOBILE_FILES + ("apps/web/src/rulebook-claim-play.css", "apps/web/qa/contrast.mjs")),
    ("standard", "studio", MOBILE_FILES + ("apps/web/src/rulebook-studio.ts", "apps/web/qa/rulebook-studio.mjs")),
    ("complex", "contract-map", MOBILE_FILES + (".agents/skills/game-rules/SKILL.md",
        "apps/web/src/board-map.ts", "packages/contracts/src/rulebook.ts", "apps/web/qa/rulebook-claim.mjs")),
)


def choice(value, allowed, label):
    if value not in allowed:
        raise ValueError(f"Invalid {label}")
    return value


def count(value, label, *, min_value=0):
    if value is not None and (type(value) is not int or value < min_value):
        raise ValueError(f"Invalid {label}")
    return value


def revision(value):
    if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value)):
        raise ValueError("Invalid Git revision")
    return value


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", value):
        raise ValueError("Expected UTC timestamp")
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise ValueError("Invalid UTC timestamp") from None


def mapping(value):
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object")
    return value


def reduced_tokens(raw, source):
    raw = mapping(raw)
    source = choice(source, ("cli-exec", "cli-status", "documented-export", None), "token source")
    tokens = {key: count(raw.get(key), key) for key in TOKEN_FIELDS}
    measured = any(value is not None for value in tokens.values())
    if measured != (source is not None):
        raise ValueError("Token observations and their provenance must be supplied together")
    for subset, total in ((TOKEN_FIELDS[1], TOKEN_FIELDS[0]), (TOKEN_FIELDS[3], TOKEN_FIELDS[2])):
        if tokens[subset] is not None and tokens[total] is not None and tokens[subset] > tokens[total]:
            raise ValueError("Token subset exceeds its total")
    return tokens


def sanitize(raw):
    raw = mapping(raw)
    if type(raw.get("schema_version")) is not int or raw["schema_version"] != VERSION:
        raise ValueError("Unsupported metrics schema version")
    started_at, ended_at = raw.get("started_at"), raw.get("ended_at")
    start, end = instant(started_at), instant(ended_at)
    if start > end:
        raise ValueError("Run ends before it starts")
    kind = choice(raw.get("kind"), ("delivery", "historical-pr", "rehearsal"), "record kind")
    outcome = choice(raw.get("outcome"), ("merged", "failed", "interrupted", "completed"), "outcome")
    if (kind == "rehearsal" and outcome == "merged") or (kind == "delivery" and outcome == "completed"):
        raise ValueError("Outcome conflicts with record kind")
    issue = count(raw.get("issue"), "issue", min_value=1)
    pr = count(raw.get("pr"), "PR", min_value=1)
    base_sha, head_sha = revision(raw.get("base_sha")), revision(raw.get("head_sha"))
    if outcome == "merged" and None in (issue, pr, base_sha, head_sha):
        raise ValueError("Merged records require issue, PR, base, and head")
    if kind == "delivery" and issue is None:
        raise ValueError("Delivery records require an issue")
    attempts = count(raw.get("ci_attempts"), "CI attempts")
    initial_pass = raw.get("first_ci_passed")
    if initial_pass is not None and (type(initial_pass) is not bool or attempts == 0):
        raise ValueError("Invalid first-pass CI observation")
    model = raw.get("model")
    if model is not None and (not isinstance(model, str) or not re.fullmatch(
            r"gpt-[0-9][a-z0-9.-]{0,31}|o[0-9](?:-[a-z0-9.-]{1,24})?", model)):
        raise ValueError("Invalid model identifier")
    tokens = reduced_tokens(raw.get("tokens", {}), raw.get("token_source"))
    proxies = mapping(raw.get("proxies", {}))
    proxy_values = {key: count(proxies.get(key), key) for key in PROXY_FIELDS}
    return {
        "schema_version": VERSION, "kind": kind, "issue": issue, "pr": pr,
        "base_sha": base_sha, "head_sha": head_sha,
        "client": choice(raw.get("client"), ("cloud", "cli", "desktop", None), "client"),
        "profile": choice(raw.get("profile"), ("small", "standard", "high-risk", None), "profile"),
        "model": model,
        "complexity": choice(raw.get("complexity"), ("small", "standard", "complex"), "complexity"),
        "domain": choice(raw.get("domain"), ("copy-css", "studio", "contract-map", "game", "provider", "factory", "other"), "domain"),
        "started_at": started_at, "ended_at": ended_at, "elapsed_seconds": (end - start).total_seconds(),
        "outcome": outcome, "ci_attempts": attempts, "first_ci_passed": initial_pass,
        "repair_attempts": count(raw.get("repair_attempts"), "repair attempts"),
        "token_source": raw.get("token_source"), "tokens": tokens,
        "proxy_source": choice(raw.get("proxy_source"), ("git-read-rehearsal", "counted", None), "proxy source"),
        "proxies": proxy_values,
    }


def mean_observed(values):
    observed = [v for v in values if v is not None]
    return {"observations": len(observed), "mean": statistics.mean(observed) if observed else None}


def summarize(records):
    groups = defaultdict(list)
    for record in records:
        groups[tuple(record[key] for key in COHORT)].append(record)
    result = []
    for cohort, group in sorted(groups.items(), key=lambda item: tuple(v or "" for v in item[0])):
        outcomes = Counter(row["outcome"] for row in group)
        successes = {row["issue"] for row in group if row["outcome"] == "merged"}
        elapsed = sum(row["elapsed_seconds"] for row in group)
        merged = [row for row in group if row["outcome"] == "merged"]
        result.append({
            "cohort": dict(zip(COHORT, cohort)),
            "outcomes": dict(outcomes),
            "unique_merged_issues": len(successes),
            "elapsed_seconds": mean_observed(row["elapsed_seconds"] for row in group),
            "merged_per_recorded_hour": len(successes) * 3600 / elapsed if elapsed and cohort[0] != "rehearsal" else None,
            "first_pass_ci": mean_observed(row["first_ci_passed"] for row in group),
            "ci_attempts": mean_observed(row["ci_attempts"] for row in group),
            "repair_attempts": mean_observed(row["repair_attempts"] for row in group),
            "tokens_per_merged_record": {
                key: mean_observed(row["tokens"][key] for row in merged) for key in TOKEN_FIELDS
            },
            "proxies_per_record": {
                key: mean_observed(row["proxies"][key] for row in group) for key in PROXY_FIELDS
            },
        })
    return result


def summarize_allowance(raw, records):
    window = mapping(raw)
    unit = choice(window.get("unit"), ("credits", "percentage-points"), "allowance unit")
    start, end = instant(window.get("started_at")), instant(window.get("ended_at"))
    before, after = window.get("before_remaining"), window.get("after_remaining")
    if start >= end or any(type(n) not in (int, float) or not 0 <= n <= 1e15 for n in (before, after)):
        raise ValueError("Invalid allowance observation")
    if unit == "percentage-points" and max(before, after) > 100:
        raise ValueError("Invalid remaining percentage")
    isolated = window.get("isolated_same_reset_window")
    if type(isolated) is not bool:
        raise ValueError("Specify whether the allowance window is isolated")
    window_rows = [r for r in records if instant(r["started_at"]) < end and instant(r["ended_at"]) > start]
    deliveries = [r for r in window_rows if r["kind"] == "delivery"]
    comparable = (
        bool(deliveries) and len(window_rows) == len(deliveries)
        and len({tuple(r[key] for key in COHORT) for r in deliveries}) == 1
        and all(start <= instant(r["started_at"]) <= instant(r["ended_at"]) <= end for r in deliveries)
    )
    observed = before - after if before >= after else None
    successes = {r["issue"] for r in deliveries if r["outcome"] == "merged"}
    return {
        "source": "manual-dashboard", "unit": unit, "observed_decrease": observed,
        "merged_per_allowance_unit": len(successes) / observed if isolated and comparable and observed else None,
    }


def rehearsal(ref):
    root = Path(__file__).resolve().parent.parent
    for complexity, domain, files in REHEARSALS:
        start = datetime.now(timezone.utc)
        seen = 0
        paths = BASE_FILES + files
        for path in paths:
            result = subprocess.run(["git", "-C", str(root), "show", f"{ref}:{path}"], capture_output=True)
            if result.returncode:
                raise ValueError("Rehearsal path is unavailable at the selected revision")
            seen += len(result.stdout)
        end = datetime.now(timezone.utc)
        yield sanitize({
            "schema_version": VERSION, "kind": "rehearsal", "outcome": "completed",
            "complexity": complexity, "domain": domain, "base_sha": ref, "head_sha": ref,
            "started_at": start.isoformat().replace("+00:00", "Z"),
            "ended_at": end.isoformat().replace("+00:00", "Z"),
            "proxy_source": "git-read-rehearsal", "proxies": {"tool_output_bytes": seen, "commands": len(paths)},
        })


def cli_usage(lines):
    observation = None
    for line in lines:
        event = mapping(json.loads(line))
        if event.get("type") == "turn.completed" and isinstance(event.get("usage"), dict):
            if observation is not None:
                raise ValueError("Supply one completed turn or record the observed counters manually")
            observation = reduced_tokens(event["usage"], "cli-exec")
    return {"token_source": "cli-exec" if observation is not None else None,
            "tokens": observation if observation is not None else reduced_tokens({}, None)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    record = sub.add_parser("record", help="Read one JSON object on stdin and append its safe fields")
    record.add_argument("log", type=Path)
    report = sub.add_parser("report", help="Summarize one or more JSONL measurement files")
    report.add_argument("logs", type=Path, nargs="+")
    report.add_argument("--allowance", type=Path)
    sub.add_parser("cli-usage", help="Extract observed counters from one codex exec --json stream")
    sample = sub.add_parser("rehearse", help="Measure three representative context-read workloads")
    sample.add_argument("revision", type=revision)
    args = parser.parse_args(argv)
    try:
        if args.command == "record":
            row = sanitize(json.load(sys.stdin))
            descriptor = os.open(args.log, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, "a", encoding="utf8") as log:
                print(json.dumps(row), file=log)
        elif args.command == "report":
            unique = {}
            for path in args.logs:
                with path.open(encoding="utf8") as log:
                    for line in log:
                        if line.strip():
                            row = sanitize(json.loads(line))
                            unique[json.dumps(row, sort_keys=True)] = row
            rows = list(unique.values())
            allowance = None
            if args.allowance:
                with args.allowance.open(encoding="utf8") as source:
                    allowance = summarize_allowance(json.load(source), rows)
            print(json.dumps({"schema_version": VERSION, "cohorts": summarize(rows), "allowance": allowance}, indent=2))
        elif args.command == "cli-usage":
            print(json.dumps(cli_usage(sys.stdin)))
        elif args.command == "rehearse":
            for row in rehearsal(args.revision):
                print(json.dumps(row))
    except (ValueError, OSError) as error:
        # Error messages from operating systems and decoders can contain user-supplied text.
        message = str(error) if type(error) is ValueError else "Unable to read or write valid metrics"
        parser.exit(2, f"metrics: {message}\n")


if __name__ == "__main__":
    main()
