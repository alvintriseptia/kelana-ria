"""Issue pickup and routine merges. Run the copy on clean, current main."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import context_packet
import delivery
import workflow

REPO = "alvintriseptia/kelana-ria"
FLOW = ".github/workflows/factory.yml"


class ApiError(RuntimeError):
    pass


def api(path, *, method="GET", **fields):
    command = ["gh", "api", "-X", method, f"repos/{REPO}/{path}"]
    for key, value in fields.items():
        command.extend(["-f", f"{key}={value}"])
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ApiError(result.stderr.strip())
    return json.loads(result.stdout)


def pages(path, field=None):
    page = 1
    while True:
        sep = "&" if "?" in path else "?"
        data = api(f"{path}{sep}per_page=100&page={page}")
        batch = data[field] if field else data
        yield from batch
        if len(batch) < 100:
            return
        page += 1


def git(root, *args):
    return subprocess.check_output(["git", "-C", root, *args])


def dependencies(body):
    headers = re.split(r"(?m)^#{2,3} ([^\n]+)\s*$", body or "")
    values = [headers[i+1].strip() for i in range(1, len(headers), 2)
              if headers[i].strip() == "Dependencies"]
    if values == ["None"]:
        return []
    if len(values) != 1 or not re.fullmatch(r"#\d+(?:\s*,\s*#\d+)*", values[0]):
        raise ValueError("Expected one Dependencies heading containing None or #12, #34")
    return [int(n) for n in re.findall(r"\d+", values[0])]


def queue_order(issue):
    labels = {v["name"] for v in issue["labels"]}
    priority = 1 if "priority:1" in labels else 2 if "priority:2" in labels else 3
    return priority, issue["number"]


def branch(number):
    return f"agent/issue-{number}"


def claim(request, number, base):
    ref = f"refs/heads/{branch(number)}"
    try:
        request("git/refs", method="POST", ref=ref, sha=base)
    except ApiError as error:
        if "HTTP 422" not in str(error):
            raise
        if request(f"git/ref/heads/{branch(number)}").get("ref") != ref:
            raise
        return False
    return True


def resume(request, number):
    if request(f"issues/{number}")["state"] != "open":
        raise ValueError("Issue is closed")
    request(f"git/ref/heads/{branch(number)}")
    print(f"Resume #{number} on {branch(number)}. Read its issue, commits and existing PR.")


def pickup(base):
    queue = sorted(pages("issues?state=open&labels=ready"), key=queue_order)
    for issue in queue:
        number = issue["number"]
        if "pull_request" in issue or "blocked" in {v["name"] for v in issue["labels"]}:
            continue
        try:
            needs = dependencies(issue["body"])
        except ValueError as error:
            print(f"Skipping #{number}: {error}", file=sys.stderr)
            continue
        try:
            ready = all(completed(api(f"issues/{dep}")) for dep in needs)
        except ApiError as error:
            if "HTTP 404" not in str(error):
                raise
            print(f"Skipping #{number}: dependency unavailable", file=sys.stderr)
            continue
        if not ready:
            continue
        if claim(api, number, base):
            print(f"Claimed #{number} on {branch(number)}\n{issue['html_url']}")
            return
    print("No unclaimed ready issue with completed dependencies.")


def completed(issue):
    return issue["state"] == "closed" and issue.get("state_reason") == "completed"


def unique_object(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("Duplicate locale key")
    return result


def plain_copy(value):
    return (isinstance(value, str) and 0 < len(value.strip()) <= 120
            and re.fullmatch(r"[\w ,.!?'’…-]+", value) is not None)


def eligible_copy(root, base, head, path):
    def read(revision, name):
        return json.loads(git(root, "show", f"{revision}:{name}"),
                          object_pairs_hook=unique_object)
    allowed = set(read(base, "factory/copy-keys.json"))
    old, new = read(base, path), read(head, path)
    if not isinstance(old, dict) or not isinstance(new, dict) or old.keys() != new.keys():
        return False
    changed = {key for key in old if old[key] != new[key]}
    return bool(changed) and changed <= allowed and all(
        plain_copy(old[k]) and plain_copy(new[k]) for k in changed)


def routine_scope(root, base, head):
    entries = git(root, "diff", "--raw", "--no-renames", "-z", base, head).split(b"\0")[:-1]
    kinds = set()
    for index in range(0, len(entries), 2):
        oldmode, newmode, _, _, status = entries[index].decode().lstrip(":").split()
        path = entries[index+1].decode()
        if oldmode not in {"000000", "100644"} or newmode != "100644" or status not in {"M", "A"}:
            return False
        if re.fullmatch(r"docs/(qa|guides)/[a-z0-9][a-z0-9-]*\.md", path):
            kinds.add("docs")
        elif path == "apps/web/src/locales/id.json" and status == "M" and eligible_copy(root, base, head, path):
            kinds.add("copy")
        else:
            return False
    return len(kinds) == 1


def green(run, head, source, jobs):
    return (run.get("path") == FLOW and run.get("event") == "pull_request"
            and run.get("head_repository", {}).get("full_name") == REPO
            and run.get("head_sha") == head and run.get("head_branch") == source
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and delivery.FACTORY_JOBS <= {job["name"] for job in jobs}
            and all(job["conclusion"] == "success" for job in jobs))


def tested_revision(run, number, head, base):
    return any(p["number"] == number and p["head"]["sha"] == head and p["base"]["sha"] == base
               for p in run.get("pull_requests", []))


def closes_claim(links, issue):
    return links["totalCount"] == 1 and links["nodes"] == [
        {"number": issue, "repository": {"nameWithOwner": REPO}}]


def closing_issues(number):
    query = """
    query($number: Int!) {
      repository(owner: "alvintriseptia", name: "kelana-ria") {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 2) {
            totalCount nodes { number repository { nameWithOwner } }
          }
        }
      }
    }"""
    raw = subprocess.check_output(["gh", "api", "graphql", "-f", f"query={query}",
                                   "-F", f"number={number}"], text=True)
    return json.loads(raw)["data"]["repository"]["pullRequest"]["closingIssuesReferences"]


def current_main(root):
    # Fetch this repository explicitly. The caller may use a separate checkout for feature work.
    git(root, "fetch", "-q", f"https://github.com/{REPO}.git", "refs/heads/main")
    base = git(root, "rev-parse", "FETCH_HEAD").decode().strip()
    if (git(root, "rev-parse", "HEAD").decode().strip() != base
            or git(root, "status", "--porcelain")):
        raise ValueError("Run from a clean checkout of current main")
    return base


def merge(root, number, base, reviewed_sha):
    pull = api(f"pulls/{number}")
    if pull["head"]["sha"] != reviewed_sha:
        raise ValueError("PR head changed since the diff was reviewed")
    source = pull["head"]["ref"]
    match = re.fullmatch(r"agent/issue-([1-9]\d*)", source)
    if (not match or pull["state"] != "open" or pull["draft"] or pull["base"]["ref"] != "main"
            or pull["head"]["repo"]["full_name"] != REPO or pull["base"]["sha"] != base):
        raise ValueError("Expected an open, same-repository issue PR against current main")
    issue = match[1]
    if not re.search(rf"(?im)^Closes #{issue}\s*$", pull["body"] or ""):
        raise ValueError("PR must link the claimed issue")
    delivery.require_ready(api, int(issue), dependencies)
    head = pull["head"]["sha"]
    git(root, "fetch", "-q", f"https://github.com/{REPO}.git", f"refs/pull/{number}/head")
    if git(root, "rev-parse", "FETCH_HEAD").decode().strip() != head:
        raise ValueError("PR revision changed during fetch")
    if git(root, "merge-base", base, head).decode().strip() != base:
        raise ValueError("Update the branch from main and rerun CI")
    if not routine_scope(root, base, head):
        raise ValueError("Maintainer review required for this diff")

    runs = [run for run in pages(f"actions/runs?head_sha={head}&event=pull_request", "workflow_runs")
            if run["path"] == FLOW and run["head_branch"] == source
            and tested_revision(run, number, head, base)]
    if not runs:
        raise ValueError("Missing Factory CI")
    run = max(runs, key=lambda r: (r["id"], r["run_attempt"]))
    jobs = list(pages(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs", "jobs"))
    if not green(run, head, source, jobs):
        raise ValueError("Factory CI has not passed on this revision")

    query = subprocess.check_output(["gh", "pr", "view", str(number), "--repo", REPO,
                                     "--json", "reviewDecision,latestReviews,statusCheckRollup"], text=True)
    review = json.loads(query)
    if (review["reviewDecision"] in {"CHANGES_REQUESTED", "REVIEW_REQUIRED"}
            or any(r["state"] == "CHANGES_REQUESTED" for r in review["latestReviews"])):
        raise ValueError("Review is outstanding")
    checks = review["statusCheckRollup"]
    if not checks or any((c.get("conclusion") or c.get("state")) != "SUCCESS" for c in checks):
        raise ValueError("All reported checks must succeed")
    if not closes_claim(closing_issues(number), int(issue)):
        raise ValueError("GitHub must link only the claimed issue for closure")
    if api("git/ref/heads/main")["object"]["sha"] != base:
        raise ValueError("Main advanced during verification")
    result = api(f"pulls/{number}/merge", method="PUT", sha=head, merge_method="squash")
    if not result["merged"]:
        raise ValueError(result["message"])
    print(f"Merged PR #{number} at {result['sha']}")
    merged = api(f"git/commits/{result['sha']}")
    if [parent["sha"] for parent in merged["parents"]] != [base]:
        raise ValueError("PR was merged concurrently with another update. Verify the merged revision and report on the issue.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("pickup")
    for name in ["resume", "merge"]:
        sub = commands.add_parser(name)
        sub.add_argument("number", type=int)
        if name == "merge":
            sub.add_argument("reviewed_sha", help="Full commit SHA of the inspected diff")
    context_packet.register(commands)
    delivery.register(commands)
    workflow.register(commands)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    if (context_packet.dispatch(args, root, api, dependencies)
            or delivery.dispatch(args, root, sys.modules[__name__])
            or workflow.dispatch(args, root, api, dependencies)):
        return
    base = current_main(root)
    if args.command == "pickup":
        pickup(base)
    elif args.command == "resume":
        resume(api, args.number)
    else:
        merge(root, args.number, base, args.reviewed_sha)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
