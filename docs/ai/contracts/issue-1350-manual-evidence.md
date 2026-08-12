# Issue #1350 packaged/debug host evidence

The fixture is disabled unless `RHYTHM_MCP_APP_HOST_FIXTURE=valid|malicious`
and a canonical enabled `RHYTHM_MCP_APPS_MODE` is present. Missing or invalid
mode exits closed.

The UI-capable orchestrator must run both the Debug app and a packaged Release
app with each fixture. Record that the valid fixture produces one accepted
`host.ping`; the malicious fixture produces only denials for foreign origin,
stale nonce, unknown method, network/navigation/popup/download attempts, and
persistent-storage probes. The iframe must never observe the native channel or
credentials, and closing/expiry must remove the view and handler.

Any accepted malicious action, persistent data after restart, bridge access
from the child frame, or missing teardown is a release-blocking failure. Mode
`off` must keep the generic fallback and create no WebKit view.
