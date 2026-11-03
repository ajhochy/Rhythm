#!/usr/bin/env python3
"""Capture an explicitly requested, owner-scoped evaluation input. Never opens live state writable."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

CONTROL_PROFILES = {'org-reviewer', 'org-optimizer', 'org-external-discovery',
                    '8f1c2d3e-4a5b-4c6d-9e7f-0a1b2c3d4e5f', '9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a'}
CASE_PROFILES = ('secretary', 'workflow-orchestrator', 'librarian', 'AI-Trend-Researcher',
                 'fantasy-gm', 'worship-planning', 'coding-agent', 'claude-code')
SECRET = re.compile(r'(?i)(?:\bBearer\s+[a-z0-9._~+/-]{24,}|\b(?:sk-ant-|sk-proj-|ghp_|github_pat_)[a-z0-9_-]{16,}|\bAKIA[A-Z0-9]{16}|\beyJ[a-z0-9_-]+\.[a-z0-9_-]{16,}\.[a-z0-9_-]{16,})')


def capture_managed_skill_dependencies(profiles):
    """Freeze engine-owned skill files, including absence, without inventing DB rows."""
    home = Path.home()
    root = home / '.config/opencode/skills'
    for directory in (home / '.config', home / '.config/opencode', root):
        if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != os.getuid():
            raise ValueError('Managed skill source root is unavailable or redirected')
    names = set()
    for profile in profiles:
        raw = profile.get('allowed_skills_json')
        if raw is None:
            continue
        parsed = json.loads(raw)
        if not isinstance(parsed, list) or any(not isinstance(name, str) for name in parsed):
            raise ValueError('Managed skill scope is not a string array')
        names.update(parsed)
    if len(names) > 512:
        raise ValueError('Managed skill dependency inventory exceeds its bound')
    dependencies = []
    slugs = set()
    for name in sorted(names):
        if not name or name in ('.', '..') or '..' in name or '/' in name or '\\' in name:
            raise ValueError('Managed skill name is unsafe')
        slug = re.sub(r'[^a-zA-Z0-9_-]+', '__', name.strip())
        if slug in slugs:
            raise ValueError('Managed skill names collide at the production slug')
        slugs.add(slug)
        directory = root / slug
        path = directory / 'SKILL.md'
        if directory.is_symlink() or path.is_symlink():
            raise ValueError('Managed skill dependency is a symlink')
        if directory.exists() and not directory.is_dir():
            raise ValueError('Managed skill dependency directory is not a directory')
        if not path.exists():
            dependencies.append({'name': name, 'state': 'absent'})
            continue
        before = path.stat()
        if not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or before.st_nlink != 1 or before.st_size > 128_000:
            raise ValueError('Managed skill dependency is not one bounded owned file')
        content = path.read_bytes()
        after = path.stat()
        if (before.st_dev, before.st_ino, before.st_mtime_ns, before.st_size) != \
           (after.st_dev, after.st_ino, after.st_mtime_ns, after.st_size) or len(content) != before.st_size:
            raise ValueError('Managed skill dependency changed during capture')
        if SECRET.search(content.decode('utf8')):
            raise ValueError('Credential-shaped managed skill content cannot enter a snapshot')
        dependencies.append({'name': name, 'state': 'present',
                             'sha256': hashlib.sha256(content).hexdigest(),
                             'bytesBase64': base64.b64encode(content).decode('ascii')})
    return dependencies


def captureOrgReviewSnapshot(owner_email):
    os.umask(0o077)
    source = Path.home() / 'Library/Application Support/Rhythm Electron/rhythm.db'
    if source.is_symlink() or source.resolve() != source or not source.is_file():
        raise ValueError('Expected the ordinary Electron database as an owned regular file')
    db = sqlite3.connect('file:' + quote(str(source), safe='/') + '?mode=ro', uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA query_only=ON')
    db.execute('BEGIN')
    try:
        owner = db.execute('SELECT id FROM users WHERE lower(email)=?', (owner_email.lower(),)).fetchall()
        if len(owner) != 1:
            raise ValueError('Authenticated owner must match exactly one local identity')
        owner_id = owner[0]['id']
        now = datetime.now(timezone.utc)
        cutoff = (now - timedelta(days=14)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        profiles = [dict(r) for r in db.execute('SELECT * FROM agent_configs ORDER BY id')
                    if r['id'] not in CONTROL_PROFILES]
        profile_ids = {r['id'] for r in profiles}
        sessions, messages, provenance = [], [], []
        for profile in CASE_PROFILES:
            if profile not in profile_ids:
                continue
            candidates = db.execute('''SELECT s.*,
              (SELECT count(*) FROM agent_session_messages m WHERE m.session_id=s.id) AS source_message_count
              FROM agent_sessions s WHERE (owner_user_id=? OR owner_user_id IS NULL)
              AND profile_id=? AND created_at>=? AND
              (SELECT count(*) FROM agent_session_messages m WHERE m.session_id=s.id) BETWEEN 2 AND 200
              ORDER BY created_at DESC''',
              (owner_id, profile, cutoff)).fetchall()
            failures = [r for r in candidates if r['status'] == 'error'][:2]
            counterexamples = [r for r in candidates if r['status'] != 'error'][:1]
            chosen = failures + counterexamples
            chosen_ids = {r['id'] for r in chosen}
            candidates = chosen + [r for r in candidates if r['id'] not in chosen_ids][:max(0, 3-len(chosen))]
            if len(candidates) < 2:
                continue
            for source_row in candidates:
                row = dict(source_row)
                count = row.pop('source_message_count')
                # Operational handles must never attach a disposable replay to a live session/worktree.
                for key in ('session_token', 'sdk_session_id', 'parent_session_id', 'task_id', 'project_id',
                            'worktree_name', 'worktree_path', 'worktree_branch', 'anthropic_account_id'):
                    row[key] = None
                row['cwd'] = '__QUALIFICATION_WORKSPACE__'
                sessions.append(row)
                originals = db.execute('SELECT * FROM agent_session_messages WHERE session_id=? ORDER BY id',
                                       (row['id'],)).fetchall()
                for original in originals:
                    item = dict(original)
                    raw_parts = item.get('parts_json')
                    parts = json.loads(raw_parts) if raw_parts else []
                    kept = []
                    for part in parts if isinstance(parts, list) else []:
                        if not isinstance(part, dict):
                            continue
                        if part.get('type') == 'text' and isinstance(part.get('text'), str):
                            kept.append({'type': 'text', 'text': part['text']})
                        state = part.get('state')
                        if part.get('type') == 'tool' and isinstance(state, dict) and state.get('status') == 'error' and isinstance(state.get('error'), str):
                            kept.append({'type': 'tool', 'tool': part.get('tool'),
                                         'state': {'status': 'error', 'error': state['error']}})
                    # Preserve exact citable text/error bytes; discard reasoning, tool arguments/results and usage metadata.
                    messages.append({k: item[k] for k in ('id', 'session_id', 'role', 'raw_text', 'stripped_text', 'created_at', 'sdk_message_id')} |
                                    {'parts_json': json.dumps(kept, ensure_ascii=False, separators=(',', ':')) if kept else None})
                provenance.append({'sessionId': row['id'], 'profileId': profile, 'sourceMessageCount': count,
                                   'sourceStatus': row['status'], 'sourceCreatedAt': row['created_at'],
                                   'selectionRole': 'failure' if row['status'] == 'error' else 'counterexample',
                                   'sourceRowsSha256': hashlib.sha256(json.dumps([dict(r) for r in originals], sort_keys=True).encode()).hexdigest()})
        schedules = [dict(r) for r in db.execute('SELECT * FROM agent_scheduled_tasks ORDER BY id')
                     if r['created_by_user_id'] in (None, owner_id) and r['agent_config_id'] not in CONTROL_PROFILES]
        skills = [dict(r) for r in db.execute('SELECT * FROM agent_skills ORDER BY id')]
        managed_skill_dependencies = capture_managed_skill_dependencies(profiles)
        recipes = [dict(r) for r in db.execute('SELECT * FROM agent_cookbook ORDER BY id')
                   if r['owner_user_id'] in (None, owner_id)]
        payload = {'schemaVersion': 1, 'sourceKind': 'actual-electron-owner-snapshot',
                   'capturedAt': now.isoformat(), 'sourceOwnerUserId': owner_id,
                   'sourcePath': str(source), 'sourceReadOnly': True, 'windowDays': 14,
                   'tables': {'agent_configs': profiles, 'agent_sessions': sessions,
                              'agent_session_messages': messages, 'agent_scheduled_tasks': schedules,
                              'agent_skills': skills, 'agent_cookbook': recipes},
                   'provenance': provenance, 'excludedControlProfiles': sorted(CONTROL_PROFILES),
                   'managedSkillDependencies': managed_skill_dependencies,
                   'omissions': ['Other users, authentication/credential stores, live SDK handles, reasoning, tool arguments/results, and unrelated application tables are excluded.',
                                 'The existing Reviewer default window remains seven days; original timestamps are preserved.']}
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()
        if len(encoded) > 8 * 1024 * 1024:
            raise ValueError('Selected real-data snapshot exceeds its explicit 8 MiB input cap')
        if SECRET.search(encoded.decode()):
            raise ValueError('Credential-shaped content found; refuse to export rather than silently rewrite evidence')
        root = Path(tempfile.mkdtemp(prefix='rhythm-actual-org-review-snapshot-', dir='/private/tmp'))
        output = root / 'snapshot.json'
        output.write_bytes(encoded)
        output.chmod(0o600)
        receipt = {'snapshotPath': str(output), 'sha256': hashlib.sha256(encoded).hexdigest(),
                   'counts': {table: len(rows) for table, rows in payload['tables'].items()},
                   'sourceReadOnly': True, 'actualCaseProfileIds': sorted({r['profile_id'] for r in sessions})}
        (root / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt))
    finally:
        db.rollback()
        db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-email', required=True)
    captureOrgReviewSnapshot(parser.parse_args().owner_email)
