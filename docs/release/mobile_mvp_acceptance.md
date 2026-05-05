# Rhythm Mobile MVP — Manual Sync Acceptance Test Plan

Covers the cross-device sync acceptance criteria from issue #70.
Run all steps against the production API (`https://api.vcrcapps.com`) on a physical iOS or Android device.

---

## Prerequisites

- Desktop Flutter app (or web prototype) is open and authenticated.
- Mobile app is installed, launched, and authenticated via Google OAuth.
- Both clients point to `https://api.vcrcapps.com`.

---

## Test cases

### 1. Login on mobile via Google OAuth completes successfully

- [ ] Open the mobile app on a fresh install (or after signing out).
- [ ] Tap **Sign in with Google**.
- [ ] Complete the Google OAuth flow in the in-app browser.
- [ ] The app returns to the Today view and the task list loads without errors.

---

### 2. Create a task on desktop → pull-to-refresh on mobile → task appears

- [ ] On the desktop app, create a new task (e.g. "Sync test task A").
- [ ] Switch to the mobile app.
- [ ] Pull down on the Today view to trigger a manual refresh.
- [ ] "Sync test task A" appears in the list.

---

### 3. Mark a task done on mobile → refresh on desktop → task shows as done

- [ ] On the mobile app, tap the checkbox on an existing incomplete task to mark it complete.
- [ ] Switch to the desktop app and refresh the task list.
- [ ] The task is shown as completed on desktop.

---

### 4. Create a task on mobile → refresh on desktop → task appears

- [ ] On the mobile app, tap **+ Add Task** (Quick Add) and create a task (e.g. "Sync test task B").
- [ ] Switch to the desktop app and refresh the task list.
- [ ] "Sync test task B" appears in the list.

---

### 5. Background the mobile app for ≥10 s and reopen → tasks list refreshes automatically

- [ ] With the mobile app open, press the Home button (or swipe up) to background the app.
- [ ] Wait at least 10 seconds.
- [ ] Reopen the Rhythm mobile app.
- [ ] The Today view shows a brief loading indicator (or the list momentarily empties and repopulates), confirming that `tasksController.load()` was triggered on resume.
- [ ] Any tasks created or changed on desktop during those 10 seconds are now visible on mobile without a manual pull-to-refresh.

---

### 6. Reopen the mobile app within 5 s of last refresh → no duplicate refresh fires

- [ ] Open the mobile app. Wait for the initial task list to load.
- [ ] Note the current time.
- [ ] Immediately background and reopen the app within 5 seconds.
- [ ] Confirm that no second network request is made (verify via Proxyman/Charles proxy or a debug print in `tasksController.load()` — the method should NOT be called a second time).
- [ ] The task list is still shown without a re-loading state.

---

## Pass criteria

All six checkboxes above must be checked before marking the mobile MVP sync story closed.
