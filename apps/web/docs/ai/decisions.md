# Decisions

## 2026-08-13 — Direct-edit inspectors

Inspector selection is the edit intent for editable records. Existing permissions remain authoritative: read-only and source-owned records continue to expose only supported fields. Reuse each page’s existing form and save handler inside the persistent inspector rather than introducing a new shared data model.

