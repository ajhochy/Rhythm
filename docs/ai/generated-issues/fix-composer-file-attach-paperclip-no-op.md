# fix(#602): composer file-attach paperclip does nothing — file picker never opens

## Problem

PR #617's #602 claim:
> "Model picker, permission-mode pill, reasoning effort, fast-mode toggle, and a new file-attach button all live in the composer area. Attachments render as chips above the input."

The paperclip icon is rendered in the composer, but clicking it does nothing. No file picker opens. No native dialog, no inline picker, no error. The chip-above-input area never gets populated because the entry-point click is a no-op.

## Likely cause

There's a related historical fix on this branch (commit `2439594` — *"replace file_picker plugin with osascript folder dialog"*) that swapped the `file_picker` Dart plugin out for an `osascript` shell-out for folder selection. If the paperclip handler is still wired to the old `file_picker` plugin call (which was removed) or to a Dart method that's been replaced/renamed, the click handler will silently fail.

Also possible: the handler is wired to a method that exists but throws (Process.run error, plugin missing) and the error gets swallowed without surfacing to the user.

## Reproduction (vbeta.18.36)

1. Open or create any agent session.
2. Click the paperclip icon in the composer.
3. Nothing happens — no native picker, no inline UI change, no error.

## Scope

`apps/desktop_flutter/lib/features/agents/views/` — find the composer view + paperclip button handler. Check:
- The onPressed callback target — does it call into a method that still exists?
- Is the call wrapped in try/catch that swallows the error?
- Has `file_picker` been removed from `pubspec.yaml` and replaced with the osascript approach? If yes, the handler needs to be updated to use the new path (likely `Process.run('osascript', ...)` returning a file path, like the folder picker does).

## Acceptance criteria

- [ ] Click paperclip → native macOS file picker opens.
- [ ] Pick a file → chip appears above the composer input with the file name + X to remove.
- [ ] Multi-file selection works (or is intentionally single-file with rationale documented).
- [ ] Send a turn with the file attached → server receives the `parts` array containing the file path/data; agent acknowledges the file in the response.
- [ ] X on the chip removes it from the pending attachments.

## Severity

Medium — visible UI control that is non-functional. Easy to file as polish, but it actively misleads the user about what the composer can do.
