"""V2 contract only; no native Hermes adapter or visibility claim."""
import tempfile
import unittest
from pathlib import Path
from hermes_notify_subscriber import Inbox, validate
from test_hermes_notify_subscriber import event

class RunOriginContract(unittest.TestCase):
    def test_run_schema_and_retained_inbox_identity(self):
        notification={**event(), 'version':2, 'runId':'run', 'workflowId':'run'}
        self.assertEqual(validate(notification),notification)
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'inbox.db'
            inbox=Inbox(path); inbox.accept(notification); inbox.db.close()
            inbox=Inbox(path); inbox.accept({**notification,'state':'accepted'})
            self.assertEqual(inbox.db.execute('SELECT COUNT(*) FROM inbox').fetchone()[0],1)
            with self.assertRaises(ValueError): inbox.accept({**notification,'runId':'different','workflowId':'different'})
            inbox.db.close()

    def test_v2_run_identity_cannot_alias_opaque_workflow_or_drop_version(self):
        for changes in [{'runId':'foreign'},{'runId':None},{'version':1},{'runId':'../../run'},{'extra':'authority'}]:
            with self.assertRaises(ValueError): validate({**event(),'version':2,'runId':'run','workflowId':'run',**changes})

if __name__=='__main__': unittest.main()
