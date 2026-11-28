import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

import metrics


def delivery(**fields):
    return {
        "schema_version": 1, "kind": "delivery", "issue": 233, "pr": 244,
        "base_sha": "a" * 40, "head_sha": "b" * 40, "client": "cloud",
        "complexity": "standard", "domain": "factory",
        "started_at": "2026-01-01T01:00:00Z", "ended_at": "2026-01-01T01:15:00Z",
        "outcome": "merged", **fields,
    }


class MetricsTests(unittest.TestCase):
    def test_missing_stays_unknown_and_timing_is_derived(self):
        row = metrics.sanitize(delivery(elapsed_seconds=5))
        self.assertEqual(row["elapsed_seconds"], 900)
        self.assertEqual(row["tokens"], dict.fromkeys(metrics.TOKEN_FIELDS))
        self.assertEqual(row["proxies"], dict.fromkeys(metrics.PROXY_FIELDS))
        self.assertIsNone(row["ci_attempts"])
        self.assertIsNone(row["model"])
        self.assertEqual(metrics.sanitize(row), row)

    def test_version_validation_rejects_invalid_state_or_counters(self):
        cases = [
            {"schema_version": 2}, {"schema_version": True}, {"pr": None},
            {"base_sha": "--other-ref"}, {"ended_at": "2025-12-31T01:00:00Z"},
            {"first_ci_passed": True, "ci_attempts": 0}, {"repair_attempts": -1},
            {"tokens": {"input_tokens": True}, "token_source": "cli-exec"},
            {"tokens": {"input_tokens": 0}},
            {"tokens": {"input_tokens": 2, "cached_input_tokens": 3}, "token_source": "cli-exec"},
            {"model": "user@example.invalid"},
        ]
        for fields in cases:
            with self.subTest(fields=fields), self.assertRaises(ValueError):
                metrics.sanitize(delivery(**fields))

    def test_redacts_unknown_content_at_ingest_and_report(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "runs.jsonl"
            cli = [sys.executable, str(Path(metrics.__file__))]
            secret = "credential and user@example.invalid"
            raw = delivery(transcript=secret, proxies={"commands": 1, "tool_output": secret},
                           proxy_source="counted", tokens={"text": secret})
            subprocess.run([*cli, "record", str(path)], text=True, input=json.dumps(raw), check=True)
            self.assertNotIn(secret, path.read_text())
            raw.update(outcome="failed", issue=242, repair_attempts=1)
            with path.open("a") as log:
                print(json.dumps(raw), file=log)
            summary = subprocess.check_output([*cli, "report", str(path), str(path)], text=True)
            self.assertNotIn(secret, summary)
            outcomes = json.loads(summary)["cohorts"][0]["outcomes"]
            self.assertEqual(outcomes, {"merged": 1, "failed": 1})

    def test_completed_turn_observations_keep_subsets_separate(self):
        example = {"input_tokens": 200, "cached_input_tokens": 50, "output_tokens": 30,
                   "reasoning_output_tokens": 10, "private": "ignore"}
        recovered = metrics.cli_usage([
            json.dumps({"type": "item.completed", "item": {"text": "private"}}),
            json.dumps({"type": "turn.completed", "usage": example}),
        ])
        row = metrics.sanitize(delivery(**recovered))
        self.assertEqual(row["token_source"], "cli-exec")
        self.assertEqual(row["tokens"], {key: example[key] for key in metrics.TOKEN_FIELDS})
        self.assertIsNone(metrics.cli_usage(['{"type":"turn.failed"}'])["token_source"])

    def test_aggregation_groups_and_counts_observed_counters(self):
        rows = [metrics.sanitize(delivery(**sample)) for sample in [
            {"first_ci_passed": True, "ci_attempts": 1},
            {"issue": 234, "first_ci_passed": False, "ci_attempts": 2, "repair_attempts": 1,
             "token_source": "cli-status", "tokens": {"input_tokens": 100, "output_tokens": 20}},
            {"issue": 235, "outcome": "interrupted", "pr": None, "head_sha": None},
            {"issue": 236, "outcome": "failed", "first_ci_passed": False, "ci_attempts": 1},
            {"issue": 237, "outcome": "merged", "client": "cli"},
        ]]
        _, cloud = metrics.summarize(rows)
        self.assertEqual(cloud["outcomes"], {"merged": 2, "failed": 1, "interrupted": 1})
        self.assertEqual(cloud["merged_per_recorded_hour"], 2)
        self.assertEqual(cloud["first_pass_ci"]["observations"], 3)
        self.assertAlmostEqual(cloud["first_pass_ci"]["mean"], 1 / 3)
        self.assertEqual(cloud["tokens_per_merged_record"]["input_tokens"], {"mean": 100, "observations": 1})
        self.assertIsNone(cloud["tokens_per_merged_record"]["reasoning_output_tokens"]["mean"])

    def test_allowance_requires_an_isolated_comparable_window(self):
        window = {
            "started_at": "2026-01-01T00:59:00Z", "ended_at": "2026-01-01T01:16:00Z",
            "unit": "percentage-points", "before_remaining": 84, "after_remaining": 80,
            "isolated_same_reset_window": True, "account": "private@example.invalid",
        }
        rows = [metrics.sanitize(delivery())]
        result = metrics.summarize_allowance(window, rows)
        self.assertEqual(result["merged_per_allowance_unit"], 0.25)
        self.assertNotIn("account", result)
        rows.append(metrics.sanitize(delivery(issue=234, profile="small")))
        self.assertIsNone(metrics.summarize_allowance(window, rows)["merged_per_allowance_unit"])
        rows.pop()
        window["after_remaining"] = 95
        self.assertIsNone(metrics.summarize_allowance(window, rows)["observed_decrease"])


if __name__ == "__main__":
    unittest.main()
