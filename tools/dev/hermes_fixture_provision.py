#!/usr/bin/env python3
"""Protected operator provisioning, never imports/starts a native server.

Default is a local reference-only plan. Canonical sandbox is the default;
--allow-private-relay selects ONLY the explicitly approved operator single fixture
on http://127.0.0.1:4001. It is not a general private-network or activation switch.
The native Receiver is the supported link writer; no Rhythm SQL writes exist.
"""
import argparse
import ast
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import tempfile
import time
import types
import uuid
import urllib.error
import urllib.request
import urllib.parse

MAX_JSON = 1024 * 1024
FIXTURE_TITLE = 'Rhythm notification disposable fixture'

class BoundaryFailure(ValueError):
    """Only locally constructed, nonsecret diagnostic labels reach stderr."""
    pass

def no_symlinks(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise ValueError('absolute protected reference required')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('symlink reference denied')
    return path

def protected(path, maximum=MAX_JSON):
    path = no_symlinks(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise ValueError('protected reference unavailable') from None
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > maximum):
            raise ValueError('protected reference denied')
        data = file.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError('protected reference too large')
        return data

def token_reference(path):
    value = protected(path, 8192).decode('ascii').strip()
    if not value or any(c.isspace() or ord(c) < 33 or ord(c) > 126 for c in value):
        raise ValueError('invalid token reference')
    return value

def endpoint(value, *, fixture=False, private=False, native=False):
    url = urllib.parse.urlsplit(value)
    if (url.username is not None or url.password is not None or url.path or
            url.query or url.fragment or url.port is None or
            value != f'{url.scheme}://{url.netloc}'):
        raise ValueError('invalid endpoint')
    address = ipaddress.ip_address(url.hostname)
    if fixture:
        if not native and value != 'http://127.0.0.1:4898':
            raise ValueError('fixture API must use canonical sandbox')
        if native and (url.scheme != 'http' or not address.is_loopback or
                       url.port in (4001, 4096, 4897, 4898, 4899)):
            raise ValueError('native fixture requires separate loopback port')
    elif url.scheme != 'https' and not (private and url.scheme == 'http' and
            address.is_private and not address.is_unspecified):
        raise ValueError('HTTP requires explicit private opt-in')
    return value

def source_endpoint(api, operator=False):
    if operator:
        if api != 'http://127.0.0.1:4001':
            raise BoundaryFailure('exact operator relay http://127.0.0.1:4001 required')
        return api
    return endpoint(api, fixture=True)

def file_reference(path, label):
    """Check references without reading credential values (including dry run)."""
    try:
        info = no_symlinks(path).stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('protected reference denied')
    except (ValueError, OSError, TypeError):
        raise BoundaryFailure('STOP fileReference ' + label + ': existing owned regular file600 required') from None

def plan(token_file, api, state_dir, *, fixture=False, operator=False):
    if operator: source_endpoint(api, True)
    else: endpoint(api, fixture=fixture)
    file_reference(token_file, '--token-file')
    state = no_symlinks(state_dir)
    if not state.is_dir() or state.stat().st_uid != os.getuid():
        raise ValueError('owned STATE_DIR required')
    return dict(mode='DRY_RUN', tokenFile=str(token_file), apiEndpoint=api,
                registryFile=str(state / 'rhythm-notify-registry.json'),
                receiverFile=str(state / 'rhythm-notify.sqlite'),
                effects=['supported Receiver.link', 'atomic registry publication'])

def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.rhythm-provision-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as file:
            os.fchmod(file.fileno(), 0o600)
            json.dump(value, file, sort_keys=True, separators=(',', ':'))
            file.flush(); os.fsync(file.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(name): os.unlink(name)

def install_link(state_dir, binding, token_file, receiver, *, receiver_endpoint=None):
    """DB first, JSON last: native authority requires BOTH matching records.

    Crash before JSON publication leaves an inert link. Subsequent provisioning
    refuses the partial record rather than adopting it or inferring authority.
    Only this run is revoked on a failed publication; existing records survive.
    """
    state = no_symlinks(state_dir)
    if not state.is_dir() or state.stat().st_uid != os.getuid() or state.stat().st_mode & 0o022:
        raise ValueError('owned non-writable STATE_DIR required')
    if (not isinstance(binding, dict) or set(binding) !=
            {'runId', 'owner', 'profile', 'hermesSessionId', 'sessionId'} or
            any(not isinstance(v, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', v)
                for v in binding.values())):
        raise ValueError('invalid immutable binding')
    digest = hashlib.sha256(token_reference(token_file).encode()).hexdigest()
    registry = no_symlinks(state / 'rhythm-notify-registry.json')
    database = no_symlinks(state / 'rhythm-notify.sqlite')
    lock = no_symlinks(state / '.rhythm-provision.lock')
    fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as locked:
        info = os.fstat(locked.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('protected provisioning lock required')
        fcntl.flock(locked, fcntl.LOCK_EX)
        data = json.loads(protected(registry)) if registry.exists() else {'version': 2, 'runs': {}}
        if not isinstance(data, dict) or data.get('version') != 2 or not isinstance(data.get('runs'), dict):
            raise ValueError('unknown registry version')
        record = dict(binding=binding, active=True, credentialDigest=digest,
                      tokenFile=str(no_symlinks(token_file)))
        if receiver_endpoint is not None: record['receiverEndpoint'] = receiver_endpoint
        prior = data['runs'].get(binding['runId'])
        if prior is not None and prior != record:
            raise ValueError('immutable registry conflict or partial provisioning')
        if database.exists():
            info = database.stat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError('protected receiver database required')
            with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
                if db.execute('PRAGMA user_version').fetchone()[0] != 2:
                    raise ValueError('exact receiver version 2 required')
                names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
                if names != {'links', 'inbox', 'render_proofs'}:
                    raise ValueError('not the dedicated receiver database')
                row = db.execute('SELECT binding,credential_digest,active FROM links WHERE run_id=?', (binding['runId'],)).fetchone()
                if (row is None) != (prior is None):
                    raise ValueError('partial provisioning refuses recovery')
        elif prior is not None:
            raise ValueError('partial provisioning refuses recovery')
        old_umask = os.umask(0o077)
        try: store = receiver(database)
        finally: os.umask(old_umask)
        try:
            store.link(binding, digest, operator_authorized=True)
            if prior is None:
                data['runs'][binding['runId']] = record
                try: atomic_json(registry, data)
                except BaseException:
                    store.revoke(binding['runId'], operator_authorized=True)
                    raise
        finally: store.close()
    return {'version': 2, 'runId': binding['runId'], 'status': 'PROVISIONED'}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError('redirect denied')

def request_json(base, path, token=None, body=None, *, cookie_file=None,
                 csrf_file=None, native=False, capability=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    headers = {'Content-Type': 'application/json'}
    if native: headers['Origin'] = base
    if token is not None: headers['Authorization'] = 'Bearer ' + token
    if capability is not None: headers['X-Rhythm-Bridge-Capability'] = capability
    if (cookie_file or csrf_file) and not native:
        raise ValueError('native credentials forbidden on nonbrowser API')
    if cookie_file is not None:
        cookie = protected(cookie_file, 8192).decode('ascii').strip()
        if not cookie or any(ord(c) < 32 or ord(c) > 126 for c in cookie):
            raise ValueError('invalid native cookie reference')
        headers['Cookie'] = cookie
        if body is not None and not csrf_file:
            raise BoundaryFailure('native mutation requires existing --native-csrf-file')
    if csrf_file: headers['X-CSRF-Token'] = token_reference(csrf_file)
    request = urllib.request.Request(base + path,
        data=None if body is None else json.dumps(body).encode(),
        headers=headers)
    with opener.open(request, timeout=10) as response:
        raw = response.read(MAX_JSON + 1)
        if len(raw) > MAX_JSON: raise ValueError('response exceeds boundary')
        return json.loads(raw)

def create_native_fixture(state, base, cookie_file=None, csrf_file=None, *, approval_digest=None):
    """Only /api/session/new mints a chat; never import/save a Session surrogate."""
    state = no_symlinks(state)
    if ((approval_digest is None and not str(state).startswith(('/private/tmp/', '/var/folders/'))) or
            not state.is_dir() or state.stat().st_uid != os.getuid() or state.stat().st_mode & 0o022):
        raise ValueError('native creation requires disposable STATE_DIR')
    endpoint(base, fixture=True, native=True)
    receipt_path = no_symlinks(state / 'rhythm-fixture-chat.json')
    lock_path = no_symlinks(state / '.rhythm-native-create.lock')
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError('protected native creation lock required')
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _create_native_locked(receipt_path, base, cookie_file, csrf_file, approval_digest=approval_digest)

def _create_native_locked(receipt_path, base, cookie_file, csrf_file=None, *, approval_digest=None):
    if receipt_path.exists():
        receipt = json.loads(protected(receipt_path))
        if (receipt.get('nativeEndpoint') != base or receipt.get('profile') != 'default' or
                receipt.get('status') != 'created' or receipt.get('durableRoute') != '/api/session/rename' or
                receipt.get('approvalDigest') != approval_digest):
            raise ValueError('immutable native fixture receipt conflict')
        session_id = receipt['hermesSessionId']
        if not isinstance(session_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session_id):
            raise ValueError('invalid native session reference')
        session = request_json(base, '/api/session?' + urllib.parse.urlencode(
                               {'session_id': session_id, 'messages': '0', 'resolve_model': '0'}),
                               cookie_file=cookie_file, native=True)['session']
        if session.get('session_id') != session_id or session.get('profile') != 'default':
            raise ValueError('current native profile/session mismatch')
        return dict(mode='NATIVE_FIXTURE_EXISTS', receiptFile=str(receipt_path))
    # Record intent BEFORE HTTP. An ambiguous/crashed creation is not retried,
    # preventing a second native conversation. No destructive automatic recovery.
    intent = dict(version=2, profile='default', nativeEndpoint=base, status='creating')
    if approval_digest is not None: intent['approvalDigest'] = approval_digest
    atomic_json(receipt_path, intent)
    session = request_json(base, '/api/session/new', body={'profile': 'default', 'worktree': False},
                           cookie_file=cookie_file, csrf_file=csrf_file, native=True)['session']
    session_id = session.get('session_id')
    if (session.get('profile') != 'default' or not isinstance(session_id, str) or
            not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session_id)):
        raise ValueError('native creation returned invalid session/profile')
    # A failed receipt write never adopts/replaces an existing chat. Operator must
    # reconcile that partial creation; do not claim cross-HTTP atomicity.
    receipt = dict(version=2, profile='default', nativeEndpoint=base, status='persisting',
                   hermesSessionId=session_id)
    if approval_digest is not None: receipt['approvalDigest'] = approval_digest
    atomic_json(receipt_path, receipt)
    # Only this newly minted receipt SID: rename is the existing zero-transcript
    # persistence route, not a message/provider call or existing-chat adoption.
    saved = request_json(base, '/api/session/rename', body={'session_id': session_id, 'title': FIXTURE_TITLE},
                         cookie_file=cookie_file, csrf_file=csrf_file, native=True)['session']
    if (saved.get('session_id') != session_id or saved.get('profile') != 'default' or
            saved.get('title') != FIXTURE_TITLE):
        raise BoundaryFailure('supported native rename birth confirmation mismatch')
    receipt.update(status='created', durableRoute='/api/session/rename')
    atomic_json(receipt_path, receipt)
    return dict(mode='NATIVE_FIXTURE_CREATED', receiptFile=str(receipt_path))

def pinned_receiver(source, hashes):
    """Load only declared inbox/schema bytes, never api.__init__/config/server."""
    source = no_symlinks(source)
    names = ('api/rhythm_schema.py', 'api/rhythm_inbox.py')
    if not isinstance(hashes, dict) or set(hashes) != set(names):
        raise BoundaryFailure('exact native inbox/schema pins required')
    modules = {}
    for name in names:
        path = no_symlinks(source / name)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022 or info.st_size > MAX_JSON:
            raise ValueError('unowned native source')
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != hashes[name]:
            raise BoundaryFailure('native source pin mismatch')
        tree = ast.parse(raw)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import) and any(n.name not in {
                    'argparse', 'importlib', 'os', 'urllib.error', 'urllib.parse', 'urllib.request',
                    'hashlib', 'hmac', 'json', 're', 'secrets', 'sqlite3', 'threading', 'time'} for n in node.names):
                raise ValueError('native offline import boundary')
            if isinstance(node, ast.ImportFrom) and not (
                    node.module in ('api.rhythm_schema', 'rhythm_schema') and
                    [n.name for n in node.names] == ['validate']):
                raise ValueError('native offline import boundary')
        module = types.ModuleType(name[:-3].replace('/', '.'))
        module.__package__ = 'api'
        modules[module.__name__] = (module, compile(tree, str(path), 'exec'))
    keys = ('api', 'api.rhythm_schema', 'api.rhythm_inbox')
    previous = {key: sys.modules.get(key) for key in keys}
    try:
        package = types.ModuleType('api'); package.__path__ = []
        sys.modules['api'] = package
        for key, (module, code) in modules.items():
            sys.modules[key] = module
            exec(code, module.__dict__)
        return modules['api.rhythm_inbox'][0].Receiver
    finally:
        for key, prior in previous.items():
            if prior is None: sys.modules.pop(key, None)
            else: sys.modules[key] = prior

def api_call(args, path, body=None, *, bridge=False):
    source_endpoint(args.api, getattr(args, 'allow_private_relay', False))
    try:
        return request_json(args.api, path, None if bridge else token_reference(args.token_file), body,
                            capability=token_reference(args.bridge_capability_file) if bridge else None)
    except urllib.error.HTTPError as error:
        # Never print remote bodies/URLs. Fixed endpoint labels and status only.
        label = 'bridge' if bridge else 'owner-api'
        raise BoundaryFailure(f'{label} {path.split("?")[0]} HTTP {error.code}') from None

def approved_fixture(args):
    """Shared preflight: endpoints/mode/refs before credentials or any HTTP."""
    operator = getattr(args, 'allow_private_relay', False)
    source_endpoint(args.api, operator)
    if args.native_endpoint: endpoint(args.native_endpoint, fixture=True, native=True)
    if operator and args.native_endpoint and not re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}', args.native_endpoint):
        raise BoundaryFailure('exact pinned native IPv4 loopback endpoint required')
    if not args.bridge_capability_file:
        raise BoundaryFailure('required existing --bridge-capability-file with catalog.read/projection.issue/delegation.dispatch scopes')
    if not args.approved_fixture_manifest or not args.native_source or not args.native_endpoint:
        raise BoundaryFailure('required --approved-fixture-manifest/--native-source/--native-endpoint')
    manifest_bytes = protected(args.approved_fixture_manifest)
    manifest = json.loads(manifest_bytes)
    if manifest.get('executionMode') not in (('operator-fixture',) if operator else (None, 'sandbox-fixture')):
        raise BoundaryFailure('explicit executionMode conflicts with relay mode')
    state = no_symlinks(args.state_dir)
    root = no_symlinks(manifest['fixtureRoot'])
    if (manifest.get('version') != 2 or manifest.get('fixtureOnly') is not True or
            not root.is_dir() or root.stat().st_uid != os.getuid() or root.stat().st_mode & 0o022 or
            not state.is_relative_to(root) or state == root or not state.is_dir() or
            state.stat().st_uid != os.getuid() or state.stat().st_mode & 0o022):
        raise BoundaryFailure('approved operator-owned fixture boundary required')
    refs = {'stateDir': args.state_dir, 'tokenFile': args.token_file,
            'bridgeCapabilityFile': args.bridge_capability_file, 'nativeSource': args.native_source,
            'nativeEndpoint': args.native_endpoint, 'apiEndpoint': args.api}
    if any(manifest.get(k) != v for k, v in refs.items()):
        raise BoundaryFailure('immutable approved fixture references mismatch')
    if operator:
        allowed = {'version', 'fixtureOnly', 'executionMode', 'fixtureRoot', 'stateDir', 'tokenFile',
                   'bridgeCapabilityFile', 'nativeSource', 'nativeEndpoint', 'apiEndpoint', 'nativeHashes',
                   'owner', 'profile', 'managerAgentId', 'targetAgentId', 'prompt', 'context',
                   'nativeCookieFile', 'nativeCsrfFile'}
        if set(manifest) - allowed:
            raise BoundaryFailure('operator approval contains unsupported fields; no ownerClaim/profile overrides')
        if any(manifest.get(k) != v for k, v in {
                'nativeCookieFile': args.native_cookie_file, 'nativeCsrfFile': args.native_csrf_file}.items()):
            raise BoundaryFailure('immutable approved native auth references mismatch')
        if manifest.get('profile') != 'default':
            raise BoundaryFailure('STOP profile: operator-selected existing default profile required; no profile takeover')
        if not isinstance(manifest.get('owner'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', manifest['owner']):
            raise BoundaryFailure('STOP owner: approved authenticated source owner required')
        for path, label in ((args.bridge_capability_file, '--bridge-capability-file'),
                            (args.token_file, '--token-file'),
                            (args.native_cookie_file, '--native-cookie-file'),
                            (args.native_csrf_file, '--native-csrf-file')):
            if path is not None: file_reference(path, label)
    return manifest_bytes, manifest, state

def operator_native_policy(args):
    auth = request_json(args.native_endpoint, '/api/auth/status', native=True, cookie_file=args.native_cookie_file)
    if auth.get('auth_enabled') is True:
        # Native JSON user identity and source owner ID are distinct namespaces.
        # ponytail: STOP until a qualified mapping contract exists; never infer user=owner1.
        raise BoundaryFailure('STOP nativeAuth: existing cookie/CSRF and qualified native JSON-user/source-owner mapping required')
    if auth.get('auth_enabled') is not False:
        raise BoundaryFailure('STOP nativeAuth: current authentication policy unavailable')
    profile = request_json(args.native_endpoint, '/api/profiles', native=True, cookie_file=args.native_cookie_file)
    if profile.get('active') != 'default':
        raise BoundaryFailure('STOP profile: current real native active default metadata required; operator must select existing profile')

def stop_owned_fixture(args):
    """Offline revocation of ONLY the exact birth-receipt link; keep all proofs."""
    manifest_bytes, manifest, state = approved_fixture(args)
    if not getattr(args, 'allow_private_relay', False):
        raise BoundaryFailure('stop requires explicit operator-fixture mode')
    receipt = json.loads(protected(state / 'rhythm-fixture-chat.json'))
    if (receipt.get('approvalDigest') != hashlib.sha256(manifest_bytes).hexdigest() or
            receipt.get('status') != 'created' or receipt.get('version') != 2 or
            receipt.get('profile') != manifest['profile'] or receipt.get('nativeEndpoint') != args.native_endpoint or
            receipt.get('durableRoute') != '/api/session/rename'):
        raise BoundaryFailure('stop requires exact operator-approved native birth receipt')
    receiver = pinned_receiver(args.native_source, manifest['nativeHashes'])
    registry = no_symlinks(state / 'rhythm-notify-registry.json')
    database = no_symlinks(state / 'rhythm-notify.sqlite')
    file_reference(database, 'receiver database')
    fd = os.open(no_symlinks(state / '.rhythm-provision.lock'), os.O_RDWR | os.O_NOFOLLOW)
    with os.fdopen(fd, 'r+') as lock:
        info = os.fstat(lock.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise BoundaryFailure('protected provisioning lock required')
        fcntl.flock(lock, fcntl.LOCK_EX)
        data = json.loads(protected(registry))
        if data.get('version') != 2 or not isinstance(data.get('runs'), dict):
            raise BoundaryFailure('unknown registry version')
        matches = [(run, record) for run, record in data['runs'].items()
                   if record.get('binding', {}).get('hermesSessionId') == receipt.get('hermesSessionId')]
        if len(matches) != 1: raise BoundaryFailure('stop requires exactly one own fixture link')
        run, record = matches[0]
        binding = record['binding']
        if (binding.get('runId') != run or binding.get('owner') != manifest['owner'] or
                binding.get('profile') != manifest['profile'] or record.get('tokenFile') != args.token_file or
                record.get('receiverEndpoint') != args.native_endpoint or
                record.get('credentialDigest') != hashlib.sha256(token_reference(args.token_file).encode()).hexdigest()):
            raise BoundaryFailure('stop immutable own binding mismatch')
        with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
            if db.execute('PRAGMA user_version').fetchone()[0] != 2:
                raise BoundaryFailure('exact receiver version 2 required')
            names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if names != {'links', 'inbox', 'render_proofs'}:
                raise BoundaryFailure('not the dedicated receiver database')
            row = db.execute('SELECT binding,credential_digest,active FROM links WHERE run_id=?', (run,)).fetchone()
            if not row or json.loads(row[0]) != binding or row[1] != record['credentialDigest']:
                raise BoundaryFailure('stop receiver binding mismatch')
            if not record.get('active') and row[2]: raise BoundaryFailure('stop partial registry mismatch')
        store = receiver(database)
        try: store.revoke(run, operator_authorized=True)
        finally: store.close()
        if record.get('active'):
            record['active'] = False
            atomic_json(registry, data)
    return dict(status='STOPPED', runId=run, effects=['own Receiver.revoke', 'own registry inactive; proofs retained'])

def execute_fixture(args):
    manifest_bytes, manifest, state = approved_fixture(args)
    operator = getattr(args, 'allow_private_relay', False)
    endpoint(args.native_endpoint, fixture=True, native=True)
    receiver = pinned_receiver(args.native_source, manifest['nativeHashes'])
    token_reference(args.bridge_capability_file)
    owner = str(api_call(args, '/hermes-notify/identity')['ownerUserId'])
    if owner != manifest['owner'] or manifest.get('profile') != 'default':
        raise BoundaryFailure('authenticated owner/default grant profile mismatch')
    receipt = json.loads(protected(state / 'rhythm-fixture-chat.json'))
    if (receipt.get('version') != 2 or receipt.get('status') != 'created' or
            receipt.get('durableRoute') != '/api/session/rename' or
            receipt.get('profile') != 'default' or receipt.get('nativeEndpoint') != args.native_endpoint):
        raise BoundaryFailure('supported native creation receipt required; no chat adoption')
    if operator and receipt.get('approvalDigest') != hashlib.sha256(manifest_bytes).hexdigest():
        raise BoundaryFailure('operator-approved NEW native birth receipt required; no chat adoption')
    sid = receipt['hermesSessionId']
    if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', sid):
        raise ValueError('invalid birth reference')
    saved_birth = json.loads(protected(state / 'sessions' / (sid + '.json')))
    if saved_birth.get('session_id') != sid or saved_birth.get('profile') != 'default':
        raise BoundaryFailure('durable native birth metadata mismatch')
    def verify_native():
        if operator: operator_native_policy(args)
        auth = request_json(args.native_endpoint, '/api/auth/status', native=True, cookie_file=args.native_cookie_file)
        if auth.get('auth_enabled') is True and (not args.native_cookie_file or not args.native_csrf_file or
                auth.get('logged_in') is not True or auth.get('user') != owner or auth.get('bound_profile') != 'default'):
            raise BoundaryFailure('existing native login/CSRF owner profile mapping required')
        if auth.get('auth_enabled') not in (True, False):
            raise BoundaryFailure('current native authentication policy unavailable')
        profile = request_json(args.native_endpoint, '/api/profiles', native=True, cookie_file=args.native_cookie_file)
        session = request_json(args.native_endpoint, '/api/session?' + urllib.parse.urlencode(
            {'session_id': sid, 'messages': '0', 'resolve_model': '0'}), native=True, cookie_file=args.native_cookie_file)['session']
        if profile.get('active') != 'default' or session.get('profile') != 'default' or session.get('session_id') != sid:
            raise BoundaryFailure('current native profile/birth receipt mismatch')
    verify_native()
    catalog = api_call(args, '/agent-bridge/v1/catalog', bridge=True)
    expected_scope = hashlib.sha256(('rhythm-shared-agents|' + owner).encode()).hexdigest()[:16]
    if catalog.get('scope') != expected_scope:
        raise BoundaryFailure('runtime capability owner mismatch')
    manager = next((a for a in catalog['agents'] if a['id'] == manifest['managerAgentId']), None)
    target = next((a for a in catalog['agents'] if a['id'] == manifest['targetAgentId']), None)
    if not manager or not target or manager['id'] == target['id']:
        raise BoundaryFailure('current manager/target catalog unavailable')
    canonical = manager['canonical']
    if any(canonical.get(k) is not True for k in ('enabled', 'isManager', 'isAgent', 'sessionSelectable')) or canonical.get('locked'):
        raise BoundaryFailure('current caller manager role unavailable')
    if target['canonical'].get('isAgent') is not True or target['canonical'].get('enabled') is not True or target['canonical'].get('locked'):
        raise BoundaryFailure('current target not executable')
    if target['id'] not in json.loads(canonical.get('allowedDelegatesJson') or '[]'):
        raise BoundaryFailure('current target not in manager roster')
    journal_path = no_symlinks(state / 'rhythm-fixture-dispatch.json')
    manifest_digest = hashlib.sha256(manifest_bytes).hexdigest()
    if journal_path.exists():
        journal = json.loads(protected(journal_path))
        if journal.get('manifestDigest') != manifest_digest or journal.get('hermesSessionId') != sid or journal.get('status') != 'projected':
            raise BoundaryFailure('partial/changed dispatch receipt requires operator reconciliation')
        projection = journal['projection']
    else:
        journal = dict(version=2, status='projecting', manifestDigest=manifest_digest,
                       hermesSessionId=sid, idempotencyKey=str(uuid.uuid4()))
        atomic_json(journal_path, journal)
        projection = api_call(args, '/agent-bridge/v1/projections', dict(sessionKey=sid, cwd=None,
            launchKind='interactive', acceptVersions=[2], agentId=manager['id'], expectedRevision=manager['revision']), bridge=True)
        journal.update(status='projected', projection=projection)
        atomic_json(journal_path, journal)
    if (projection.get('schema') != 'rhythm.hermes-projection.v1' or projection.get('ownerId') != owner or
            projection.get('agentId') != manager['id'] or projection.get('revision') != manager['revision'] or
            projection['snapshot']['source'] != dict(agent_id=manager['id'], revision=manager['revision'], reference=projection['projectionId']) or
            'rhythm_delegate' not in projection['snapshot']['allowed_tools']):
        raise BoundaryFailure('current owner/manager frozen projection mismatch')
    parent = dict(projectionId=projection['projectionId'], sessionKey=sid)
    def verify_projection():
        check = api_call(args, '/agent-bridge/v1/projections/' + str(uuid.UUID(parent['projectionId'])) + '/check',
                         dict(sessionKey=sid, includeSnapshot=True), bridge=True)
        if check.get('ok') is not True or check.get('ownerId') != owner or check.get('snapshot') != projection['snapshot']:
            raise BoundaryFailure('current frozen projection authority mismatch')
    verify_projection()
    job = api_call(args, '/agent-bridge/v1/delegations', dict(idempotencyKey=journal['idempotencyKey'],
        parent=parent, targetAgentId=target['id'], prompt=manifest['prompt'], context=manifest.get('context')), bridge=True)['job']
    run_id = str(uuid.UUID(job['jobId']))
    if job.get('direction') != 'hermes_to_rhythm' or job.get('targetAgentId') != target['id'] or job.get('targetRevision') != target['revision']:
        raise BoundaryFailure('supported broker job receipt mismatch')
    deadline = time.monotonic() + 30
    events = None
    while time.monotonic() < deadline:
        try: events = api_call(args, '/hermes-notify/runs/' + run_id + '/events')
        except BoundaryFailure as error:
            if not str(error).endswith('HTTP 404'): raise
        if events and events.get('version') == 2 and events.get('events'): break
        time.sleep(.25)
    if not events or events.get('version') != 2 or not events.get('events'):
        raise BoundaryFailure('owner-api /hermes-notify/runs/<actual-job>/events bounded V2 preengine origin unavailable')
    event = events['events'][0]
    session_id = event.get('sessionId')
    if (not isinstance(session_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', session_id) or
            any(e.get('version') != 2 or e.get('runId') != run_id or e.get('hermesSessionId') != sid or
                e.get('sessionId') != session_id for e in events['events'])):
        raise BoundaryFailure('exact V2 job/native birth authority mismatch')
    # listRun authenticates the current broker child/owner/generation, not a body ID.
    verify_projection(); verify_native()
    binding = dict(runId=run_id, owner=owner, profile='default', hermesSessionId=sid, sessionId=session_id)
    result = install_link(state, binding, args.token_file, receiver, receiver_endpoint=args.native_endpoint)
    # This real native handler invokes Native.current_binding against durable
    # metadata + protected registry + Receiver DB before returning any events.
    # Do not import native config/server or substitute a memory-only predicate.
    authority = request_json(args.native_endpoint, '/api/rhythm-notify/render-metadata?' +
        urllib.parse.urlencode({'hermesSessionId': sid}), native=True, cookie_file=args.native_cookie_file)
    if not isinstance(authority.get('events'), list):
        raise BoundaryFailure('actual Native.current_binding readiness unavailable')
    return dict(result, sessionId=session_id, hermesSessionId=sid, projectionId=parent['projectionId'],
                nativeCurrentBinding='PASS',
                registryFile=str(state / 'rhythm-notify-registry.json'), receiptFile=str(journal_path))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--api', default='http://127.0.0.1:4898')
    parser.add_argument('--allow-private-relay', action='store_true', help='explicit operator-fixture mode: ONLY exact http://127.0.0.1:4001')
    parser.add_argument('--manifest-file', help='protected API-bound immutable origin reference')
    parser.add_argument('--approved-fixture-manifest', help='protected explicit fixture execution approval receipt')
    parser.add_argument('--bridge-capability-file', help='existing protected runtime capability, never an owner bearer substitute')
    parser.add_argument('--native-source', help='copied, pinned native source directory')
    parser.add_argument('--execute-owned-fixture', action='store_true')
    parser.add_argument('--create-native-owned-fixture', action='store_true')
    parser.add_argument('--stop-owned-fixture', action='store_true', help='offline idempotent disable of ONLY approved own fixture link; keep proofs')
    parser.add_argument('--native-endpoint')
    parser.add_argument('--native-cookie-file', help='existing protected native cookie reference, if authentication is enabled')
    parser.add_argument('--native-csrf-file', help='existing protected native CSRF reference; never synthesized')
    args = parser.parse_args()
    source_endpoint(args.api, args.allow_private_relay)
    if sum((args.create_native_owned_fixture, args.execute_owned_fixture, args.stop_owned_fixture)) > 1:
        raise BoundaryFailure('explicit separate native fixture creation required')
    if args.stop_owned_fixture:
        print(json.dumps(stop_owned_fixture(args), sort_keys=True))
        return
    approval_digest = None
    if args.allow_private_relay:
        manifest_bytes, manifest, state = approved_fixture(args)
        if args.create_native_owned_fixture:
            # Validate the offline bytes and current policy before birth intent/write.
            pinned_receiver(args.native_source, manifest['nativeHashes'])
            owner = str(api_call(args, '/hermes-notify/identity')['ownerUserId'])
            if owner != manifest['owner']: raise BoundaryFailure('authenticated approved source owner mismatch')
            operator_native_policy(args)
            approval_digest = hashlib.sha256(manifest_bytes).hexdigest()
    elif args.approved_fixture_manifest:
        manifest = json.loads(protected(args.approved_fixture_manifest))
        if manifest.get('executionMode') not in (None, 'sandbox-fixture'):
            raise BoundaryFailure('explicit executionMode conflicts with relay mode')
    result = plan(Path(args.token_file), args.api, Path(args.state_dir), fixture=True, operator=args.allow_private_relay)
    if args.allow_private_relay: result['executionMode'] = 'operator-fixture'
    if args.create_native_owned_fixture:
        if args.execute_owned_fixture or not args.native_endpoint:
            raise ValueError('explicit separate native fixture creation required')
        result = create_native_fixture(Path(args.state_dir), args.native_endpoint, args.native_cookie_file, args.native_csrf_file,
                                       approval_digest=approval_digest)
    if args.execute_owned_fixture:
        # ponytail: fixture receipt, not a production activation switch.
        result = execute_fixture(args)
    print(json.dumps(result, sort_keys=True))

if __name__ == '__main__':
    try: main()
    except BoundaryFailure as error:
        print('FAIL: ' + str(error), file=sys.stderr)
        sys.exit(1)
    except (ValueError, OSError, KeyError, TypeError):
        # Never serialize exception URLs, response bodies or credential-bearing data.
        print('FAIL: protected provisioning boundary rejected; no live activation', file=sys.stderr)
        sys.exit(1)
