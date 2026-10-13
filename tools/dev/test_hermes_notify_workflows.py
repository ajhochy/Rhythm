"""Multiworkflow inbox/label checks. Fixture sink is not native Hermes."""
import unittest
from hermes_notify_subscriber import Inbox, validate
from test_hermes_notify_subscriber import Contract, event

class WorkflowContract(Contract):
    def test_three_busy_workflows_survive_reopen_and_deduplicate_independently(self):
        names = ['encompass-security-map','rhythm-notify-approval','opus-encompass-review']
        self.adapter.busy = True
        for i,name in enumerate(names,1):
            notification={**event(),'eventId':name,'cursor':i,'hermesSessionId':f'hermes-{name}',
                'workflowId':f'run-{name}','kind':'progress','text':'Rhythm workflow running: 0 settled, 1 awaiting.'}
            self.inbox.accept(notification)
        self.inbox.drain(self.adapter,self.ack)
        self.assertEqual(self.count(),0)
        self.inbox.db.close(); self.inbox=Inbox(self.path/'inbox.db')
        self.adapter.busy=False
        self.inbox.drain(self.adapter,self.ack); self.inbox.drain(self.adapter,self.ack)
        self.assertEqual(self.count(),3)
        self.assertEqual({r[0] for r in self.adapter.db.execute('SELECT session_id FROM transcript')},
            {f'hermes-{name}' for name in names})

    def test_workflow_labels_cannot_forge_terminal_or_instruction(self):
        for changes in [{'kind':'completion','text':'Rhythm workflow succeeded: 1 settled, 1 awaiting.'},
            {'kind':'completion','text':'Rhythm workflow succeeded: 0 settled, 0 awaiting.'},
            {'kind':'completion','text':'Rhythm workflow running: 1 settled, 0 awaiting.'},
            {'kind':'progress','text':'Rhythm workflow execute-tools: 1 settled, 0 awaiting.'}]:
            with self.assertRaises(ValueError): validate({**event(),**changes})

if __name__=='__main__': unittest.main()
