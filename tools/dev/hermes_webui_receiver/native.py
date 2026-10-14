"""Owned in-process notification integration. No provider or launch on import."""
import json
import hashlib
import os
import stat
import secrets
import hmac
from urllib.parse import parse_qs
from pathlib import Path

from api.config import STATE_DIR, _get_session_agent_lock
from api.models import get_session
from api.rhythm_inbox import Capability, Receiver, Denied, binding_json, encoded
from api.turn_journal import read_turn_journal


class Native:
    def __init__(self):
        self.path = STATE_DIR / 'rhythm-notify.sqlite'
        self.registry = STATE_DIR / 'rhythm-notify-registry.json'

    def records(self):
        # A protected local operator registry, never an HTTP adoption operation.
        fd = os.open(self.registry, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as file:
            info = os.fstat(file.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                    or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1024 * 1024):
                raise Denied('registry unavailable')
            data = json.load(file)
        if data.get('version') != 2 or not isinstance(data.get('runs'), dict):
            raise Denied('registry unavailable')
        return data['runs']

    def current_binding(self, run_id):
        record = self.records().get(run_id)
        if not isinstance(record, dict) or record.get('active') is not True:
            raise Denied('origin unavailable')
        binding = record.get('binding')
        binding_json(binding)
        if binding['runId'] != run_id:
            raise Denied('origin unavailable')
        try:
            session = get_session(binding['hermesSessionId'])
            # Read durable metadata too: a warm cache is not a revocation proof.
            saved = json.loads(Path(session.path).read_text())
        except (KeyError, OSError, ValueError):
            raise Denied('origin unavailable') from None
        if (session.session_id != binding['hermesSessionId']
                or session.profile != binding['profile']
                or saved.get('profile') != binding['profile']
                or saved.get('session_id') != binding['hermesSessionId']):
            raise Denied('origin unavailable')
        store = Receiver(self.path)
        try:
            row = store.db.execute('SELECT * FROM links WHERE run_id=?', (run_id,)).fetchone()
            if (row is None or not row['active'] or row['binding'] != binding_json(binding)
                    or row['credential_digest'] != record.get('credentialDigest')):
                raise Denied('origin unavailable')
        finally:
            store.close()
        return binding

    def start_once(self, intent, binding):
        from api.routes import start_session_turn
        operation = Operation(self, intent, binding)
        # Do not take the non-reentrant session lock here: the real start chain
        # rechecks operation authority inside its existing commit lock.
        result = start_session_turn(binding['hermesSessionId'], intent['event']['text'],
                                    source='rhythm_notify', notification=operation)
        return 'busy' if result.get('_status') == 409 else None

    def observe(self, turn_identity):
        # Journal completion and saved bytes alone never qualify visibility.
        for run_id in self.records():
            binding = self.current_binding(run_id)
            journal = read_turn_journal(binding['hermesSessionId'])
            if journal['malformed']:
                continue
            events = journal['events']
            submitted = [e for e in events if e.get('event') == 'submitted'
                         and e.get('turn_id') == turn_identity and e.get('rhythm_notify')]
            if len(submitted) != 1:
                continue
            event = submitted[0]
            states = [e.get('event') for e in events if e.get('turn_id') == turn_identity]
            if 'worker_started' not in states:
                return None  # committed-before-launch is ambiguous, never replayed
            proof = dict(turnIdentity=turn_identity, eventId=event['rhythm_notify']['eventId'],
                        identityHash=event['rhythm_notify']['identityHash'],
                        hermesSessionId=binding['hermesSessionId'],
                        state='started')
            completed = [e for e in events if e.get('turn_id') == turn_identity
                         and e.get('event') == 'completed']
            if len(completed) == 1 and not any(s in states for s in ('interrupted', 'failed')):
                session = get_session(binding['hermesSessionId'])
                saved = json.loads(Path(session.path).read_text())
                index = completed[0].get('assistant_message_index')
                messages = saved.get('messages', [])
                if (type(index) is int and 0 <= index < len(messages)
                        and messages[index].get('role') == 'assistant'
                        and messages[index].get('content')):
                    proof['state'] = 'completed'
                    proof['saved'] = dict(messageId=hashlib.sha256(encoded(messages[index]).encode()).hexdigest(),
                                          identityHash=proof['identityHash'], turnIdentity=turn_identity)
                    proof['messageIndex'] = index
            return proof

    def browser_owned(self, handler, binding):
        from api.auth import is_auth_enabled, get_session_info, parse_cookie
        from api.profiles import get_active_profile_name
        if get_active_profile_name() != binding['profile']:
            raise Denied('origin unavailable')
        # Auth-disabled LAN is the existing trusted single-operator boundary.
        # Auth-enabled deployments must bind the existing login, never a body owner.
        if is_auth_enabled():
            cookie = parse_cookie(handler) or ''
            info = getattr(handler, '_trusted_auth_session_reconciled', None) or get_session_info(cookie) or {}
            record = self.records()[binding['runId']]
            session_digest = hashlib.sha256(cookie.encode()).hexdigest()
            if not (info.get('username') == binding['owner'] or
                    (cookie and hmac.compare_digest(session_digest,
                        record.get('browserSessionDigest', '')))):
                raise Denied('origin unavailable')

    def render_metadata(self, store, row, binding):
        proof = self.observe(row['turn_id'])
        if (not proof or proof.get('state') != 'completed' or
                proof.get('eventId') != row['event_id'] or
                proof.get('identityHash') != row['identity_hash']):
            raise Denied('completion unavailable')
        session = get_session(binding['hermesSessionId'])
        if session.active_stream_id or session.pending_user_message:
            raise Denied('chat busy')
        metadata = dict(eventId=row['event_id'], runId=binding['runId'],
                        hermesSessionId=binding['hermesSessionId'],
                        turnIdentity=row['turn_id'], messageId=proof['saved']['messageId'],
                        messageIndex=proof['messageIndex'], identityHash=row['identity_hash'])
        prior = store.db.execute('SELECT metadata FROM render_proofs WHERE event_id=?',
                                 (row['event_id'],)).fetchone()
        if prior:
            old = json.loads(prior['metadata'])
            if any(old.get(key) != value for key, value in metadata.items()):
                raise Denied('saved reply changed')
            return old, proof
        metadata['proofNonce'] = secrets.token_hex(32)
        store.db.execute('INSERT INTO render_proofs(event_id,metadata) VALUES(?,?)',
                         (row['event_id'], encoded(metadata)))
        return metadata, proof


def handle_browser(handler, parsed):
    """Called ONLY after the existing browser auth/CSRF request gate."""
    from api.helpers import j
    path = parsed.path
    if path not in ('/api/rhythm-notify/render-metadata', '/api/rhythm-notify/render-receipt'):
        return False
    from api.routes import _check_csrf, _check_same_origin_browser_request, _csrf_rejection_error
    check = _check_csrf if handler.command != 'GET' else _check_same_origin_browser_request
    if not check(handler):
        handler.close_connection = True
        return j(handler, {'error': _csrf_rejection_error(handler)}, status=403)
    capability = getattr(handler.server, 'rhythm_notify', None)
    store = None
    try:
        if capability is None:
            raise Denied('unavailable')
        native = capability.native
        if path.endswith('render-metadata') and handler.command == 'GET':
            query = parse_qs(parsed.query, strict_parsing=True)
            if set(query) != {'hermesSessionId'} or len(query['hermesSessionId']) != 1:
                raise ValueError('invalid query')
            sid = query['hermesSessionId'][0]
            results = []
            contents = {}
            store = Receiver(native.path)
            for run_id in native.records():
                binding = native.current_binding(run_id)
                if binding['hermesSessionId'] != sid:
                    continue
                with _get_session_agent_lock(sid):
                    binding = native.current_binding(run_id)
                    native.browser_owned(handler, binding)
                    for row in store.db.execute("SELECT * FROM inbox WHERE run_id=? AND state IN ('started','completed')", (run_id,)).fetchall():
                        try:
                            store.db.execute('BEGIN IMMEDIATE')
                            metadata, _ = native.render_metadata(store, row, binding)
                            store.db.commit()
                            results.append(metadata)
                            saved = json.loads(Path(get_session(sid).path).read_text())
                            contents[metadata['messageId']] = saved['messages'][metadata['messageIndex']]['content']
                        except Denied:
                            store.db.rollback()
            return j(handler, {'events': results, **({'contents': contents} if results else {})})
        if not path.endswith('render-receipt') or handler.command != 'POST':
            raise ValueError('invalid method')
        if handler.headers.get('Transfer-Encoding'):
            raise ValueError('unsupported framing')
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= 4096:
            raise ValueError('invalid size')
        metadata = json.loads(handler.rfile.read(length))
        if not isinstance(metadata, dict) or set(metadata) != {
                'eventId', 'runId', 'hermesSessionId', 'turnIdentity', 'messageId',
                'messageIndex', 'identityHash', 'proofNonce'}:
            raise ValueError('invalid receipt')
        binding = native.current_binding(metadata['runId'])
        with _get_session_agent_lock(binding['hermesSessionId']):
            binding = native.current_binding(metadata['runId'])
            native.browser_owned(handler, binding)
            if metadata['hermesSessionId'] != binding['hermesSessionId']:
                raise Denied('wrong chat')
            store = Receiver(native.path)
            store.db.execute('BEGIN IMMEDIATE')
            row = store.db.execute('SELECT * FROM inbox WHERE event_id=? AND run_id=?',
                                   (metadata['eventId'], binding['runId'])).fetchone()
            prior = store.db.execute('SELECT metadata FROM render_proofs WHERE event_id=?',
                                     (metadata['eventId'],)).fetchone()
            if row is None or prior is None or row['state'] not in ('started', 'completed', 'visible'):
                raise Denied('completion unavailable')
            expected, proof = native.render_metadata(store, row, binding)
            if metadata != expected or encoded(metadata) != prior['metadata']:
                raise Denied('receipt mismatch')
            store._owned(native.current_binding(binding['runId']))
            proof['rendered'] = proof['saved']
            proof['visibilityTrust'] = 'authenticated-ui-relay-attestation-not-human-reading'
            store.db.execute('UPDATE render_proofs SET received=1 WHERE event_id=?', (row['event_id'],))
            store.db.execute("UPDATE inbox SET state='visible',proof=? WHERE event_id=? AND state!='visible'",
                             (encoded(proof), row['event_id']))
            store.db.commit()
            return j(handler,
                dict(version=2, eventId=row['event_id'], runId=binding['runId'],
                     hermesSessionId=binding['hermesSessionId'], state='visible'))
    except (Denied, FileNotFoundError):
        return j(handler, {'error': 'unavailable'}, status=404)
    except (ValueError, TypeError, KeyError, AttributeError):
        handler.close_connection = True
        return j(handler, {'error': 'invalid_receipt'}, status=400)
    finally:
        if store is not None:
            store.db.rollback()
            store.close()


class Operation:
    def __init__(self, native, intent, binding):
        self.native, self.intent, self.binding = native, intent, binding
        self.fields = {'turn_id': intent['turnIdentity'], 'rhythm_notify': {
            'eventId': intent['event']['eventId'], 'identityHash': intent['identityHash'],
            'runId': binding['runId']}}

    def recheck(self, session):
        if self.native.current_binding(self.binding['runId']) != self.binding:
            raise Denied('origin unavailable')
        if session.session_id != self.binding['hermesSessionId']:
            raise Denied('origin unavailable')
        journal = read_turn_journal(session.session_id)
        # Malformed journal or any prior operation is an ambiguous quarantine.
        if journal['malformed'] or any(e.get('turn_id') == self.intent['turnIdentity']
                                       for e in journal['events']):
            raise Denied('native operation already committed or ambiguous')

    def arm(self, session):
        # Capture authoritative durable metadata, not the warm Session cache.
        self.authority = self.metadata(session)
        self.record = self.native.records()[self.binding['runId']]
        session._rhythm_notify_operation = self

    def metadata(self, session):
        saved = json.loads(Path(session.path).read_text())
        return {key: saved.get(key) for key in
                ('session_id', 'profile', 'clear_generation', 'intentional_shrink_generation')}

    def save_metadata(self, session):
        # A stale notification worker must never erase a transfer/reset. Preserve
        # the file and quarantine its queue instead of retagging the cached object.
        current = self.metadata(session)
        if (self.native.records().get(self.binding['runId']) != self.record
                or any(current[key] != self.authority[key] for key in
                       ('session_id', 'clear_generation', 'intentional_shrink_generation'))):
            raise Denied('notification metadata generation changed')
        # Keep the worker's original owner/profile untouched. Only serialization
        # uses the durable transfer; current_binding then denies every old event.
        return current

    def check_save(self, session, metadata):
        if self.save_metadata(session) != metadata:
            raise Denied('notification metadata changed during save')

    def committed(self, session, event):
        if any(event.get(k) != v for k, v in self.fields.items()):
            raise Denied('native commit receipt absent')
        # The existing helper swallows directory fsync errors for ordinary chat.
        # Notification delivery requires that durability receipt explicitly.
        directory = Path(session.path).parent / '_turn_journal'
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)


def startup():
    native = Native()
    store = Receiver(native.path)
    try:
        try:
            records = native.records()
        except FileNotFoundError:
            records = {}
        for record in records.values():
            if record.get('active') is True:
                store.link(record['binding'], record['credentialDigest'], operator_authorized=True)
    finally:
        store.close()
    capability = Capability(native.path, native)
    # Empty/missing registry does not grant authority; drain fails closed.
    capability.startup()
    return capability


def handle(handler, parsed):
    capability = getattr(handler.server, 'rhythm_notify', None)
    if parsed.path not in (Capability.RECEIVE, Capability.STATUS) or handler.command != 'POST':
        return False
    from api.helpers import j
    try:
        if handler.headers.get('Transfer-Encoding'):
            raise ValueError('unsupported framing')
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= 8192:
            raise ValueError('invalid size')
        body = handler.rfile.read(length)
        if len(body) != length:
            raise ValueError('truncated body')
        if capability is None:
            return j(handler, {'error': 'unavailable'}, status=404)
        # Lock the trusted native chat, not a client-selected profile cookie.
        event = json.loads(body)
        binding = capability.native.current_binding(event.get('runId'))
        with _get_session_agent_lock(binding['hermesSessionId']):
            code, result = capability.handle('POST', parsed.path, dict(handler.headers), body)
        return j(handler, result, status=code)
    except (Denied, FileNotFoundError):
        return j(handler, {'error': 'unavailable'}, status=404)
    except (ValueError, TypeError, AttributeError):
        handler.close_connection = True
        return j(handler, {'error': 'invalid_event'}, status=400)
