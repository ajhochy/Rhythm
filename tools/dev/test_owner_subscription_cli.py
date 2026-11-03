import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from test_provision_contract import implementation

class OwnerAttach(unittest.TestCase):
    def test_dry_run_never_requires_runtime_capability(self):
        p = implementation()
        with tempfile.TemporaryDirectory(dir='/private/tmp', prefix='owner-attach-') as directory:
            root = Path(directory); state = root / 'state'; state.mkdir(mode=0o700)
            token = root / 'owner'; token.write_text('synthetic-not-secret'); token.chmod(0o600)
            manifest = root / 'approval.json'
            p.atomic_json(manifest, dict(version=2,fixtureOnly=True,executionMode='operator-fixture',fixtureRoot=str(root),
                stateDir=str(state),tokenFile=str(token),nativeSource=str(root),nativeEndpoint='http://127.0.0.1:8787',
                apiEndpoint='http://127.0.0.1:4001',owner='1',profile='default',sourceKind='agent_session',sourceId='actual-source',
                nativeHashes={},nativeCookieFile=None,nativeCsrfFile=None))
            command=[sys.executable,'-B',str(Path(__file__).with_name('hermes_fixture_provision.py')),
                '--attach-existing-owned-source','--allow-private-relay','--api','http://127.0.0.1:4001',
                '--token-file',str(token),'--state-dir',str(state),'--native-source',str(root),
                '--native-endpoint','http://127.0.0.1:8787','--approved-fixture-manifest',str(manifest)]
            result=subprocess.run(command,capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(json.loads(result.stdout)['mode'],'DRY_RUN')
            self.assertNotIn('synthetic-not-secret',result.stdout+result.stderr)
            self.assertEqual(list(state.iterdir()),[])
            manifest_value=json.loads(manifest.read_text());manifest_value['callbackUrl']='http://127.0.0.1:1'
            p.atomic_json(manifest,manifest_value)
            denied=subprocess.run(command,capture_output=True,text=True,timeout=10)
            self.assertNotEqual(denied.returncode,0)

if __name__=='__main__':unittest.main()
