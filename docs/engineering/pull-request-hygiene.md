# Pull Request Hygiene

Use this check before opening a PR when the branch is supposed to stay in one lane.

## Scope Check

Run:

```bash
tools/git/check_pr_scope.sh --expect-area backend
```

Replace `backend` with one of:

- `backend`
- `desktop`
- `release`
- `docs`

The command compares `HEAD` against the merge-base with `origin/main` when available, or `main` otherwise. It prints changed files by area and fails when the branch includes files outside the expected area.

## Intentional Multi-Area PRs

If a PR truly needs to cross areas, state that explicitly in the PR body and use:

```bash
tools/git/check_pr_scope.sh --allow-multi-area
```

That keeps broad changes intentional instead of accidental branch spillover.
