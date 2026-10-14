"""Offline reviewed, exact-hash source patch builder; never force mismatched bytes."""
import difflib
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def replace(text, old, new, count=1):
    if text.count(old) != count:
        raise ValueError('reviewed patch anchor mismatch')
    return text.replace(old, new)


def build():
    source = ROOT / 'source_snapshot'
    manifest = json.loads((ROOT / 'source_snapshot_manifest.json').read_text())
    pins = manifest['hashes']
    if isinstance(pins, list):
        pins = {x['path']: x['sha256'] for x in pins}
    originals = {}
    # Rebuild from recovered pinned originals; never reverse the retained copy.
    with tempfile.TemporaryDirectory() as directory:
        recovered = Path(directory) / 'source'
        shutil.copytree(source, recovered)
        prior = json.loads((ROOT / 'native_patch_manifest.json').read_text())
        for name, record in prior.items():
            if hashlib.sha256((recovered / name).read_bytes()).hexdigest() != record['after']:
                raise ValueError('prior output hash mismatch: ' + name)
        subprocess.run(['git', 'apply', '--reverse', str(ROOT / 'native.patch')], cwd=recovered, check=True)
        recovered_bytes = {name: (recovered / name).read_bytes()
                           for name in ('server.py', 'api/routes.py', 'api/models.py', 'static/ui.js')}
    for name, raw in recovered_bytes.items():
        pin = pins[name]
        if isinstance(pin, dict):
            pin = pin['sha256']
        if hashlib.sha256(raw).hexdigest() != pin:
            raise ValueError('source hash mismatch: ' + name)
        originals[name] = raw.decode()
    server = originals['server.py']
    server = replace(server, '            _is_csp_report_post =',
        "            from api.rhythm_notify import handle as handle_rhythm_notify\n"
        "            if self.command == 'POST' and parsed.path in ('/api/rhythm-notify/receive', '/api/rhythm-notify/status'):\n"
        "                return handle_rhythm_notify(self, parsed)\n"
        '            _is_csp_report_post =')
    server = replace(server, '    httpd = QuietHTTPServer((HOST, PORT), Handler)',
        '    httpd = QuietHTTPServer((HOST, PORT), Handler)\n'
        '    from api.rhythm_notify import startup as start_rhythm_notify\n'
        '    httpd.rhythm_notify = start_rhythm_notify()')
    server = replace(server, '            result = handle_get(self, parsed)',
        '            from api.rhythm_notify import handle_browser\n'
        "            if parsed.path == '/api/rhythm-notify/render-metadata':\n"
        '                return handle_browser(self, parsed)\n'
        '            result = handle_get(self, parsed)')
    server = replace(server, '            result = route_func(self, parsed)',
        '            from api.rhythm_notify import handle_browser\n'
        "            if parsed.path == '/api/rhythm-notify/render-receipt':\n"
        '                return handle_browser(self, parsed)\n'
        '            result = route_func(self, parsed)')
    server = replace(server, '        httpd.server_close()',
        '        httpd.rhythm_notify.shutdown()\n        httpd.server_close()')
    routes = originals['api/routes.py']
    routes = replace(routes, '    rearm_deferred_wakeup: bool = False,\n):',
        '    rearm_deferred_wakeup: bool = False,\n    notification=None,\n):', count=3)
    routes = replace(routes, '        rearm_deferred_wakeup=rearm_deferred_wakeup,\n',
        '        rearm_deferred_wakeup=rearm_deferred_wakeup,\n        notification=notification,\n', count=3)
    routes = replace(routes, '        with session_lock:\n            locked_stream_id',
        '        with session_lock:\n            if notification is not None:\n'
        '                notification.recheck(s)\n            locked_stream_id')
    routes = replace(routes, '                                "event": "submitted",\n',
        '                                **(notification.fields if notification is not None else {}),\n'
        '                                "event": "submitted",\n')
    routes = replace(routes, '                        logger.warning("Failed to append submitted turn journal event", exc_info=True)',
        '                        if notification is not None:\n                            raise\n'
        '                        logger.warning("Failed to append submitted turn journal event", exc_info=True)')
    routes = replace(routes, '                    diag.stage("stream_registration") if diag else None\n                    stream = create_stream_channel()',
        '                    if notification is not None:\n                        notification.committed(s, journal_event)\n'
        '                    diag.stage("stream_registration") if diag else None\n                    stream = create_stream_channel()')
    routes = replace(routes, '                    _prepare_chat_start_session_for_stream(\n',
        '                    if notification is not None:\n'
        '                        notification.arm(s)\n'
        '                    else:\n'
        '                        s._rhythm_notify_operation = None\n'
        '                    _prepare_chat_start_session_for_stream(\n')
    # External backends cannot carry this native journal fence. Refuse, do not
    # silently bypass configured routing or invent a foreign-engine receipt.
    routes = replace(routes, '    runner_enabled = runtime_adapter_runner_enabled()',
        '    runner_enabled = runtime_adapter_runner_enabled()\n'
        '    if notification is not None and (runner_enabled or gateway_chat_enabled):\n'
        '        return {"error": "notification requires native journal backend", "_status": 501}')
    additions = {
        'api/rhythm_notify.py': (ROOT / 'native.py').read_text(),
        'api/rhythm_inbox.py': (ROOT / 'receiver.py').read_text().replace(
            'from hermes_notify_subscriber import validate', 'from api.rhythm_schema import validate'),
        'api/rhythm_schema.py': (ROOT.parent / 'hermes_notify_subscriber.py').read_text().split('class Inbox:')[0],
    }
    models = originals['api/models.py']
    models = replace(models, '        if not is_safe_session_id(self.session_id):\n',
        '        operation = getattr(self, "_rhythm_notify_operation", None)\n'
        '        notification_metadata = operation.save_metadata(self) if operation is not None else None\n'
        '        if not is_safe_session_id(self.session_id):\n')
    models = replace(models, '        meta = {k: getattr(self, k, None) for k in METADATA_FIELDS}\n',
        '        meta = {k: getattr(self, k, None) for k in METADATA_FIELDS}\n'
        '        if notification_metadata is not None:\n'
        '            meta.update(notification_metadata)\n')
    models = replace(models, '\n                _safe_replace(tmp, self.path)\n',
        '\n                if operation is not None:\n'
        '                    operation.check_save(self, notification_metadata)\n'
        '                _safe_replace(tmp, self.path)\n')
    models = replace(models, '\n                    _safe_replace(tmp, self.path)\n',
        '\n                    if operation is not None:\n'
        '                        operation.check_save(self, notification_metadata)\n'
        '                    _safe_replace(tmp, self.path)\n')
    ui = replace(originals['static/ui.js'], 'function renderMessages(options){',
        'function renderMessages(options){\n  _scheduleRhythmRenderReceipt();')
    ui += '\n' + (ROOT / 'render_receipt.js').read_text()
    changes = {'server.py': server, 'api/routes.py': routes, 'api/models.py': models,
               'static/ui.js': ui, **additions}
    patch = ''.join(''.join(difflib.unified_diff(originals.get(name, '').splitlines(True),
                      text.splitlines(True), fromfile='a/' + name, tofile='b/' + name))
                    for name, text in changes.items())
    receipt = {name: {'before': hashlib.sha256(originals[name].encode()).hexdigest() if name in originals else None,
                     'after': hashlib.sha256(text.encode()).hexdigest()}
               for name, text in changes.items()}
    # Validate complete intended surface before publishing any build output.
    for name, text in changes.items():
        if name.endswith('.py'):
            compile(text, name, 'exec')
    (ROOT / 'native.patch').write_text(patch)
    (ROOT / 'native_patch_manifest.json').write_text(json.dumps(receipt, indent=2) + '\n')
    for name, text in changes.items():
        (source / name).write_text(text)
    print('Native patch built: ' + ', '.join(changes))


if __name__ == '__main__':
    build()
