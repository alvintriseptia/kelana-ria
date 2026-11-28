from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import agent
import delivery as dl


NUMBER = 220
NAME = "agent/issue-220"
REPO = agent.REPO
BODY = "Closes #220\n\n## Outcome\nOutcome\n\n## Verification\nTests\n\n## Review\nReview"
READY = {"state": "open", "labels": [{"name": "ready"}], "body": "## Dependencies\n\nNone"}
COMPLETE = {"state": "closed", "state_reason": "completed"}


def commit(path, name):
    subprocess.check_call(["git", "-C", str(path), "-c", "user.name=Factory Test",
                           "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", name])
    return dl.git_text(path, "rev-parse", "HEAD")


def pull(base, head, **keys):
    return {
        "number": 999, "title": "Fixture", "body": BODY, "state": "open",
        "html_url": "https://example.invalid/pull/999", "head": {"ref": NAME, "sha": head, "repo": {"full_name": REPO}},
        "base": {"ref": "main", "sha": base}, **keys,
    }


class LegacyClaimTests(unittest.TestCase):
    def setUp(self):
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name) / "control"
        self.remote = Path(temp.name) / "remote.git"
        dl.git(Path(temp.name), "init", "-q", "-b", "main", str(self.root))
        self.old = commit(self.root, "V1")
        dl.git(self.root, "branch", NAME, self.old)
        self.base = commit(self.root, "Factory V2")
        dl.git(self.root, "clone", "--quiet", "--bare", str(self.root), str(self.remote))
        self.head = self.old
        self.pr = None
        self.issue = READY
        self.mutations = []

    def request(self, path, method="GET", **fields):
        if method != "GET":
            self.mutations.append((path, method))
        if path == f"issues/{NUMBER}":
            return self.issue
        if path == f"git/ref/heads/{NAME}":
            return {"ref": f"refs/heads/{NAME}", "object": {"sha": self.head}}
        if path == "git/ref/heads/main":
            return {"object": {"sha": self.base}}
        if path.startswith("pulls?"):
            return [self.pr] if self.pr and self.pr["state"] == "open" else []
        if path == "pulls":
            self.pr = pull(self.base, self.head, title=fields["title"], body=fields["body"])
            return self.pr
        if path == "pulls/999":
            if method == "PATCH":
                self.pr.update(fields)
            return self.pr
        raise AssertionError(path)

    def prepare(self):
        return dl.prepare(self.root, NUMBER, self.base, self.request, agent.dependencies, REPO, str(self.remote))

    def test_retains_v1_claim_and_fast_forwards_empty_branch_once(self):
        before = self.head
        first = self.prepare()
        self.assertEqual(first, self.prepare())
        self.assertEqual(first["claimed_head_sha"], before)
        self.assertEqual(first["head_sha"], self.base)
        self.assertFalse(first["needs_base_update"])
        self.assertEqual(dl.git_text(self.remote, "rev-parse", NAME), before)
        self.assertEqual(self.mutations, [])
        path = Path(first["worktree"])
        (path / "uncommitted.txt").write_text("Draft")
        with self.assertRaisesRegex(ValueError, "uncommitted"):
            self.prepare()
        self.assertEqual((path / "uncommitted.txt").read_text(), "Draft")

    def test_resume_preserves_commits_and_open_pr_across_workflows(self):
        path = self.root.parent / "existing authoring folder"
        dl.git(self.root, "worktree", "add", str(path), NAME)
        self.head = commit(path, "Work started before V2")
        dl.git(path, "push", str(self.remote), NAME)
        self.pr = pull(self.base, self.head)
        checked = self.prepare()
        self.assertEqual(checked["head_sha"], self.head)
        self.assertEqual(checked["worktree"], str(path))
        self.assertEqual(checked["pr"], 999)
        self.assertTrue(checked["needs_base_update"])
        self.assertEqual(self.mutations, [])
        with self.assertRaisesRegex(ValueError, "Update the branch"):
            dl.publish(path, NUMBER, "Fixture", BODY, self.request, agent.dependencies, REPO)

    def test_publish_is_idempotent_and_cleanup_protects_edits(self):
        info = self.prepare()
        path = Path(info["worktree"])
        self.head = commit(path, "Finish old issue using V2")
        dl.git(path, "push", str(self.remote), NAME)
        options = (path, NUMBER, "Fixture", BODY, self.request, agent.dependencies, REPO)
        self.assertEqual(dl.publish(*options)["operation"], "created")
        self.assertEqual(dl.publish(*options)["operation"], "reused")
        self.assertEqual(dl.publish(path, NUMBER, "Updated", BODY, self.request, agent.dependencies, REPO)["operation"], "updated")
        self.assertEqual(self.mutations, [("pulls", "POST"), ("pulls/999", "PATCH")])
        with self.assertRaisesRegex(ValueError, "merged"):
            dl.cleanup(self.root, 999, self.request, REPO)
        self.issue = COMPLETE
        self.pr.update(merged=True, state="closed")
        work = path / "unsaved"
        work.touch()
        with self.assertRaisesRegex(ValueError, "edits"):
            dl.cleanup(self.root, 999, self.request, REPO)
        work.unlink()
        self.assertEqual(dl.cleanup(self.root, 999, self.request, REPO)["status"], "removed")
        self.assertEqual(dl.cleanup(self.root, 999, self.request, REPO)["status"], "already-removed")
        self.assertEqual(dl.git_text(self.remote, "rev-parse", NAME), self.head)

    def test_incomplete_dependency_stops_before_creating_worktree(self):
        self.issue = {**READY, "body": "## Dependencies\n\n#233"}
        def lookup(path):
            return READY if path == "issues/233" else self.request(path)
        with self.assertRaisesRegex(ValueError, "Dependency #233"):
            dl.prepare(self.root, NUMBER, self.base, lookup, agent.dependencies, REPO, str(self.remote))
        self.assertIsNone(dl.worktree_for(self.root, NAME))


class VerificationTests(unittest.TestCase):
    def test_failure_redaction_timeout_and_full_log_retention(self):
        with TemporaryDirectory() as temp:
            path = Path(temp)
            command = [sys.executable, "-c",
                       "print('x'*50000); print('ERROR: Authorization: short-test'); "
                       "print('ERROR: user@example.invalid'); raise SystemExit(9)"]
            row = dl.run_check(path, "failing", command, path, 10)
            full = (path / "failing.log").read_text()
            self.assertEqual(row["exit_code"], 9)
            self.assertEqual(row["log_bytes"], len(full))
            self.assertIn("short-test", full)
            self.assertNotIn("short-test", row["failure_excerpt"])
            self.assertNotIn("user@example.invalid", row["failure_excerpt"])
            self.assertLessEqual(len(row["failure_excerpt"]), dl.MAX_EXCERPT)
            timed = dl.run_check(path, "timeout", [sys.executable, "-c", "import time; time.sleep(10)"], path, 1)
            self.assertEqual(timed["status"], "timed-out")
            self.assertEqual(timed["exit_code"], 124)
            ok = dl.run_check(path, "passing", [sys.executable, "-c", "print('passed')"], path, 10)
            self.assertEqual(ok["status"], "passed")
            self.assertNotIn("failure_excerpt", ok)

    def test_pr_requires_exact_single_closing_line_and_evidence(self):
        dl.validate_pr_body(BODY, NUMBER)
        for item in (BODY + "\nFixes #233", BODY.replace("## Verification", "## Tests"), BODY.replace("#220", "#176")):
            with self.assertRaises(ValueError):
                dl.validate_pr_body(item, NUMBER)

    def test_ci_reports_old_missing_pending_failed_and_green_separately(self):
        head, base = "a" * 40, "b" * 40
        current = pull(base, head)
        remote = {"git/ref/heads/main": {"object": {"sha": base}},
                  f"git/ref/heads/{NAME}": {"ref": f"refs/heads/{NAME}", "object": {"sha": head}},
                  f"compare/{base}...{head}": {"merge_base_commit": {"sha": base}}}
        workflow = {"path": dl.FLOW, "event": "pull_request", "head_sha": head, "head_branch": NAME,
                    "head_repository": {"full_name": REPO}, "status": "completed", "conclusion": "success",
                    "id": 10, "run_attempt": 1, "pull_requests": [{"number": current["number"]}]}
        cases = [
            ("missing", [], []),
            ("missing", [{**workflow, "head_sha": "0" * 40}], []),
            ("pending", [{**workflow, "status": "in_progress"}], []),
            ("failed", [workflow], [{"name": "factory", "conclusion": "success"}]),
            ("passed", [workflow], [{"name": name, "conclusion": "success"} for name in dl.FACTORY_JOBS]),
        ]
        def request(path):
            return [current] if path.startswith("pulls?") else remote[path]
        for expected, runs, jobs in cases:
            with self.subTest(expected=expected):
                result = dl.ci_status(request, lambda _path, field: {"workflow_runs": runs, "jobs": jobs}[field],
                                      NUMBER, REPO, False)
                self.assertEqual(result["status"], expected)
        remote[f"compare/{base}...{head}"]["merge_base_commit"]["sha"] = "0" * 40
        self.assertEqual(dl.ci_status(request, None, NUMBER, REPO, False)["status"], "stale")

    def test_final_verification_keeps_install_build_and_factory(self):
        root = Path(__file__).resolve().parent.parent
        with patch.object(dl.subprocess, "check_output", return_value=(root / ".nvmrc").read_text()), \
             patch.object(dl, "run_check", side_effect=lambda _root, name, *_: {"status": "passed", "check": name, "exit_code": 0}):
            result = dl.verify(root, [], "studio", True, 60, None)
        self.addCleanup(Path(result["log_dir"]).rmdir)
        self.assertEqual([row["check"] for row in result["checks"]], ["factory", "install", "build", "studio"])


if __name__ == "__main__":
    unittest.main()
