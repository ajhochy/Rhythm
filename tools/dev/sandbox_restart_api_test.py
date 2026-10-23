"""Real launcher/API/fork acceptance. No model calls, no mocked processes."""
import json
import os
from pathlib import Path
import subprocess
import sqlite3
import unittest
import urllib.request
import time

ROOT = Path(__file__).resolve().parents[2]
SB = Path('/private/tmp/rhythm-coordinator-repair-sandbox')


class ReservedEnvelope(unittest.TestCase):
    def test_reserved_ports_are_denied_by_pre_signal_envelope(self):
        # Regression: shared launch/stop preflight accepts live service ports.
        # Pure envelope evaluation: no filesystem writes, process lookup or signal.
        for key, port in [('ENGINE_PORT', '4096'), ('API_PORT', '4001'),
                          ('GATEWAY_PORT', '4002')]:
            result = subprocess.run(['bash', '-c', 'source "$1"; safe_sandbox_path',
                                     'bash', str(ROOT / 'tools/dev/sandbox.sh')],
                                    env={**os.environ, 'RHYTHM_SANDBOX_' + key: port},
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0, key + ': reserved port accepted')
            self.assertIn('reserved', result.stderr)


@unittest.skipUnless(os.environ.get('RHYTHM_LIVE_E2E') == '1', 'owned live sandbox required')
class ApiRestart(unittest.TestCase):
    def request(self, path, data=None):
        req = urllib.request.Request('http://127.0.0.1:4797' + path,
                                     data=None if data is None else json.dumps(data).encode(),
                                     headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.load(response)

    def restart(self, overrides=None):
        environment = os.environ.copy()
        environment.update(overrides or {})
        return subprocess.run([str(ROOT / 'tools/dev/sandbox.sh'), 'restart-api'],
                              cwd=ROOT, env=environment, capture_output=True, text=True,
                              timeout=100)

    def test_00_reserved_ports_refuse_before_any_process_lookup_or_signal(self):
        # Regression: helper rejects 4096 only after the old API has been killed.
        # OS lookup/signal sentinels ensure this never even probes a live port.
        for key, port in [('ENGINE_PORT', '4096'), ('API_PORT', '4001'),
                          ('GATEWAY_PORT', '4002')]:
            result = subprocess.run(['bash', '-c', '''
source "$1"
listener() { printf 'UNSAFE_LOOKUP\n' >&2; exit 91; }
kill() { printf 'UNSAFE_SIGNAL\n' >&2; exit 92; }
restart_api
''', 'bash', str(ROOT / 'tools/dev/sandbox.sh')], cwd=ROOT,
                env={**os.environ, 'RHYTHM_SANDBOX_' + key: port},
                capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('reserved', result.stderr)
            self.assertNotIn('UNSAFE_', result.stderr)

    def test_00_foreground_and_runtime_path_mismatch_preserve_both_processes(self):
        # Regression: missing/symlinked config or HOME is discovered after API kill.
        api = (SB / 'api_server.pid').read_bytes()
        engine = (SB / 'opencode_engine.pid').read_bytes()
        holder = SB / 'foreground_holder.pid'
        holder.write_text(str(os.getpid()) + '\n')
        try:
            result = self.restart()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('foreground', result.stderr)
            os.kill(int(api), 0)
            os.kill(int(engine), 0)
        finally:
            holder.unlink()
        for relative in ['home/.config/opencode/opencode.json', 'home/.local/share/opencode',
                         'vault', 'live-artifacts', 'rhythm.db']:
            path = SB / relative
            saved = path.with_name(path.name + '.r0-saved')
            path.rename(saved)
            path.symlink_to(saved)
            try:
                result = self.restart()
                self.assertNotEqual(result.returncode, 0, relative)
                self.assertIn('refusing', result.stderr.lower())
                os.kill(int(api), 0)
                os.kill(int(engine), 0)
                self.assertEqual((SB / 'api_server.pid').read_bytes(), api)
                self.assertEqual((SB / 'opencode_engine.pid').read_bytes(), engine)
            finally:
                path.unlink()
                saved.rename(path)

    def test_01_foreign_api_pid_is_rejected_without_signalling(self):
        # Regression: an edited PID record kills an unrelated process.
        record = SB / 'api_server.pid'
        original = record.read_bytes()
        engine = (SB / 'opencode_engine.pid').read_bytes()
        try:
            record.write_text(str(os.getpid()) + '\n')
            result = self.restart()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('refusing', result.stderr)
            os.kill(os.getpid(), 0)
            self.assertEqual((SB / 'opencode_engine.pid').read_bytes(), engine)
            os.kill(int(original), 0)
        finally:
            record.write_bytes(original)

    def test_00_foreign_engine_and_symlinked_api_records_leave_both_processes_alive(self):
        # Regression: restart kills API before discovering it cannot preserve the engine,
        # or overwrites a symlink target when publishing the replacement API PID.
        api_record = SB / 'api_server.pid'
        engine_record = SB / 'opencode_engine.pid'
        api, engine = api_record.read_bytes(), engine_record.read_bytes()
        try:
            engine_record.write_text(str(os.getpid()) + '\n')
            result = self.restart()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('engine identity mismatch', result.stderr)
            os.kill(int(api), 0)
            os.kill(int(engine), 0)
        finally:
            engine_record.write_bytes(engine)
        target = SB / 'r0-api-record-target'
        target.write_bytes(api)
        api_record.unlink()
        api_record.symlink_to(target)
        try:
            result = self.restart()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('missing owned API record', result.stderr)
            self.assertEqual(target.read_bytes(), api)
            os.kill(int(api), 0)
            os.kill(int(engine), 0)
        finally:
            api_record.unlink()
            api_record.write_bytes(api)

    def test_02_restart_preserves_engine_session_database_and_vault(self):
        # Regression: API startup kills/replaces engine or recopies fixture DB/vault.
        engine = (SB / 'opencode_engine.pid').read_bytes()
        api = (SB / 'api_server.pid').read_bytes()
        session = self.request('/session', {'title': 'R0 restart preservation'})
        marker = SB / 'vault/r0-restart-marker.txt'
        marker.write_text('owned synthetic marker\n')
        with sqlite3.connect(SB / 'rhythm.db') as db:
            db.execute('CREATE TABLE IF NOT EXISTS r0_restart_marker (value TEXT)')
            db.execute('DELETE FROM r0_restart_marker')
            db.execute("INSERT INTO r0_restart_marker VALUES ('owned synthetic marker')")
        result = self.restart()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotEqual((SB / 'api_server.pid').read_bytes(), api)
        self.assertEqual((SB / 'opencode_engine.pid').read_bytes(), engine)
        os.kill(int(engine), 0)
        self.assertEqual(self.request('/session/' + session['id'])['id'], session['id'])
        self.assertEqual(marker.read_text(), 'owned synthetic marker\n')
        with sqlite3.connect(SB / 'rhythm.db') as db:
            self.assertEqual(db.execute('SELECT value FROM r0_restart_marker').fetchall(),
                             [('owned synthetic marker',)])
        with urllib.request.urlopen('http://127.0.0.1:4798/opencode/health', timeout=10) as response:
            self.assertEqual(json.load(response)['status'], 'ready')
        print(json.dumps({'api_before': int(api), 'api_after': int((SB / 'api_server.pid').read_bytes()),
                          'engine_preserved': int(engine), 'session_preserved': session['id']}))

    def test_99_unhealthy_replacement_is_cleaned_without_disposing_engine(self):
        # Regression: failed attachment leaves a replacement API running, or cleans
        # its engine/DB/vault. A disposable launch wrapper changes ONLY the API's
        # production flag, driving the real initialization refusal (no fake API).
        engine = (SB / 'opencode_engine.pid').read_bytes()
        session = self.request('/session', {'title': 'R0 failed attachment preservation'})
        marker = SB / 'vault/r0-failure-marker.txt'
        marker.write_text('preserved after failed attachment\n')
        with sqlite3.connect(SB / 'rhythm.db') as db:
            db.execute('CREATE TABLE IF NOT EXISTS r0_failure_marker (value TEXT)')
            db.execute('DELETE FROM r0_failure_marker')
            db.execute("INSERT INTO r0_failure_marker VALUES ('preserved')")
        node = subprocess.check_output(['which', 'node'], text=True).strip()
        wrapper = SB / 'r0-replacement-node'
        wrapper.write_text('#!/bin/sh\nif [ "$1" != "-e" ]; then export NODE_ENV=production; fi\nexec '
                           + json.dumps(node) + ' "$@"\n')
        wrapper.chmod(0o700)
        result = self.restart({'RHYTHM_SANDBOX_NODE_BIN': str(wrapper)})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((SB / 'opencode_engine.pid').read_bytes(), engine)
        os.kill(int(engine), 0)
        self.assertEqual(self.request('/session/' + session['id'])['id'], session['id'])
        self.assertEqual(marker.read_text(), 'preserved after failed attachment\n')
        with sqlite3.connect(SB / 'rhythm.db') as db:
            self.assertEqual(db.execute('SELECT value FROM r0_failure_marker').fetchall(), [('preserved',)])
        replacement = int((SB / 'api_server.pid').read_bytes())
        for _ in range(50):
            try:
                os.kill(replacement, 0)
            except ProcessLookupError:
                break
            time.sleep(0.1)
        else:
            self.fail('unhealthy replacement API survived cleanup')
        self.assertTrue((SB / 'opencode_engine.ownership.json').is_file())


if __name__ == '__main__':
    unittest.main()
