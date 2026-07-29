# Title

OCU-35C follow-up — Add privacy-safe transcript sharing UI to desktop Flutter

# Body

## Summary

Add the desktop Flutter workflow for Rhythm's internal transcript-sharing API
implemented by #1178. Keep sharing opt-in and inside the authenticated Rhythm
instance.

## Requirements

- Add a Share action to an agent session that opens a review/redaction screen
  before any network request.
- Display every candidate transcript item and clearly mark file contents, tool
  outputs, emails, PCO data, system prompts, attachments, and secret-pattern
  matches as excluded by default.
- Require an explicit per-item opt-in for protected categories and show that
  credentials/host paths remain redacted.
- Select one or more named Rhythm users as recipients; do not offer public
  links.
- Default expiry to 30 days and allow a future timestamp.
- Clearly distinguish the private live source session from the frozen shared
  snapshot.
- Add owned/received share lists showing recipients, expiration, exclusions,
  and revocation state.
- Show the owner-visible share/view/revoke audit history without transcript
  content.
- Allow the owner or an administrator to revoke with explicit confirmation and
  update the UI immediately after the API returns 204.

## API

- `POST /agent-sessions/:id/shares`
- `GET /shares`
- `GET /shares/:id`
- `DELETE /shares/:id`

## Acceptance

- Flutter widget tests cover review, default exclusions, explicit inclusion,
  named recipients, 30-day default expiry, and revoke confirmation.
- Accessibility semantics and keyboard navigation are verified.
- A desktop smoke test creates a share, reads it as a recipient, displays audit
  state to the owner, revokes it, and confirms the recipient can no longer
  open it.
- No OpenCode external/public sharing configuration or endpoint is introduced.
