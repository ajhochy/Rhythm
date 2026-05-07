$ curl -i -X POST 'https://api.vcrcapps.com/recurring-rules/__ping__/steps' -H 'Content-Type: application/json' -d '{}'

HTTP/2 401
content-type: application/json
{"error":{"code":"UNAUTHORIZED","message":"Missing bearer token"}}

VERDICT: route exists. Auth middleware fires (401) before reaching the controller — this is what we expect for a properly registered POST /:id/steps endpoint. Compare to a non-existent route which would 404 from the catch-all. Production is deployed and ready for the new MCP version.

DEFERRED to manual setup (user action): npm publish --access public from apps/mcp_server, then git tag mcp-v0.4.0 && git push --tags. Publishing is irreversible shared-state and is left to the user.
