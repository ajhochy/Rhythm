# Task Assignment Email Notifications — Implementation Plan

**Spec:** [`docs/superpowers/specs/2026-05-04-task-assignment-email-notifications-design.md`](../specs/2026-05-04-task-assignment-email-notifications-design.md)

**Goal:** Send a transactional email via Resend when a user is assigned a task or added as a task collaborator. Users can opt out via a Settings toggle.

**Tech Stack:** Node.js / TypeScript / Express / Resend SDK / Flutter / SQLite + Postgres dual-write

---

## Phase 1 — Foundation: opt-out column + model wiring

### 1.1 Add `email_notifications_enabled` column to `users`

**Files:**
- `apps/api_server/src/database/migrations.ts` — add `ALTER TABLE` block in the SQLite migration section, mirroring the existing `is_facilities_manager` pattern around line 335. Include the equivalent Postgres migration.

**Migration snippet (SQLite):**
```ts
const userColsP9 = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
if (!userColsP9.includes('email_notifications_enabled')) {
  db.exec(
    `ALTER TABLE users ADD COLUMN email_notifications_enabled INTEGER NOT NULL DEFAULT 1`,
  );
}
```

**Postgres equivalent** (in the postgres branch of migrations):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE;
```

**Acceptance:**
- Running the API server against an existing DB (both SQLite and Postgres) adds the column with default `true`/`1`
- All existing users get `emailNotificationsEnabled = true` after migration
- Re-running migrations is idempotent (no error)

### 1.2 Update `User` model + `UsersRepository` to expose `emailNotificationsEnabled`

**Files:**
- `apps/api_server/src/models/user.ts` — add `emailNotificationsEnabled: boolean` to `User`, `CreateUserDto` (optional), `UpdateUserDto` (optional)
- `apps/api_server/src/repositories/users_repository.ts` — add the column to `UserRow` interface, `rowToUser()` mapping (handle SQLite's `0|1` → boolean), all SELECT/INSERT/UPDATE statements

**Acceptance:**
- `findByIdAsync()` returns `emailNotificationsEnabled: boolean`
- `updateAsync({ emailNotificationsEnabled: false })` persists correctly in both SQLite and Postgres
- Existing tests still pass

---

## Phase 2 — Email Service

### 2.1 Add `resend` package and email env vars

**Files:**
- `apps/api_server/package.json` — add `resend` dependency (latest stable, currently `^4.x`)
- `apps/api_server/src/config/env.ts` — add two env getters:
  ```ts
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'Rhythm <onboarding@resend.dev>',
  ```
- `apps/api_server/.env.production.example` — add `RESEND_API_KEY=` and `EMAIL_FROM_ADDRESS=Rhythm <notifications@yourdomain.com>` template lines

**Acceptance:**
- `npm install` succeeds; `resend` listed in `dependencies`
- `env.resendApiKey` is `''` when var unset; populated when set
- `.env.production.example` has the new vars documented (empty key)

### 2.2 Create `EmailService`

**Files:**
- Create: `apps/api_server/src/services/email_service.ts`
- Create: `apps/api_server/src/services/email_service.test.ts`

**Service shape:**
```ts
import { Resend } from 'resend';
import { env } from '../config/env';
import type { UsersRepository } from '../repositories/users_repository';

export class EmailService {
  private readonly client: Resend | null;

  constructor(private readonly usersRepo: UsersRepository) {
    this.client = env.resendApiKey ? new Resend(env.resendApiKey) : null;
  }

  async sendTaskAssignedEmailAsync(
    taskId: string,
    taskTitle: string,
    actorName: string,
    recipientUserId: number,
    actorUserId: number,
  ): Promise<void> {
    await this.sendCollaborationEmailAsync({
      taskId, taskTitle, actorName, recipientUserId, actorUserId,
      subjectVerb: 'assigned you to',
    });
  }

  async sendCollaboratorAddedEmailAsync(
    taskId: string,
    taskTitle: string,
    actorName: string,
    recipientUserId: number,
    actorUserId: number,
  ): Promise<void> {
    await this.sendCollaborationEmailAsync({
      taskId, taskTitle, actorName, recipientUserId, actorUserId,
      subjectVerb: 'added you to',
    });
  }

  private async sendCollaborationEmailAsync(params: {
    taskId: string;
    taskTitle: string;
    actorName: string;
    recipientUserId: number;
    actorUserId: number;
    subjectVerb: string;
  }): Promise<void> {
    if (params.recipientUserId === params.actorUserId) return;
    if (!this.client) return;

    const recipient = await this.usersRepo.findByIdAsync(params.recipientUserId).catch(() => null);
    if (!recipient || !recipient.emailNotificationsEnabled || !recipient.email) return;

    const link = `rhythm://tasks/${params.taskId}`;
    const subject = `${params.actorName} ${params.subjectVerb} "${params.taskTitle}" in Rhythm`;
    const html = `
      <p>${escapeHtml(params.actorName)} has invited you to collaborate on
      "<strong>${escapeHtml(params.taskTitle)}</strong>" in Rhythm.</p>
      <p><a href="${link}">Click here to open in Rhythm</a></p>
      <hr>
      <p style="color:#6B7280;font-size:12px">
        You're receiving this because you have email notifications enabled in Rhythm.
      </p>
    `;
    const text = `${params.actorName} has invited you to collaborate on "${params.taskTitle}" in Rhythm.\n\nOpen in Rhythm: ${link}`;

    try {
      await this.client.emails.send({
        from: env.emailFromAddress,
        to: recipient.email,
        subject,
        html,
        text,
      });
    } catch (err) {
      console.error('[email] send failed', err);
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
```

**Tests** (vitest, mocking `Resend` and `UsersRepository`):
- skips when `recipientUserId === actorUserId`
- skips when `RESEND_API_KEY` is unset (no-op, no throw)
- skips when recipient `emailNotificationsEnabled` is false
- skips when recipient not found
- calls `client.emails.send` with correct subject/from/to when enabled
- swallows Resend errors (does not throw)
- HTML escapes special chars in `actorName` and `taskTitle`

**Acceptance:**
- All tests pass: `cd apps/api_server && npm test`
- `EmailService` is independently constructible from `UsersRepository`

---

## Phase 3 — Wire into TasksController

### 3.1 Hook `EmailService` into task assignment + collaborator add

**Files:**
- Modify: `apps/api_server/src/controllers/tasks_controller.ts`

**Changes:**

Top of file — add imports + instantiate:
```ts
import { EmailService } from '../services/email_service';
import { UsersRepository } from '../repositories/users_repository';

const usersRepo = new UsersRepository();
const emailService = new EmailService(usersRepo);
```

In `update()` — after the existing `notifyTaskAssignedAsync` call (around line 67), fetch the actor name and fire the email:

```ts
if (
  data.ownerId !== undefined &&
  updated.ownerId != null &&
  updated.ownerId !== existing.ownerId &&
  actorId != null
) {
  await notifService.notifyTaskAssignedAsync(
    updated.id,
    updated.title,
    updated.ownerId,
    actorId,
  );
  const actor = await usersRepo.findByIdAsync(actorId).catch(() => null);
  if (actor) {
    await emailService.sendTaskAssignedEmailAsync(
      updated.id,
      updated.title,
      actor.name,
      updated.ownerId,
      actorId,
    );
  }
}
```

In `addCollaborator()` — after the existing `notifyCollaboratorAddedAsync` call (around line 142):

```ts
await notifService.notifyCollaboratorAddedAsync(
  'task',
  req.params.id,
  task.title,
  userId,
  actorId,
);
const actor = await usersRepo.findByIdAsync(actorId).catch(() => null);
if (actor) {
  await emailService.sendCollaboratorAddedEmailAsync(
    req.params.id,
    task.title,
    actor.name,
    userId,
    actorId,
  );
}
```

**Acceptance:**
- PATCH `/tasks/:id` with `ownerId` change → email received by new owner (when `RESEND_API_KEY` is set, recipient opted in, and recipient ≠ actor)
- POST `/tasks/:id/collaborators` → email received by new collaborator
- Self-assignment / self-add does NOT send email
- Email failures do not break the API response (logged only)
- Existing in-app notification still fires correctly

---

## Phase 4 — Flutter opt-out toggle

### 4.1 Add `PATCH /users/me/preferences` endpoint

The existing `PATCH /users/:id` requires admin. Users need to update their own preferences without admin role. Add a self-service endpoint.

**Files:**
- Modify: `apps/api_server/src/controllers/users_controller.ts` — add `updateMyPreferences` method
- Modify: `apps/api_server/src/routes/users_routes.ts` — wire `PATCH /users/me/preferences` route (must be registered BEFORE `:id` route to avoid path collision)

**Controller method:**
```ts
async updateMyPreferences(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.auth!.user.id;
    const { emailNotificationsEnabled } = req.body as Record<string, unknown>;
    if (typeof emailNotificationsEnabled !== 'boolean') {
      throw AppError.badRequest('emailNotificationsEnabled must be a boolean');
    }
    const user = await repo.updateAsync(userId, { emailNotificationsEnabled });
    res.json(user);
  } catch (err) {
    next(err);
  }
}
```

**Route registration** (BEFORE `:id` patterns):
```ts
usersRouter.patch('/me/preferences', controller.updateMyPreferences.bind(controller));
```

**Acceptance:**
- Authenticated non-admin user can `PATCH /users/me/preferences { emailNotificationsEnabled: false }` and the change persists
- Returns the updated user object
- Bad request body → 400
- Unauthenticated → 401

### 4.2 Add Flutter user preferences data layer

**Files:**
- Create: `apps/desktop_flutter/lib/features/settings/data/user_preferences_data_source.dart`
- Modify: `apps/desktop_flutter/lib/features/settings/repositories/settings_repository.dart` — add `updateEmailNotifications(bool enabled)` method
- Modify: `apps/desktop_flutter/lib/features/settings/controllers/settings_controller.dart` — add `bool emailNotificationsEnabled`, loader, `setEmailNotifications(bool)` that calls the repository and `notifyListeners()`
- Modify: `apps/desktop_flutter/lib/app/core/auth/auth_user.dart` — add `emailNotificationsEnabled` field, parse from JSON (`json['emailNotificationsEnabled'] ?? true`)

**Data source method:**
```dart
Future<void> updateEmailNotifications(bool enabled) async {
  final response = await http.patch(
    Uri.parse('$baseUrl/users/me/preferences'),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $token',
    },
    body: jsonEncode({'emailNotificationsEnabled': enabled}),
  );
  if (response.statusCode != 200) {
    throw Exception('Failed to update preferences: ${response.statusCode}');
  }
}
```

**Acceptance:**
- Repository method round-trips successfully against the API
- Controller exposes `emailNotificationsEnabled` and updates state on toggle
- `AuthUser.fromJson` reads the new field, defaults to `true` when missing

### 4.3 Add Email Notifications toggle to Settings view

**Files:**
- Modify: `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`

Add a new section (under existing settings rows) titled "Notifications" with a single `SwitchListTile`:

```dart
Card(
  child: Column(
    children: [
      ListTile(
        title: Text('Notifications', style: ...),
        dense: true,
      ),
      const Divider(height: 1),
      SwitchListTile(
        title: const Text('Email notifications'),
        subtitle: const Text(
          "Get an email when you're assigned a task or added as a collaborator",
        ),
        value: settingsController.emailNotificationsEnabled,
        onChanged: (value) async {
          try {
            await settingsController.setEmailNotifications(value);
          } catch (e) {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Failed to update: $e')),
              );
            }
          }
        },
      ),
    ],
  ),
),
```

**Acceptance:**
- Settings view shows the toggle in current state from the user's profile
- Toggling immediately persists via API call
- Failure shows a SnackBar; toggle reverts to previous state on error
- `flutter analyze --no-fatal-infos` passes
- `dart format .` produces no diff

---

## Implementation Order

The phases must be done in order; within a phase, sub-steps can in some cases be parallelized but blocked-by relationships are noted in the GitHub issues.

1. 1.1 (migration) → blocks everything
2. 1.2 (model + repo) → blocks 2.2, 3.1, 4.1
3. 2.1 (deps + env) → blocks 2.2
4. 2.2 (EmailService) → blocks 3.1
5. 3.1 (wire into controller) — backend complete after this
6. 4.1 (preferences endpoint) → blocks 4.2
7. 4.2 (Flutter data layer) → blocks 4.3
8. 4.3 (Settings UI) — feature complete

---

## Out of Scope (separate PRs)

- `rhythm://` URL scheme registration in `Info.plist` + Swift `kAEGetURL` handler
- Method Channel + deep-link routing in Flutter
- Specific-task highlight/scroll in `TasksView` based on the deep link
- Email notifications for other event types (step completed, rhythm step due/unlocked, etc.)
- `desktop_release.yml` workflow update to embed `RESEND_API_KEY` for the bundled-server build path (only needed if the bundled local server is expected to send emails — typically users hit the hosted API)
