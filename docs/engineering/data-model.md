# Data Model (High-level)

## Task
Concrete actionable item with schedule metadata; may originate from one-off input, recurrence generation, or project generation.

## RecurringTaskRule
Pattern definition (weekly/monthly/annual) used to pre-generate concrete Task instances.

## ProjectTemplate
Reusable annual project blueprint with target window and step definitions.

## ProjectTemplateStep
Relative step definition tied to template, often offset-based (e.g., 8 weeks before due date).

## ProjectInstance
Generated instance of a project template for a specific cycle/year.

## ExternalLink
Reference from Rhythm entities to external provider records (calendar event, email thread, plan id).

## AutomationRule
Declarative behavior rule describing generation/assignment behavior.

## WeeklyPlan
Curated view of week-specific workload assembled from multiple sources.

## CalendarShadowEvent
Read-only normalized representation of external calendar timing signals.
