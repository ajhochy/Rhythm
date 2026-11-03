---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: null
issues: []
status: installed-and-verified
tags: [run, rhythm, tailscale, launchd]
---

# Login startup and automatic recovery

## Files

AJ explicitly requested automatic startup at login so the web app stays available without manually opening the candidate. Installed `/Users/ajhochhalter/Library/LaunchAgents/com.ajhochhalter.rhythm-web-host.plist` (0600, user-owned). Logs: `/Users/ajhochhalter/Library/Logs/Rhythm Web Host/{stdout,stderr}.log` (0600; directory0700). No credential contents are stored in the plist or receipts: only the existing credential file path is passed.

Launches the existing verified Developer ID signed candidate directly at `/Users/ajhochhalter/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/eager-star/apps/electron/dist/Rhythm.app/Contents/MacOS/Rhythm`, source89596fc186fa2662da66e0ba2f19413cbf6559c7. The app continues to own its API/engine and native bridges; no standalone api_server or external backend service was introduced. No app/source rebuild or copying of bundles. The candidate path and its `apps/web/dist-web` assets must remain in place; this registration follows this exact candidate rather than an app installed in Applications.

Configuration: RunAtLoadtrue, KeepAlivetrue, ThrottleInterval30, ExitTimeOut30, Aqua login session, ProcessTypeInteractive, Umask077. Retains all previously accepted exact local/HTTPS origins, owner1, cloud credential path, loopback API bind and normal local role. Required flags explicitly set and verified loaded: `RHYTHM_WORKSTREAMS_ENABLED=true`, `RHYTHM_MANAGED_CONTEXT_EXPORTS=1`. Mobile4002 remains disabled. Tailscale Serve, ACLs and443/8443 were not changed.

## Checks

- `python3 -I /private/tmp/rhythm-web-install-login-agent.py` — CLI0. Deep/strict signature and bundled source identity verified; credential metadata only (regular/single-link, owner,0600). Generated plist passed `/usr/bin/plutil -lint` exit0. Verified old candidate PID/executable, graceful shutdown, ports4001/4002/4096 free. Installed plist with exclusive create; `/bin/launchctl bootstrap gui/501 /Users/ajhochhalter/Library/LaunchAgents/com.ajhochhalter.rhythm-web-host.plist` exit0. launchd started desktop67591/API67600/engine67646.
- `python3 -I /private/tmp/rhythm-web-final-candidate-ready.py` — CLI0, exact app/engine/build/assets match, cloud available, owner bound,4002 absent.
- `python3 -I /private/tmp/rhythm-web-login-agent-20261022/check-recovery.py` — CLI0. SIGTERM only exact owned desktop67591; launchd automatically restarted it as68041 without a kickstart command. Final API68048 and engine68094. `launchctl print gui/501/com.ajhochhalter.rhythm-web-host` confirms running, runs2, matching PID, required environment flags loaded.
- Repeated exact candidate readiness command — CLI0 after recovery; bundle executable ownership/version/assets and cloud/owner readiness pass.
- `node /private/tmp/rhythm-web-login-agent-20261022/browser-proof.mjs` — CLI0: actual private MagicDNS HTTPS URL, Tasks render/reload, cloud true, native bridge absent, WebSocket101; zero HTTP mutations/page errors.
- `curl --noproxy '*' --connect-timeout 4 --max-time 10 -sS -o /dev/null -w 'HTTPS status=%{http_code} cert_verify=%{ssl_verify_result}\n' https://ajs-macbook-pro-3.tail3798ec.ts.net:4001/` — CLI0, HTTP200, certificate verification0, no bypass.
- `tailscale serve status --json` parsed equality to pre-agent configuration: unchanged. Plist/log owner/modes checked. [Durable receipt](../../testing/results/2026-10-22-web-login-agent.json).

## Notes and management

Starts when AJ logs into this Mac and automatically restarts if it exits. This is a per-user GUI-session LaunchAgent, not a pre-login/system daemon. A complete logout/login was not forced; actual launchd bootstrap and automatic restart were tested. No sleep/power settings were changed. Source/package93-row parity, real-account4, and AJ's previous actual Mac mini page confirmation remain separate evidence; this configuration-only change did not rerun paid checks.

Because KeepAlive is enabled, quitting Rhythm alone causes launchd to restart it. To stop and disable automatic startup, run these commands in order:

```sh
launchctl disable gui/501/com.ajhochhalter.rhythm-web-host
launchctl bootout gui/501/com.ajhochhalter.rhythm-web-host
```

To enable again after disabling/booting out:

```sh
launchctl enable gui/501/com.ajhochhalter.rhythm-web-host
launchctl bootstrap gui/501 /Users/ajhochhalter/Library/LaunchAgents/com.ajhochhalter.rhythm-web-host.plist
```

Fallback candidate/worktree and existing real data are preserved. No push, PR, merge, Funnel or additional Tailscale/network changes.
