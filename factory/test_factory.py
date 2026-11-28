import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import agent


class QueueTests(unittest.TestCase):
    def test_priority_then_oldest(self):
        def ticket(number, priority):
            return {"number": number, "labels": [{"name": priority}]}
        self.assertEqual([2, 4, 1], [i["number"] for i in sorted(
            [ticket(1, "priority:2"), ticket(4, "priority:1"),
             ticket(2, "priority:1")], key=agent.queue_order)])

    def test_dependency_format(self):
        self.assertEqual([12, 42], agent.dependencies("### Dependencies\n\n#12, #42\n\n## Outcome\nx"))
        self.assertEqual([], agent.dependencies("## Dependencies\nNone"))
        for body in ["", "## Dependencies\nLater", "## Dependencies\nNone\n#1"]:
            with self.assertRaises(ValueError):
                agent.dependencies(body)

    def test_only_first_worker_claims(self):
        api = Mock()
        api.side_effect = [{}, agent.ApiError("HTTP 422"), {"ref": "refs/heads/agent/issue-8"}]
        self.assertTrue(agent.claim(api, 8, "abc"))
        self.assertFalse(agent.claim(api, 8, "abc"))

    def test_missing_dependency_does_not_block_next_ticket(self):
        def ticket(n, dep):
            return {"number": n, "labels": [], "body": f"## Dependencies\n{dep}",
                    "html_url": "https://example.invalid"}
        with patch.object(agent, "pages", return_value=[ticket(4, "#404"), ticket(5, "None")]), \
             patch.object(agent, "api", side_effect=agent.ApiError("HTTP 404")), \
             patch.object(agent, "claim", return_value=True) as claim:
            agent.pickup("base")
            claim.assert_called_once_with(agent.api, 5, "base")

    def test_resume_without_new_claim(self):
        api = Mock(side_effect=[{"state": "open"}, {"ref": "refs/heads/agent/issue-8"}])
        agent.resume(api, 8)
        self.assertTrue(all("method" not in call.kwargs for call in api.call_args_list))


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.put("factory/copy-keys.json", '["nav.home"]')
        self.put("apps/web/src/locales/id.json", '{"nav.home":"Beranda","rules":"Win"}')
        self.base = self.commit()

    def git(self, *args):
        return subprocess.check_output(["git", "-C", self.root, *args], text=True).strip()

    def put(self, path, data):
        dest = self.root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(data)

    def commit(self):
        self.git("add", ".")
        self.git("-c", "user.name=test", "-c", "user.email=test@example.invalid",
                 "commit", "-qm", "fixture")
        return self.git("rev-parse", "HEAD")

    def eligible(self):
        return agent.routine_scope(self.root, self.base, self.commit())

    def test_qa_note(self):
        self.put("docs/qa/walkthrough.md", "Opening the menu")
        self.assertTrue(self.eligible())

    def test_neutral_copy(self):
        self.put("apps/web/src/locales/id.json", '{"nav.home":"Menu utama","rules":"Win"}')
        self.assertTrue(self.eligible())

    def test_mixed_scope(self):
        self.put("docs/qa/example.md", "x")
        self.put("AGENTS.md", "x")
        self.assertFalse(self.eligible())

    def test_protected_copy_and_placeholders(self):
        for values in [{"nav.home": "Home", "rules": "Changed"},
                       {"nav.home": "Hi {name}", "rules": "Win"},
                       {"nav.home": "<b>Home</b>", "rules": "Win"},
                       {"nav.home": "First", "rules": "Win", "new": "Added"}]:
            self.put("apps/web/src/locales/id.json", json.dumps(values))
            self.assertFalse(self.eligible())

    def test_executable_and_symlink(self):
        self.put("docs/qa/file.md", "x")
        (self.root / "docs/qa/file.md").chmod(0o755)
        self.assertFalse(self.eligible())
        (self.root / "docs/qa/link.md").symlink_to("elsewhere")
        self.assertFalse(self.eligible())


class MergeTests(unittest.TestCase):
    def test_refuses_revision_after_semantic_review(self):
        pull = {"head": {"ref": "agent/issue-2", "sha": "new", "repo": {"full_name": agent.REPO}},
                "state": "open", "draft": False, "base": {"ref": "main", "sha": "base"}}
        with patch.object(agent, "api", return_value=pull) as api:
            with self.assertRaisesRegex(ValueError, "reviewed"):
                agent.merge(".", 16, "base", "old")
            self.assertEqual(len(api.call_args_list), 1)

    def test_complete_merge_gate(self):
        pull = {"head": {"ref": "agent/issue-2", "sha": "new", "repo": {"full_name": agent.REPO}},
                "state": "open", "draft": False, "base": {"ref": "main", "sha": "base"},
                "body": "Closes #2"}
        run = {"id": 8, "run_attempt": 1, "path": agent.FLOW, "event": "pull_request",
               "head_branch": "agent/issue-2", "status": "completed", "conclusion": "success",
               "head_sha": "new", "head_repository": {"full_name": agent.REPO},
               "pull_requests": [{"number": 16, "base": {"sha": "base"}, "head": {"sha": "new"}}]}
        results = {"pulls/16": pull, "issues/2": {"state": "open", "body": "## Dependencies\n\nNone", "labels": [{"name": "ready"}]},
                   "git/ref/heads/main": {"object": {"sha": "base"}},
                   "pulls/16/merge": {"merged": True, "sha": "merged"},
                   "git/commits/merged": {"parents": [{"sha": "base"}]}}
        reviews = {"reviewDecision": "", "latestReviews": [], "statusCheckRollup": [{"conclusion": "SUCCESS"}]}
        links = {"totalCount": 1, "nodes": [{"number": 2, "repository": {"nameWithOwner": agent.REPO}}]}
        with patch.object(agent, "api", side_effect=lambda path, **kw: results[path]) as api, \
             patch.object(agent, "git", side_effect=[b"", b"new", b"base"]), \
             patch.object(agent, "pages", side_effect=[[run], [{"name": "factory", "conclusion": "success"},
                                                        {"name": "workspace", "conclusion": "success"}]]), \
             patch.object(agent, "routine_scope", return_value=True), \
             patch.object(agent, "closing_issues", return_value=links), \
             patch.object(subprocess, "check_output", return_value=json.dumps(reviews)):
            agent.merge(".", 16, "base", "new")
            api.assert_any_call("pulls/16/merge", method="PUT", sha="new", merge_method="squash")

    def test_ci_run_belongs_to_pr_and_base(self):
        run = {"pull_requests": [{"number": 16, "head": {"sha": "a"}, "base": {"sha": "b"}}]}
        self.assertTrue(agent.tested_revision(run, 16, "a", "b"))
        self.assertFalse(agent.tested_revision(run, 15, "a", "b"))
        self.assertFalse(agent.tested_revision(run, 16, "a", "old"))
        self.assertFalse(agent.tested_revision({}, 16, "a", "b"))

    def test_closes_only_the_claimed_issue(self):
        node = {"number": 5, "repository": {"nameWithOwner": agent.REPO}}
        self.assertTrue(agent.closes_claim({"totalCount": 1, "nodes": [node]}, 5))
        self.assertFalse(agent.closes_claim({"totalCount": 2, "nodes": [node, node]}, 5))
        self.assertFalse(agent.closes_claim({"totalCount": 0, "nodes": []}, 5))

    def test_ci_requires_current_head_successful_jobs(self):
        run = {"path": ".github/workflows/factory.yml", "event": "pull_request",
               "head_sha": "abc", "status": "completed", "conclusion": "success",
               "head_repository": {"full_name": agent.REPO}, "head_branch": "agent/issue-1"}
        jobs = [{"name": name, "conclusion": "success"} for name in ("factory", "workspace")]
        self.assertTrue(agent.green(run, "abc", "agent/issue-1", jobs))
        self.assertFalse(agent.green(run, "abc", "agent/issue-1", jobs[:1]))
        for sha, jobs in [("old", [{"name": "factory", "conclusion": "success"}]),
                          ("abc", []), ("abc", [{"name": "factory", "conclusion": "skipped"}])]:
            self.assertFalse(agent.green(run, sha, "agent/issue-1", jobs))


if __name__ == "__main__":
    unittest.main()
