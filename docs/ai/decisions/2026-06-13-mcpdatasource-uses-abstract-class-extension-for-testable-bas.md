---
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# McpDataSource uses abstract class + extension for testable baseUrlForTest (#702)

**Context:** Issue #702 test fake uses `class _FakeMcpDataSource implements McpDataSource` but does NOT implement `baseUrlForTest`. Contract test c5 calls `McpDataSource().baseUrlForTest`. These two requirements are contradictory if `baseUrlForTest` is a regular public method on the class.

**Decision:** `McpDataSource` is an abstract class declaring only the 5 async operation methods (no `baseUrlForTest`). `_McpDataSourceImpl` is the private concrete class that holds `_baseUrl`. `baseUrlForTest` is defined as an extension method on `McpDataSource` (via `McpDataSourceTestExtension`) that casts to `_McpDataSourceImpl` and reads `_baseUrl`. Extension methods are NOT part of the Dart interface contract — `implements McpDataSource` does NOT require the fake to implement them. Both test requirements are satisfied.

**Alternatives considered:**
- Make `baseUrlForTest` abstract on `McpDataSource`: fails — fake must implement it but test file can't be modified.
- Make `McpDataSource` a factory with a private concrete: `McpDataSource()` return type is the abstract type; `ds.baseUrlForTest` won't compile unless it's on the abstract type.
- Expose `baseUrl` as a public field on the concrete impl and cast in c5: too fragile — callers could reach it accidentally.

**Consequences:** All extension-based access is in-library only. Production code cannot accidentally call `baseUrlForTest` from another package (analyzer enforces `@visibleForTesting`). The cast in the extension `(this as _McpDataSourceImpl)` will throw at runtime if called on a fake — which is the desired behavior (tests should use the real class for c5).
