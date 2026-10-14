"""Execute exact launcher bytes with synthetic host I/O; never launch/install.

python3 -B tools/dev/hermes_webui_receiver/test_launcher_security.py [launcher.py]
The optional path lets an independent verifier test read-only staged bytes.
"""
import ast
import builtins
import contextlib
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from hermes_webui_receiver import host_job as job
import hermes_webui_receiver.receiver as receiver
import hermes_notify_subscriber as subscriber

TARGET = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(__file__).with_name('launcher.py')
CODE = TARGET.read_bytes()
STAGE = Path('/home/pi-nas/rhythm-notify-stage-bb4a5651')
UNIT = 'rhythm-notify-install-bb4a5651.service'
SECRET = 'SYNTHETIC_PRIVATE_BUFFER_DO_NOT_PRINT'


class Stream(io.BytesIO):
    def __init__(self, fixture, fd, mode):
        self.fixture, self.fd, self.mode = fixture, fd, mode
        super().__init__(fixture.data.get(fixture.fds[fd], b''))

    def fileno(self):
        return self.fd

    def write(self, data):
        self.fixture.writes.append((self.fixture.fds[self.fd], data))
        return super().write(data)


class Host:
    def __init__(self, case):
        self.case, self.fds, self.opens, self.writes, self.calls = case, {}, [], [], []
        self.data, self.meta = {}, {}
        self.env = {'INVOCATION_ID': 'synthetic-invocation'}
        self.props = {'MainPID': '4242', 'ActiveState': 'active', 'InvocationID': self.env['INVOCATION_ID']}
        self.container = dict(Id='a' * 64, Image=job.IMAGE,
                              Config={'Healthcheck': {'Test': ['CMD', SECRET]}, 'Env': [SECRET]},
                              HostConfig={}, Mounts=[dict(Source='/synthetic/source', Destination='/webui', RW=False)],
                              State={'Running': True, 'Health': {'Status': 'healthy'}})
        self.m = dict(image=job.IMAGE, restartBudget=1, containerId=self.container['Id'],
                      configDigest=self.config_hash(), mountedSourceRoot='/synthetic/source',
                      backupDirectory=str(STAGE / 'backup'), approvedPatchManifest=str(STAGE / 'native_patch_manifest.json'),
                      hostFacility=dict(kind='systemd-run', attestedAvailable=True, launchedOnHost=False),
                      readiness=dict(kind='docker-health', status='healthy'), files=[],
                      nativeGate=dict(result='PASS', cases={k: 'PASS' for k in job.GATES}, verifier='independent-fixture',
                                      sourceManifestHash='', evidenceHash='', patchSetHash=''))
        pins, approved = {}, {}
        for i, (name, operation) in enumerate(job.OUTPUTS.items()):
            before, after = (SECRET + name).encode(), ('new-' + name).encode()
            artifact = str(STAGE / 'artifacts' / str(i))
            self.data[artifact] = after
            if operation == 'REPLACE':
                self.data['/synthetic/source/' + name] = before
                pins[name] = job.sha(before)
            f = dict(path=name, operation=operation, expectedAbsent=operation == 'CREATE',
                     beforeHash=job.sha(before) if operation == 'REPLACE' else None,
                     afterHash=job.sha(after), artifact=artifact, mode=0o644, uid=1000, gid=1000)
            self.m['files'].append(f)
            approved[name] = {'before': f['beforeHash'], 'after': f['afterHash']}
        self.data[str(STAGE / 'native_patch_manifest.json')] = job.encoded(approved).encode()
        self.data[str(STAGE / 'independent-gate-evidence.json')] = job.encoded({'originalSourcePins': pins}).encode()
        gate = self.m['nativeGate']
        gate['sourceManifestHash'] = job.sha(self.data[str(STAGE / 'native_patch_manifest.json')])
        gate['evidenceHash'] = job.sha(self.data[str(STAGE / 'independent-gate-evidence.json')])
        gate['patchSetHash'] = job.sha(job.encoded(self.m['files']).encode())
        self.review = None
        self.evidence_review = gate['evidenceHash']
        self.mutate()
        self.raw = job.encoded(self.m).encode()
        self.data[str(STAGE / 'candidate-manifest.json')] = self.raw
        self.review = job.sha(self.raw) if self.review is None else self.review
        self.data[str(STAGE / 'launcher.py')] = CODE
        inventory = {str(Path(p).relative_to(STAGE)): job.sha(b) for p, b in self.data.items() if p.startswith(str(STAGE))}
        if case == 'inventory_traversal':
            inventory['../foreign'] = '0' * 64
        if case == 'inventory_absolute':
            inventory['/foreign'] = '0' * 64
        self.data[str(STAGE / 'inventory.json')] = job.encoded(inventory).encode()
        if case == 'staged_byte':
            self.data[str(STAGE / 'launcher.py')] += b'changed'
        self.argv = [str(TARGET), '--execute-parent-authorized', '--reviewed-candidate-sha', self.review,
                     '--independent-gate-reviewed', self.evidence_review]
        if case == 'readonly':
            self.argv = [str(TARGET)]

    def config_hash(self):
        return job.sha(job.encoded({k: self.container[k] for k in ('Id', 'Image', 'Config', 'HostConfig', 'Mounts')}).encode())

    def mutate(self):
        c = self.case
        if c == 'wrong_pid': self.props['MainPID'] = '9999'
        if c == 'inactive': self.props['ActiveState'] = 'inactive'
        if c in ('wrong_invocation', 'wrong_unit'): self.props['InvocationID'] = 'other-service'
        if c == 'missing_invocation': self.env = {}
        if c == 'missing_property': del self.props['MainPID']
        if c == 'wrong_review': self.review = '0' * 64
        if c == 'wrong_evidence_review': self.evidence_review = '0' * 64
        if c == 'facility': self.m['hostFacility']['kind'] = 'nohup'
        if c == 'candidate_launched': self.m['hostFacility']['launchedOnHost'] = True
        if c == 'backup_path': self.m['backupDirectory'] = '/synthetic/other'
        if c == 'evidence_binding': self.m['nativeGate']['evidenceHash'] = '0' * 64
        if c == 'source_manifest_binding': self.m['nativeGate']['sourceManifestHash'] = '0' * 64
        if c == 'source_pin': self.data['/synthetic/source/server.py'] = b'foreign'
        if c == 'before_hash': self.m['files'][0]['beforeHash'] = '0' * 64
        if c == 'artifact_hash': self.m['files'][0]['afterHash'] = '0' * 64
        if c == 'container_id': self.container['Id'] = 'b' * 64
        if c == 'image': self.container['Image'] = 'sha256:' + 'b' * 64
        if c == 'config': self.container['Config']['Env'] += ['foreign']
        if c == 'not_running': self.container['State']['Running'] = False
        if c == 'unhealthy': self.container['State']['Health']['Status'] = 'unhealthy'
        if c == 'health_command': self.container['Config']['Healthcheck']['Test'] = ['BAD']
        if c == 'mount': self.container['Mounts'][0]['RW'] = True
        if c == 'patch_binding': self.m['nativeGate']['patchSetHash'] = '0' * 64
        if c == 'gate': self.m['nativeGate']['result'] = 'FAIL'

    def exists(self, path):
        p = str(path)
        return (p in self.data or (p == '/.dockerenv' and self.case == 'docker_marker') or
                (p == '/run/.containerenv' and self.case == 'container_marker') or
                (p == str(STAGE / 'backup') and self.case == 'backup_replay') or
                (p == str(STAGE / 'executed-manifest.json') and self.case == 'manifest_replay') or
                (p == '/synthetic/source/api/rhythm_notify.py' and self.case == 'create_collision'))

    def text(self, path, *args, **kwargs):
        if str(path) == '/proc/1/comm': return 'other' if self.case == 'pid1' else 'systemd'
        if str(path) == '/proc/self/cgroup': return 'kubepods' if self.case == 'cgroup' else 'host'
        raise RuntimeError('unexpected fixture text read')

    def open(self, path, flags, mode=0o777, dir_fd=None):
        p = str(path) if dir_fd is None else str(Path(self.fds[dir_fd]) / path)
        if flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT):
            self.opens.append(p)
            if p != str(STAGE / 'executed-manifest.json'):
                raise RuntimeError('unexpected write intercepted')
        fd = len(self.fds) + 100
        self.fds[fd] = p
        return fd

    def info(self, fd):
        p = self.fds[fd]
        directory = p not in self.data and p != str(STAGE / 'executed-manifest.json')
        mode = (stat.S_IFDIR | 0o700) if directory else (stat.S_IFREG | (0o600 if p.startswith(str(STAGE)) else 0o644))
        uid = gid = 1000
        links = 1
        if p == str(STAGE / 'launcher.py'):
            if self.case == 'file_mode': mode = stat.S_IFREG | 0o644
            if self.case == 'file_owner': uid = 1234
            if self.case == 'file_group': gid = 1234
            if self.case == 'file_links': links = 2
            if self.case == 'file_type': mode = stat.S_IFIFO | 0o600
        if p == '/home/pi-nas':
            if self.case == 'directory_mode': mode |= 0o022
            if self.case == 'directory_owner': uid = 1234
        if p == '/synthetic/source/server.py' and self.case == 'source_metadata': mode = stat.S_IFREG | 0o664
        return SimpleNamespace(st_mode=mode, st_uid=uid, st_gid=gid, st_nlink=links)

    def command(self, argv, **kwargs):
        if argv == ['docker', 'inspect', self.m['containerId']]:
            return json.dumps([self.container]).encode()
        expected = ['/usr/bin/systemctl', '--user', 'show', UNIT,
                    '--property=MainPID', '--property=ActiveState', '--property=InvocationID']
        if argv != expected: raise RuntimeError('non-fixed unit command intercepted')
        return '\n'.join(k + '=' + v for k, v in self.props.items()).encode()

    def run(self, argv, **kwargs):
        if argv == ['/usr/bin/systemctl', '--user', 'is-system-running']:
            return SimpleNamespace(returncode=1 if self.case == 'manager' else 0, stdout=b'running')
        expected = ['/usr/bin/python3', '-B', '-m', 'hermes_webui_receiver.host_job',
                    '--manifest', str(STAGE / 'executed-manifest.json'), '--execute-parent-authorized']
        if argv != expected or kwargs != {'cwd': STAGE}: raise RuntimeError('unexpected host call intercepted')
        self.calls.append(argv)
        return SimpleNamespace(returncode=0)

    def execute(self, optimize):
        output = io.StringIO()
        origins = [(job, str(STAGE / 'hermes_webui_receiver/host_job.py'), 'job_origin'),
                   (receiver, str(STAGE / 'hermes_webui_receiver/receiver.py'), 'receiver_origin'),
                   (subscriber, str(STAGE / 'hermes_notify_subscriber.py'), 'subscriber_origin')]
        with contextlib.ExitStack() as stack:
            for module, path, case in origins:
                stack.enter_context(patch.object(module, '__file__', '/foreign' if self.case == case else path))
            patches = [(os, 'getuid', lambda: 1234 if self.case == 'uid' else 1000),
                       (os, 'getgid', lambda: 1234 if self.case == 'gid' else 1000),
                       (os, 'getpid', lambda: 4242), (os, 'open', self.open), (os, 'fstat', self.info),
                       (os, 'close', lambda fd: None), (os, 'fsync', lambda fd: None),
                       (os, 'fdopen', lambda fd, mode: Stream(self, fd, mode)),
                       (os, 'access', lambda *a: self.case != 'facility_access'),
                       (os.path, 'lexists', self.exists), (Path, 'exists', lambda p: self.exists(p)),
                       (Path, 'is_file', lambda p: self.case != 'facility_file'),
                       (Path, 'read_text', lambda p, *a, **kw: self.text(p, *a, **kw)),
                       (subprocess, 'run', self.run), (job, 'command', self.command),
                       (job, 'protected', lambda p: self.data[str(p)]),
                       (job, 'open_directory', lambda p: self.open(p, os.O_DIRECTORY)),
                       (job, 'read_file', lambda fd, name: (self.data[str(Path(self.fds[fd]) / name)],
                                                          self.info(self.open(name, os.O_RDONLY, dir_fd=fd)))),
                       (job, 'fsync_directory', lambda p: None), (sys, 'argv', self.argv)]
            for obj, name, value in patches: stack.enter_context(patch.object(obj, name, value))
            stack.enter_context(patch.dict(os.environ, self.env, clear=True))
            stack.enter_context(contextlib.redirect_stdout(output))
            try:
                exec(compile(CODE, str(TARGET), 'exec', optimize=optimize), {'__name__': '__main__'})
            except SystemExit as e:
                status = e.code
        return status, output.getvalue()


DENIALS = ('wrong_pid inactive wrong_invocation wrong_unit missing_invocation missing_property wrong_review '
           'wrong_evidence_review uid gid docker_marker container_marker pid1 cgroup facility_file facility_access '
           'manager inventory_traversal inventory_absolute staged_byte directory_mode directory_owner file_mode '
           'file_owner file_group file_links file_type job_origin receiver_origin subscriber_origin facility '
           'candidate_launched backup_path backup_replay manifest_replay evidence_binding source_manifest_binding '
           'container_id image config not_running unhealthy health_command mount source_pin source_metadata '
           'before_hash artifact_hash create_collision patch_binding gate').split()


class SecurityContract(unittest.TestCase):
    def test_denials_before_any_write_or_host_call(self):
        for optimize in (0, 1, 2):
            for case in DENIALS:
                with self.subTest(optimize=optimize, guard=case):
                    host = Host(case)
                    status, output = host.execute(optimize)
                    self.assertEqual(host.opens, [], 'manifest WRITE intercept reached')
                    self.assertEqual(host.writes, [])
                    self.assertEqual(host.calls, [])
                    self.assertEqual(status, 1)
                    self.assertEqual(json.loads(output), dict(state='BLOCKED', reason='staging_or_host_guard_failed', execution='NOTQUALIFIED'))

    def test_valid_fixture_exactly_one_manifest_and_fake_host_call(self):
        for optimize in (0, 1, 2):
            host = Host('valid')
            status, output = host.execute(optimize)
            self.assertEqual(status, 0)
            self.assertEqual(output, '')
            self.assertEqual(host.opens, [str(STAGE / 'executed-manifest.json')])
            self.assertEqual(len(host.writes), 1)
            self.assertEqual(len(host.calls), 1)
            written = json.loads(host.writes[0][1])
            self.assertTrue(written['hostFacility']['launchedOnHost'])
            self.assertFalse(host.m['hostFacility']['launchedOnHost'])

    def test_readonly_allowlisted_output_and_zero_side_effects(self):
        allowed = {'state', 'execution', 'candidateSHA', 'configDigest', 'serviceLaunched', 'candidateLaunchedOnHost',
                   'hostProcessProof', 'before', 'facility', 'backupAbsent', 'executedManifestAbsent'}
        for optimize in (0, 1, 2):
            host = Host('readonly')
            status, output = host.execute(optimize)
            self.assertEqual(status, 0)
            self.assertEqual(set(json.loads(output)), allowed)
            self.assertNotIn(SECRET, output)
            self.assertEqual((host.opens, host.writes, host.calls), ([], [], []))

    def test_no_production_asserts(self):
        self.assertFalse(any(isinstance(n, ast.Assert) for n in ast.walk(ast.parse(CODE))))

    def test_missing_import_or_os_flags_fail_closed(self):
        original_import = builtins.__import__

        def missing_job(name, *args, **kwargs):
            if name == 'hermes_webui_receiver':
                raise ImportError(SECRET)
            return original_import(name, *args, **kwargs)

        for optimize in (0, 1, 2):
            for boundary in ('import', 'flags'):
                host = Host('valid')
                guard = (patch.object(builtins, '__import__', missing_job) if boundary == 'import'
                         else patch.object(os, 'O_NOFOLLOW', None))
                with guard:
                    status, output = host.execute(optimize)
                self.assertEqual(status, 1)
                self.assertEqual((host.opens, host.writes, host.calls), ([], [], []))
                self.assertEqual(json.loads(output), dict(state='BLOCKED', reason='staging_or_host_guard_failed', execution='NOTQUALIFIED'))
                self.assertNotIn(SECRET, output)


if __name__ == '__main__':
    unittest.main(verbosity=2)
