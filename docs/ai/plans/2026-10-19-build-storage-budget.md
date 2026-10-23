# Shared build-storage budget

Scope: local build tooling for the user-authorized 10 GiB combined worker/check-out
budget. No release, installation, real-cache deletion or remote writes.

Implement a Python stdlib process-group supervisor with shared locked accounting,
marker-owned run scratch, retained output registry and bounded receipts. Add direct
Node/shell entrypoint supervision; document required wrappers for other builders.
Exercise tiny real byte budgets, nested wrappers, signals, concurrent workers and
safe cleanup. The limit is sampled and cooperative, not an OS quota. Preserve all
unrecognized data and existing active plans/state. Integration/review owner controls
activation and separately audited legacy-cache cleanup.
