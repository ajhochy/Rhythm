#!/usr/bin/env python3
"""Repair the agent profiles whose bash allowlist contradicts their skill allowlist.

WHY
---
Seven profiles run bash in deny-by-default (`"*": "deny"`) with an allowlist that
does not cover the binaries their OWN allowed skills invoke. The engine then
hard-denies those commands before Rhythm ever sees them, so no Rhythm-side
permission setting can rescue it:

    The user has specified a rule which prevents you from using this
    specific tool call.

Measured 2026-08-04: `librarian` allows the `defuddle` SKILL but denies the
`defuddle` BINARY, producing 11 denied calls in one run of
`theological-research-daily` and degrading its archive pass to
`capture_status: partial`. `email-assistant`, `graphic-designer` and `money` had
an allowlist of length ZERO — bash was entirely dead for them.

Every pattern added below was derived from the fenced bash blocks in that
profile's own skills, not guessed. Counts in the comments are real occurrences.

SAFETY
------
* Preserves deny-by-default. Only ADDS specific `allow` patterns; never touches
  the `"*": "deny"` catch-all and never removes an existing entry.
* Refuses to modify a profile that is not already in deny-by-default shape.
* Idempotent — safe to re-run.
* Writes go through the REST API on :4001. The running Rhythm server holds
  ~/Library/Application Support/Rhythm/rhythm.db open; a second connection
  returns stale or torn reads, so raw SQL against agent_configs is forbidden.

AFTER RUNNING
-------------
Profile frontmatter is only re-read by the engine on a fresh boot. Quit Rhythm
completely (Cmd-Q) and reopen it, or the change will not be in effect.

USAGE
-----
    python3 tools/dev/repair_profile_bash_allowlists.py            # dry run
    python3 tools/dev/repair_profile_bash_allowlists.py --apply    # write
"""
import argparse
import copy
import json
import sys
import urllib.error
import urllib.request

BASE = 'http://localhost:4001'

ADD: dict[str, list[str]] = {
    # 21 `obsidian`, 5 `defuddle`, 2 `python3` uses across its 18 skills.
    'librarian': ['obsidian *', 'defuddle *', 'python3 *'],
    # 21 `obsidian`, 9 `ddgs`, 7 `scrapling`, 5 `defuddle`.
    # `pip` (4 uses) deliberately NOT added — package installation is setup, not
    # run-time work, and is a materially larger grant than the rest.
    'research': ['obsidian *', 'defuddle *', 'scrapling *', 'ddgs *'],
    # Allowlist was EMPTY. Its skills shell out to npx-based generators.
    'graphic-designer': ['npx *', 'curl *', 'python3 *'],
    # agent-reach fans out to per-platform CLIs; `gh` alone is used 27x.
    'local': ['gh *', 'curl *', 'agent-reach *', 'bili *', 'twitter *', 'rdt *', 'xhs *'],
    # ffb-podcast-vibes invokes an ABSOLUTE interpreter path, which `python3 *`
    # does not match. Taken verbatim from the stuck session's recorded input:
    #   /opt/homebrew/bin/python3.11 "$HOME/.../ingest_podcast.py" status
    'podcast-ingest': ['/opt/homebrew/bin/python3.11 *'],
    # NOT REPAIRED HERE, on purpose:
    #   email-assistant — empty allowlist, but its 2 skills declare no bash at
    #     all, so there is nothing to derive. Profile is currently disabled.
    #   money — empty allowlist and zero allowed skills. Nothing to derive.
    # Both are left in deny-by-default rather than granted speculative access.
}


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.load(r)


def patch(path: str, body: dict):
    req = urllib.request.Request(
        BASE + path,
        method='PATCH',
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'},
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true',
                    help='actually PATCH; default is a dry run')
    args = ap.parse_args()

    try:
        cfgs = get('/agent-configs')
    except urllib.error.URLError as err:
        print(f'ERROR: cannot reach {BASE} ({err}). Is Rhythm running?')
        return 2

    cfgs = cfgs if isinstance(cfgs, list) else cfgs.get('data')
    by_id = {c['id']: c for c in cfgs}
    changed = 0

    for pid, adds in ADD.items():
        cfg = by_id.get(pid)
        if not cfg:
            print(f'SKIP    {pid}: no such profile')
            continue

        raw = cfg.get('corePermissionsJson')
        core = json.loads(raw) if raw else {}
        bash = core.get('bash')

        if not isinstance(bash, dict):
            print(f'SKIP    {pid}: bash is {bash!r}, not a map — leaving alone')
            continue
        if bash.get('*') != 'deny':
            print(f'SKIP    {pid}: bash["*"]={bash.get("*")!r} is not deny — leaving alone')
            continue

        before = copy.deepcopy(bash)
        for pattern in adds:
            bash.setdefault(pattern, 'allow')
        added = [p for p in bash if p not in before]

        if not added:
            print(f'OK      {pid}: already covered')
            continue

        changed += 1
        if not args.apply:
            print(f'WOULD   {pid}  + {added}')
            continue

        core['bash'] = bash
        patch(f'/agent-configs/{pid}', {'corePermissionsJson': json.dumps(core)})
        # Regenerate ~/.config/opencode/agents/<id>.md from the DB row.
        try:
            urllib.request.urlopen(
                urllib.request.Request(
                    f'{BASE}/agent-configs/{pid}/resync-agent-file', method='POST'),
                timeout=10).read()
            print(f'PATCHED {pid}  + {added}  (agent file resynced)')
        except urllib.error.HTTPError as err:
            print(f'PATCHED {pid}  + {added}  (WARNING: resync failed {err.code} — '
                  f'the .md will regenerate on next profile save)')

    if not args.apply and changed:
        print(f'\nDry run — {changed} profile(s) would change. Re-run with --apply.')
    elif args.apply and changed:
        print('\nNow QUIT Rhythm completely (Cmd-Q) and reopen it — the engine only '
              're-reads agent .md frontmatter on a fresh boot.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
