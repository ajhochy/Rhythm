"""Offline native SessionDB storage contract, never installed-source imports.

Run inside the owned Rhythm sandbox with --source pointing to an identified
Hermes tracked-source checkout. Copies ONLY tracked Python source (no .env/.git).
--baseline demonstrates stock Hermes's missing atomic event receipt.
This tests storage, NOT wakeup, deployed WebUI rendering or private transport.
"""
import argparse
import importlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    home = Path(os.environ['HOME'])
    assert home == Path('/private/tmp/hermes-event-notify-20261012-sandbox/home')
    assert os.environ.get('HERMES_HOME') == str(home / 'native-fixture')
    source = Path(args.source)
    revision = subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
    files = subprocess.check_output(['git','ls-files','*.py'],cwd=source,text=True).splitlines()
    archive = subprocess.check_output(['git','archive','HEAD','--',*files],cwd=source)
    with tempfile.TemporaryDirectory(dir=home, prefix='native-source-') as tmp:
        root = Path(tmp)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for entry in tar:
                path = Path(entry.name)
                if entry.isfile() and path.suffix == '.py' and not path.is_absolute() and '..' not in path.parts:
                    target = root / path
                    target.parent.mkdir(parents=True,exist_ok=True)
                    target.write_bytes(tar.extractfile(entry).read())
        sys.path.insert(0,str(root))
        native = importlib.import_module('hermes_state')
        assert Path(native.__file__).parent == root
        store = native.SessionDB(home / 'native-fixture' / 'synthetic-state.db')
        try:
            store.create_session('hermes-fixture', source='cli')
            event = {'version':1,'eventId':'event-native-fixture','cursor':1,'sessionId':'rhythm-fixture',
                'hermesSessionId':'hermes-fixture','workflowId':'workflow-fixture','kind':'progress',
                'text':'Rhythm session updated.','referenceId':None,'state':'pending'}
            if args.baseline:
                for _ in range(2):
                    store.append_message('hermes-fixture','assistant',event['text'],platform_message_id=event['eventId'])
            else:
                from hermes_native_receipt import NativeReceiptAdapter
                binding = (event['sessionId'],event['hermesSessionId'],event['workflowId'])
                adapter = NativeReceiptAdapter(store,{binding})
                receipt = adapter.deliver(event)
                assert receipt == adapter.deliver(event)
                assert receipt == {'version':1,'eventId':event['eventId'],'hermesSessionId':'hermes-fixture','state':'visible'}
            messages = store.get_messages('hermes-fixture', include_inactive=True)
            assert len(messages) == 1, f'event replay produced {len(messages)} native transcript effects, expected 1'
            if not args.baseline:
                assert messages[0]['content'] == event['text']
                # Presentation-only row must not modify the provider replay/cache.
                assert store.get_messages('hermes-fixture') == []
                changed = {**event,'workflowId':'foreign'}
                assert adapter.owns(changed) is False
                try: adapter.deliver(changed)
                except ValueError: pass
                else: raise AssertionError('foreign origin accepted')
                adapter.bindings.clear()
                try: adapter.deliver(event)
                except ValueError: pass
                else: raise AssertionError('revoked origin recovered receipt')
            print(f'PASS native SessionDB atomic storage/replay, source={revision}; wake/render NOTRUN')
        finally:
            store.close()

if __name__ == '__main__':
    main()
