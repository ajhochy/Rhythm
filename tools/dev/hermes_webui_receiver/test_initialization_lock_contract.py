"""Current schema reads and real native drain/metadata/receipt lock regression."""
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from hermes_webui_receiver.receiver import Receiver
from hermes_webui_receiver.test_native_wakeup import fixture
from hermes_webui_receiver.test_visible_receipts import VisibleReceipts


def schema(path):
    with sqlite3.connect(path) as db:
        return (db.execute('PRAGMA user_version').fetchone(),
                db.execute('PRAGMA schema_version').fetchone(),
                db.execute('SELECT * FROM sqlite_master ORDER BY name').fetchall())


class InitializationLockContract(unittest.TestCase):
    def test_current_read_only_open_under_writer_without_schema_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            writer = Receiver(path)
            before = schema(path)
            try:
                writer.db.execute('BEGIN IMMEDIATE')
                reader = Receiver(path.as_uri()+'?mode=ro')
                try:
                    self.assertEqual(reader.db.execute('SELECT count(*) FROM links').fetchone()[0], 0)
                    self.assertFalse(reader.db.in_transaction)
                finally:
                    reader.close()
                self.assertEqual(schema(path), before)
            finally:
                writer.db.rollback()
                writer.close()

    def test_invalid_current_schema_and_dependencies_rejected_without_writes(self):
        changes = ["ALTER TABLE inbox ADD COLUMN unexpected TEXT",
                   "DROP TABLE render_proofs",
                   "CREATE INDEX unknown_dependency ON inbox(state)",
                   "CREATE TABLE foreign_child(id TEXT REFERENCES inbox(event_id))",
                   "DROP TABLE inbox; CREATE TABLE inbox(event_id TEXT PRIMARY KEY)"]
        for change in changes:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                path = Path(directory)/'receiver.db'
                Receiver(path).close()
                with sqlite3.connect(path) as db:
                    db.executescript(change)
                before = schema(path)
                with self.assertRaises(ValueError):
                    Receiver(path)
                self.assertEqual(schema(path), before)

    def test_actual_native_drain_metadata_receipt_reentrant_no_schema_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with fixture(home) as server:
                path = home/'state/rhythm-notify.sqlite'
                before = schema(path)
                self.assertEqual(server.post()[0], 200)
                server.wait_reply()
                deadline = time.monotonic()+5
                while server.post(path='status')[1]['state'] != 'completed':
                    self.assertLess(time.monotonic(), deadline, server.logs())
                    time.sleep(.05)
                request = VisibleReceipts().request
                code, result = request(server, 'render-metadata?hermesSessionId=fixture-chat')
                self.assertEqual(code, 200)
                self.assertEqual(len(result['events']), 1)
                code, receipt = request(server, 'render-receipt', result['events'][0])
                self.assertEqual(code, 200)
                self.assertEqual(receipt['state'], 'visible')
                self.assertEqual(server.post(path='status')[1], receipt)
                self.assertEqual(schema(path), before)
                self.assertEqual(len(server.calls()), 1)
