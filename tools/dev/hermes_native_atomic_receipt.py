"""Source artifact: atomic native transcript receipt, NOT a wake/visible adapter.

Call only within an authenticated Hermes owner's runtime, after proving the
origin tuple. Requires a version-qualified SessionDB. Opens no DB or listener
on import; does not load installed Hermes/config. No provider/tool invocation.
"""
from contextvars import ContextVar
import hashlib
import json

from hermes_notify_subscriber import validate

def receipt_session_db(native_session_db):
    """Extend the native transaction boundary, not a parallel transcript store."""
    class ReceiptSessionDB(native_session_db):
        _notification = ContextVar('rhythm_notification', default=None)

        def initialize_notification_receipts(self):
            self._execute_write(lambda conn: conn.execute('''CREATE TABLE IF NOT EXISTS rhythm_notification_receipts(
                event_id TEXT PRIMARY KEY, digest TEXT NOT NULL, session_id TEXT NOT NULL,
                message_id INTEGER NOT NULL REFERENCES messages(id))'''))

        def persist_notification(self, event, owned_bindings):
            validate(event)
            identity = tuple(event[k] for k in ('sessionId','hermesSessionId','workflowId'))
            # Caller supplies the current locally authenticated binding inventory;
            # no remote identifier grants authority, even when recovering a receipt.
            if identity not in owned_bindings:
                raise ValueError('origin not locally owned')
            digest = hashlib.sha256(json.dumps({k:v for k,v in event.items() if k != 'state'},sort_keys=True).encode()).hexdigest()
            token = self._notification.set((event,digest,owned_bindings,identity))
            try:
                message_id = self.append_message(event['hermesSessionId'],'assistant',event['text'])
            finally:
                self._notification.reset(token)
            # Persistence is not wakeup, renderer visibility, or a subscriber visible ACK.
            return {'version':1,'eventId':event['eventId'],'hermesSessionId':event['hermesSessionId'],
                'messageId':message_id,'state':'persisted'}

        def _execute_write(self, fn, patience_s=None):
            notification = self._notification.get()
            if notification is None:
                return super()._execute_write(fn,patience_s=patience_s)
            event,digest,bindings,identity = notification
            def atomic(conn):
                if identity not in bindings:
                    raise ValueError('origin revoked')
                previous = conn.execute('SELECT digest,session_id,message_id FROM rhythm_notification_receipts WHERE event_id=?',
                    (event['eventId'],)).fetchone()
                if previous:
                    if previous['digest'] != digest or previous['session_id'] != event['hermesSessionId']:
                        raise ValueError('event identity changed')
                    row = conn.execute('SELECT session_id,content FROM messages WHERE id=?',(previous['message_id'],)).fetchone()
                    if not row or row['session_id'] != event['hermesSessionId'] or row['content'] != event['text']:
                        raise ValueError('native receipt no longer matches transcript')
                    return previous['message_id']
                # Preserve native turn/compression/closed-session admission; no busy steering.
                self._check_transcript_write_guards(conn,event['hermesSessionId'],None,reject_active_turn_lease=True,
                    reject_active_compression_lock=True)
                session = conn.execute('SELECT ended_at,archived FROM sessions WHERE id=?',(event['hermesSessionId'],)).fetchone()
                if not session or session['ended_at'] is not None or session['archived']:
                    raise ValueError('native session unavailable')
                message_id = fn(conn)  # Actual native append closure + counters + FTS triggers.
                conn.execute('INSERT INTO rhythm_notification_receipts VALUES (?,?,?,?)',
                    (event['eventId'],digest,event['hermesSessionId'],message_id))
                return message_id
            return super()._execute_write(atomic,patience_s=patience_s)
    return ReceiptSessionDB
