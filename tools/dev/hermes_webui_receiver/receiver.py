"""Durable intent inbox. Native JSON/journal effects are NOT this SQLite transaction.

The native boundary must implement correlated, fenced start_once/observe in the
RUNNING WebUI process. Never configure it with a docker-exec/import surrogate.
No provider, server, credentials, database or worker is opened on import.
"""
import hashlib
import hmac
import json
import re
import secrets
import sqlite3
import threading
import time
from hermes_notify_subscriber import validate


class Denied(ValueError):
    pass


class Collision(ValueError):
    pass


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True)


def identity(event):
    validate(event)
    if event['version'] != 2:
        raise ValueError('V2 required')
    return encoded({k: v for k, v in event.items() if k != 'state'})


def binding_json(binding):
    if not isinstance(binding, dict) or set(binding) != {
            'runId', 'owner', 'profile', 'hermesSessionId', 'sessionId'}:
        raise Denied('invalid local binding')
    if any(not isinstance(v, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', v)
           for v in binding.values()):
        raise Denied('invalid local binding')
    return encoded(binding)


class Receiver:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None, timeout=10, uri=True)
        self.db.row_factory = sqlite3.Row
        try:
            self.db.execute('PRAGMA synchronous=FULL')
            if self._migrate():
                self.db.execute('PRAGMA journal_mode=WAL')
        except BaseException:
            self.db.close()
            raise

    def _migrate(self):
        # Receiver scratch DB only. Exact known schemas, never a user/chat DB.
        schemas = {
            'links': '''CREATE TABLE links(
                run_id TEXT PRIMARY KEY, binding TEXT NOT NULL, credential_digest TEXT NOT NULL,
                active INTEGER NOT NULL CHECK(active IN (0,1)))''',
            'inbox': '''CREATE TABLE inbox(
                event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES links(run_id),
                payload TEXT NOT NULL, identity_hash TEXT NOT NULL, turn_id TEXT NOT NULL UNIQUE,
                state TEXT NOT NULL CHECK(state IN ('accepted','launching','started','completed','visible')),
                lease TEXT, lease_until REAL, proof TEXT)''',
            'render_proofs': '''CREATE TABLE render_proofs(
                event_id TEXT PRIMARY KEY, metadata TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0)''',
        }
        def normalized(sql):
            return re.sub(r'\s+', '', sql.replace('IF NOT EXISTS ', '').replace('"inbox"', 'inbox')).rstrip(';')
        def inspect_schema():
            version = self.db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 2):
                raise ValueError('unknown receiver schema version')
            objects = self.db.execute("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").fetchall()
            tables = {r['name']: r['sql'] for r in objects if r['type'] == 'table'}
            legacy = False
            if tables or version == 2:
                if not {'links', 'inbox'} <= tables.keys():
                    raise ValueError('not a receiver database')
                for name, sql in schemas.items():
                    if name not in tables:
                        if name == 'render_proofs' and version == 0:
                            continue
                        raise ValueError('incomplete receiver schema')
                    actual = normalized(tables[name])
                    if name == 'inbox' and version == 0 and actual == normalized(sql.replace("'completed',", '')):
                        legacy = True
                    elif actual != normalized(sql):
                        raise ValueError('unknown receiver schema')
                # Unknown dependent SQL cannot safely be rebuilt. Preserve/fail closed.
                if any(r['type'] != 'table' and r['tbl_name'] in schemas for r in objects):
                    raise ValueError('unknown receiver dependencies')
                for name in tables.keys() - schemas.keys():
                    if any(r['table'] in schemas for r in self.db.execute('PRAGMA foreign_key_list("'+name.replace('"', '""')+'")')):
                        raise ValueError('unknown receiver references')
            return version, tables, legacy

        # Current authority reads must not compete with their caller's write lock.
        # Validate the complete schema in one read snapshot, not just its version.
        self.db.execute('BEGIN')
        try:
            version, _, _ = inspect_schema()
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
        if version == 2:
            return False
        self.db.execute('BEGIN IMMEDIATE')
        try:
            # Another initializer may have migrated while we waited for the lock.
            version, tables, legacy = inspect_schema()
            if version == 2:
                self.db.commit()
                return False
            if legacy:
                self.db.execute(schemas['inbox'].replace('CREATE TABLE inbox(', 'CREATE TABLE inbox_migrating('))
                self.db.execute('INSERT INTO inbox_migrating(rowid,event_id,run_id,payload,identity_hash,turn_id,state,lease,lease_until,proof) SELECT rowid,* FROM inbox')
                # No state inference, identity/credential rewrite or lease expiry retry.
                self.db.execute('DROP TABLE inbox')
                self.db.execute('ALTER TABLE inbox_migrating RENAME TO inbox')
            for name, sql in schemas.items():
                if name not in tables:
                    self.db.execute(sql)
            self.db.execute('PRAGMA user_version=2')
            self.db.commit()
            return True
        except BaseException:
            self.db.rollback()
            raise

    def close(self):
        self.db.close()

    def link(self, binding, credential_digest, *, operator_authorized=False):
        # Provision only from the authenticated operator's local run registry.
        # No HTTP link endpoint exists. Caller authorization is a native integration gate.
        if operator_authorized is not True or not re.fullmatch(r'[0-9a-f]{64}', credential_digest):
            raise Denied('operator authorization required')
        payload = binding_json(binding)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            prior = self.db.execute('SELECT * FROM links WHERE run_id=?', (binding['runId'],)).fetchone()
            if prior and (prior['binding'] != payload or prior['credential_digest'] != credential_digest or not prior['active']):
                raise Collision('immutable link conflict')
            self.db.execute('INSERT OR IGNORE INTO links VALUES(?,?,?,1)',
                            (binding['runId'], payload, credential_digest))
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def revoke(self, run_id, *, operator_authorized=False):
        if operator_authorized is not True:
            raise Denied('operator authorization required')
        self.db.execute('UPDATE links SET active=0 WHERE run_id=?', (run_id,))

    def _owned(self, binding, authorization=None):
        payload = binding_json(binding)
        row = self.db.execute('SELECT * FROM links WHERE run_id=?', (binding['runId'],)).fetchone()
        if not row or not row['active'] or row['binding'] != payload:
            raise Denied('origin unavailable')
        if authorization is not None:
            if not isinstance(authorization, str) or not authorization.startswith('Bearer ') or len(authorization) > 8192:
                raise Denied('relay authorization rejected')
            token = authorization[7:]
            digest = hashlib.sha256(token.encode()).hexdigest()
            if not token or not hmac.compare_digest(digest, row['credential_digest']):
                raise Denied('relay authorization rejected')

    def _event_owned(self, event, binding, authorization):
        payload = identity(event)
        if not isinstance(authorization, str) or not authorization.startswith('Bearer '):
            raise Denied('relay authorization rejected')
        self._owned(binding, authorization)
        if any(event[k] != binding[k] for k in ('runId', 'hermesSessionId', 'sessionId')):
            raise Denied('origin unavailable')
        return payload

    def receive(self, event, authorization, current_binding):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            payload = self._event_owned(event, current_binding, authorization)
            digest = hashlib.sha256(payload.encode()).hexdigest()
            old = self.db.execute('SELECT payload FROM inbox WHERE event_id=?', (event['eventId'],)).fetchone()
            if old and old['payload'] != payload:
                raise Collision('event identity conflict')
            self.db.execute("INSERT OR IGNORE INTO inbox(event_id,run_id,payload,identity_hash,turn_id,state) VALUES(?,?,?,?,?,'accepted')",
                            (event['eventId'], event['runId'], payload, digest, 'rhythm_' + digest))
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise
        return self.status(event, authorization, current_binding)

    def status(self, event, authorization, current_binding):
        payload = self._event_owned(event, current_binding, authorization)
        row = self.db.execute('SELECT * FROM inbox WHERE event_id=?', (event['eventId'],)).fetchone()
        if not row:
            raise Denied('event unavailable')
        if row['payload'] != payload:
            raise Collision('event identity conflict')
        receipt = dict(version=2, eventId=event['eventId'], runId=event['runId'],
                       hermesSessionId=event['hermesSessionId'], state=row['state'])
        return receipt

    def claim(self, current_binding, *, now=None):
        now = time.time() if now is None else now
        self.db.execute('BEGIN IMMEDIATE')
        try:
            self._owned(current_binding)
            row = self.db.execute("SELECT * FROM inbox WHERE run_id=? AND state='accepted' ORDER BY rowid LIMIT 1",
                                  (current_binding['runId'],)).fetchone()
            if row is None:
                self.db.commit()
                return None
            lease = secrets.token_hex(16)
            self.db.execute("UPDATE inbox SET state='launching',lease=?,lease_until=? WHERE event_id=?",
                            (lease, now + 60, row['event_id']))
            self.db.commit()
            return dict(event=json.loads(row['payload']), identityHash=row['identity_hash'],
                        turnIdentity=row['turn_id'], lease=lease)
        except BaseException:
            self.db.rollback()
            raise

    def busy(self, event_id, lease):
        # Only explicit native 409 BEFORE launch; exceptions/timeout remain ambiguous.
        self.db.execute("UPDATE inbox SET state='accepted',lease=NULL,lease_until=NULL WHERE event_id=? AND state='launching' AND lease=?",
                        (event_id, lease))

    def drain(self, native):
        """native is trusted in-process wiring, never request-supplied evidence.

        observe must read persisted native correlation journal AND saved/render
        proof. Unknown launch outcomes stay quarantined indefinitely. No expired
        lease, HTTP200 or in-memory journal can authorize a second launch.
        """
        for link in self.db.execute('SELECT binding FROM links WHERE active=1').fetchall():
            registered = json.loads(link['binding'])
            try:
                current = native.current_binding(registered['runId'])
                self._owned(current)
            except Denied:
                # A retired/foreign link stays quarantined, not a global drain veto.
                continue
            # A link may change after selection; start_once must recheck under the
            # native session/profile lock, and fence revoked/old-session work.
            intent = self.claim(current)
            if intent:
                result = native.start_once(intent, current)
                if result == 'busy':
                    self.busy(intent['event']['eventId'], intent['lease'])
            for row in self.db.execute("SELECT * FROM inbox WHERE run_id=? AND state IN ('launching','started','completed')",
                                       (current['runId'],)).fetchall():
                current = native.current_binding(current['runId'])
                self._owned(current)
                proof = native.observe(row['turn_id'])
                if not isinstance(proof, dict) or any(proof.get(k) != v for k, v in {
                        'turnIdentity': row['turn_id'], 'eventId': row['event_id'],
                        'identityHash': row['identity_hash'],
                        'hermesSessionId': current['hermesSessionId']}.items()):
                    continue
                if proof.get('state') not in ('started', 'completed'):
                    continue
                state = proof['state']
                # Saved/render observations must name the SAME native message and
                # completed turn. Production integration must verify these server-side.
                saved, rendered = proof.get('saved'), proof.get('rendered')
                if (proof['state'] == 'completed' and isinstance(saved, dict) and
                        saved == rendered and set(saved) == {'messageId', 'identityHash', 'turnIdentity'} and
                        isinstance(saved['messageId'], str) and saved['messageId'] and
                        saved['identityHash'] == row['identity_hash'] and saved['turnIdentity'] == row['turn_id']):
                    state = 'visible'
                self.db.execute('BEGIN IMMEDIATE')
                try:
                    self._owned(native.current_binding(current['runId']))
                    self.db.execute("UPDATE inbox SET state=?,proof=? WHERE event_id=? AND state!='visible'",
                                    (state, encoded(proof), row['event_id']))
                    self.db.commit()
                except BaseException:
                    self.db.rollback()
                    raise


class Capability:
    """Registered native handler target + owned startup/shutdown worker; no listener.

    The source patch must explicitly register handle in the EXISTING WebUI server.
    It is NOT WebUI-wide bearer authentication and exposes no link/provider/action API.
    """
    RECEIVE = '/api/rhythm-notify/receive'
    STATUS = '/api/rhythm-notify/status'

    def __init__(self, path, native):
        self.path, self.native = path, native
        self.stop = threading.Event()
        self.worker = None

    def handle(self, method, path, headers, body):
        if method != 'POST' or path not in (self.RECEIVE, self.STATUS):
            return 404, {'error': 'not_found'}
        # Relay is nonbrowser-only; browser paths retain existing auth+CSRF policy.
        if any(k.lower() in ('origin', 'cookie') for k in headers):
            return 403, {'error': 'relay_only'}
        if not isinstance(body, bytes) or len(body) > 8192:
            return 400, {'error': 'invalid_event'}
        store = Receiver(self.path)
        try:
            event = json.loads(body)
            identity(event)
            auth = next((v for k, v in headers.items() if k.lower() == 'authorization'), '')
            current = self.native.current_binding(event['runId'])
            action = store.receive if path == self.RECEIVE else store.status
            return 200, action(event, auth, current)
        except Denied:
            return 404, {'error': 'unavailable'}
        except Collision:
            return 409, {'error': 'identity_conflict'}
        except (ValueError, TypeError):
            return 400, {'error': 'invalid_event'}
        finally:
            store.close()

    def startup(self):
        if self.worker is not None:
            raise RuntimeError('receiver already started')
        self.stop.clear()
        self.worker = threading.Thread(target=self._drain, name='rhythm-notify-drain', daemon=True)
        self.worker.start()

    def _drain(self):
        store = Receiver(self.path)
        try:
            while not self.stop.is_set():
                try:
                    store.drain(self.native)
                except (ValueError, OSError, sqlite3.Error):
                    # No event, credentials, provider strings or native exceptions logged.
                    pass
                self.stop.wait(1)
        finally:
            store.close()

    def shutdown(self):
        self.stop.set()
        if self.worker is not None:
            self.worker.join(timeout=30)
            if self.worker.is_alive():
                raise RuntimeError('native drain did not stop; restart safety gate failed')
            self.worker = None
