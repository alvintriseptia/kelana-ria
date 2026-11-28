import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import agent
import context_packet as cp

ROOT = Path(__file__).resolve().parent.parent


def sample(**fields):
    return {"number": 8, "state": "open", "title": "Studio map editor",
            "body": "## Outcome\n\nAdd Studio MapLibre editing.\n\n## Dependencies\n\n#233\n\n## Verification\n\nRun browser tests.",
            "updated_at": "2026-01-02T00:00:00Z", **fields}


class ContextTests(unittest.TestCase):
    def test_deterministic_multi_domain_packet_preserves_constraints(self):
        index = cp.Index(ROOT, "HEAD")
        issue = sample()
        evidence = [{"number": 233, "status": "closed", "state_reason": "completed"}]
        args = (index, issue, [233], evidence, index.sha, index.sha)
        first = cp.build_packet(*args, limit=4)
        self.assertEqual(first, cp.build_packet(*args, limit=4))
        self.assertEqual(first["issue"]["body"], issue["body"])
        self.assertEqual(first["dependencies"], [233])
        self.assertEqual(first["dependency_evidence"], evidence)
        self.assertEqual(first["domains"], ["map", "studio"])
        self.assertIn("AGENTS.md", first["required_guidance"])
        self.assertIn(".agents/skills/mobile-pwa/SKILL.md", first["required_guidance"])
        self.assertEqual({item["domain"] for item in first["source_and_test_hints"]}, {"map", "studio"})
        self.assertEqual(len(first["source_and_test_hints"]), 4)
        self.assertGreater(first["additional_index_matches"], 0)
        self.assertIn("8.1", {item.get("section") for item in first["prd_pointers"]})
        self.assertIn("A28", {item.get("scenario") for item in first["prd_pointers"]})
        self.assertIn(8, {item.get("issue") for item in first["prd_pointers"]})
        self.assertEqual(cp.build_packet(*args, limit=0)["source_and_test_hints"], [])

    def test_strict_dependencies_before_indexing_and_unavailable_evidence(self):
        fake = {"issues/8": sample(), "git/ref/heads/main": {"object": {"sha": "a" * 40}}}
        def request(path):
            if path == "issues/233":
                raise agent.ApiError("HTTP 404")
            return fake[path]
        report = cp.collect_packet(ROOT, 8, "HEAD", [], 0, request, agent.dependencies)
        self.assertEqual(report["dependency_evidence"][0]["status"], "unavailable")
        fake["issues/8"] = sample(body="## Dependencies\n\nPending.")
        with self.assertRaisesRegex(ValueError, "Dependencies"):
            cp.collect_packet(ROOT, 8, "HEAD", [], 0, request, agent.dependencies)

    def test_long_issue_body_survives_optional_limit_and_controls_are_removed(self):
        body = sample()["body"] + "\nLong requirement. " * 1600 + "\x1b[31m\u202E"
        index = cp.Index(ROOT, "HEAD")
        report = cp.build_packet(index, sample(body=body), [233], [], index.sha, index.sha, limit=0)
        self.assertIn("Long requirement.", report["issue"]["body"])
        self.assertEqual(report["issue"]["removed_control_characters"], 2)
        self.assertGreater(len(report["issue"]["body"]), 12800)
        self.assertNotIn("\x1b", report["issue"]["body"])
        self.assertNotIn("\u202E", report["issue"]["body"])

    def test_index_follows_pinned_commit_after_tracking_changes(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            def git(*args):
                return subprocess.check_output(["git", "-C", temp, "-c", "user.name=Factory Test",
                                                "-c", "user.email=factory@example.invalid", *args])
            git("init", "-q")
            git("commit", "--allow-empty", "-qm", "baseline")
            old = cp.Index(root, "HEAD")
            path = root / "apps/web/src/board-map.ts"
            path.parent.mkdir(parents=True)
            path.write_text("export function mountBoard() {}\n")
            git("add", "apps")
            git("commit", "-qm", "map symbol")
            new = cp.Index(root, "HEAD")
            self.assertNotEqual(old.sha, new.sha)
            self.assertEqual(cp.Index(root, old.sha).candidates("map"), [])
            self.assertEqual(new.candidates("map"), ["apps/web/src/board-map.ts"])
            self.assertEqual(new.symbols("apps/web/src/board-map.ts"), [{"name": "mountBoard", "line": 1}])
            report = cp.handoff(root, 234, "interrupted", new.sha, old.sha, ["Keep agent/issue-234"],
                                ["Check by user@example.invalid"], ["Bearer ghp_testcredential"], ["map"])
            self.assertEqual(report["head_sha"], new.sha)
            self.assertEqual(report["changed_paths"], ["apps/web/src/board-map.ts"])
            self.assertNotIn("user@example.invalid", str(report))
            self.assertNotIn("ghp_testcredential", str(report))
            self.assertIn("[redacted]", str(report))
            with self.assertRaises(ValueError):
                cp.short_notes(["x" * 181])


if __name__ == "__main__":
    unittest.main()
