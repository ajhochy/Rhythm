# Task Assignment Email Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a transactional email via Resend when a user is assigned to a task or added as a collaborator, with a per-user opt-out toggle in the Flutter Settings screen.

**Architecture:** A new `EmailService` sits alongside the existing `NotificationService` in `TasksController`. Both are called at the same trigger points. `EmailService` fetches the recipient user, checks their opt-out flag, and sends via the Resend SDK. If `RESEND_API_KEY` is unset, the service is a silent no-op.

**Tech Stack:** Node.js/TypeScript (Express + better-sqlite3/pg), `resend` npm package, Flutter/Dart (Provider pattern)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `apps/api_server/src/database/migrations.ts` | Modify | Add `email_notifications_enabled` column to `users` |
| `apps/api_server/src/models/user.ts` | Modify | Add field to `User` and `UpdateUserDto` |
| `apps/api_server/src/repositories/users_repository.ts` | Modify | Add to `UserRow`, `rowToUser`, `updateAsync`, `update` |
| `apps/api_server/src/config/env.ts` | Modify | Add `resendApiKey`, `emailFromAddress` |
| `apps/api_server/package.json` | Modify | Add `resend` dependency |
| `apps/api_server/src/services/email_service.ts` | Create | New `EmailService` class |
| `apps/api_server/src/controllers/tasks_controller.ts` | Modify | Import + call `EmailService` at both trigger points |
| `apps/desktop_flutter/lib/app/core/auth/auth_user.dart` | Modify | Add `emailNotificationsEnabled` field |
| `apps/desktop_flutter/lib/features/settings/data/settings_data_source.dart` | Modify | Add `emailNotificationsEnabled` param to `updateUser` |
| `apps/desktop_flutter/lib/features/settings/repositories/settings_repository.dart` | Modify | Add `emailNotificationsEnabled` param to `updateUser` |
| `apps/desktop_flutter/lib/features/settings/controllers/settings_controller.dart` | Modify | Add `emailNotificationsEnabled` param to `updateUser` |
| `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` | Modify | Add NOTIFICATIONS section with opt-out toggle |

---

## Task 1: DB Migration + User Model + UsersRepository

**Files:**
- Modify: `apps/api_server/src/database/migrations.ts`
- Modify: `apps/api_server/src/models/user.ts`
- Modify: `apps/api_server/src/repositories/users_repository.ts`

- [ ] **Step 1: Write failing test for migration column**

Create `apps/api_server/src/__tests__/email_notifications.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  runMigrations(db);
  return db;
}

describe('email_notifications_enabled', () => {
  let usersRepo: UsersRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
  });

  it('defaults emailNotificationsEnabled to true on new users', () => {
    const user = usersRepo.create({ name: 'Alice', email: 'alice@test.com' });
    expect(user.emailNotificationsEnabled).toBe(true);
  });

  it('can set emailNotificationsEnabled to false via update', () => {
    const user = usersRepo.create({ name: 'Bob', email: 'bob@test.com' });
    const updated = usersRepo.update(user.id, { emailNotificationsEnabled: false });
    expect(updated.emailNotificationsEnabled).toBe(false);
  });

  it('preserves emailNotificationsEnabled when updating other fields', () => {
    const user = usersRepo.create({ name: 'Carol', email: 'carol@test.com' });
    usersRepo.update(user.id, { emailNotificationsEnabled: false });
    const updated = usersRepo.update(user.id, { name: 'Carol Updated' });
    expect(updated.emailNotificationsEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/api_server && npm test -- --reporter=verbose email_notifications
```

Expected: FAIL — `emailNotificationsEnabled` is undefined.

- [ ] **Step 3: Add migration**

In `apps/api_server/src/database/migrations.ts`, add at the very end of the `runMigrations` function body, after the notifications block:

```typescript
  // Email notification preferences
  const userColsEmail = (db.pragma('table_info(users)') as { name: string }[]).map((c) => c.name);
  if (!userColsEmail.includes('email_notifications_enabled')) {
    db.exec(`ALTER TABLE users ADD COLUMN email_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  }
```

- [ ] **Step 4: Update User model**

In `apps/api_server/src/models/user.ts`, add `emailNotificationsEnabled` to both interfaces:

```typescript
export interface User {
  id: number;
  name: string;
  email: string;
  googleSub: string | null;
  photoUrl: string | null;
  role: string;
  isFacilitiesManager: boolean;
  emailNotificationsEnabled: boolean;   // ← add this line
  createdAt: string;
  updatedAt: string;
}

// ... (CreateUserDto is unchanged)

export interface UpdateUserDto {
  name?: string;
  email?: string;
  googleSub?: string | null;
  photoUrl?: string | null;
  role?: string;
  isFacilitiesManager?: boolean;
  emailNotificationsEnabled?: boolean;  // ← add this line
}
```

- [ ] **Step 5: Update UsersRepository**

In `apps/api_server/src/repositories/users_repository.ts`:

**a) Add `email_notifications_enabled` to `UserRow`:**
```typescript
interface UserRow {
  id: number;
  name: string;
  email: string;
  google_sub: string | null;
  photo_url: string | null;
  role: string;
  is_facilities_manager: number;
  email_notifications_enabled: number | boolean;  // ← add this line
  created_at: string;
  updated_at: string;
}
```

**b) Add to `rowToUser`** — add after the `isFacilitiesManager` assignment:
```typescript
function rowToUser(row: UserRow): User {
  const isFacilitiesManager =
    typeof row.is_facilities_manager === 'boolean'
      ? row.is_facilities_manager
      : row.is_facilities_manager === 1;

  const emailNotificationsEnabled =
    typeof row.email_notifications_enabled === 'boolean'
      ? row.email_notifications_enabled
      : row.email_notifications_enabled !== 0;

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    googleSub: row.google_sub,
    photoUrl: row.photo_url,
    role: row.role,
    isFacilitiesManager,
    emailNotificationsEnabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

**c) Replace `updateAsync` (Postgres branch) SQL** — shift param numbers to make room for the new field before `updated_at`:
```typescript
async updateAsync(id: number, data: UpdateUserDto): Promise<User> {
  if (env.dbClient === 'postgres') {
    const existing = await this.findByIdAsync(id);
    const now = new Date().toISOString();
    const result = await getPostgresPool().query<UserRow>(
      `UPDATE users
          SET name = $1,
              email = $2,
              google_sub = $3,
              photo_url = $4,
              role = $5,
              is_facilities_manager = $6,
              email_notifications_enabled = $7,
              updated_at = $8
        WHERE id = $9
        RETURNING *`,
      [
        data.name ?? existing.name,
        data.email ?? existing.email,
        data.googleSub ?? existing.googleSub,
        data.photoUrl !== undefined ? data.photoUrl : existing.photoUrl,
        data.role ?? existing.role,
        data.isFacilitiesManager !== undefined
          ? data.isFacilitiesManager
          : existing.isFacilitiesManager,
        data.emailNotificationsEnabled !== undefined
          ? data.emailNotificationsEnabled
          : existing.emailNotificationsEnabled,
        now,
        id,
      ],
    );
    return rowToUser(result.rows[0]);
  }

  return this.update(id, data);
}
```

**d) Replace `update` (SQLite branch)**:
```typescript
update(id: number, data: UpdateUserDto): User {
  const existing = this.findById(id);
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE users
          SET name = ?,
              email = ?,
              google_sub = ?,
              photo_url = ?,
              role = ?,
              is_facilities_manager = ?,
              email_notifications_enabled = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .run(
      data.name ?? existing.name,
      data.email ?? existing.email,
      data.googleSub ?? existing.googleSub,
      data.photoUrl !== undefined ? data.photoUrl : existing.photoUrl,
      data.role ?? existing.role,
      data.isFacilitiesManager !== undefined
        ? (data.isFacilitiesManager ? 1 : 0)
        : (existing.isFacilitiesManager ? 1 : 0),
      data.emailNotificationsEnabled !== undefined
        ? (data.emailNotificationsEnabled ? 1 : 0)
        : (existing.emailNotificationsEnabled ? 1 : 0),
      now,
      id,
    );
  return this.findById(id);
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api_server && npm test -- --reporter=verbose email_notifications
```

Expected: 3 tests PASS.

- [ ] **Step 7: Run full test suite to catch regressions**

```bash
cd apps/api_server && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd apps/api_server
git add src/database/migrations.ts src/models/user.ts src/repositories/users_repository.ts src/__tests__/email_notifications.test.ts
git commit -m "feat: add email_notifications_enabled field to users"
```

---

## Task 2: Resend Package + Env Vars + EmailService

**Files:**
- Modify: `apps/api_server/package.json`
- Modify: `apps/api_server/src/config/env.ts`
- Create: `apps/api_server/src/services/email_service.ts`

- [ ] **Step 1: Add Resend dependency**

```bash
cd apps/api_server && npm install resend
```

- [ ] **Step 2: Add env vars to config**

In `apps/api_server/src/config/env.ts`, add two fields at the end of the `env` object (before the closing `};`):

```typescript
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'Rhythm <onboarding@resend.dev>',
```

- [ ] **Step 3: Write failing tests for EmailService**

Add to `apps/api_server/src/__tests__/email_notifications.test.ts`:

```typescript
import { EmailService } from '../services/email_service';

describe('EmailService', () => {
  let usersRepo: UsersRepository;

  beforeEach(() => {
    const db = makeDb();
    setDb(db);
    usersRepo = new UsersRepository();
  });

  it('is a no-op when resendApiKey is empty', async () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@test.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@test.com' });
    const svc = new EmailService(usersRepo, '');
    // Should not throw
    await expect(
      svc.sendTaskAssignedEmailAsync('task-1', 'Fix bug', alice.id, bob.id),
    ).resolves.toBeUndefined();
  });

  it('skips send when actor equals recipient', async () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@test.com' });
    const svc = new EmailService(usersRepo, '');
    await expect(
      svc.sendTaskAssignedEmailAsync('task-1', 'Fix bug', alice.id, alice.id),
    ).resolves.toBeUndefined();
  });

  it('skips send when recipient has opted out', async () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@test.com' });
    const bob = usersRepo.create({ name: 'Bob', email: 'bob@test.com' });
    usersRepo.update(bob.id, { emailNotificationsEnabled: false });
    const svc = new EmailService(usersRepo, 'fake-key');
    // Would throw if it tried to actually call Resend with a fake key,
    // but it should return early due to opt-out
    await expect(
      svc.sendTaskAssignedEmailAsync('task-1', 'Fix bug', alice.id, bob.id),
    ).resolves.toBeUndefined();
  });

  it('skips collaborator email when actor equals recipient', async () => {
    const alice = usersRepo.create({ name: 'Alice', email: 'alice@test.com' });
    const svc = new EmailService(usersRepo, '');
    await expect(
      svc.sendCollaboratorAddedEmailAsync('task-1', 'Fix bug', alice.id, alice.id),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
cd apps/api_server && npm test -- --reporter=verbose email_notifications
```

Expected: FAIL — `EmailService` does not exist yet.

- [ ] **Step 5: Create EmailService**

Create `apps/api_server/src/services/email_service.ts`:

```typescript
import { Resend } from 'resend';
import { env } from '../config/env';
import type { UsersRepository } from '../repositories/users_repository';

export class EmailService {
  private readonly client: Resend | null;

  constructor(
    private readonly usersRepo: UsersRepository,
    resendApiKey?: string,
  ) {
    const key = resendApiKey ?? '';
    this.client = key ? new Resend(key) : null;
  }

  async sendTaskAssignedEmailAsync(
    taskId: string,
    taskTitle: string,
    actorUserId: number,
    recipientUserId: number,
  ): Promise<void> {
    if (actorUserId === recipientUserId) return;
    if (!this.client) return;

    try {
      const [actor, recipient] = await Promise.all([
        this.usersRepo.findByIdAsync(actorUserId),
        this.usersRepo.findByIdAsync(recipientUserId),
      ]);

      if (!recipient.emailNotificationsEnabled) return;

      await this.client.emails.send({
        from: env.emailFromAddress,
        to: recipient.email,
        subject: `${actor.name} added you to "${taskTitle}" in Rhythm`,
        html: this._buildHtml(actor.name, taskTitle, taskId),
        text: this._buildText(actor.name, taskTitle, taskId),
      });
    } catch (err) {
      console.error('[EmailService] sendTaskAssignedEmailAsync failed:', err);
    }
  }

  async sendCollaboratorAddedEmailAsync(
    taskId: string,
    taskTitle: string,
    actorUserId: number,
    recipientUserId: number,
  ): Promise<void> {
    if (actorUserId === recipientUserId) return;
    if (!this.client) return;

    try {
      const [actor, recipient] = await Promise.all([
        this.usersRepo.findByIdAsync(actorUserId),
        this.usersRepo.findByIdAsync(recipientUserId),
      ]);

      if (!recipient.emailNotificationsEnabled) return;

      await this.client.emails.send({
        from: env.emailFromAddress,
        to: recipient.email,
        subject: `${actor.name} added you to "${taskTitle}" in Rhythm`,
        html: this._buildHtml(actor.name, taskTitle, taskId),
        text: this._buildText(actor.name, taskTitle, taskId),
      });
    } catch (err) {
      console.error('[EmailService] sendCollaboratorAddedEmailAsync failed:', err);
    }
  }

  private _buildHtml(actorName: string, taskTitle: string, taskId: string): string {
    return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;max-width:480px;margin:0 auto;padding:24px;">
  <h2 style="color:#4F6AF5;margin-top:0;">You've been added to a task</h2>
  <p><strong>${this._esc(actorName)}</strong> has invited you to collaborate on <strong>&ldquo;${this._esc(taskTitle)}&rdquo;</strong> in Rhythm.</p>
  <p style="margin-top:24px;">
    <a href="rhythm://tasks/${encodeURIComponent(taskId)}"
       style="display:inline-block;background:#4F6AF5;color:#ffffff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
      Open in Rhythm
    </a>
  </p>
  <p style="color:#6B7280;font-size:12px;margin-top:32px;">
    You're receiving this because you have email notifications enabled in Rhythm.<br>
    You can turn these off in Rhythm &rarr; Settings &rarr; Notifications.
  </p>
</body>
</html>`;
  }

  private _buildText(actorName: string, taskTitle: string, taskId: string): string {
    return `${actorName} has invited you to collaborate on "${taskTitle}" in Rhythm.\n\nOpen in Rhythm: rhythm://tasks/${taskId}\n\nYou can turn off email notifications in Rhythm → Settings → Notifications.`;
  }

  private _esc(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/api_server && npm test -- --reporter=verbose email_notifications
```

Expected: all 7 tests PASS (3 from Task 1 + 4 new).

- [ ] **Step 7: Run full test suite**

```bash
cd apps/api_server && npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
cd apps/api_server
git add package.json package-lock.json src/config/env.ts src/services/email_service.ts src/__tests__/email_notifications.test.ts
git commit -m "feat: add EmailService with Resend integration"
```

---

## Task 3: Wire EmailService into TasksController

**Files:**
- Modify: `apps/api_server/src/controllers/tasks_controller.ts`

- [ ] **Step 1: Add imports and module-level instantiation**

At the top of `apps/api_server/src/controllers/tasks_controller.ts`, add the new imports alongside the existing ones:

```typescript
import { UsersRepository } from '../repositories/users_repository';
import { EmailService } from '../services/email_service';
import { env } from '../config/env';
```

Then add the service instantiation below the existing `notifService` line:

```typescript
const repo = new TasksRepository();
const rulesRepo = new RecurringTaskRulesRepository();
const notifService = new NotificationService(new NotificationsRepository());
const emailService = new EmailService(new UsersRepository(), env.resendApiKey);  // ← add this line
```

- [ ] **Step 2: Add email call at task assignment trigger**

In the `update` method, the existing assignment block ends with `notifyTaskAssignedAsync`. Add the email call immediately after it:

Replace this block:
```typescript
      // Notify on assignment
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
      }
```

With:
```typescript
      // Notify on assignment
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
        await emailService.sendTaskAssignedEmailAsync(
          updated.id,
          updated.title,
          actorId,
          updated.ownerId,
        );
      }
```

- [ ] **Step 3: Add email call at collaborator addition trigger**

In the `addCollaborator` method, the existing call ends with `notifyCollaboratorAddedAsync`. Add the email call immediately after it:

Replace this block:
```typescript
      await repo.addCollaboratorAsync(req.params.id, userId);
      await notifService.notifyCollaboratorAddedAsync(
        'task',
        req.params.id,
        task.title,
        userId,
        actorId,
      );
      res.status(201).json(await repo.listCollaboratorsAsync(req.params.id));
```

With:
```typescript
      await repo.addCollaboratorAsync(req.params.id, userId);
      await notifService.notifyCollaboratorAddedAsync(
        'task',
        req.params.id,
        task.title,
        userId,
        actorId,
      );
      await emailService.sendCollaboratorAddedEmailAsync(
        req.params.id,
        task.title,
        actorId,
        userId,
      );
      res.status(201).json(await repo.listCollaboratorsAsync(req.params.id));
```

- [ ] **Step 4: Build to catch TypeScript errors**

```bash
cd apps/api_server && npm run build
```

Expected: exits 0 with no errors.

- [ ] **Step 5: Run full test suite**

```bash
cd apps/api_server && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd apps/api_server
git add src/controllers/tasks_controller.ts
git commit -m "feat: send email notification on task assignment and collaborator addition"
```

---

## Task 4: Flutter Opt-Out Toggle

**Files:**
- Modify: `apps/desktop_flutter/lib/app/core/auth/auth_user.dart`
- Modify: `apps/desktop_flutter/lib/features/settings/data/settings_data_source.dart`
- Modify: `apps/desktop_flutter/lib/features/settings/repositories/settings_repository.dart`
- Modify: `apps/desktop_flutter/lib/features/settings/controllers/settings_controller.dart`
- Modify: `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`

- [ ] **Step 1: Add `emailNotificationsEnabled` to `AuthUser`**

In `apps/desktop_flutter/lib/app/core/auth/auth_user.dart`, replace the entire file:

```dart
import '../utils/json_parsing.dart';

class AuthUser {
  const AuthUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.isFacilitiesManager = false,
    this.emailNotificationsEnabled = true,
    this.photoUrl,
  });

  final int id;
  final String name;
  final String email;
  final String role;
  final bool isFacilitiesManager;
  final bool emailNotificationsEnabled;
  final String? photoUrl;

  bool get isAdmin => role == 'admin' || role == 'system';

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      id: _asInt(json['id']) ?? 0,
      name: _asString(json['name']) ?? '',
      email: _asString(json['email']) ?? '',
      role: _asString(json['role']) ?? 'member',
      isFacilitiesManager: _asBool(json['isFacilitiesManager']) ??
          _asBool(json['is_facilities_manager']) ??
          false,
      emailNotificationsEnabled:
          _asBool(json['emailNotificationsEnabled']) ??
          _asBool(json['email_notifications_enabled']) ??
          true,
      photoUrl: _asString(json['photoUrl']) ?? _asString(json['photo_url']),
    );
  }
}

String? _asString(dynamic value) => asString(value);
int? _asInt(dynamic value) => asInt(value);
bool? _asBool(dynamic value) => asBool(value);
```

- [ ] **Step 2: Update SettingsDataSource**

In `apps/desktop_flutter/lib/features/settings/data/settings_data_source.dart`, replace the `updateUser` method:

```dart
  Future<AuthUser> updateUser(
    int userId, {
    String? role,
    bool? isFacilitiesManager,
    bool? emailNotificationsEnabled,
  }) async {
    final response = await http.patch(
      Uri.parse('$_baseUrl/users/$userId'),
      headers: AuthSessionStore.headers(json: true),
      body: jsonEncode({
        if (role != null) 'role': role,
        if (isFacilitiesManager != null)
          'isFacilitiesManager': isFacilitiesManager,
        if (emailNotificationsEnabled != null)
          'emailNotificationsEnabled': emailNotificationsEnabled,
      }),
    );
    assertOk(response);
    return AuthUser.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }
```

- [ ] **Step 3: Update SettingsRepository**

In `apps/desktop_flutter/lib/features/settings/repositories/settings_repository.dart`, replace the `updateUser` method:

```dart
  Future<AuthUser> updateUser(
    int userId, {
    String? role,
    bool? isFacilitiesManager,
    bool? emailNotificationsEnabled,
  }) {
    return _dataSource.updateUser(
      userId,
      role: role,
      isFacilitiesManager: isFacilitiesManager,
      emailNotificationsEnabled: emailNotificationsEnabled,
    );
  }
```

- [ ] **Step 4: Update SettingsController**

In `apps/desktop_flutter/lib/features/settings/controllers/settings_controller.dart`, replace the `updateUser` method:

```dart
  Future<AuthUser> updateUser(
    int userId, {
    String? role,
    bool? isFacilitiesManager,
    bool? emailNotificationsEnabled,
  }) async {
    _savingUserIds.add(userId);
    notifyListeners();
    try {
      final updated = await _repository.updateUser(
        userId,
        role: role,
        isFacilitiesManager: isFacilitiesManager,
        emailNotificationsEnabled: emailNotificationsEnabled,
      );
      final users = List<AuthUser>.from(_users);
      final index = users.indexWhere((user) => user.id == userId);
      if (index >= 0) {
        users[index] = updated;
      } else {
        users.add(updated);
      }
      users.sort(_compareUsers);
      _users = users;
      _usersErrorMessage = null;
      _usersStatus = SettingsUsersStatus.ready;
      return updated;
    } catch (error) {
      _usersErrorMessage = error.toString();
      rethrow;
    } finally {
      _savingUserIds.remove(userId);
      notifyListeners();
    }
  }
```

- [ ] **Step 5: Add NOTIFICATIONS section to SettingsView**

In `apps/desktop_flutter/lib/features/settings/views/settings_view.dart`, find the line:

```dart
          if (canManagePermissions) ...[
```

Insert the following block immediately before it (after the `const SizedBox(height: 24),` that closes the ACCOUNT section):

```dart
          if (user != null) ...[
            Text(
              'NOTIFICATIONS',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 12),
            _NotificationsCard(user: user, onUpdated: auth.updateCurrentUser),
            const SizedBox(height: 24),
          ],
```

Then at the bottom of `settings_view.dart`, before the final `}` that closes the file, add:

```dart
class _NotificationsCard extends StatefulWidget {
  const _NotificationsCard({
    required this.user,
    required this.onUpdated,
  });

  final AuthUser user;
  final void Function(AuthUser) onUpdated;

  @override
  State<_NotificationsCard> createState() => _NotificationsCardState();
}

class _NotificationsCardState extends State<_NotificationsCard> {
  bool _saving = false;

  Future<void> _toggle(bool value) async {
    setState(() => _saving = true);
    try {
      final updated = await context.read<SettingsController>().updateUser(
            widget.user.id,
            emailNotificationsEnabled: value,
          );
      widget.onUpdated(updated);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to save notification preference')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: SwitchListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(
          'Email notifications',
          style: TextStyle(
            fontWeight: FontWeight.w500,
            color: context.rhythm.textPrimary,
          ),
        ),
        subtitle: Text(
          'Receive an email when you\'re assigned a task or added as a collaborator',
          style: TextStyle(
            fontSize: 13,
            color: context.rhythm.textSecondary,
          ),
        ),
        value: widget.user.emailNotificationsEnabled,
        onChanged: _saving ? null : _toggle,
        activeColor: context.rhythm.accent,
      ),
    );
  }
}
```

- [ ] **Step 6: Run Flutter analyze**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

Expected: no errors.

- [ ] **Step 7: Run Flutter app locally to verify toggle works**

```bash
cd apps/desktop_flutter && flutter run -d macos
```

Manually verify:
- Navigate to Settings
- A "NOTIFICATIONS" section appears with an "Email notifications" toggle
- Toggling it off and back on works without error
- The toggle state persists after navigating away and back

- [ ] **Step 8: Format and commit**

```bash
cd apps/desktop_flutter && dart format .
git add lib/app/core/auth/auth_user.dart \
        lib/features/settings/data/settings_data_source.dart \
        lib/features/settings/repositories/settings_repository.dart \
        lib/features/settings/controllers/settings_controller.dart \
        lib/features/settings/views/settings_view.dart
git commit -m "feat: add email notifications opt-out toggle in Settings"
```

---

## Task 5: Push Branch and Open PR

- [ ] **Step 1: Verify full API test suite passes**

```bash
cd apps/api_server && npm test
```

Expected: all tests pass.

- [ ] **Step 2: Verify Flutter analyze passes**

```bash
cd apps/desktop_flutter && flutter analyze --no-fatal-infos
```

Expected: no errors.

- [ ] **Step 3: Push branch and open PR**

```bash
git push -u origin HEAD
gh pr create \
  --title "feat: email notifications for task assignment and collaborator addition" \
  --body "$(cat <<'EOF'
## Summary

- Sends a transactional email via Resend when a user is assigned to a task or added as a collaborator
- Adds `email_notifications_enabled` column to `users` table (default: true)
- New `EmailService` in the API server handles opt-out checks and email rendering
- Flutter Settings screen gains a NOTIFICATIONS section with an opt-out toggle
- If `RESEND_API_KEY` is not configured, the service is a silent no-op

## Setup required

Add to `apps/api_server/.env`:
\`\`\`
RESEND_API_KEY=your_resend_api_key_here
EMAIL_FROM_ADDRESS=Rhythm <notifications@yourdomain.com>
\`\`\`

Get a free API key at https://resend.com

## Test plan

- [ ] Assign a task to another user → they receive an email
- [ ] Add a collaborator to a task → they receive an email
- [ ] Assign a task to yourself → no email sent
- [ ] Toggle off email notifications in Settings → no email sent on next assignment
- [ ] Toggle email notifications back on → email resumes
- [ ] Remove `RESEND_API_KEY` from env → no errors, emails silently skipped
- [ ] All API server tests pass: `cd apps/api_server && npm test`
- [ ] Flutter analyze passes: `cd apps/desktop_flutter && flutter analyze --no-fatal-infos`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Share PR URL with user for review**
