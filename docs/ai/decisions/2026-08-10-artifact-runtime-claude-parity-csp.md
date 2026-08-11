---
tags: [decision, api_server, live-artifacts, security]
---

# Artifact runtime Claude-parity CSP

## Context

Live smoke showed that nonce-only CSP prevented Claude-style artifacts from rendering their inline style/script and curated CDN/font resources. The runtime remains a sandboxed, credential-free artifact surface, not a general browser.

## Decision

Replace nonce-only bundle CSP with the reviewed Claude-parity allowlist: inline script/style plus `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, and `unpkg.com`; Google Fonts is allowed only for styles and fonts. Keep `connect-src 'none'`, `form-action 'none'`, `base-uri 'none'`, `frame-src 'none'`, `object-src 'none'`, header `sandbox allow-scripts`, and `frame-ancestors 'none'`.

The bridge nonce remains a message-binding nonce, not a CSP nonce. `window.rhythm` and `window.__rhythmHostResponse` remain frozen. Full HTML documents are assembled in place; fragment bundles retain the server wrapper.

## Alternatives

- Retain nonce-only CSP: rejected because CSP2 ignores `'unsafe-inline'` when a nonce appears, so it cannot provide Claude parity.
- Allow arbitrary HTTPS images: rejected. It expands the URL-path exfiltration channel to every host without being required for parity; images remain `data:`, `blob:`, and curated CDN hosts.

## Consequences

Residual risk is deliberate and bounded: scripts/styles/font requests to allowlisted CDN/font hosts can encode data in URL paths. This is accepted for Claude parity. It does not provide arbitrary network access because `connect-src 'none'` remains.

The following invariants remain test-asserted or enforced at their existing boundary: Flutter-side authenticated render fetch keeps credentials out of artifact markup; `connect-src 'none'`; native top-level navigation, form, download, popup, and media blocking; bridge request nonce and frozen bridge objects; revision/audit history; artifact ACLs; and existing approval gates for agent actions. Meta refresh stripping and CSS/JS closing-tag escaping apply to both document assembly paths.
