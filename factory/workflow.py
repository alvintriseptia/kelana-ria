"""Recommend execution profiles and rehearse the bounded delivery workflow."""
import hashlib
import json
from pathlib import Path
import re
from time import perf_counter

EXECUTION_PROFILES = {
    "small": {"reasoning": "low", "hint_limit": 4},
    "standard": {"reasoning": "medium", "hint_limit": 8},
    "high-risk": {"reasoning": "high", "hint_limit": 12},
}
HIGH_RISK = re.compile(
    r"\b(?:architecture|security|privacy|isolation|authorization|auth(?:entication)?|"
    r"database|sqlite|fts5|schema|engine|payment|migration|contract invariants|"
    r"zone polygons|merge gates|session transitions|scoring rules)\b", re.I
)
SMALL = re.compile(r"\b(?:copy|contrast|typo|docs|documentation|css|text label)\b", re.I)
CHANGE = re.compile(r"\b(?:rewrite|refactor|responsive|redesign|replace|workflow|new controls|routing)\b", re.I)


def execution_profile(title, body, override=None):
    outcome = re.split(r"(?m)^## Dependencies\s*$", body, maxsplit=1)[0]
    overview = f"{title}\n{outcome}"
    if override:
        name, reason = override, "Explicit operator selection"
    elif HIGH_RISK.search(overview):
        name, reason = "high-risk", "Scope may affect an invariant or a sensitive boundary"
    elif SMALL.search(title) and not CHANGE.search(overview):
        name, reason = "small", "Title points to a localized copy, docs, or CSS change"
    else:
        name, reason = "standard", "Default for coding and UI work"
    return {"name": name, **EXECUTION_PROFILES[name], "reason": reason, "advisory": True}


def failure_signature(report):
    if report.get("status") not in ("failed", "timed-out"):
        return None
    checks = report.get("checks") or []
    if checks:
        row = checks[-1]
        step = row.get("check"), row.get("exit_code")
    else:
        row = report
        step = tuple(sorted(name for name, state in report.get("jobs", {}).items()
                            if state in ("failure", "timed_out", "cancelled")))
    if not (excerpt := row.get("failure_excerpt")):
        return None
    normalized = re.sub(r"\b[A-Za-z][a-z]+ \d+ \d+:\d+:\d+(?:\.\d+)?Z\b|"
                        r"\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\b|"
                        r"/(?:tmp|var/tmp)/kelana-factory-[\w-]+", "<run>", excerpt)
    return step, hashlib.sha256(normalized.strip().encode()).hexdigest()


def retry_advice(previous, current):
    if current.get("status") == "passed":
        return {"state": "passed", "action": "Continue through the normal review gates"}
    signature = failure_signature(current)
    if signature and signature == failure_signature(previous):
        return {"state": "repeated", "action": "Read the relevant log, change the hypothesis, and checkpoint if no useful action remains"}
    if not signature:
        return {"state": "needs-evidence", "action": "Retrieve the relevant check and failure output before retrying"}
    return {"state": "new-failure", "action": "Investigate and retry after a targeted correction or verified transient cause"}


# The V1 read scenarios and revision remain fixed. These needles select starting
# points in the same source/test files, while guidance and issue text are read in full.
MATCHED_ISSUES = (205, 209, 231)
RANGES = {
    "factory/agent.py": r"^def (?:pickup|merge)\(",
    ".github/workflows/factory.yml": r"^  (?:factory|workspace):",
    "apps/web/src/rulebook-claim-play.css": r"main-lagi|\.cg-result",
    "apps/web/qa/contrast.mjs": r"^export function contrastRatio",
    "apps/web/src/rulebook-studio.ts": r"function (?:setValidationFeedback|renderStep4)",
    "apps/web/qa/rulebook-studio.mjs": r"function checkAutomaticValidation",
    "apps/web/src/board-map.ts": r"function (?:update|render|mountBoardMap)",
    "packages/contracts/src/rulebook.ts": r"^export type (?:GeoSnapshot|GeoCoordinate)",
    "apps/web/qa/rulebook-claim.mjs": r"MapLibre canvas|Claim zone overlay",
}


def extract(lines, locations, *, before=3, after=15):
    selected = {i for line in locations for i in range(max(0, line - before - 1), min(len(lines), line + after))}
    return "\n".join(lines[i] for i in sorted(selected)).encode("utf-8")


def benchmark(root, revision, request, parse_dependencies):
    import context_packet as cp
    from metrics import BASE_FILES, REHEARSALS

    baseline = cp.Index(root, revision)
    current = cp.Index(root, "HEAD")
    reports = []
    for number, (complexity, domain, files) in zip(MATCHED_ISSUES, REHEARSALS):
        packet = cp.collect_packet(root, number, baseline.sha, (), None, request, parse_dependencies)
        v1_files = BASE_FILES + files
        start = perf_counter()
        v1 = sum(len(cp.git(root, "show", f"{baseline.sha}:{file}")) for file in v1_files)
        v1_elapsed = round(perf_counter() - start, 4)

        start = perf_counter()
        packet_bytes = len((json.dumps(packet, indent=2, ensure_ascii=True) + "\n").encode())
        guides = packet["required_guidance"]
        guide_bytes = sum(len(cp.git(root, "show", f"{current.sha}:{file}")) for file in guides)
        snippets = []
        for file in v1_files:
            if file not in RANGES:
                continue
            lines = baseline.lines(file)
            locations = [i for i, line in enumerate(lines, 1) if re.search(RANGES[file], line)][:2]
            pointer = extract(lines, locations or [1])
            snippets.append({"path": file, "bytes": len(pointer), "matched": bool(locations)})
        for file in dict.fromkeys(row["path"] for row in packet["prd_pointers"]):
            indices = [row["line"] for row in packet["prd_pointers"] if row["path"] == file]
            pointers = extract(baseline.lines(file), indices, before=0, after=2)
            snippets.append({"path": file, "bytes": len(pointers), "matched": True})
        v2_elapsed = round(perf_counter() - start, 4)
        reports.append({
            "fixture_issue": number, "domain": domain, "complexity": complexity,
            "execution_profile": packet["execution_profile"]["name"],
            "v1_full_read_bytes": v1, "v1_git_reads": len(v1_files), "v1_read_seconds": v1_elapsed,
            "v2_packet_bytes": packet_bytes, "v2_full_guidance_bytes": guide_bytes,
            "v2_excerpt_bytes": sum(row["bytes"] for row in snippets), "v2_excerpts": snippets,
            "v2_guidance_and_excerpt_git_reads": len(guides) + len(snippets), "v2_read_seconds_after_packet": v2_elapsed,
            "observed_tokens": None, "observed_allowance": None,
        })
    return {"kind": "matched-read-rehearsal", "source_revision": baseline.sha, "guidance_revision": current.sha,
            "reports": reports}


def register(commands):
    guard = commands.add_parser("retry-advice", help="Compare two compact check reports before retrying")
    guard.add_argument("previous", type=Path)
    guard.add_argument("current", type=Path)
    compare = commands.add_parser("rehearse-workflow", help="Compare matched V1 and V2 context reads without model calls")
    compare.add_argument("--ref", default="39e39ed68fdc8ce8b627b7627ca87a51bcf86d17")


def dispatch(args, root, request, parse_dependencies):
    if args.command == "retry-advice":
        value = retry_advice(json.loads(args.previous.read_text()), json.loads(args.current.read_text()))
    elif args.command == "rehearse-workflow":
        value = benchmark(root, args.ref, request, parse_dependencies)
    else:
        return False
    print(json.dumps(value, indent=2))
    return True
