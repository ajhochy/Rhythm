"""Stdlib relay adapter; protected operator auth references, no login or worker."""
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import stat
import urllib.request
import urllib.parse

from hermes_notify_subscriber import NoRedirect, validate
from hermes_webui_receiver.receiver import binding_json


def protected(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as file:
        info = os.fstat(file.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or
                stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 1024 * 1024):
            raise ValueError('protected auth reference unavailable')
        return file.read()


class NativeAdapter:
    def __init__(self, registry, *, allow_private_native=False, fixture_origin=None):
        self.registry = Path(registry)
        self.allow_private_native = allow_private_native
        self.fixture_origin = fixture_origin
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def record(self, event):
        validate(event)
        if event['version'] != 2:
            raise ValueError('V2 required')
        data = json.loads(protected(self.registry))
        if data.get('version') != 2:
            raise ValueError('invalid registry')
        record = data['runs'].get(event['runId'])
        if not record or record.get('active') is not True:
            raise ValueError('origin unavailable')
        binding = record['binding']
        binding_json(binding)
        if any(event[key] != binding[key] for key in ('runId', 'hermesSessionId', 'sessionId')):
            raise ValueError('origin unavailable')
        base = record['receiverEndpoint']
        url = urllib.parse.urlsplit(base)
        if (url.username is not None or url.password is not None or url.path or url.query or
                url.fragment or base != f'{url.scheme}://{url.netloc}' or url.port is None):
            raise ValueError('invalid native endpoint')
        address = ipaddress.ip_address(url.hostname)
        if url.scheme != 'https':
            fixture = base == self.fixture_origin and address.is_loopback
            if url.scheme != 'http' or not (fixture or
                    (self.allow_private_native and address.is_private and not address.is_unspecified)):
                raise ValueError('native HTTP requires explicit private opt-in')
        token = protected(record['tokenFile']).decode().strip()
        if not token or any(c.isspace() for c in token) or len(token) > 8192:
            raise ValueError('invalid auth reference')
        if not hmac.compare_digest(hashlib.sha256(token.encode()).hexdigest(), record['credentialDigest']):
            raise ValueError('auth reference owner mismatch')
        return base, token

    def owns(self, event):
        try:
            self.record(event)
            return True
        except (OSError, ValueError, KeyError, TypeError):
            return False

    def deliver(self, event):
        # Subscriber heartbeat/recovery/drain provides bounded polling opportunities.
        # Repeating receive is native-idempotent; no adapter thread or LLM wakeup.
        base, token = self.record(event)
        result = None
        for path in ('receive', 'status'):
            request = urllib.request.Request(base + '/api/rhythm-notify/' + path,
                data=json.dumps(event).encode(), method='POST', headers={
                    'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
            with self.opener.open(request, timeout=5) as response:
                if response.status != 200:
                    raise ValueError('native receipt unavailable')
                result = json.loads(response.read(8193))
            expected = dict(version=2, eventId=event['eventId'], runId=event['runId'],
                            hermesSessionId=event['hermesSessionId'], state=result.get('state'))
            if result != expected or result['state'] not in (
                    'accepted', 'launching', 'started', 'completed', 'visible'):
                raise ValueError('invalid native receipt')
        return result if result['state'] == 'visible' else None
