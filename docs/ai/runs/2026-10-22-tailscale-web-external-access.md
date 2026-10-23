---
date: 2026-10-22
repo: Rhythm
branch: feat/tailscale-web-app-20261022
pr: null
issues: []
status: repaired-and-remote-confirmed
tags: [run, rhythm, tailscale, triage]
---

# External tailnet access diagnosis

## Files

No product source or packaged app change. [Policy diagnosis](../../testing/results/2026-10-22-web-external-policy-diagnosis.json) stores selected nonsecret policy conclusions; raw node/machine keys and full netmap are not recorded.

## Checks

- AJ reports Mac’s Mac mini shows a blank page with an endless browser spinner at HTTPS4001.
- Read registry and prior reports before diagnosis. `tailscale serve status --json`: private HTTPS4001 to127.0.0.1:4001 remains correctly configured. Local curl with normal certificate verification returns HTTP200/verify0/CLI0. API64835 still owns loopback4001. `tailscale debug prefs` selected fields: ShieldsUpfalse, WantRunningtrue. Tailscale health empty, backendRunning; netcheckUDPtrue.
- `tailscale debug netmap` parsed in memory with `ipaddress`: received TCP filter allows the host's ports1–4000 and4002–65535 to ordinary personal-tailnet peers, but4001 only from pi-nas. Check both source and destination CIDRs/protocol/port. Mac mini4001 assertion is RED, while pi-nas is allowed. Other online personal-tailnet devices also fail4001. No keys or full netmap logged.
- Tailscale admin initially authenticated to the church tailnet, which is not the target. Selecting personal `ajhochy@gmail.com` tailnet requires fresh Google sign-in. Correct personal account sign-in tab is open and handed to AJ; password/MFA entry remains with AJ.

## Notes

Root cause is the central access policy, not a browser login or app data-loading defect. AJ explicitly instructed that any device on the Tailscale network should be allowed. Authorized correction: permit all personal-tailnet devices to this Mac's IPv4/IPv6 TCP4001, preserving other rules. No additional permission is required. Application is pending personal admin authentication; no policy changes have been made yet. Once signed in, inspect original policy, add the narrow rule, save and confirm the received policy allows Mac mini and all other personal-tailnet peers; verify the remote page and WSS when possible. Preserve443/8443, no Funnel, LaunchAgent, new app auth, or change to unrelated tailnet.

Earlier same-host HTTPS proof remains valid but does not establish peer connectivity. Current external acceptance is FAIL/pending repair until the rule is applied and the Mac mini succeeds. Original93/93 scoped parity and4/4 real-account checks are separate evidence.

## Repair and external confirmation

AJ completed personal-tailnet admin sign-in. Original grant2 was `{"src":["ipset:hermes-host"],"dst":["ipset:rhythm-mac"],"ip":["tcp:4001"]}`. The authorized replacement changes only source to `["*"]`, retaining destination and TCP4001. Other grants, hosts/ipsets, SSH and node attributes were compared and preserved semantically. JSON formatting/comments were normalized; no unrelated policy semantics changed.

The first save was rejected by six existing policy tests expecting Drop for iPhone, pi-hermes and Mac mini, each IPv4/IPv6. Rejection made no policy change. Updated exactly those six tests to require Accept4001 while preserving their previous acceptance checks. Existing two pi-nas tests remain. This is the deliberate new user-specified behavior, not deletion of failing tests. Saved rule and tests together; Tailscale reported **Saved tailnet policy file**.

`tailscale debug netmap`, parsed without logging keys, now permits every online personal-tailnet peer to this Mac TCP4001 over both destination address families: Mac mini, both iPhones, pi-hermes, pi-monitor, pi-nas. All expected allow assertions GREEN (previously RED except pi-nas). `curl` HTTPS again HTTP200/certificate verify0/exit0. Serve443/8443 and app configuration were not changed in this repair.

**Actual external confirmation:** after reloading the HTTPS Tasks URL on Mac’s Mac mini, AJ answered **“Yes, Rhythm loads.”** This closes the external page-loading failure. The earlier same-host browser WSS proof remains distinct; remote WSS/chat/paid-turn execution was not independently asserted during this repair. [Durable policy and external confirmation receipt](../../testing/results/2026-10-22-web-all-tailnet-access.json). No app login/pairing/enrollment layer, Funnel or LaunchAgent was added.
