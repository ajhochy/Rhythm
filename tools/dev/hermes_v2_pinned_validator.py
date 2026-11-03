"""Read-only invocation of the ORIGINAL pinned subscriber and receiver schema."""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path('/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/tools/dev')
for name, digest in {
    'hermes_notify_subscriber.py': '270548dfe3c047babe7445db98ccf5d70226b9c37273cca5c6b8f7b49fa58656',
    'hermes_webui_receiver/receiver.py': '4d49279b04b5adf294103f9275c440cda6e8ec4fae01b5dd88da0d4846922d44',
}.items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == digest, 'consumer pin changed'
sys.path.insert(0, str(ROOT))
from hermes_notify_subscriber import validate
from hermes_webui_receiver.receiver import identity

errors = []
for i, event in enumerate(json.load(sys.stdin)):
    try:
        validate(event)
        if event['version'] == 2:
            identity(event)
    except ValueError as error:
        errors.append({'index': i, 'error': str(error)})
print(json.dumps({'validated': i + 1 if 'i' in globals() else 0, 'errors': errors}))
sys.exit(bool(errors))
