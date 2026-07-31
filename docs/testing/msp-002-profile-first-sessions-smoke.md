---
date: 2026-07-30
workstream: MSP-002
platform: iOS and Android
status: pending-native-verification
---

# MSP-002 profile-first session smoke

Run this checklist only against a signed development build connected to the
isolated development environment. Do not point it at production data.

Record:

- Device and OS:
- Build identifier:
- Commit SHA:
- Tester:
- Timestamp:
- Screenshot or recording:

## New-chat entry points

- [ ] Chats list plus opens the New chat sheet before creating anything.
- [ ] Workspace plus opens the same New chat sheet.
- [ ] Chat three-dot menu → New chat opens the same New chat sheet.
- [ ] Profile is preselected to Secretary in every sheet.
- [ ] Secretary's configured model, reasoning, and approval policy are shown.
- [ ] Selecting another profile immediately loads that profile's configured
      model and defaults.
- [ ] Changing Model, Reasoning, or Approval Policy after profile selection
      creates the chat with those overrides.
- [ ] Opening an empty workspace through `/agents/chat` creates its automatic
      bootstrap session with Secretary defaults.

## Session configuration and isolation

- [ ] The three-dot button is announced as “Session configuration”.
- [ ] The sheet announces Profile, Model, Reasoning, and Approval Policy in a
      sensible focus order.
- [ ] Approval Policy explains that its scope is only the current chat and
      does not change global OpenCode auto-approval.
- [ ] Profile search matches a human label, Rhythm profile ID, OpenCode agent
      ID, provider ID, and configured model ID.
- [ ] Model search matches a human label, full model ID, provider ID/provider
      label, and account label.
- [ ] In chat A, change all four execution controls and close the sheet.
- [ ] Open chat B and confirm its four values are unchanged.
- [ ] Change chat B, switch A → B → A, and confirm each chat restores only its
      own values after refresh/relaunch.
- [ ] Send one prompt in each chat and confirm the selected agent/model and
      approval behavior match that chat's sheet.

## Accessibility and layout

- [ ] VoiceOver/TalkBack traps focus within each open sheet and returns focus
      to the three-dot or plus trigger after dismissal.
- [ ] Search results, selected values, Back, Close, and Create are announced.
- [ ] Dynamic Type / large font does not clip labels, scope explanation, or
      approval choices.
- [ ] Keyboard appearance and dismissal leave search results and actions
      reachable.
- [ ] Composer growth, cap, internal scrolling, and empty-draft reset still
      pass the MSP-005 native checklist.

## Result

- [ ] PASS — all checks have signed native evidence.
- [ ] FAIL — record the exact step, observed behavior, and evidence.

No live/device check was run in this implementation session. The workstream
explicitly prohibited starting servers, binding ports 4096–4098, or running
`tools/dev/sandbox.sh`.
