"""Actual SQLite interruption/rollback and sparse ordering preservation."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from hermes_webui_receiver.receiver import Receiver
from hermes_webui_receiver.test_inbox_migration_contract import seed, snapshot


class MigrationInterrupt(unittest.TestCase):
    def test_sqlite_denied_drop_rolls_back_complete_copy_and_version(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            seed(path)
            before = snapshot(path)
            store = Receiver.__new__(Receiver)
            store.db = sqlite3.connect(path, isolation_level=None)
            store.db.row_factory = sqlite3.Row
            # SQLite itself rejects DDL after the data copy; no SUT mock.
            store.db.set_authorizer(lambda action, *args: sqlite3.SQLITE_DENY
                                    if action == sqlite3.SQLITE_DROP_TABLE else sqlite3.SQLITE_OK)
            with self.assertRaises(sqlite3.DatabaseError):
                store._migrate()
            store.close()
            self.assertEqual(snapshot(path), before)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 0)
                self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='inbox_migrating'").fetchone())
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute("UPDATE inbox SET state='completed' WHERE event_id='2'")
            Receiver(path).close()
            self.assertEqual(snapshot(path), before)

    def test_sparse_rowids_and_unknown_version_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            seed(path)
            with sqlite3.connect(path) as db:
                db.execute('UPDATE inbox SET rowid=99 WHERE event_id=\'2\'')
            before = snapshot(path)
            Receiver(path).close()
            self.assertEqual(snapshot(path), before)
            with sqlite3.connect(path) as db:
                db.execute('PRAGMA user_version=999')
            with self.assertRaises(ValueError):
                Receiver(path)
            self.assertEqual(snapshot(path), before)
