"""Seed one disposable Hermes history row for the private qualification actor."""

import os
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        raise RuntimeError("qualification Hermes history arguments invalid")
    session_id, title = sys.argv[1:]
    if not session_id.startswith("smoke-") or not title.startswith("[smoke] "):
        raise RuntimeError("qualification Hermes history marker invalid")
    home = Path(os.environ["HOME"]).resolve(strict=True)
    hermes_home = Path(os.environ["HERMES_HOME"]).resolve(strict=True)
    if hermes_home.parent != home.parent or home.name != "home" or hermes_home.name != "hermes-home":
        raise RuntimeError("qualification Hermes history escaped its private fixture")

    from hermes_state import SessionDB
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    db = SessionDB()
    try:
        db.create_session(session_id=session_id, source="cli")
        db.append_message(session_id=session_id, role="user", content="[smoke] Private history request")
        db.append_message(session_id=session_id, role="assistant", content="[smoke] Private history response")
        if not db.set_session_title(session_id, title):
            raise RuntimeError("qualification Hermes history title unavailable")
    finally:
        db.close()

    response = TestClient(app).get(
        "/api/sessions?limit=20&min_messages=2&archived=exclude",
        headers={_SESSION_HEADER_NAME: _SESSION_TOKEN},
    )
    if response.status_code != 200:
        raise RuntimeError("qualification Hermes history route unavailable")
    rows = response.json().get("sessions", [])
    if not any(row.get("id") == session_id and row.get("title") == title for row in rows):
        raise RuntimeError("qualification Hermes history row unavailable")


if __name__ == "__main__":
    main()
