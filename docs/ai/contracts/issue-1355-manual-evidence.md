# Issue #1355 two-pilot evidence

In `readonly`, run one Open Design call and one `rhythm_get_dashboard` call in
Debug and packaged Release. Both must use the generic descriptor/resource host,
show fallback before HTML, render after load, deny links/actions, make no network
request from the iframe, and preserve fallback after resource failure. In `off`,
both remain generic tool cards and create no WebView. In `interactive`, dashboard
may request only same-server app-visible tools through #1357. Any pilot-specific
Flutter branch, changed MCP tool count, external iframe request, or accepted
unsupported method blocks release.
