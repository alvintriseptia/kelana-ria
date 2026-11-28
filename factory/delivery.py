"""Explicit worktree, verification, and pull request operations for Factory."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlencode

from context_packet import SECRET, safe_text

FLOW = ".github/workflows/factory.yml"
FACTORY_JOBS = {"factory", "workspace"}
WEB_QA = ("pwa", "claim", "seek", "seek-mode", "studio", "player-errors", "release")
CHECKS = {
    "factory": [sys.executable, "-m", "unittest", "discover", "-s", "factory", "-v"],
    "install": ["npm", "ci"],
    "build": ["npm", "run", "build"],
    "api": ["npm", "test", "--workspace", "@kelana-ria/api"],
    "provider": ["npm", "run", "capture:integration", "--workspace", "@kelana-ria/api"],
    **{key: ["npm", "run", script, "--workspace", "@kelana-ria/web"] for key, script in zip(WEB_QA, (
        "qa", "qa:rulebook-claim", "qa:rulebook-seek", "qa:seek-mode",
        "qa:rulebook-studio", "qa:player-errors", "qa:release",
    ))},
}
PROFILES = {
    "factory": ("factory",),
    "copy-css": ("pwa", "player-errors"),
    "studio": ("studio",),
    "claim": ("api", "claim"),
    "seek": ("api", "seek", "seek-mode"),
    "map": ("claim", "seek", "studio", "pwa"),
    "contracts": ("api",),
    "providers": ("api", "provider"),
    "full": ("factory", "install", "build", "api", "provider", *WEB_QA),
}
BASELINE = ("factory", "install", "build")
MAX_EXCERPT = 1600
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
CREDENTIAL_LINE = re.compile(r"(?im)^.*\b(?:authorization|password|cookie|api[_ -]?key|token|secret)\s*[=:]\s*\S.*$")
URL_QUERY = re.compile(r"(https?://[^\s?]+)\?[^\s]+")


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL)


def git_text(root, *args):
    return git(root, *args).decode().strip()


def ancestry(root, ancestor, descendant):
    result = subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", ancestor, descendant],
                            capture_output=True)
    if result.returncode not in (0, 1):
        raise ValueError("Git could not establish ancestry")
    return result.returncode == 0


def branch_name(number):
    if number < 1:
        raise ValueError("Expected a positive issue number")
    return f"agent/issue-{number}"


def worktree_for(root, branch):
    ref = b"branch refs/heads/" + branch.encode()
    for entry in git(root, "worktree", "list", "--porcelain", "-z").split(b"\0\0"):
        fields = entry.split(b"\0")
        if ref in fields:
            if any(field == b"locked" or field.startswith(b"locked ") for field in fields):
                raise ValueError("The issue worktree is locked")
            return Path(os.fsdecode(fields[0].removeprefix(b"worktree ")))
    return None


def claim_head(request, number):
    name = branch_name(number)
    claim = request(f"git/ref/heads/{name}")
    head = claim.get("object", {}).get("sha")
    if claim.get("ref") != f"refs/heads/{name}" or not isinstance(head, str) or not re.fullmatch(r"[a-f0-9]{40}", head):
        raise ValueError("GitHub did not return the exact issue claim")
    return head


def require_ready(request, number, parse_dependencies):
    issue = request(f"issues/{number}")
    labels = {item["name"] for item in issue["labels"]}
    if "pull_request" in issue or issue["state"] != "open" or "ready" not in labels or "blocked" in labels:
        raise ValueError("Expected an open, ready and unblocked issue")
    for dependency in parse_dependencies(issue.get("body")):
        item = request(f"issues/{dependency}")
        if item["state"] != "closed" or item.get("state_reason") != "completed":
            raise ValueError(f"Dependency #{dependency} is incomplete")


def validate_pull(pull, number, repo):
    if (pull.get("head", {}).get("ref") != branch_name(number)
            or (pull.get("head", {}).get("repo") or {}).get("full_name") != repo
            or pull.get("base", {}).get("ref") != "main"):
        raise ValueError("Expected the claimed branch and same-repository main PR")
    return pull


def open_pull(request, repo, number):
    query = urlencode({"state": "open", "head": f"{repo.split('/')[0]}:{branch_name(number)}", "per_page": 2})
    pulls = request(f"pulls?{query}")
    if len(pulls) > 1:
        raise ValueError("Multiple open PRs share the issue branch")
    return validate_pull(pulls[0], number, repo) if pulls else None


def prepare(root, number, base, request, parse_dependencies, repo, remote):
    if git_text(root, "symbolic-ref", "--short", "HEAD") != "main":
        raise ValueError("Run prepare from the control checkout on main")
    require_ready(request, number, parse_dependencies)
    branch = branch_name(number)
    head = claim_head(request, number)
    pull = open_pull(request, repo, number)
    path = worktree_for(root, branch)
    if path is not None and git(path, "status", "--porcelain"):
        raise ValueError("The issue worktree has uncommitted edits. Preserve them before preparing it.")
    remote_ref = f"refs/heads/{branch}"
    git(root, "fetch", "--no-tags", remote, remote_ref)
    if git_text(root, "rev-parse", "FETCH_HEAD") != head or claim_head(request, number) != head:
        raise ValueError("The remote issue branch changed while preparing it. Refresh and retry.")
    if request("git/ref/heads/main")["object"]["sha"] != base:
        raise ValueError("Main changed while preparing the issue. Refresh and retry.")
    local_ref = f"refs/heads/{branch}"
    local_head = git_text(root, "for-each-ref", "--format=%(objectname)", local_ref)
    if local_head and not (ancestry(root, local_head, head) or ancestry(root, head, local_head)):
        raise ValueError("Local and remote issue history diverged. Preserve both and reconcile explicitly.")
    if path is None:
        path = Path(root).parent / f"kelana-issue-{number}"
        if path.exists() or path.is_symlink():
            raise ValueError("The expected worktree path already exists outside Git")
        if local_head:
            git(root, "worktree", "add", "--quiet", str(path), branch)
        else:
            git(root, "worktree", "add", "--quiet", "--no-track", "-b", branch, str(path), head)
    current = git_text(path, "rev-parse", "HEAD")
    if current != head and ancestry(root, current, head):
        git(path, "merge", "--ff-only", "--quiet", head)
        current = head
    if current != base and ancestry(root, current, base):
        git(path, "merge", "--ff-only", "--quiet", base)
        current = base
    return {
        "issue": number, "branch": branch, "worktree": str(path),
        "base_sha": base, "head_sha": current, "claimed_head_sha": head,
        "pr": pull["number"] if pull else None,
        "pr_url": pull.get("html_url") if pull else None,
        "needs_base_update": not ancestry(root, base, current),
    }


def sanitize_excerpt(raw):
    text = safe_text(ANSI.sub("", raw.decode("utf-8", errors="replace")))
    text = SECRET.sub("[redacted]", CREDENTIAL_LINE.sub("[redacted credential line]", text))
    text = URL_QUERY.sub(r"\1?[redacted]", text)
    lines = text.splitlines()
    significant = [line for line in lines if re.search(r"\b(?:error|fail|fatal|timeout|assertion)\b", line, re.I)]
    excerpt = "\n".join(dict.fromkeys([*significant[-5:], *lines[-9:]]))
    return excerpt[-MAX_EXCERPT:]


def run_check(root, name, argv, log_dir, timeout):
    path = log_dir / f"{name}.log"
    start = time.monotonic()
    code, status = 127, "failed"
    with path.open("xb") as log:
        try:
            with subprocess.Popen(argv, cwd=root, stdout=log, stderr=subprocess.STDOUT,
                                  start_new_session=os.name == "posix") as sub:
                try:
                    code = sub.wait(timeout=timeout)
                    status = "passed" if code == 0 else "failed"
                except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
                    if os.name == "posix":
                        try:
                            os.killpg(sub.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    else:
                        sub.kill()
                    sub.wait()
                    if isinstance(error, KeyboardInterrupt):
                        raise
                    code, status = 124, "timed-out"
                    log.write(b"\nFactory command exceeded its timeout.\n")
        except OSError:
            log.write(b"Unable to start the check. Verify the executable is available.\n")
    size = path.stat().st_size
    result = {"check": name, "status": status, "exit_code": code,
              "elapsed_seconds": round(time.monotonic() - start, 3), "log_bytes": size, "log": str(path)}
    if status != "passed":
        with path.open("rb") as saved:
            saved.seek(max(0, size - 32_768))
            result["failure_excerpt"] = sanitize_excerpt(saved.read())
    return result


def verify(root, selected, profile, final, timeout, log_parent):
    if not 1 <= timeout <= 3600:
        raise ValueError("Check timeout must be between 1 and 3600 seconds")
    sequence = list(dict.fromkeys([*(BASELINE if final else ()), *PROFILES[profile], *selected]))
    if any(CHECKS[name][0] == "npm" for name in sequence):
        expected = (Path(root) / ".nvmrc").read_text().strip().lstrip("v")
        actual = subprocess.check_output(["node", "--version"], cwd=root, text=True).strip().lstrip("v")
        if actual != expected:
            raise ValueError(f"Use Node {expected} from .nvmrc before running workspace verification")
    log_dir = Path(tempfile.mkdtemp(prefix="kelana-factory-", dir=log_parent))
    rows = []
    for name in sequence:
        row = run_check(root, name, CHECKS[name], log_dir, timeout)
        rows.append(row)
        if row["exit_code"]:
            break
    return {"status": rows[-1]["status"], "profile": profile, "final_baseline": final or profile == "full",
            "planned_checks": len(sequence), "executed_checks": len(rows), "checks": rows, "log_dir": str(log_dir)}


def validate_pr_body(body, number):
    closing = re.findall(r"(?im)^\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(\S+)[ \t]*$", body)
    if (closing != [f"#{number}"] or not re.search(rf"(?m)^Closes #{number}[ \t]*$", body)
            or any(not re.search(rf"(?m)^## {heading}[ \t]*$", body)
                   for heading in ("Outcome", "Verification", "Review"))):
        raise ValueError("Use one standalone Closes line and the full PR template")


def publish(root, number, title, body, request, parse_dependencies, repo):
    validate_pr_body(body, number)
    require_ready(request, number, parse_dependencies)
    branch = branch_name(number)
    if git_text(root, "symbolic-ref", "--short", "HEAD") != branch or git(root, "status", "--porcelain"):
        raise ValueError("Publish from the clean, committed issue worktree")
    current = git_text(root, "rev-parse", "HEAD")
    if current != claim_head(request, number):
        raise ValueError("Push the reviewed local head before publishing the PR")
    base = request("git/ref/heads/main")["object"]["sha"]
    if not ancestry(root, base, current):
        raise ValueError("Update the branch from current main before publishing")
    pull = open_pull(request, repo, number)
    if pull and pull["head"]["sha"] != current:
        raise ValueError("The PR head changed. Refresh its GitHub state before publishing.")
    fields = {"title": title, "body": body}
    if pull is None:
        pull = request("pulls", method="POST", head=branch, base="main", **fields)
        operation = "created"
    elif pull.get("title") != title or pull.get("body") != body:
        pull = request(f"pulls/{pull['number']}", method="PATCH", **fields)
        operation = "updated"
    else:
        operation = "reused"
    validate_pull(pull, number, repo)
    if pull["head"]["sha"] != current:
        raise ValueError("The published pull request head changed. Recheck before verification.")
    return {"operation": operation, "pr": pull["number"], "url": pull["html_url"], "head_sha": current}


def ci_status(request, paginate, number, repo, include_failure):
    pull = open_pull(request, repo, number)
    if not pull:
        return {"issue": number, "status": "no-pull-request"}
    head = pull["head"]["sha"]
    result = {"issue": number, "pr": pull["number"], "head_sha": head, "base_sha": pull["base"]["sha"]}
    base = request("git/ref/heads/main")["object"]["sha"]
    if (claim_head(request, number) != head or pull["base"]["sha"] != base
            or request(f"compare/{base}...{head}").get("merge_base_commit", {}).get("sha") != base):
        return {**result, "status": "stale", "current_main": base}
    query = urlencode({"head_sha": head, "event": "pull_request"})
    runs = [run for run in paginate(f"actions/runs?{query}", "workflow_runs")
            if run.get("path") == FLOW and run.get("event") == "pull_request"
            and run.get("head_sha") == head and run.get("head_branch") == branch_name(number)
            and (run.get("head_repository") or {}).get("full_name") == repo
            and (not run.get("pull_requests") or any(
                p["number"] == pull["number"] and p.get("base", {}).get("sha", base) == base
                and p.get("head", {}).get("sha", head) == head for p in run["pull_requests"]))]
    if not runs:
        return {**result, "status": "missing"}
    run = max(runs, key=lambda item: (item["id"], item["run_attempt"]))
    jobs = list(paginate(f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs", "jobs"))
    observed = {job["name"]: job.get("conclusion") or job.get("status") for job in jobs}
    if run["status"] != "completed":
        status = "pending"
    elif run["conclusion"] == "success" and FACTORY_JOBS <= observed.keys() and all(
            job.get("conclusion") == "success" for job in jobs):
        status = "passed"
    else:
        status = "failed"
    result.update(status=status, run=run["id"], attempt=run["run_attempt"], jobs=observed)
    if status == "failed" and include_failure:
        log_dir = Path(tempfile.mkdtemp(prefix="kelana-factory-ci-"))
        path = log_dir / "failed-jobs.log"
        with path.open("xb") as log:
            try:
                subprocess.run(["gh", "run", "view", str(run["id"]), "--repo", repo, "--log-failed"],
                               stdout=log, stderr=subprocess.STDOUT, check=True, timeout=30)
            except (subprocess.SubprocessError, OSError):
                result["failure_log_incomplete"] = True
        with path.open("rb") as log:
            log.seek(max(0, path.stat().st_size - 32_768))
            result.update(failure_excerpt=sanitize_excerpt(log.read()), failure_log=str(path))
    return result


def cleanup(root, pr, request, repo):
    if git_text(root, "symbolic-ref", "--short", "HEAD") != "main":
        raise ValueError("Run cleanup from the control checkout on main")
    pull = request(f"pulls/{pr}")
    name = pull.get("head", {}).get("ref") or ""
    match = re.fullmatch(r"agent/issue-([1-9]\d*)", name)
    if not match or not pull.get("merged") or pull.get("state") != "closed":
        raise ValueError("Cleanup requires a merged issue PR")
    number = int(match[1])
    validate_pull(pull, number, repo)
    issue = request(f"issues/{number}")
    if (issue["state"] != "closed" or issue.get("state_reason") != "completed"
            or not re.search(rf"(?m)^Closes #{number}[ \t]*$", pull.get("body") or "")):
        raise ValueError("GitHub has not closed the linked issue as completed")
    path = worktree_for(root, name)
    if path is None:
        return {"status": "already-removed", "issue": number, "pr": pr}
    matches = git_text(path, "rev-parse", "HEAD") == pull["head"]["sha"]
    if not matches or git(path, "status", "--porcelain"):
        raise ValueError("Keep the worktree. It contains edits or a different commit from the merged PR.")
    git(root, "worktree", "remove", str(path))
    return {"status": "removed", "issue": number, "pr": pr, "worktree": str(path)}


def register(commands):
    prep = commands.add_parser("prepare", help="Prepare or resume one previously claimed issue")
    prep.add_argument("number", type=int)
    checks = commands.add_parser("verify", help="Run approved checks and retain their local logs")
    checks.add_argument("--profile", choices=PROFILES, default="factory")
    checks.add_argument("--check", action="append", choices=CHECKS, default=[])
    checks.add_argument("--final", action="store_true")
    checks.add_argument("--timeout", type=int, default=900)
    checks.add_argument("--log-dir", type=Path)
    pr = commands.add_parser("publish", help="Open or update the PR for the pushed issue branch")
    pr.add_argument("number", type=int)
    pr.add_argument("--title", required=True)
    pr.add_argument("--body-file", type=Path, required=True)
    ci = commands.add_parser("ci", help="Summarize the required jobs on the exact PR head")
    ci.add_argument("number", type=int)
    ci.add_argument("--failure-log", action="store_true")
    clean = commands.add_parser("cleanup", help="Remove a clean completed worktree after merge")
    clean.add_argument("number", type=int, help="Merged pull request number")


def dispatch(args, root, agent):
    if args.command == "prepare":
        result = prepare(root, args.number, agent.current_main(root), agent.api, agent.dependencies,
                         agent.REPO, f"https://github.com/{agent.REPO}.git")
    elif args.command == "verify":
        result = verify(root, args.check, args.profile, args.final, args.timeout, args.log_dir)
        print(json.dumps(result))
        if result["status"] != "passed":
            sys.exit(result["checks"][-1]["exit_code"] if result["checks"][-1]["exit_code"] > 0 else 1)
        return True
    elif args.command == "publish":
        result = publish(root, args.number, args.title, args.body_file.read_text(encoding="utf-8"),
                         agent.api, agent.dependencies, agent.REPO)
    elif args.command == "ci":
        result = ci_status(agent.api, agent.pages, args.number, agent.REPO, args.failure_log)
    elif args.command == "cleanup":
        result = cleanup(root, args.number, agent.api, agent.REPO)
    else:
        return False
    print(json.dumps(result))
    return True
