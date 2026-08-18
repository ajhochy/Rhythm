---
date: 2026-08-12
repo: Rhythm
branch: mobile/synology-relay
pr: none
issues: [1387]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue 1387 physical-device smoke

## Files

- The c19 repair under test preserves the same active project, session, and transcript when one
  paired Cloud Gateway identity moves between connected and unavailable.
- The strengthened c19 client contract and real-uplink restart diagnostic reproduce that state
  transition through the actual provider and relay boundaries.
- This final checkpoint changed only the postmortem, failure-pattern history, run log, and project
  snapshot. It did not edit product or contract files.

## Checks

- PASS — physical c19 after rebuild and install: stop the desktop while a chat is already open; the
  phone retained the complete transcript, changed the header to Offline, never showed
  `Opening chat`, and automatically returned the same transcript to Connected after restoration.
- PASS — manual `RELAY_FINAL_TWO`: the phone stayed Connected throughout while relay health remained
  `macOnline: true` and the Cloudflare socket was established.
- PASS — c22 cached transcript on cold offline launch and c24 automatic recovery.
- PASS — c25 honest Gallery hydration and persisted-project artifacts.
- PASS — c26 honest desktop-offline catalog with mirrored sessions still visible.
- PASS — c27 safe project name after one online catalog refresh and a second cold offline launch.
- PASS — online Models, Profiles, session list, and chat opening.
- PASS — `npx jest tests/contract/issue-1387-false-offline-after-send.test.tsx --runInBand`
  (1/1).
- PASS — `npx jest tests/contract/issue-1387-offline-cold-relaunch.test.tsx --runInBand`
  (2/2).
- PASS — focused c19/c22/c24/c26/c27 plus chat-route and open-session-cache contracts (10/10).
- PASS — offline transcript and atomic open-session Node contracts (13/13).
- PASS — mobile typecheck, targeted ESLint, and diff check.
- PASS — real `RelayUplinkClient`/`RelayUplinkServer` restart diagnostic (1/1).
- EXCLUDED — Terminal, paused at the user's request and not a mobile blocker.

## Notes

- The first manual `RELAY_FINAL` send on the older final build coincided with relay health changing
  to `macOnline: false` with `lastUplinkAt: null`. The phone collapsed to `Opening chat` and reported
  that the Cloud Gateway could not reach the Mac, then recovered and persisted both the prompt and
  exact response. The desktop API and engine remained alive; the Cloudflare socket was observed in
  `CLOSE_WAIT`.
- The next `RELAY_FINAL_TWO` send stayed Connected under a healthy relay. Together, those two turns
  show that sending a prompt did not itself trigger the outage; the first turn overlapped a fresh or
  restarted relay instance.
- The strengthened c19 contract reproduced the transcript collapse before the repair. After the
  repair, the final physical uplink-loss check preserved the transcript and recovered automatically.
- Final relay health was `macOnline: true`, and the desktop app was restored to its signed-in
  Dashboard.
- Older caches still require one online catalog refresh before safe project labels are mirrored.
- No Tailscale fallback was used or required. No commit, push, PR, or CI work was performed.
