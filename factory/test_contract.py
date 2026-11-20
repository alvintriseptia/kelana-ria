import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class RepositoryContract(unittest.TestCase):
    def test_all_prd_scenarios_have_linked_issue_owners(self):
        prd = (ROOT / "docs/Exploration_Game_MVP_PRD.md").read_text()
        expected = set(re.findall(r"^\| (A\d\d) \|", prd, re.M))
        self.assertEqual({f"A{i:02}" for i in range(1, 32)}, expected)
        owners = (ROOT / "docs/acceptance.md").read_text().splitlines()
        owned = set()
        for line in owners:
            if re.search(r"\bA\d\d\b", line):
                self.assertRegex(line, r"https://github.com/alvintriseptia/kelana-ria/issues/\d+\)")
                owned.update(re.findall(r"\bA\d\d\b", line))
        self.assertEqual(expected, owned)

    def test_skills_discoverable(self):
        guide = (ROOT / "AGENTS.md").read_text()
        for name in ["github-delivery", "mobile-pwa", "game-rules", "integration-evidence"]:
            path = Path(".agents/skills") / name / "SKILL.md"
            self.assertIn(str(path), guide)
            self.assertRegex((ROOT / path).read_text(),
                             rf"^---\nname: {name}\ndescription: Use [^\n]+\n---\n")


if __name__ == "__main__":
    unittest.main()
