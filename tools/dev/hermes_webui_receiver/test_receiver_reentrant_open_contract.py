"""Focused real-SQLite trace of native authority recheck during drain commit."""
import tempfile
import unittest
from pathlib import Path
from hermes_webui_receiver.receiver import Receiver


class ReentrantOpenContract(unittest.TestCase):
    def test_current_receiver_open_during_native_write_transaction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'receiver.db'
            writer = Receiver(path)
            try:
                self.assertEqual(writer.db.execute('PRAGMA user_version').fetchone()[0],2)
                writer.db.execute('BEGIN IMMEDIATE')
                # drain -> native.current_binding -> Receiver(path), actual database.
                reader = Receiver(path)
                reader.close()
            finally:
                writer.db.rollback()
                writer.close()
