# Phase 7: Multiuser Accounts & Collaboration — Design Spec

**Date:** 2026-04-13
**Issues:** #62 (Workspaces), #53 (Collaborative tasks/projects), #124 (Messages identity)
**Milestone:** Phase 7: Multiuser Accounts & Collaboration

---

## Overview

Phase 7 adds real multi-user collaboration to Rhythm. The model is user-owned data with explicit collaborators — not workspace-scoped everything. A workspace is a lightweight user directory for one church. It controls who exists in the system and who can be added as a collaborator on tasks, projects, and message threads.

Auth (Google OAuth, session tokens, Flutter integration) is already complete. The hosted API is the canonical backend.

---

## Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Workspace model | One per church | Church staff all share one context |
| Roles | `admin` + `staff` only | No viewer/read-only tier needed |
| Join mechanism | Join code (8-char) | Simpler than email invites; admin controls code rotation |
| Data scoping | User-owned + explicit collaborators | Tasks are personal by default; sharing is opt-in per item |
| Workspace-scoped FK on tasks | Nullable `workspace_id` | Avoids forced migration; enables future admin views |
| Messages identity | `sender_id` from auth context; retire `sender_name` | Free-text name was a workaround |
| Thread types | `direct` (2 participants) + `group` (unrestricted) | Group threads requested in Phase 7 |

---

## Onboarding Flow

When a user signs in with Google for the first time and has no workspace membership:

1. Google Sign-In → backend creates/links user account
2. Flutter detects no workspace in `/auth/me` response
3. Flutter shows **Join or Create** screen:
   - **Create**: enter a workspace name → creates workspace, user becomes admin, join code generated
   - **Join**: enter an 8-char join code → adds user as `staff` member
4. User lands in the main app with workspace context set

The Join or Create screen blocks all other navigation — the app shell is not accessible until workspace membership is established.

Returning users: session restored → workspace loaded from `/auth/me` → straight to app.

---

## Data Model

### New Tables

**`workspaces`**
```
id           INTEGER PK AUTOINCREMENT
name         TEXT NOT NULL
join_code    TEXT NOT NULL UNIQUE  -- 8-char alphanumeric, regeneratable
created_by   INTEGER FK → users.id
created_at   DATETIME
```

**`workspace_members`**
```
workspace_id  INTEGER FK → workspaces.id
user_id       INTEGER FK → users.id
role          TEXT NOT NULL  -- 'admin' | 'staff'
joined_at     DATETIME
PRIMARY KEY (workspace_id, user_id)
```

**`task_collaborators`**
```
task_id    INTEGER FK → tasks.id
user_id    INTEGER FK → users.id
added_at   DATETIME
PRIMARY KEY (task_id, user_id)
```

**`project_collaborators`**
```
project_instance_id  INTEGER FK → project_instances.id
user_id              INTEGER FK → users.id
added_at             DATETIME
PRIMARY KEY (project_instance_id, user_id)
```

### Modified Tables

**`tasks`** — add `workspace_id INTEGER NULLABLE FK → workspaces.id`. Set to the creating user's workspace on all new task creation. Existing rows remain NULL.

**`messages`** — retire `sender_name` (keep column but stop writing it; derive display name from users join). `sender_id` is now always required.

**`message_threads`** — add `thread_type TEXT NOT NULL DEFAULT 'direct'` — values: `'direct'` | `'group'`

### Unchanged

`thread_participants` and `thread_reads` already support the required behavior. No changes needed.

---

## API Changes

### Auth

`GET /auth/me` — extend response to include:
```json
{
  "user": { ... },
  "workspace": { "id": 1, "name": "Grace Church", "joinCode": "XKCD1234" },
  "workspaceRole": "admin"
}
```
`joinCode` only returned if `workspaceRole === 'admin'`. Users with no workspace get `workspace: null`.

### New: Workspace Endpoints

| Method | Path | Description |
|---|---|---|
| POST | /workspaces | Create workspace (caller becomes admin) |
| POST | /workspaces/join | Join via join code |
| GET | /workspaces/me | Current workspace + role |
| GET | /workspaces/me/members | List all workspace members |
| PATCH | /workspaces/me/members/:userId | Change role (admin only) |
| DELETE | /workspaces/me/members/:userId | Remove member (admin only) |
| POST | /workspaces/me/join-code/regenerate | Regenerate join code (admin only) |

### New: Collaborator Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /tasks/:id/collaborators | List collaborators on a task |
| POST | /tasks/:id/collaborators | Add collaborator (body: `{ userId }`) |
| DELETE | /tasks/:id/collaborators/:userId | Remove collaborator |
| GET | /project-instances/:id/collaborators | List collaborators on a project |
| POST | /project-instances/:id/collaborators | Add collaborator |
| DELETE | /project-instances/:id/collaborators/:userId | Remove collaborator |

### Modified: Tasks

`GET /tasks` — return tasks where `owner_id = currentUser` OR `task_collaborators.user_id = currentUser`. Include a `isShared: true` flag on tasks the user doesn't own.

### Modified: Message Threads

`POST /message-threads` — accept `participantIds: number[]` and `threadType: 'direct' | 'group'`. Direct threads enforce exactly 2 participants (existing behavior). Group threads are unrestricted.

`GET /message-threads` — return only threads the current user is a participant of. Include `unreadCount` derived from `thread_reads.last_read_at` vs latest message `created_at`.

`GET /message-threads/:id/messages` — join with `users` to return `senderName` and `senderPhotoUrl` derived from the user record, not the stored `sender_name` column.

---

## Flutter Changes

### Auth & Session

`AuthSessionService` stores workspace context from `/auth/me`:
- `workspace` (id, name, joinCode if admin)
- `workspaceRole` (`'admin'` | `'staff'` | `null`)

New `WorkspaceOnboardingView` shown when `workspace == null` after sign-in. Two actions: create workspace (text field for name) or join workspace (text field for code).

### Settings Screen

New workspace section visible to all users:
- Workspace name
- Copy join code button (admin only — shows code; staff see nothing)
- Member list with roles
- Admin controls: change role, remove member, regenerate join code

### Tasks

Task card and detail view: collaborator avatar row. Tapping opens a people picker (workspace members, excluding current owner and existing collaborators). Owner can remove collaborators via long-press or edit mode. Tasks shared with the current user show a subtle "shared" badge and the owner's name.

### Projects

Project instance detail: same collaborator avatar row and people picker as tasks.

### Messages

- Thread list: real name + photo from user record; unread dot from `unreadCount`
- New Message button: shows a dialog to pick `Direct Message` or `Group Thread`, then select participants from workspace member list
- Group thread header: comma-separated participant names
- Message bubbles: sender photo + name inline for all participants (not just the other party)
- Sending a message marks the thread as read for the current user (`thread_reads` upsert)

---

## Acceptance Criteria

- A new Google user sees Join or Create on first launch
- Creating a workspace generates an 8-char join code
- A second user can join with that code and sees the app
- Admin can view/manage members in Settings
- A task owner can add a workspace member as a collaborator; the task appears in the collaborator's task list
- Removing a collaborator removes the task from their list
- Same add/remove flow works for project instances
- Messages show real user names and photos
- Direct messages work between two workspace members
- Group threads can be created with 3+ participants
- Unread dots appear and clear correctly
