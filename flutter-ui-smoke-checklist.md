# Odysseus Flutter UI — Smoke Test Checklist

Branch: `feature/agent-scheduler`
Commit: `feat(odysseus): Flutter UI for agent scheduler, memory, research, webhooks, profiles`

One testable action per screen. Run these with the local server running (`pnpm dev` in `apps/api_server`).

---

## 1. Agent Profiles (Agents tab → left rail)

- [ ] **Create a specialist profile** — Open Agents tab, scroll to bottom of the left projects rail, tap the `+` (person-add) icon, fill in a name (e.g. "Dev Agent"), write a system prompt, select 2–3 MCPs from the checklist, tap Save. Confirm the profile initial appears in the rail.

- [ ] **Create a manager profile** — Repeat but check the "Manager" checkbox. Confirm a ★ badge appears on the icon in the rail.

- [ ] **Edit a profile** — Long-press or right-click an existing profile icon in the rail. Confirm the sheet opens pre-populated with current values.

---

## 2. Scheduled Tasks (Agents tab → ⏱ header icon, or Settings → Agent Tools → Scheduled Tasks)

- [ ] **View list** — Tap the schedule icon in the Agent Sessions header. Confirm "Scheduled Tasks" opens with an empty state or list.

- [ ] **Create a daily task** — Tap FAB (+), enter name + prompt, select "Daily", pick a time (e.g. 09:00), pick an agent profile, tap "Create Schedule". Confirm it appears with label "Daily at 09:00".

- [ ] **Create a cron task** — Create another task with type "Cron Expression", enter `0 8 * * 1-5`, confirm the cron preview line updates.

- [ ] **Swipe to delete** — Swipe a task row left. Confirm delete confirmation dialog appears and task is removed on confirm.

- [ ] **Trigger now** — Tap a task to open the detail sheet, tap "Trigger Now". Confirm no error toast appears.

---

## 3. Agent Memory (Settings → Agent Tools → Agent Memory)

- [ ] **Open screen** — Settings → AGENT TOOLS → "Agent Memory". Confirm the screen opens with search bar.

- [ ] **Search** — Type a query in the search bar. Confirm list updates or shows "No results". Clear field and confirm full list returns.

- [ ] **Long-press delete** — Long-press a memory tile. Confirm delete confirmation dialog appears. Cancel it (no crash).

- [ ] **Clear all** — Tap the trash icon in the AppBar. Confirm confirmation dialog appears. Cancel it.

---

## 4. Deep Research (Agents tab → 🔭 header icon)

- [ ] **Open screen** — Tap the explore icon in the Agent Sessions header. Confirm "Deep Research" opens.

- [ ] **Start a research job** — Tap FAB (+), enter a query (e.g. "Flutter 3.33 release notes"), pick depth, tap "Start". Confirm job appears in Active section with progress bar.

- [ ] **Job progresses** — Wait ~10 seconds. Confirm status label updates (Queued → Gathering → Reading → Synthesizing).

- [ ] **View completed report** — Tap a completed job. Confirm bottom sheet opens with full report text and a copy icon.

- [ ] **Copy report** — Tap the copy icon. Confirm no crash.

---

## 5. Webhook Endpoints (Settings → Agent Tools → Webhook Endpoints)

- [ ] **Open screen** — Settings → AGENT TOOLS → "Webhook Endpoints". Confirm screen opens.

- [ ] **Create a webhook** — Tap FAB (+), enter a name, optionally a target prompt, tap Create. Confirm a success sheet appears with the receive URL.

- [ ] **Copy URL** — Tap the copy icon in the success sheet. Confirm no crash.

- [ ] **See webhook in list** — Dismiss success sheet. Confirm new endpoint appears in list with trigger count 0.

- [ ] **Delete a webhook** — Long-press the webhook tile. Confirm delete confirmation dialog. Confirm deletion removes the endpoint.

---

## 6. Settings → Agent Tools navigation

- [ ] All three tiles in Settings → AGENT TOOLS open their respective screens and each has a working AppBar back button.

---

## Regression

- [ ] **Agents tab loads normally** — Projects rail, sessions list, and agent server status dot all render correctly after the new profiles section is added.

- [ ] **flutter analyze clean** — `flutter analyze --no-pub` in `apps/desktop_flutter` → 0 errors, 0 warnings.
