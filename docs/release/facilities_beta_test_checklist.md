# Facilities Beta Test Checklist

Use this checklist for the Facilities beta validation pass on April 9, 2026.

## Environment

- Install and open the latest macOS beta build on a clean machine.
- Confirm the app launches without a crash.
- Confirm sign-in works.
- Confirm the API server starts normally from the packaged app.

## Regular User Flow

- Sign in as a normal staff user.
- Open Facilities.
- Confirm all rooms load.
- Confirm existing reservations are visible.
- Open the overview screen.
- Confirm day, week, and month views load.
- Confirm building filter works.
- Confirm room filter works.
- Confirm date-range controls work.
- Confirm the user can create a single reservation.
- Confirm required fields behave correctly: room, date, start time, end time, title, requester.
- Confirm optional notes can be added.
- Confirm overlapping single reservations are blocked.
- Confirm the user can edit a reservation they created.
- Confirm the user can delete a reservation they created.
- Confirm the user cannot edit or delete someone else’s reservation.

## Facilities Manager Flow

- Sign in as a facilities manager.
- Open Facilities overview.
- Confirm summary cards render.
- Confirm the Attention Needed section renders.
- Confirm notes are visible without opening every reservation.
- Confirm conflicts are clearly marked.
- Confirm the manager can create a reservation on behalf of another person.
- Confirm the manager can edit another person’s reservation.
- Confirm the manager can delete another person’s reservation.
- Confirm overview row actions open details correctly.

## Recurring Reservations

- Create a weekly recurring reservation.
- Create a bi-weekly recurring reservation.
- Create a monthly recurring reservation.
- Create a custom-date recurring reservation.
- Confirm recurring summary shows created dates and conflicted dates.
- Confirm one conflicting occurrence does not block the whole series.
- Open a recurring reservation from the overview.
- Confirm series details are visible.
- Edit the entire series.
- Delete the entire series.
- Confirm linked occurrences update or disappear correctly.

## Conflict And Visibility Checks

- Create a reservation with notes like chairs, tables, TV, or podium.
- Confirm those notes appear in overview and detail views.
- Confirm conflict badges appear on conflicting reservations.
- Confirm room-level daily schedule context appears while editing/booking.

## Regression Checks

- Confirm Facilities screen still loads after logout/login.
- Confirm switching between Rooms and Overview does not lose state unexpectedly.
- Confirm no obvious layout breakage on common desktop window sizes.
- Confirm filters do not produce stale reservation results.

## Known V1 Limits To Keep In Mind

- Google Calendar two-way sync is not part of this beta.
- Reservations are live immediately; there is no approval workflow.
- Recurring edits are full-series only.
- Setup needs are free-text notes only.

## Pass/Fail Notes

- Record any failed step with:
  - user role
  - room
  - exact action taken
  - expected result
  - actual result
  - screenshot if useful
