"""Versioned outbound SSE consumer. No listener, cron, tool execution or Hermes config edits.

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
    if not isinstance(event, dict) or type(event.get("version")) is not int or event["version"] not in (1,2) or set(event) != (FIELDS if event["version"] == 1 else FIELDS | {"runId"}):
        raise ValueError("unsupported notification schema")
    if event["version"] == 2 and event["runId"] != event["workflowId"]:
        raise ValueError("run identity mismatch")
    for key in ("eventId", "sessionId", "hermesSessionId", "workflowId"):
        if not isinstance(event[key], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", event[key]):
            raise ValueError("invalid identity")
    if type(event["cursor"]) is not int or not 0 < event["cursor"] < 10**15:
        raise ValueError("invalid cursor")
    workflow_label = isinstance(event["text"], str) and re.fullmatch(
        r"Rhythm workflow (pending|running|blocked_approval|blocked_reconciliation|awaiting_children|succeeded|failed|budget_exhausted|workflow_disabled|cancelled): ([0-9]{1,9}) settled, ([0-9]{1,9}) awaiting\.", event["text"])
    workflow_kind = None
    if workflow_label:
        status, settled, awaiting = workflow_label.groups()
        workflow_kind = "completion" if status == "succeeded" else "error" if status in ("failed", "budget_exhausted", "workflow_disabled", "cancelled") else "approval-request" if status == "blocked_approval" else "progress"
        if workflow_kind in ("completion", "error") and int(awaiting) != 0:
            raise ValueError("unqualified workflow terminal")
        if status == "succeeded" and int(settled) == 0:
            raise ValueError("empty workflow success")
    if not isinstance(event["kind"], str) or not isinstance(event["text"], str) or event["kind"] not in LABELS or (event["text"] not in LABELS[event["kind"]] and event["kind"] != workflow_kind):
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
            # state is mutable transport data, deliberately absent from identity.
            event = {**json.loads(payload), 'state': 'accepted'}
            if not visible:
                receipt = adapter.deliver(event)
                if receipt is None:  # Busy/unsupported session: persist and retry, never drop.
                    continue
                expected={"version": event["version"], "eventId": event_id, "hermesSessionId": event["hermesSessionId"], "state": "visible"}
                if event["version"] == 2:
                    expected["runId"]=event["runId"]
                if receipt != expected:
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

def validate_origin(base, *, private_relay=False, loopback_test=False):
    """Private HTTP exceptions are exact byte-pinned origins, never URL patterns."""
    if not isinstance(base, str) or any(c.isspace() for c in base):
        raise ValueError("invalid origin")
    if (private_relay and base == "http://127.0.0.1:4001") or (loopback_test and base == "http://127.0.0.1:4898"):
        return base
    url = urllib.parse.urlsplit(base)
    if (url.scheme != "https" or not url.hostname or url.username is not None or
            url.password is not None or url.query or url.fragment or
            url.path not in ("", "/") or "?" in base or "#" in base):
        raise ValueError("HTTPS or exact opted-in loopback origin required")
    url.port  # Reject invalid ports before creating any request.
    return base.rstrip("/")

class Subscriber:
    def __init__(self, base, token, inbox, adapter, run_id=None, *, private_relay=False, loopback_test=False):
        self.base = validate_origin(base, private_relay=private_relay, loopback_test=loopback_test)
        self.token, self.inbox, self.adapter = token, inbox, adapter
        if run_id is not None and (not isinstance(run_id,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}",run_id)):
            raise ValueError("invalid run identity")
        self.run_id=run_id
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, path, body=None):
        request = urllib.request.Request(self.base + "/hermes-notify" + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        return self.opener.open(request, timeout=20)

    def ack(self, event_id, state):
        with self.request(f"/runs/{self.run_id}/ack" if self.run_id else "/ack", {"eventId": event_id, "state": state}) as response:
            if response.status != 200:
                raise ValueError("ACK rejected")

    def receive(self, event):
        validate(event)
        if (self.run_id is None and event["version"] != 1) or (self.run_id is not None and (event["version"] != 2 or event["runId"] != self.run_id)):
            raise ValueError("subscriber authority mismatch")
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
            with self.request(f"/runs/{self.run_id}/events" if self.run_id else "/events") as response:
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
                with self.request(f"/stream?runId={self.run_id}" if self.run_id else "/stream") as response:
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
    parser.add_argument("--run-id", help="explicit V2 run-owner inbox; adapter must authorize immutable run/conversation")
    parser.add_argument("--allow-loopback-test", action="store_true")
    parser.add_argument("--allow-private-relay", action="store_true", help="opt in only to http://127.0.0.1:4001; operator must attest upstream ownership")
    args = parser.parse_args()
    try:
        validate_origin(args.base_url, private_relay=args.allow_private_relay, loopback_test=args.allow_loopback_test)
    except ValueError:
        parser.error("HTTPS or exact explicitly opted-in loopback origin required")
    token = os.environ.get("RHYTHM_NOTIFY_TOKEN")
    if not token:
        parser.error("explicit owner-bound RHYTHM_NOTIFY_TOKEN required; no auth fallback")
    adapter = importlib.import_module(args.adapter).adapter
    Subscriber(args.base_url, token, Inbox(args.inbox), adapter, args.run_id,
               private_relay=args.allow_private_relay, loopback_test=args.allow_loopback_test).run()

if __name__ == "__main__":
    main()
