import unittest

from context_packet import build_packet, Index
from pathlib import Path
from workflow import execution_profile, extract, retry_advice

ROOT = Path(__file__).resolve().parent.parent


class WorkflowTests(unittest.TestCase):
    def test_profiles_are_advisory_and_standard_is_default(self):
        self.assertEqual(execution_profile("Fix Main Lagi contrast", "")["reasoning"], "low")
        self.assertEqual(execution_profile("Revise Studio confirmation", "")["reasoning"], "medium")
        self.assertEqual(execution_profile("Add Claim zone polygons", "")["reasoning"], "high")
        self.assertEqual(execution_profile("Refactor docs and workflow", "")["name"], "standard")
        self.assertEqual(execution_profile("Fix copy", "Database isolation changes")["name"], "high-risk")
        self.assertTrue(execution_profile("Improve", "")["advisory"])

    def test_packet_retains_full_issue_during_profile_transition(self):
        index = Index(ROOT, "HEAD")
        for title, name, limit in [
            ("Fix Claim CSS contrast", "small", 4),
            ("Revamp Studio map editor", "standard", 8),
            ("Change Claim engine and zone polygons", "high-risk", 12),
        ]:
            issue = {"number": 5, "state": "open", "title": title,
                     "body": "## Outcome\nOriginal text.\n## Dependencies\nNone"}
            packet = build_packet(index, issue, [], [], index.sha, index.sha)
            self.assertEqual(packet["execution_profile"]["name"], name)
            self.assertLessEqual(len(packet["source_and_test_hints"]), limit)
            self.assertEqual(packet["issue"]["body"], issue["body"])
            self.assertIn("AGENTS.md", packet["required_guidance"])

    def test_same_error_changes_retry_advice_without_exposing_logs(self):
        def failure(message, name="studio", timestamp="2026-11-28T10:00:00Z"):
            return {"status": "failed", "checks": [
                {"check": name, "exit_code": 1, "failure_excerpt": timestamp + " " + message},
            ]}
        one = failure("AssertionError draft failed")
        two = failure("AssertionError draft failed", timestamp="2026-11-28T10:02:00Z")
        result = retry_advice(one, two)
        self.assertEqual(result["state"], "repeated")
        self.assertNotIn("AssertionError", str(result))
        self.assertEqual(retry_advice(one, failure("A new error"))["state"], "new-failure")
        self.assertEqual(retry_advice(one, failure("AssertionError draft failed", "api"))["state"], "new-failure")
        self.assertEqual(retry_advice(one, {"status": "failed"})["state"], "needs-evidence")
        self.assertEqual(retry_advice(one, {"status": "passed"})["state"], "passed")

    def test_extract_is_bounded_at_edges_and_merges_overlapping_pointers(self):
        text = [str(n) for n in range(1, 10)]
        self.assertEqual(extract(text, [1, 2, 9], before=1, after=1), b"1\n2\n3\n8\n9")


if __name__ == "__main__":
    unittest.main()
