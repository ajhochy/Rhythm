#!/usr/bin/env python3
"""Cooperative aggregate build byte budget; sampled, not a filesystem quota."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import time

MAX_BYTES = 10 * 1024**3
OWNER = 'rhythm-build-scratch-v1'
OUTPUTS = ('apps/electron/dist', 'apps/opencode_fork/packages/opencode/dist',
           'apps/desktop_flutter/build', 'apps/desktop_flutter/dist',
           'apps/web/dist', 'apps/api_server/dist', 'apps/mcp_server/dist',
           'apps/mobile/dist', 'apps/mobile/dist-e2e', 'apps/mobile/build',
           'apps/mobile/.expo', 'apps/mobile/ios/build',
           'apps/mobile/android/build', 'apps/mobile/android/app/build',
           'apps/mobile/android/.gradle')


def safe_path(path):
    path = Path(os.path.abspath(path))
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f'Symlink is not a budget boundary: {part}')
    return path


def read_json(path):
    safe_path(path)
    return json.loads(path.read_text())


def write_json(path, value):
    safe_path(path)
    temp = path.with_name(path.name + '.new')
    safe_path(temp)
    with open(temp, 'w') as stream:
        json.dump(value, stream)
    os.replace(temp, path)


def identity(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='],
                            text=True, capture_output=True)
    return result.stdout.strip() if result.returncode == 0 else None


def group_exists(group):
    # macOS may report EPERM for a group containing only unreaped zombies.
    result = subprocess.run(['ps', '-axo', 'pgid=,stat='], capture_output=True, text=True, check=True)
    return any(int(row.split()[0]) == group and not row.split()[1].startswith('Z')
               for row in result.stdout.splitlines() if len(row.split()) == 2)


def size(paths, input_link_roots=()):
    """Count each inode once, including hardlinks and overlapping watches."""
    boundaries = [safe_path(path) for path in paths]
    input_link_roots = [safe_path(path) for path in input_link_roots]
    seen = set()
    total = 0
    def visit(path):
        nonlocal total
        try:
            info = path.lstat()
        except (FileNotFoundError, NotADirectoryError):
            return
        if stat.S_ISLNK(info.st_mode):
            # Temporary input aliases are common in build/test tooling. Count
            # the link itself, never traverse or remove its external target.
            if any(root in path.parents for root in input_link_roots):
                total += info.st_size
                return
            target = path.resolve()
            if not any(target == root or root in target.parents for root in boundaries):
                raise ValueError(f'External symlink in budgeted output: {path}')
            total += info.st_size
            return
        key = (info.st_dev, info.st_ino)
        if key in seen:
            return
        seen.add(key)
        if stat.S_ISDIR(info.st_mode):
            try:
                entries = list(path.iterdir())
            except (FileNotFoundError, NotADirectoryError):
                # Builders may replace/remove outputs between lstat and scan.
                return
            for entry in entries:
                visit(entry)
        elif stat.S_ISREG(info.st_mode):
            total += info.st_size
        elif (stat.S_ISSOCK(info.st_mode) or stat.S_ISFIFO(info.st_mode)) and any(
                root in path.parents for root in input_link_roots):
            # tsx and other builders use temporary IPC nodes. They have no
            # traversable payload; cleanup unlinks them after the group exits.
            total += info.st_size
        else:
            raise ValueError(f'Unsupported budgeted file: {path}')
    for path in boundaries:
        visit(path)
    return total


class Budget:
    def __init__(self, root, limit):
        self.root = safe_path(root)
        self.root.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.root.mkdir(mode=0o700)
            created = True
        except FileExistsError:
            created = False
        safe_path(self.root)
        info = self.root.stat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError('Scratch root must be owned by this uid with mode 0700')
        marker = self.root / 'owner.json'
        if created:
            write_json(marker, {'owner': OWNER, 'uid': os.getuid()})
        else:
            # Another first starter may have won mkdir but not published its
            # atomic marker yet. Wait briefly; never adopt an unmarked root.
            deadline = time.monotonic() + 0.5
            while not marker.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            if read_json(marker) != {'owner': OWNER, 'uid': os.getuid()}:
                raise ValueError('Scratch root lacks its ownership marker')
        self.limit = limit
        self.lock_path = safe_path(self.root / 'lock')

    @contextmanager
    def locked(self):
        with open(self.lock_path, 'a+') as stream:
            fcntl.flock(stream, fcntl.LOCK_EX)
            self.state = read_json(self.root / 'registry.json') if (self.root / 'registry.json').exists() else {
                'limit': self.limit, 'watches': [], 'runs': {}}
            # A new worker cannot silently raise an existing shared ceiling.
            self.state['limit'] = min(self.limit, self.state['limit'])
            try:
                yield
            finally:
                write_json(self.root / 'registry.json', self.state)

    def reap_stale(self):
        """Remove only registered scratch whose exact supervisor/group are gone."""
        for token, run in list(self.state['runs'].items()):
            if not re.fullmatch(r'run-[0-9a-f]{24}', token):
                continue
            if not isinstance(run.get('pid'), int) or not isinstance(run.get('group'), int):
                continue
            if run['pid'] <= 0 or run['group'] <= 0 or not isinstance(run.get('identity'), str):
                continue
            if identity(run['pid']) == run['identity'] or group_exists(run['group']):
                continue
            path = safe_path(self.root / token)
            if not path.is_dir():
                continue
            marker_path = path / 'run.json'
            if not marker_path.exists():
                continue
            marker = read_json(marker_path)
            if marker != {'owner': OWNER, 'token': token, 'pid': run['pid'], 'identity': run['identity']}:
                continue
            shutil.rmtree(path)
            del self.state['runs'][token]

    def measured(self):
        # Every child-created byte in the owned root counts; receipts are bounded.
        temporary = [self.root / token / 'tmp' for token in self.state['runs']
                     if re.fullmatch(r'run-[0-9a-f]{24}', token)]
        return size([self.root, *self.state['watches']], input_link_roots=temporary)

    def active(self, token):
        with self.locked():
            run = self.state['runs'].get(token)
            return bool(run and run.get('group') == os.getpgrp()
                        and run['identity'] == identity(run['pid'])
                        and 'guard.py' in run['identity'])

    def cleanup(self, token):
        path = safe_path(self.root / token)
        if path.exists():
            marker = read_json(path / 'run.json')
            if marker != {'owner': OWNER, 'token': token, 'pid': os.getpid(), 'identity': identity(os.getpid())}:
                raise ValueError('Run ownership changed; preserving scratch')
            shutil.rmtree(path)


def stop_group(child):
    """Escalate against the group even when its leader already exited."""
    child.poll()
    if not group_exists(child.pid):
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + 0.4
    while time.monotonic() < deadline:
        child.poll()
        if not group_exists(child.pid):
            break
        time.sleep(0.02)
    if group_exists(child.pid):
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    child.wait()
    deadline = time.monotonic() + 2
    while group_exists(child.pid) and time.monotonic() < deadline:
        time.sleep(0.02)
    if group_exists(child.pid):
        raise ValueError('Owned build group still alive; preserving scratch')


def run(args):
    limit_text = args.limit_bytes
    if not limit_text.isdecimal() or not 0 < int(limit_text) <= MAX_BYTES:
        raise ValueError('Limit must be an integer from 1 through 10737418240 bytes')
    budget = Budget(args.root, int(limit_text))
    with budget.locked():
        budget.reap_stale()
    token = os.environ.get('RHYTHM_BUILD_TOKEN', '')
    watches = [str(safe_path(Path(args.repo) / output)) for output in OUTPUTS]
    watches.extend(str(safe_path(path)) for path in args.watch)
    if args.check_active:
        if not budget.active(token):
            return 1
        with budget.locked():
            budget.state['watches'] = sorted(set(budget.state['watches'] + watches))
            if budget.measured() > budget.state['limit']:
                raise ValueError('Build budget exceeded during active check')
        return 0
    if not args.command:
        raise ValueError('Expected -- command [args ...]')
    if token and budget.active(token):
        # Nested guards add explicit outputs before running anything.
        with budget.locked():
            budget.state['watches'] = sorted(set(budget.state['watches'] + watches))
            if budget.measured() > budget.state['limit']:
                raise ValueError('Build budget exceeded before nested command')
        return subprocess.call(args.command)
    token = 'run-' + secrets.token_hex(12)
    scratch = budget.root / token
    own_identity = identity(os.getpid())
    child = None
    code = 1
    reason = 'launch failed'
    peak = 0
    received = []
    def forward(signum, _frame):
        received.append(signum)
    previous = {s: signal.signal(s, forward) for s in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    try:
        with budget.locked():
            budget.state['watches'] = sorted(set(budget.state['watches'] + watches))
            peak = budget.measured()
            if peak > budget.state['limit']:
                raise ValueError(f'Build budget exceeded before launch: {peak} > {budget.state["limit"]} bytes')
            scratch.mkdir(mode=0o700)
            write_json(scratch / 'run.json', {'owner': OWNER, 'token': token, 'pid': os.getpid(), 'identity': own_identity})
            temporary = scratch / 'tmp'
            temporary.mkdir()
            env = dict(os.environ, RHYTHM_BUILD_TOKEN=token, RHYTHM_BUILD_ROOT=str(budget.root),
                       RHYTHM_BUILD_LIMIT_BYTES=str(budget.state['limit']), RHYTHM_BUILD_SCRATCH=str(scratch),
                       TMPDIR=str(temporary), TMP=str(temporary), TEMP=str(temporary),
                       npm_config_cache=str(scratch / 'npm-cache'),
                       XDG_CACHE_HOME=str(scratch / 'xdg-cache'),
                       CARGO_TARGET_DIR=str(scratch / 'cargo-target'),
                       CARGO_HOME=str(scratch / 'cargo-home'))
            # Marker and registry overhead also count before child side effects.
            if budget.measured() > budget.state['limit']:
                raise ValueError('Build budget exceeded before launch')
            # Register supervisor and process group while the root lock is held.
            child = subprocess.Popen(args.command, env=env, start_new_session=True)
            budget.state['runs'][token] = {'pid': os.getpid(), 'identity': own_identity, 'group': child.pid}
        while True:
            with budget.locked():
                measured = budget.measured()
                peak = max(peak, measured)
                exceeded = measured > budget.state['limit']
            if received or exceeded:
                code = 128 + received[0] if received else 75
                reason = f'signal {received[0]}' if received else 'build budget exceeded'
                # Forward the original signal, then always reap the entire group.
                if received:
                    try:
                        os.killpg(child.pid, received[0])
                    except ProcessLookupError:
                        pass
                stop_group(child)
                break
            status = child.poll()
            if status is not None:
                code = status if status >= 0 else 128 - status
                reason = 'success' if code == 0 else 'command failed'
                stop_group(child)
                break
            time.sleep(0.05)
        if code:
            print(f'build-guard: {reason}; peak {peak} bytes', file=sys.stderr)
        return code
    except (ValueError, OSError, RuntimeError) as error:
        code = 74
        reason = str(error)
        raise
    finally:
        if child:
            stop_group(child)
        with budget.locked():
            budget.cleanup(token)
            budget.state['runs'].pop(token, None)
            latest = budget.root / 'latest.json'
            if latest.exists():
                write_json(budget.root / 'previous.json', read_json(latest))
            write_json(latest, {'run': token, 'exit': code, 'reason': reason, 'peak_bytes': peak})
        for signum, handler in previous.items():
            signal.signal(signum, handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default=os.environ.get('RHYTHM_BUILD_ROOT') or str(
        Path(pwd.getpwuid(os.getuid()).pw_dir) / 'Documents/Codex/.rhythm-build-scratch'))
    parser.add_argument('--limit-bytes', default=os.environ.get('RHYTHM_BUILD_LIMIT_BYTES', str(MAX_BYTES)))
    parser.add_argument('--repo', default=os.getcwd())
    parser.add_argument('--watch', action='append', default=[])
    parser.add_argument('--check-active', action='store_true')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if args.command[:1] == ['--']:
        args.command.pop(0)
    try:
        return run(args)
    except (ValueError, OSError, RuntimeError, KeyError, TypeError, json.JSONDecodeError) as error:
        print(f'build-guard: {error}', file=sys.stderr)
        return 74


if __name__ == '__main__':
    sys.exit(main())
