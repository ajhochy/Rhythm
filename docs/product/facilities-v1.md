# Facilities V1 Rollout Notes

## Status

Facilities v1 is ready for internal beta with manual release validation.

Current shipped behavior:
- all staff can view all reservations
- regular users can create reservations and edit/delete only their own
- facilities managers can book on behalf of others and manage any reservation
- single reservations and recurring series are supported
- recurring series management supports full-series edit/delete
- manager overview supports day/week/month summaries with room and building filters
- reservation notes are visible in overview and detail views

Deferred for v1:
- Google Calendar two-way sync with `Facilities Use`

## QA Checklist

Run this checklist before publishing a beta build or handing the feature to testers.

- verify all staff can open Facilities and view room schedules
- verify a regular user can create a single reservation with title, room, date, time, requester, and optional notes
- verify a regular user can edit and delete only reservations they created
- verify a facilities manager can create a reservation for another person
- verify a facilities manager can edit and delete any reservation
- verify conflict detection blocks overlapping time ranges
- verify recurring reservations can be created as weekly, bi-weekly, monthly, and custom-date series
- verify recurring conflicts are reported per occurrence instead of failing the full series
- verify series detail opens from the reservation card or overview row
- verify full-series edit and delete work from the series detail dialog
- verify overview filters work for date range, room, and building
- verify notes and conflict state are visible in the manager overview
- verify a fresh macOS beta build installs and opens successfully

## Known Limitations

- Google Calendar two-way sync is intentionally deferred for now.
- reservations are live immediately; there is no approval workflow
- room metadata is limited to the existing room/building fields
- notes are free text only
- recurring edits are full-series only; single-occurrence editing is not yet supported
- there is no structured setup-equipment checklist yet

