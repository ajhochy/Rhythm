# Task Assignment Email Notifications — Design Spec

**Date:** 2026-05-04  
**Status:** Approved  

---

## Overview

When a user is assigned to a task (either as `ownerId` or as a collaborator), Rhythm sends them a transactional email via [Resend](https://resend.com). Users can opt out of email notifications via a toggle in Settings. The feature builds on the existing in-app `NotificationService` pattern rather than replacing it.

---

## Scope

**In scope:**
- Email sent when a task's `ownerId` changes to a new user
- Email sent when a collaborator is added to a task
- Per-user opt-out preference stored in the database
- Flutter Settings toggle for opt-out
- `rhythm://tasks/{taskId}` deep link in email body (functional once the deep-link PR lands)

**Out of scope (future PRs):**
- `rhythm://` URL scheme registration in the Flutter/macOS app (separate PR)
- Email notifications for other event types (step completion, rhythm steps, etc.)
- Email queue / retry infrastructure
- Custom email templates via a template engine

---

## Architecture

### New component: `EmailService`

`src/services/email_service.ts` — a standalone service with two public methods. `TasksController` instantiates it alongside the existing `NotificationService`. Both are called at the same trigger points.

```
TasksController
  ├── NotificationService  (in-app DB notification — unchanged)
  └── EmailService         (new — sends via Resend)
```

`EmailService` is responsible for:
1. Fetching the recipient user (email address + opt-out flag)
2. Skipping silently if opted out or if `RESEND_API_KEY` is not configured
3. Sending via the Resend SDK
4. Catching and logging any send errors without surfacing them to the API caller

### Data flow — task assignment

```
PATCH /tasks/:id  { ownerId: 42 }
  → TasksController.update()
  → detect ownerId changed to a new user
  → fetch actor user → get actorName
  → notifService.notifyTaskAssignedAsync(...)       // existing, unchanged
  → emailService.sendTaskAssignedEmailAsync(        // new
      taskId, taskTitle, actorName, recipientUserId
    )
      → usersRepo.findByIdAsync(recipientUserId)
      → if !emailNotificationsEnabled → return
      → resend.emails.send({ to, subject, html })
      → catch + log silently
```

### Data flow — collaborator added

```
POST /tasks/:id/collaborators  { userId: 42 }
  → TasksController.addCollaborator()
  → repo.addCollaboratorAsync(...)
  → notifService.notifyCollaboratorAddedAsync(...)  // existing, unchanged
  → emailService.sendCollaboratorAddedEmailAsync(   // new
      taskId, taskTitle, actorName, recipientUserId
    )
```

---

## Email Template

**Subject:** `{actorName} added you to "{taskTitle}" in Rhythm`

**Body (HTML + plain text fallback):**
```
{actorName} has invited you to collaborate on "{taskTitle}" in Rhythm.

[Click here to open in Rhythm](rhythm://tasks/{taskId})

You're receiving this because you have email notifications enabled in Rhythm.
```

The `rhythm://tasks/{taskId}` link is included now. It will be inert until the deep-link PR ships, but costs nothing to include and makes the email future-proof.

---

## Database Changes

One new column on the `users` table:

```sql
ALTER TABLE users ADD COLUMN email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```

Migration added to `src/database/migrations.ts` (existing `ALTER TABLE IF NOT EXISTS` pattern, compatible with both SQLite and Postgres).

The `User` model and `UsersRepository` are updated to include `emailNotificationsEnabled: boolean`.

---

## Configuration

Two new environment variables added to `src/config/env.ts`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `RESEND_API_KEY` | No | `undefined` | If absent, `EmailService` is a silent no-op |
| `EMAIL_FROM_ADDRESS` | No | `Rhythm <onboarding@resend.dev>` | Sender address; use Resend sandbox sender for dev |

When `RESEND_API_KEY` is not set (e.g. local dev without email configured), the service logs a debug message and returns without sending. No errors thrown.

---

## New npm Dependency

```
resend  (latest stable)
```

Added to `apps/api_server/package.json` dependencies.

---

## Flutter Settings Toggle

A new row added to `SettingsView` under a "Notifications" section:

- Label: **Email notifications**
- Subtitle: *Receive an email when you're assigned a task or added as a collaborator*
- Widget: `Switch`
- On toggle: calls `PATCH /users/:id` with `{ emailNotificationsEnabled: bool }`

The existing `UpdateUserDto` and `UsersRepository.updateAsync()` are extended to accept `emailNotificationsEnabled`. No new endpoint needed.

---

## Error Handling

- Email send failures are caught in `EmailService`, logged to console (`console.error`), and swallowed. The API response is unaffected.
- If the recipient user cannot be found, the email is skipped silently.
- If `RESEND_API_KEY` is missing, the service is a no-op (no error, no log spam — one debug log at startup).

---

## Self-assignment Guard

`EmailService` mirrors the existing `NotificationService` pattern: if `recipientUserId === actorUserId`, return early without sending.

---

## Implementation Phases

| Phase | Work |
|---|---|
| 1 — Foundation | DB migration, User model update, UsersRepository update |
| 2 — Email Service | `resend` package, env vars, `EmailService` implementation |
| 3 — Wire Up | Hook `EmailService` into `TasksController` at both trigger points |
| 4 — Flutter Opt-Out | Settings toggle + `UpdateUserDto` + repository update |
