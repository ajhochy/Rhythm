#!/usr/bin/env python3
"""
Rhythm repo-local AI workflow orchestrator.

The global `ai-workflow` CLI delegates here. The goal of this script is to own
the *mechanical* parts of the workflow so the agent only spends tokens on
judgment and implementation:

    status                                    - context-file health
    checks --level {issue,smoke,pr}           - stack-aware test/lint commands
    next-issue [--milestone X]                - pick next open issue via gh
    start-issue --issue N [--execute]         - branch off main as issue-N
    open-pr   --title T [--execute]           - push + draft PR via gh
    run [--issue N[,M,...]] [--execute]       - packed handoff for the agent:
                                                fetches all issue bodies once,
                                                groups by shared files, prints
                                                a single brief the agent can
                                                feed to coding-agent subagents.

Token-saving design:

- `run --issue ...` makes one `gh issue view --json` call per issue and inlines
  the bodies, so the agent never needs to re-fetch them.
- `checks --level pr` runs the full validation suite once and prints a
  one-line pass/fail per command instead of streaming full output.
- All git/gh mechanics happen here, not in the agent.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
FLUTTER_DIR = REPO_ROOT / "apps" / "desktop_flutter"
API_DIR = REPO_ROOT / "apps" / "api_server"


# ---------------------------------------------------------------------------
# Shell helpers
# ---------------------------------------------------------------------------

def _run(cmd: list[str], cwd: Path, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, text=True, capture_output=capture, check=False)


def _gh_json(args: list[str]) -> object:
    result = _run(["gh", *args], REPO_ROOT, capture=True)
    if result.returncode != 0:
        raise RuntimeError(f"gh failed: {' '.join(args)}\n{result.stderr.strip()}")
    return json.loads(result.stdout)


def _git(*args: str, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return _run(["git", *args], REPO_ROOT, capture=capture)


def _ok(label: str) -> None:
    print(f"  ✓ {label}")


def _fail(label: str) -> None:
    print(f"  ✗ {label}")


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

REQUIRED_CONTEXT_FILES = [
    "AGENTS.md",
    "docs/ai/project-state.md",
    "docs/ai/repo-map.md",
    "docs/ai/architecture.md",
    "docs/ai/testing-guide.md",
    "docs/ai/current-plan.md",
    "docs/ai/decisions.md",
]


def cmd_status(_args: argparse.Namespace) -> int:
    missing = [p for p in REQUIRED_CONTEXT_FILES if not (REPO_ROOT / p).exists()]
    branch = _git("rev-parse", "--abbrev-ref", "HEAD", capture=True).stdout.strip()
    dirty = _git("status", "--porcelain", capture=True).stdout.strip()

    print(f"Repo:    {REPO_ROOT}")
    print(f"Branch:  {branch}")
    print(f"Dirty:   {'yes' if dirty else 'no'}")

    if missing:
        print("Missing context files:")
        for p in missing:
            print(f"  - {p}")
    else:
        print("Context files: OK")

    return 1 if missing else 0


# ---------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------

@dataclass
class Check:
    label: str
    cwd: Path
    cmd: list[str]


ISSUE_CHECKS: list[Check] = [
    Check("flutter analyze (no fatal infos)", FLUTTER_DIR, ["flutter", "analyze", "--no-fatal-infos"]),
    Check("dart format (--set-exit-if-changed)", FLUTTER_DIR, ["dart", "format", "--set-exit-if-changed", "."]),
    Check("api_server tsc --noEmit", API_DIR, ["npx", "--no-install", "tsc", "--noEmit"]),
]

PR_CHECKS: list[Check] = ISSUE_CHECKS + [
    Check("api_server vitest", API_DIR, ["npm", "test", "--silent"]),
]


def _run_check(check: Check) -> bool:
    print(f"→ {check.label}  ({check.cwd.relative_to(REPO_ROOT)})")
    result = _run(check.cmd, check.cwd, capture=True)
    if result.returncode != 0:
        _fail(check.label)
        # Print last ~30 lines of output for triage.
        combined = (result.stdout or "") + (result.stderr or "")
        tail = "\n".join(combined.strip().splitlines()[-30:])
        print(tail)
        return False
    _ok(check.label)
    return True


def cmd_checks(args: argparse.Namespace) -> int:
    if args.level == "issue":
        checks = ISSUE_CHECKS
    elif args.level == "pr":
        checks = PR_CHECKS
    elif args.level == "smoke":
        print("Smoke is manual. See docs/testing/manual-smoke.md.")
        return 0
    else:
        print(f"Unknown level: {args.level}")
        return 2

    all_ok = True
    for c in checks:
        if not _run_check(c):
            all_ok = False
            if args.fail_fast:
                break
    return 0 if all_ok else 1


# ---------------------------------------------------------------------------
# next-issue
# ---------------------------------------------------------------------------

def cmd_next_issue(args: argparse.Namespace) -> int:
    query = ["issue", "list", "--state", "open", "--limit", "50",
             "--json", "number,title,milestone,labels"]
    if args.milestone:
        query.extend(["--milestone", args.milestone])
    issues = _gh_json(query)
    if not issues:
        print("No open issues found.")
        return 1
    # Lowest number wins (preserves manual ordering when issues are numbered intentionally).
    issues = sorted(issues, key=lambda i: i["number"])
    pick = issues[0]
    print(f"#{pick['number']}  {pick['title']}")
    return 0


# ---------------------------------------------------------------------------
# start-issue
# ---------------------------------------------------------------------------

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(title: str) -> str:
    return _SLUG_RE.sub("-", title.lower()).strip("-")[:50]


def cmd_start_issue(args: argparse.Namespace) -> int:
    issue = _gh_json(["issue", "view", str(args.issue), "--json", "number,title"])
    branch = f"issue-{issue['number']}-{_slug(issue['title'])}"
    print(f"Branch:  {branch}")
    print(f"Base:    main")

    if not args.execute:
        print("(dry-run; pass --execute to create the branch)")
        return 0

    fetch = _git("fetch", "origin", "main", capture=True)
    if fetch.returncode != 0:
        print(fetch.stderr.strip())
        return fetch.returncode
    create = _git("switch", "-c", branch, "origin/main")
    return create.returncode


# ---------------------------------------------------------------------------
# open-pr
# ---------------------------------------------------------------------------

def cmd_open_pr(args: argparse.Namespace) -> int:
    branch = _git("rev-parse", "--abbrev-ref", "HEAD", capture=True).stdout.strip()
    if branch in ("main", "HEAD"):
        print(f"Refusing to open PR from {branch}.")
        return 1

    print(f"Title:   {args.title}")
    print(f"Branch:  {branch}")
    print(f"Base:    main")
    print(f"Draft:   yes")

    if not args.execute:
        print("(dry-run; pass --execute to push and create the draft PR)")
        return 0

    push = _git("push", "-u", "origin", branch)
    if push.returncode != 0:
        return push.returncode

    body = "Auto-generated draft PR. Manual smoke required before merge."
    result = _run(["gh", "pr", "create",
                   "--title", args.title,
                   "--body", body,
                   "--base", "main",
                   "--draft"], REPO_ROOT, capture=True)
    print(result.stdout.strip() or result.stderr.strip())
    return result.returncode


# ---------------------------------------------------------------------------
# run --issue N[,M,...]
# ---------------------------------------------------------------------------

# Heuristics for grouping issues that touch overlapping files, so the
# orchestrator can suggest single-agent batches.

_PATH_HINT_RE = re.compile(r"`?(apps/[\w/_.-]+|lib/[\w/_.-]+|src/[\w/_.-]+)`?")


def _extract_path_hints(body: str) -> set[str]:
    return {m.group(1) for m in _PATH_HINT_RE.finditer(body or "")}


def _group_by_shared_files(issues: list[dict]) -> list[list[dict]]:
    """Group issues where at least one path hint overlaps."""
    groups: list[list[dict]] = []
    paths_per_group: list[set[str]] = []
    for issue in issues:
        hints = _extract_path_hints(issue.get("body", ""))
        placed = False
        for i, gpaths in enumerate(paths_per_group):
            if hints & gpaths:
                groups[i].append(issue)
                paths_per_group[i] |= hints
                placed = True
                break
        if not placed:
            groups.append([issue])
            paths_per_group.append(hints or {f"__solo_{issue['number']}__"})
    return groups


def cmd_run(args: argparse.Namespace) -> int:
    if not args.issue:
        print("`run` without --issue is not implemented for this repo. "
              "Use --issue N[,M,...] for a packed multi-issue handoff.")
        return 1

    numbers: list[str] = []
    for token in args.issue:
        numbers.extend([t.strip() for t in token.split(",") if t.strip()])

    issues: list[dict] = []
    for n in numbers:
        issues.append(_gh_json(["issue", "view", n,
                                "--json", "number,title,body,labels,milestone,state"]))

    branch = _git("rev-parse", "--abbrev-ref", "HEAD", capture=True).stdout.strip()
    print(f"# AI Workflow Handoff\n")
    print(f"Repo branch: `{branch}`")
    print(f"Issues:      {', '.join('#' + str(i['number']) for i in issues)}\n")

    groups = _group_by_shared_files(issues)

    print("## Suggested dispatch (batches by shared file ownership)\n")
    for idx, group in enumerate(groups, start=1):
        nums = ", ".join(f"#{i['number']}" for i in group)
        print(f"{idx}. coding-agent → {nums}")
    print()
    print("Between batches: `ai-workflow checks --level issue`")
    print("After all batches: `ai-workflow checks --level pr`")
    print("Final: `ai-workflow open-pr --title \"...\" --execute` (or stack onto existing branch).\n")

    print("---\n")
    for issue in issues:
        print(f"## Issue #{issue['number']} — {issue['title']}\n")
        print(issue.get("body", "").strip())
        print("\n---\n")
    return 0


# ---------------------------------------------------------------------------
# entrypoint
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("status")

    pc = sub.add_parser("checks")
    pc.add_argument("--level", choices=["issue", "smoke", "pr"], default="issue")
    pc.add_argument("--fail-fast", action="store_true")

    pn = sub.add_parser("next-issue")
    pn.add_argument("--milestone", default=None)

    ps = sub.add_parser("start-issue")
    ps.add_argument("--issue", required=True)
    ps.add_argument("--execute", action="store_true")

    pp = sub.add_parser("open-pr")
    pp.add_argument("--title", required=True)
    pp.add_argument("--execute", action="store_true")

    pr = sub.add_parser("run")
    pr.add_argument("--issue", action="append")
    pr.add_argument("--milestone", default=None)
    pr.add_argument("--execute", action="store_true")
    pr.add_argument("--after", choices=["planning", "implementation", "memory"], default=None)
    pr.add_argument("--check-level", choices=["issue", "smoke", "pr"], default="issue")
    pr.add_argument("--pr-title", default=None)
    pr.add_argument("--sync-globals", action="store_true")

    return p


def main(argv: Iterable[str] | None = None) -> int:
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    handlers = {
        "status": cmd_status,
        "checks": cmd_checks,
        "next-issue": cmd_next_issue,
        "start-issue": cmd_start_issue,
        "open-pr": cmd_open_pr,
        "run": cmd_run,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
