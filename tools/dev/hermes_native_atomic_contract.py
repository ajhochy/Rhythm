"""Run with the same isolated environment as hermes_native_receipt_contract.py."""
import importlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from hermes_native_atomic_receipt import receipt_session_db

home = Path(os.environ['HOME'])
assert home == Path('/private/tmp/hermes-event-notify-20261012-sandbox/home')
assert os.environ['HERMES_HOME'] == str(home / 'native-fixture')
source = sys.argv[1]
files = subprocess.check_output(['git','ls-files','*.py'],cwd=source,text=True).splitlines()
archive = subprocess.check_output(['git','archive','HEAD','--',*files],cwd=source)
with tempfile.TemporaryDirectory(dir=home,prefix='atomic-native-source-') as tmp:
    root = Path(tmp)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for entry in tar:
            p = Path(entry.name)
            if entry.isfile() and p.suffix == '.py' and not p.is_absolute() and '..' not in p.parts:
                dest = root / p; dest.parent.mkdir(parents=True,exist_ok=True)
                dest.write_bytes(tar.extractfile(entry).read())
    sys.path.insert(0,str(root))
    native = importlib.import_module('hermes_state')
    assert Path(native.__file__).parent == root
    cls = receipt_session_db(native.SessionDB)
    path = home / 'native-fixture' / 'atomic-synthetic.db'
    store = cls(path); store.initialize_notification_receipts()
    store.create_session('atomic-parent',source='cli')
    event = {'version':1,'eventId':'atomic-event','cursor':1,'sessionId':'fixture-rhythm',
        'hermesSessionId':'atomic-parent','workflowId':'fixture-run','kind':'progress',
        'text':'Rhythm session updated.','referenceId':None,'state':'pending'}
    bindings = {('fixture-rhythm','atomic-parent','fixture-run')}
    first = store.persist_notification(event,bindings)
    assert first['state'] == 'persisted' and first == store.persist_notification(event,bindings)
    store.close(); store = cls(path); store.initialize_notification_receipts()
    assert first == store.persist_notification({**event,'state':'accepted'},bindings)
    assert len(store.get_messages('atomic-parent')) == 1
    assert store.try_acquire_session_turn_lease('atomic-parent','fixture-native-busy',ttl_seconds=60)
    try: store.persist_notification({**event,'eventId':'atomic-busy','cursor':3},bindings)
    except native.SessionTurnLeaseLostError: pass
    else: raise AssertionError('busy native session was modified')
    assert len(store.get_messages('atomic-parent')) == 1
    store.release_session_turn_lease('atomic-parent','fixture-native-busy')
    try: store.persist_notification({**event,'cursor':2},bindings)
    except ValueError: pass
    else: raise AssertionError('changed identity replay accepted')
    try: store.persist_notification(event,set())
    except ValueError: pass
    else: raise AssertionError('revoked origin accepted')
    # Real SQLite abort after native insertion must roll back transcript and counters.
    store._execute_write(lambda conn: conn.execute("CREATE TRIGGER reject_fixture_receipt BEFORE INSERT ON rhythm_notification_receipts BEGIN SELECT RAISE(ABORT,'fixture crash'); END"))
    try: store.persist_notification({**event,'eventId':'atomic-abort','cursor':2},bindings)
    except Exception as error:
        assert 'fixture crash' in str(error)
    else: raise AssertionError('fixture abort did not propagate')
    assert len(store.get_messages('atomic-parent')) == 1
    store._execute_write(lambda conn: conn.execute('DROP TRIGGER reject_fixture_receipt'))
    store.persist_notification({**event,'eventId':'atomic-abort','cursor':2},bindings)
    assert len(store.get_messages('atomic-parent')) == 2
    store.close()
    print('PASS: actual native append closure + atomic receipt/reopen/digest/revocation/rollback; persisted NOT wake/visible ACK')
