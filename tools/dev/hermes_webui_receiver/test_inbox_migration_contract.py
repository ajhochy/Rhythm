"""Frozen scratch-only legacy CHECK contract; never opens a user chat database."""
import concurrent.futures
import sqlite3
import tempfile
import unittest
from pathlib import Path
from hermes_webui_receiver.receiver import Receiver

OLD = """
CREATE TABLE links(
 run_id TEXT PRIMARY KEY, binding TEXT NOT NULL, credential_digest TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)));
CREATE TABLE inbox(
 event_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES links(run_id),
 payload TEXT NOT NULL, identity_hash TEXT NOT NULL, turn_id TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('accepted','launching','started','visible')),
 lease TEXT, lease_until REAL, proof TEXT);
CREATE TABLE render_proofs(
 event_id TEXT PRIMARY KEY, metadata TEXT NOT NULL, received INTEGER NOT NULL DEFAULT 0);
CREATE TABLE metadata(key TEXT PRIMARY KEY, value BLOB);
"""


def seed(path):
    with sqlite3.connect(path) as db:
        db.executescript(OLD)
        db.execute('INSERT INTO links VALUES(?,?,?,0)', ('run', ' immutable bytes ', 'a'*64))
        for i, state in enumerate(('accepted', 'launching', 'started', 'visible')):
            db.execute('INSERT INTO inbox VALUES(?,?,?,?,?,?,?,?,?)',
                       (str(i), 'run', ' full payload bytes ', 'b'*64, 'turn'+str(i),
                        state, 'lease', 123.5, ' receipt bytes '))
        db.execute('INSERT INTO render_proofs VALUES(?,?,1)', ('3', ' nonce bytes '))
        db.execute('INSERT INTO metadata VALUES(?,?)', ('ack-tombstone', b'\x00\xff'))


def snapshot(path):
    with sqlite3.connect(path) as db:
        return {name: db.execute('SELECT rowid,* FROM '+name).fetchall()
                for name in ('links', 'inbox', 'render_proofs', 'metadata')}


class MigrationContract(unittest.TestCase):
    def test_old_check_full_bytes_reopen_completed_no_false_visible(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            seed(path)
            before = snapshot(path)
            with sqlite3.connect(path) as db:
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute("UPDATE inbox SET state='completed' WHERE event_id='2'")
            store = Receiver(path)
            store.close()
            self.assertEqual(snapshot(path), before)
            store = Receiver(path)
            self.assertEqual(snapshot(path), before)
            self.assertEqual(store.db.execute('PRAGMA user_version').fetchone()[0], 2)
            store.db.execute("UPDATE inbox SET state='completed' WHERE event_id='2'")
            self.assertEqual(store.db.execute("SELECT state FROM inbox WHERE event_id='2'").fetchone()[0], 'completed')
            with self.assertRaises(sqlite3.IntegrityError):
                store.db.execute("UPDATE inbox SET state='unknown' WHERE event_id='2'")
            store.close()

    def test_concurrent_open_and_empty_version_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            seed(path)
            before = snapshot(path)
            def opening(_):
                store = Receiver(path)
                version = store.db.execute('PRAGMA user_version').fetchone()[0]
                store.close()
                return version
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                self.assertEqual(list(pool.map(opening, range(4))), [2]*4)
            self.assertEqual(snapshot(path), before)
            empty = Path(directory)/'empty.db'
            for _ in range(2):
                store = Receiver(empty)
                self.assertEqual(store.db.execute('PRAGMA user_version').fetchone()[0], 2)
                self.assertEqual(store.db.execute('SELECT count(*) FROM inbox').fetchone()[0], 0)
                store.close()

    def test_read_only_and_unknown_fail_without_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            seed(path)
            before = snapshot(path)
            with self.assertRaises(sqlite3.Error):
                Receiver(path.as_uri()+'?mode=ro')
            self.assertEqual(snapshot(path), before)
            with sqlite3.connect(path) as db:
                self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0], 0)
                db.execute('ALTER TABLE inbox ADD COLUMN uncertain TEXT')
            bytes_before = path.read_bytes()
            with self.assertRaises((ValueError, sqlite3.Error)):
                Receiver(path)
            self.assertEqual(path.read_bytes(), bytes_before)


if __name__ == '__main__':
    unittest.main()
