"""Version 1 outbound SSE consumer. No listener, cron, tool execution or Hermes config edits.

The operator-supplied local adapter must implement deliver(event) -> receipt and
deduplicate eventId atomically with the original-session transcript write. A busy
adapter returns None. No runtime adapter is shipped/claimed for WebUI.
"""
import argparse
import importlib
import json
import os
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request

LABELS = {
    "progress": {"Rhythm session linked.", "Rhythm session updated."},
    "completion": {"Rhythm session completed."},
    "error": {"Rhythm session reported an error."},
    "approval-request": {"Rhythm session needs approval. Open the Rhythm card."},
    "question": {"Rhythm session has a question. Open the Rhythm session."},
}
FIELDS = {"version", "eventId", "cursor", "sessionId", "hermesSessionId", "workflowId", "kind", "text", "referenceId", "state"}

def validate(event):
    if not isinstance(event, dict) or set(event) != FIELDS or type(event["version"]) is not int or event["version"] != 1:
        raise ValueError("unsupported notification schema")
    for key in ("eventId", "sessionId", "hermesSessionId", "workflowId"):
        if not isinstance(event[key], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", event[key]):
            raise ValueError("invalid identity")
    if type(event["cursor"]) is not int or not 0 < event["cursor"] < 10**15:
        raise ValueError("invalid cursor")
    if not isinstance(event["kind"], str) or not isinstance(event["text"], str) or event["kind"] not in LABELS or event["text"] not in LABELS[event["kind"]]:
        raise ValueError("not a server-generated label")
    if not isinstance(event["state"], str) or event["state"] not in ("pending", "accepted", "visible"):
        raise ValueError("invalid state")
    reference = event["referenceId"]
    if reference is not None and (not isinstance(reference, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", reference)):
        raise ValueError("invalid reference")
    return event

class Inbox:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS inbox(event_id TEXT PRIMARY KEY, cursor INTEGER UNIQUE, payload TEXT NOT NULL, visible INTEGER NOT NULL DEFAULT 0)")
        self.db.commit()

    def accept(self, event):
        validate(event)
        identity = {k: v for k, v in event.items() if k != "state"}
        encoded = json.dumps(identity, sort_keys=True)
        previous = self.db.execute("SELECT payload FROM inbox WHERE event_id=?", (event["eventId"],)).fetchone()
        if previous and previous[0] != encoded:
            raise ValueError("event identity changed")
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO inbox(event_id,cursor,payload) VALUES (?,?,?)", (event["eventId"], event["cursor"], encoded))
            stored = self.db.execute("SELECT payload FROM inbox WHERE event_id=?", (event["eventId"],)).fetchone()
            if stored is None or stored[0] != encoded:
                raise ValueError("event identity/cursor conflict")
        return "accepted"  # Durable ingestion only, NOT visible delivery or wakeup.

    def drain(self, adapter, ack):
        for event_id, payload, visible in self.db.execute("SELECT event_id,payload,visible FROM inbox WHERE visible!=2 ORDER BY cursor LIMIT 100").fetchall():
            event = json.loads(payload)
            if not visible:
                receipt = adapter.deliver(event)
                if receipt is None:  # Busy/unsupported session: persist and retry, never drop.
                    continue
                if receipt != {"version": 1, "eventId": event_id, "hermesSessionId": event["hermesSessionId"], "state": "visible"}:
                    raise ValueError("adapter did not prove original-session visible receipt")
                with self.db:
                    self.db.execute("UPDATE inbox SET visible=1 WHERE event_id=?", (event_id,))
            ack(event_id, "visible")  # Retain receipt locally if remote ACK fails.
            with self.db:
                # Keep a dedup tombstone. Do not erase event identity on ACK.
                self.db.execute("UPDATE inbox SET visible=2 WHERE event_id=?", (event_id,))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ValueError("redirect refused")

class Subscriber:
    def __init__(self, base, token, inbox, adapter):
        self.base, self.token, self.inbox, self.adapter = base.rstrip("/"), token, inbox, adapter
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, body=None):
        request = urllib.request.Request(self.base + "/hermes-notify" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        return self.opener.open(request, timeout=20)

    def ack(self, event_id, state):
        with self.request("/ack", {"eventId": event_id, "state": state}) as response:
            if response.status != 200:
                raise ValueError("ACK rejected")

    def receive(self, event):
        validate(event)
        # Remote identifiers never authorize adoption of an arbitrary Hermes parent.
        # The local adapter must consult its trusted dispatch/owner binding registry.
        if self.adapter.owns(event) is not True:
            raise ValueError('origin not in local authenticated dispatch registry')
        self.inbox.accept(event)
        visible = self.inbox.db.execute("SELECT visible FROM inbox WHERE event_id=?", (event["eventId"],)).fetchone()[0]
        self.ack(event["eventId"], "visible" if visible else "accepted")
        self.inbox.drain(self.adapter, self.ack)

    def run(self):
        delay, watchdog = 1, 0
        def recover():
            nonlocal watchdog
            if time.monotonic() - watchdog < 600:
                return
            with self.request("/events") as response:
                page = json.loads(response.read(256 * 1024))
            if not isinstance(page, dict) or not isinstance(page.get("events"), list) or len(page["events"]) > 100:
                raise ValueError("invalid recovery page")
            for event in page["events"]:
                self.receive(event)
            watchdog = time.monotonic()
        while True:
            try:
                self.inbox.drain(self.adapter, self.ack)
                recover()
                # Replay all pending on reconnect, NOT just the largest locally enqueued cursor.
                with self.request("/stream") as response:
                    while True:
                        line = response.readline(8193)
                        if not line:
                            break
                        if len(line) > 8192:
                            raise ValueError("oversized SSE frame")
                        delay = 1
                        if line.startswith(b"data: "):
                            self.receive(json.loads(line[6:]))
                        elif line.startswith(b":"):
                            self.inbox.drain(self.adapter, self.ack)
                        recover()  # Elapsed-time recovery even while SSE remains healthy.
                time.sleep(delay)
                delay = min(60, delay * 2)
            except urllib.error.HTTPError as error:
                if error.code in (401, 403):
                    raise RuntimeError("subscriber authentication rejected") from None
                time.sleep(delay)
                delay = min(60, delay * 2)
            except (OSError, ValueError):
                # Never print payloads, credentials, remote bodies or exception strings.
                time.sleep(delay)
                delay = min(60, delay * 2)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--inbox", required=True)
    parser.add_argument("--adapter", required=True, help="operator-owned local Python module exposing adapter.deliver")
    parser.add_argument("--allow-loopback-test", action="store_true")
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.base_url)
    if url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        parser.error("base URL must be a credential-free origin")
    if url.scheme != "https" and not (args.allow_loopback_test and url.scheme == "http" and url.hostname == "127.0.0.1" and url.port == 4898):
        parser.error("HTTPS required outside isolated loopback fixture")
    token = os.environ.get("RHYTHM_NOTIFY_TOKEN")
    if not token:
        parser.error("explicit owner-bound RHYTHM_NOTIFY_TOKEN required; no auth fallback")
    adapter = importlib.import_module(args.adapter).adapter
    Subscriber(args.base_url, token, Inbox(args.inbox), adapter).run()

if __name__ == "__main__":
    main()
