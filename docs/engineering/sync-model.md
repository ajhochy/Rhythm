# Sync Model

## Source of truth rules
- Google Calendar: canonical event timing.
- Gmail: canonical thread/message state.
- Planning Center: canonical plan/service data.
- Rhythm: canonical planning constructs (tasks, weekly plans, project breakdown, scheduling).

## External sync boundaries
External providers are imported/linked as signals; Rhythm stores normalized references and planning projections.

## Normalized events
All imported provider data should be translated to normalized internal forms before planning logic consumes it.

## Rule engine concept
Automation/recurrence rules are applied in a deterministic pipeline that can be safely rerun.

## Task/project generation pipeline
1. Read recurrence/project templates.
2. Generate concrete task/project instances for planning horizon.
3. Merge external shadow events.
4. Build weekly planning read model.
