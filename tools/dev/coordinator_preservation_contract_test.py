"""Safe preservation contracts only; no sockets, moves, real APIs or deleting suites."""
import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_HELPER = ROOT / 'apps/api_server/src/__tests__/helpers/preserved_fixture.cjs'
RECOVERY_HELPER = ROOT / 'tools/dev/sandbox_api_recovery.py'


class PreservationContract(unittest.TestCase):
    def test_retention_publication_next_read(self):
        # Bug: teardown deletes a fixture or overwrites its first retained receipt.
        self.assertTrue(FIXTURE_HELPER.is_file(), 'explicit preserving fixture lifecycle is missing')
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-retention-contract-', dir='/private/tmp'))
        env = {'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
               'NODE_ENV': 'test', 'RHYTHM_TEST_PRESERVE_FIXTURES': '1', 'RHYTHM_TEST_FIXTURE_ROOT': str(parent)}
        code = '''const fs=require('node:fs'),path=require('node:path'),h=require(process.argv[1]);
const root=process.env.RHYTHM_TEST_FIXTURE_ROOT,fixture=path.join(root,'owned');fs.mkdirSync(fixture,{mode:0o700});
fs.writeFileSync(path.join(fixture,'kept'),'synthetic retained bytes',{flag:'wx'});
h.finishFixture(fixture,()=>{throw Error('deletion callback reached')});
if(fs.readFileSync(path.join(fixture,'kept'),'utf8')!=='synthetic retained bytes')throw Error('fixture lost');
const receipt=JSON.parse(fs.readFileSync(path.join(fixture,'.retained-fixture.json'),'utf8'));
if(receipt.path!==fixture||receipt.preserved!==true)throw Error('wrong retained owner');
const before=fs.readFileSync(path.join(fixture,'.retained-fixture.json'));
let refused=false;try{h.finishFixture(fixture,()=>{});}catch{refused=true;}
if(!refused||!fs.readFileSync(path.join(fixture,'.retained-fixture.json')).equals(before))throw Error('receipt replaced');
'''
        result = subprocess.run(['/opt/homebrew/bin/node', '-e', code, str(FIXTURE_HELPER)], env=env,
                                cwd=ROOT, capture_output=True)
        (parent / 'check.stderr').write_bytes(result.stderr)
        self.assertEqual(result.returncode, 0, 'real retained fixture consumer failed; local stderr retained')

    def test_finite_port_validation_without_listener(self):
        # Bug: preservation opt-in silently uses port0/live/runtime ports or fallback.
        self.assertTrue(FIXTURE_HELPER.is_file(), 'finite test-only port selector is missing')
        code = '''const h=require(process.argv[1]);
if(h.testServerPort({})!==0)throw Error('default changed');
if(h.testServerPort({NODE_ENV:'test',RHYTHM_TEST_SERVER_PORT:'4796'})!==4796)throw Error('opt-in lost');
for(const p of ['0','4001','4002','4096','4797','4798','4799','04796','4796x']){
let refused=false;try{h.testServerPort({NODE_ENV:'test',RHYTHM_TEST_SERVER_PORT:p});}catch{refused=true;}
if(!refused)throw Error('unsafe port admitted');}
let refused=false;try{h.testServerPort({NODE_ENV:'production',RHYTHM_TEST_SERVER_PORT:'4796'});}catch{refused=true;}
if(!refused)throw Error('production test override');
'''
        result = subprocess.run(['/opt/homebrew/bin/node', '-e', code, str(FIXTURE_HELPER)],
                                env={'HOME': '/private/tmp', 'PATH': '/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'},
                                cwd=ROOT, capture_output=True)
        self.assertEqual(result.returncode, 0, 'finite port contract rejected; no socket was opened')

    def test_recovery_generation_immutable_without_runtime(self):
        # Bug: a controlled API death makes holder accept arbitrary replacement or
        # overwrite an old generation rather than keep the proven engine identity.
        self.assertTrue(RECOVERY_HELPER.is_file(), 'intent-bound recovery records are missing')
        spec = importlib.util.spec_from_file_location('recovery', RECOVERY_HELPER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        parent = pathlib.Path(tempfile.mkdtemp(prefix='rhythm-coordinator-recovery-records-', dir='/private/tmp'))
        module.write_new(parent / 'intent.json', {'phase': 'await_archive', 'old_api': 11, 'engine': 22})
        self.assertEqual(json.loads((parent / 'intent.json').read_text()),
                         {'phase': 'await_archive', 'old_api': 11, 'engine': 22})
        with self.assertRaises(FileExistsError):
            module.write_new(parent / 'intent.json', {'old_api': 99})
        self.assertEqual(json.loads((parent / 'intent.json').read_text())['old_api'], 11)
        with self.assertRaises(ValueError):
            module.verify_archived_pid(parent / 'missing.pid', parent / 'archive.pid',
                                       {'sha256': '0' * 64, 'dev': 1, 'ino': 2})
        self.assertFalse((parent / 'archive.pid').exists())


if __name__ == '__main__':
    unittest.main()
