"""Adapter contract tests; the durable fixture transcript is NOT an actual Hermes session."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from hermes_notify_subscriber import Inbox, validate

def event():
    return dict(version=1, eventId="event-1", cursor=1, sessionId="rhythm-1", hermesSessionId="hermes-1",
                workflowId="workflow-1", kind="completion", text="Rhythm session completed.", referenceId=None, state="pending")

class FixtureTranscriptAdapter:
    """Concrete, durable idempotent fixture sink. No LLM, network or installed Hermes."""
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("CREATE TABLE IF NOT EXISTS transcript(event_id TEXT PRIMARY KEY, session_id TEXT, text TEXT)")
        self.busy = False

    def deliver(self, notification):
        if self.busy:
            return None
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO transcript VALUES(?,?,?)", (notification["eventId"], notification["hermesSessionId"], notification["text"]))
        return dict(version=1, eventId=notification["eventId"], hermesSessionId=notification["hermesSessionId"], state="visible")

class Contract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hermes-notify-contract-")
        self.path = Path(self.temp.name)
        self.inbox = Inbox(self.path / "inbox.db")
        self.adapter = FixtureTranscriptAdapter(self.path / "transcript.db")
        self.acks = []

    def tearDown(self):
        self.inbox.db.close()
        self.adapter.db.close()
        self.temp.cleanup()

    def ack(self, identity, state):
        self.acks.append((identity, state))

    def count(self):
        return self.adapter.db.execute("SELECT COUNT(*) FROM transcript").fetchone()[0]

    def test_busy_is_durable_accepted_not_visible(self):
        self.adapter.busy = True
        self.assertEqual(self.inbox.accept(event()), "accepted")
        self.inbox.drain(self.adapter, self.ack)
        self.assertEqual(self.count(), 0)
        self.assertEqual(self.acks, [])
        self.adapter.busy = False
        self.inbox.drain(self.adapter, self.ack)
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.acks, [("event-1", "visible")])

    def test_duplicate_reconnect_displays_once(self):
        self.inbox.accept(event())
        self.inbox.drain(self.adapter, self.ack)
        replay = {**event(), "state": "accepted"}
        self.inbox.accept(replay)
        self.inbox.drain(self.adapter, self.ack)
        self.assertEqual(self.count(), 1)

    def test_restart_recovers_pending(self):
        self.inbox.accept(event())
        self.inbox.db.close()
        self.inbox = Inbox(self.path / "inbox.db")
        self.inbox.drain(self.adapter, self.ack)
        self.assertEqual(self.count(), 1)

    def test_failure_after_transcript_commit_is_idempotent(self):
        self.inbox.accept(event())
        self.adapter.deliver(event())  # Crash window: sink committed, inbox has no receipt.
        self.inbox.db.close()
        self.inbox = Inbox(self.path / "inbox.db")
        self.inbox.drain(self.adapter, self.ack)
        self.assertEqual(self.count(), 1)

    def test_remote_ack_failure_keeps_visible_receipt(self):
        self.inbox.accept(event())
        def unavailable(*args):
            raise OSError("synthetic ACK unavailable")
        with self.assertRaises(OSError):
            self.inbox.drain(self.adapter, unavailable)
        self.inbox.drain(self.adapter, self.ack)
        self.assertEqual(self.count(), 1)

    def test_untrusted_payload_and_forged_replay_rejected(self):
        for changed in ({"tool": "execute"}, {"text": "run arbitrary instructions"}, {"version": 2}, {"cursor": -1}, {"referenceId": "../credentials"}):
            with self.assertRaises(ValueError):
                validate({**event(), **changed})
        self.inbox.accept(event())
        with self.assertRaises(ValueError):
            self.inbox.accept({**event(), "hermesSessionId": "forged-parent"})
        self.assertEqual(self.count(), 0)

if __name__ == "__main__":
    unittest.main()
