"""Canonical sandbox-only registrar digest; no credential output."""
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys

def digest(root, sandbox, registrar):
    root, sandbox, registrar = map(Path, (root, sandbox, registrar))
    for path in (root, sandbox, registrar):
        if not path.is_absolute() or '..' in path.parts or any(p.is_symlink() for p in (path, *path.parents)):
            raise ValueError('unprotected fixture path')
    if not registrar.is_relative_to(root) or sandbox.is_relative_to(root):
        raise ValueError('fixture reference containment')
    for path in (root, sandbox, sandbox / 'home'):
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError('owned fixture directories required')
    info = registrar.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 128:
        raise ValueError('protected registrar required')
    value = registrar.read_bytes().strip()
    if not re.fullmatch(rb'[A-Za-z0-9_-]{43,128}', value):
        raise ValueError('generated synthetic registrar required')
    with sqlite3.connect((sandbox / 'rhythm.db').as_uri() + '?mode=ro', uri=True) as db:
        users = db.execute('SELECT id,email FROM users ORDER BY id').fetchall()
        sessions = db.execute('SELECT token,user_id FROM sessions ORDER BY user_id').fetchall()
        if users != [(1, 'admin@example.invalid'), (2, 'member@example.invalid')] or sessions not in (
                [('e02-synthetic-session-not-a-secret', 1)],
                [('e02-synthetic-session-not-a-secret', 1), ('c1-member-synthetic-session-not-a-secret', 2)]):
            raise ValueError('only canonical public synthetic auth fixtures allowed')
    return hashlib.sha256(value).hexdigest()

if __name__ == '__main__':
    try: print(digest(*sys.argv[1:]))
    except (ValueError, OSError, sqlite3.Error):
        print('synthetic bridge fixture rejected', file=sys.stderr)
        sys.exit(1)
