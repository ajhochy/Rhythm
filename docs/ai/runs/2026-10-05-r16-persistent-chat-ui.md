---
date: 2026-10-05
repo: Rhythm
branch: codex/r16-persistent-chat-ui
pr: null
status: in-review
tags: [run, rhythm, coordinator, chat-ui]
---

# R16 persistent coordinator chat UI — source-only handoff

## Scope implemented

- Web coordinator transport, controller, and durable journal now use exact scoped C1/C2 wire bodies. Local `actorKey`, model, context, grants, and transcript data never enter request bodies or the journal. The normal local fetcher continues stripping its bearer; the signed-in `taskToken` is used only in protected coordinator and Dayflow-source request headers, never in a body or journal.
- Both journals preserve an immutable uncertain command before its wire exposure. A stale controller's higher view-only revision cannot delete, overwrite, or admit a competing command. Mobile serializes every shared AsyncStorage read/modify/write operation across remounted journal factories. Only a matching acknowledgement/replay or a directly persisted message-409 followed by qualified review can retire it. Corrupt nonempty storage fails closed; account/host/navigation/cancel fences keep foreign or late responses out of the active view.
- Web `SessionRail` and mobile Agents navigation expose an explicit permanent **Rhythm** entry. The client calls the published schema-v3 `resolve` route, accepts only the server-returned root/project, then opens/statuses that root. Mobile replays a server-required opaque project switch through the existing paired selector and can hold an explicit server-primary view when the qualified catalog has no SDK row; it neither guesses an SDK identity nor falls back to an ordinary SDK prompt.
- Web and paired-mobile transports bind published `resolve`, `setup`, `open`, `status`, `message`, `goals`, `prepare-plan`, `continue-plan`, and bounded `history` shapes. Setup keeps one opaque key through a server-returned eligible-profile choice and never auto-runs on a read. Finite consent uses only `totalTokenAuthorization`, `maxTurns`, `maxWallTimeSeconds`, `expiresInSeconds`, and soft-budget acknowledgement; `execute` additionally requires the fresh scoped-workspace acknowledgement. It does not turn a reasoning budget into authority.
- C2 schema-v3 cards are compact by default, show material holds distinctly, retain accessible exact same-key retry, and expose finite planning controls only for a server-marked primary root. Existing persisted canonical rows are now mapped through the normal web/mobile transcript mappers and rendered; a foreground acknowledgement remains only an acknowledgement, never a fabricated assistant bubble. Live SDK rows are blended only for the same canonical root and project.
- The desktop conversation menu exposes explicit Allow/Remove Dayflow-context controls only for a currently selected schema-v3 server root. They post the closed source-consent body with the normal signed-in header and report only accepted/unavailable; mobile has no invented proxy and gives paired-Mac setup guidance.
- Existing ordinary messaging, composer draft-edit protection, permissions/questions, scrolling, keyboard behavior, attachments, and streaming paths stay intact. Coordinator failure, uncertain acknowledgement, unavailable/auth hold, or normal-mode exit never falls through to an ordinary SDK send. Continuous voice is stopped/gated while coordinating; plaintext dictation still fills the coordinator draft.
- Additive catalog integration uses the materialized frozen OpenDesign/Agent Tools/Dayflow dependencies only: `/open-design`, `/tools/agent-tools`, and `/tools/dayflow` use their accepted modules and owner-scoped pins. The permanent Rhythm entry is outside that registry and cannot be unpinned. No frozen catalog, Dayflow, or Electron dependency file was edited by this work.

## Source checks

- `cd apps/web && node --experimental-vm-modules --test tests/coordinator-conversation-controller.test.mjs tests/coordinator-conversations.test.mjs tests/coordinator-live-gateway-auth.test.mjs tests/coordinator-composer-draft.test.mjs`: **30/30 passed**. These invented-fixture tests cover exact wire enumeration/auth isolation, malformed/foreign responses, bounded timeout, stale journal refresh, finite consent, setup choice, canonical-history parsing, Dayflow source-consent closure, draft ABA, and no SDK fallback.
- `cd apps/mobile && npm test -- --runInBand --no-cache tests/coordinator-conversation.test.ts`: **38/38 passed**. These cover qualified paired identity, schema-v3 primary resolve/switch/setup, exact paired fields, canonical-history row mapping/pagination, finite consent, journal concurrency/corruption/stale refresh, cancellation, voice/dictation boundary, and real ChatView draft acknowledgement handling.
- Current external source-only witnesses: shared AsyncStorage remount journal **3/3** and schema-v3 desktop finite callbacks **8/8**. They use invented storage/gateway data with no network, browser, device, or native runtime and are review evidence only, not product acceptance.
- `cd apps/web && npm run typecheck` and `cd apps/mobile && npm run typecheck`: both passed. The scoped cached mobile ESLint command over the changed coordinator provider/service/view/card/test files also passed with `--max-warnings=0`.
- `git diff --check` plus no-index whitespace checks for every owned new file passed. Final GitNexus `detect_changes --scope compare --base-ref 13209b743af4675cd9cd3523449c3221bc07df20` again stopped at the sandboxed registry-temp `EPERM`; it did not produce a change/risk report.
- A read-only SHA-256 check against `../accepted-ui-dependencies-materialization.json` found all **33/33** frozen OpenDesign/catalog/Dayflow dependency entries unchanged.
- Web lint remains unavailable: the package has no lint script/cached ESLint, and no network/install fallback is authorized.
- A generic `apps/web npm test` was not used as validation: it attempted the inherited Playwright/Vite path and sandbox policy rejected its `127.0.0.1:4173` bind before a server launched. It is not a source failure or runtime acceptance result.
- GitNexus upstream impact queries and final change detection use the installed CLI only. This isolated checkout is not registered and the CLI cannot create its registry temp file under sandbox policy, so GitNexus has no risk/change result. Manual scope is documented below; no index rebuild, registration, or install was performed.

## Manual caller and path scope

- Desktop: `main.tsx` / gateway composition → coordinator-only auth adapter → `useCoordinatorConversation` → `AgentsWorkspace`, `Composer`, `Transcript`, and `CoordinatorConversationCard`; `SessionRail` is the permanent explicit entry.
- Mobile: paired catalog/current-project provenance → `CoordinatorConversationProvider` → controller/journal/service → `ChatView` coordinator routing and card. Components consume presentation state while provider/controller own binding, transport, and persistence.
- The accepted catalog is additive around `App`, `Shell`, `SessionRail`, and `ToolWorkspace`; it is not a coordinator authority or transcript path.

## Remaining integration and runtime boundaries

- The source is aligned to the current schema-v3 C2 proposal, but that proposal is not a mounted/runtime qualification. Backend mounting, paired allowlisting, signed auth at runtime, resolver/bootstrap behavior, planning/dispatch/continuation ports, Dayflow-source route composition, and real server receipts were not run here.
- Canonical coordinator history is mapped from the published persisted row/parts shape. Runtime still needs the accepted server event/history delivery seam and real paired/SDK stream qualification; this work neither creates an SDK session nor fabricates a turn from an acknowledgement.
- The UI can express the closed finite `decompose`/`continue`/`execute` choices, but all remain server-gated. No browser/mobile action can waive a hold, budget, permission, verification criterion, Dayflow dependency, or grant.
- No app, API, engine, model, server, browser, device, phone, native build, account mutation, capture, grant, install, commit, push, signing, or deployment was performed. This is an in-review source patch, not a completed coordinator product or runtime acceptance.

## Final continuation receipt

The following are the final post-`1142` owned source hashes for this bounded
continuation. They supersede the matching rows in the earlier pin receipt;
unchanged pinned source rows and all frozen dependency rows are intentionally
not repeated here.

| Path | SHA-256 |
| --- | --- |
| `apps/mobile/app/(tabs)/agents.tsx` | `5a7e0d8d35a844fa8d91220488d43a5d11f6028f9d47eda1758ca913ee7f9cac` |
| `apps/mobile/components/chat/chat-content.tsx` | `3ebdf2b0bb0fd588c4d9f627902e71cd3c2059b27b387c660c24ab0e625fe026` |
| `apps/mobile/components/chat/chat-view.tsx` | `01d876d8abf557b936dfa30c256a1ac59328ca124e52870c88f6db577e6c4e96` |
| `apps/mobile/components/chat/coordinator-conversation-card.tsx` | `d575c9ee6f18a083fe326e36287983cf16f4ddaf1bb1090328bb25a54095f3f5` |
| `apps/mobile/lib/opencode/format.ts` | `49dc08f1d02ee410f381f563b6811187841923c0b5e28374839fb86b87214681` |
| `apps/mobile/providers/coordinator-conversation-controller.ts` | `e2a643dd551a75ac77ecba8b2407d1b0514d2f509b8be929bd8e96e0a011b319` |
| `apps/mobile/providers/coordinator-conversation-journal.ts` | `9554299db3e99cf5825cfa7df8754a5580369dc63bfd241cbe55abc28c061c06` |
| `apps/mobile/providers/coordinator-conversation-provider.tsx` | `d3ead6f579abc7b3e965a5e5b0d29006664b2776c0effa6481bdce0dc227d6b5` |
| `apps/mobile/providers/services/coordinator-conversations-service.ts` | `1163842c1069ba567f5a9509cd687ee68b6912cfe8e808d5fdbe321a85417b55` |
| `apps/mobile/providers/services/coordinator-history-transcript.ts` | `80631bc49e307409894294e5aa082c71db89cfc1c100c7d5cea59aab1e1bc217` |
| `apps/mobile/tests/coordinator-conversation.test.ts` | `a2288055b832055e8fa69ec57ea58ccc2dafe947738b082accf20319f307c751` |
| `apps/web/src/components/AgentsWorkspace.tsx` | `278a1092d28eaed6e9750fab9bdf6db540161da33325fa509709ccfce9895441` |
| `apps/web/src/components/CoordinatorConversationCard.css` | `46507e91e7e6f7d53d2f1ab5bf923c632595cc5434924a54d0b4d89a57fffb60` |
| `apps/web/src/components/CoordinatorConversationCard.tsx` | `1f156490eff65809232f695fe53c11168af59b8b07f5cb2ef5a8b2b402b0c4b0` |
| `apps/web/src/components/Transcript.tsx` | `04d45858b981871019c78ee6043070047e93d24dbf886d655186e05e60e12161` |
| `apps/web/src/components/use-coordinator-conversation.ts` | `838c151aa4d34e2f9c6423275430833ae613f53f90468e20f815860a5a1dbffc` |
| `apps/web/src/gateway/index.ts` | `566a2c8ccc4b9c9e715afb668970cb7d1d2ee9e39f428c20b6e24c1ad11a7424` |
| `apps/web/src/gateway/coordinator-conversations.ts` | `a8189535cdfde09da557bbb3444a076183aa743c2d4d825c941144e68aa11834` |
| `apps/web/src/gateway/dayflow-source-consent.ts` | `17e9f5bc15d437253823a11bcd1b44c847c31bb33c19ea12b746738733d13621` |
| `apps/web/tests/coordinator-conversation-controller.test.mjs` | `aa4200a40ec48b932c42cb0ee39c0403c17bb0365df3833be2eb6f7fb060b8ce` |
| `apps/web/tests/coordinator-conversations.test.mjs` | `d57eefb5243236454017b344b0cb385d0ab90d46903b953a09983accb3b0c3bf` |
| `apps/web/tests/coordinator-live-gateway-auth.test.mjs` | `cccec1b26a26ab35d1c1201a3dfd048945b7323d301b68e8ac44a29013224b36` |

## Pinned source receipt at 11:42 UTC

The table excludes frozen materialized dependency files and this self-referential run note. `absent-at-base` means a new owned file relative to `13209b743af4675cd9cd3523449c3221bc07df20`.

| Path | Base SHA-256 | Final SHA-256 |
| --- | --- | --- |
| `apps/mobile/app/(tabs)/agents.tsx` | `a2ef9e6523cf3d0965cb4ca5ea6c008883c95700c92c18baa68b174cd559efcf` | `d8b38bde40220d2c770fd6d93406f54977719532a5566693594d32fd38bed038` |
| `apps/mobile/app/_layout.tsx` | `49fdcec19bf6f5973f737ec48680f621504910fda6780ebc07f2e930fdcfd77f` | `3a13103f3fcff61443c7e4b33170bdda6064476eadf8b450083ca2ede531508b` |
| `apps/mobile/components/chat/chat-composer.tsx` | `70e16290d6d834e0259db1289553a245b400538749c34b1d9d73e223798e672e` | `49e8d8dd0549b1d3b7875e90cc5dc2f36e08417b79fc6f358a1aa6aea3b3279b` |
| `apps/mobile/components/chat/chat-content.tsx` | `778db7d12e0c7c72c50c134eebaf926a27f6f047faf0033d37c7fa4d6d187563` | `cc2214402dc6ea09333f64d4ed211a957b16ea3a7f2b9aac72f537b49d986e19` |
| `apps/mobile/components/chat/chat-drafts.ts` | `4e74a3deb6c1b93b21513dcbf0a2fa3895f8d290ae4da52a737c93fea7b31d18` | `591fdec9972c2fb25b04382fc1aaa8188eab17a3942cea30742ea910cffcbb8e` |
| `apps/mobile/components/chat/chat-header.tsx` | `5bbcba0cf1995919f62a171f492b554428af401264f619cb3aa2f1b11ee314ef` | `7b66bbd2d8d8f8d62c47870a342e1a42de08c44442f312b3a933bbec0c46f972` |
| `apps/mobile/components/chat/chat-view.tsx` | `38414c66bbd6635141ac9ed6a3df5d6206a7c945532b9557350bcde92af0dec7` | `513e15105e36b67043232c10e0a33005bd040ca1381dd5453f7b92bf6f41129d` |
| `apps/mobile/components/chat/coordinator-composer-routing.ts` | absent-at-base | `bac6a7af267d9dd5d20f7dc08c32c0e7466384b8cee3e1d8a69b84f388c6695c` |
| `apps/mobile/components/chat/coordinator-conversation-card.tsx` | absent-at-base | `b76fe8c9de4ccc7af7ff408ff61fbee8c2f4d696a083bf7016440132d349ca81` |
| `apps/mobile/components/chat/coordinator-voice-routing.ts` | absent-at-base | `599a606a8270cc921e8afd7b85556af3ca323d4991fb889adc6b8c4606269492` |
| `apps/mobile/providers/opencode-provider-types.ts` | `99aade8abec1b295041b93fe304fc08cb14c29a7495ea378b1792d14a078562b` | `c15b2c47587862818e072ae4711c993b0bbc826f76aa829de7aac02d8b5e24c8` |
| `apps/mobile/providers/opencode-provider.tsx` | `30a780b47d02c432c979c9cb840094395b7420764a56c2ab9f2a63fddedfd372` | `4cf106fdc8a3f5f8cb7384117c8d966de84b65ac4334a41dc97e8cbe136b6b09` |
| `apps/mobile/providers/coordinator-conversation-binding.ts` | absent-at-base | `d9999ccd49dad3d9d8e4eb3e5aa8f350d814c49214312bcca79facbfa5f6ee98` |
| `apps/mobile/providers/coordinator-conversation-controller.ts` | absent-at-base | `103124d7a66e71e20993ad90f77bc1b326bb65e1b1497631f1448bfa9dbeded3` |
| `apps/mobile/providers/coordinator-conversation-journal.ts` | absent-at-base | `b024702a88e2c5e4fb191727a83f7847b5a2e48da2de3710c30432cc8590c45e` |
| `apps/mobile/providers/coordinator-conversation-provider.tsx` | absent-at-base | `1bc6d5261ace34802bf4aafeb7dee16071f4c916055da0edd0552c3cfa930afb` |
| `apps/mobile/providers/services/coordinator-conversations-service.ts` | absent-at-base | `288620f7168fb4d168a72556438a59287a3b2ba6fdf05e86dc79de16290f33a8` |
| `apps/mobile/tests/coordinator-conversation.test.ts` | absent-at-base | `c6100a363ef05fa0e9af5a65a4730d3f9b4235f783984fa0512efb7b73d2941a` |
| `apps/web/src/App.tsx` | `c8acfbc474844bfbef7484f6335e199e982164e7f75f82e13012ee0573f6ce93` | `23853fe66db7e232f66db04e671765f60fa6e4f15ab92ab7b01ba24707ebd8e8` |
| `apps/web/src/components/AgentsWorkspace.tsx` | `54c2107963df9bb3d6774f8633a8e9e335772f2599ced4e394d816bcaf28a70f` | `32efe36fde7420dcc504b225b26109e72e0f60818702b5e95fbe1bb07e965943` |
| `apps/web/src/components/Composer.tsx` | `cc5afc16c9dbcea67ad1829408c7bbb47f50f86c59bb23ef777b58cd936c29a4` | `657400865463468bfc442f2eed1ea2a64746bd42839c1d77459398cf32d93d73` |
| `apps/web/src/components/CoordinatorConversationCard.css` | absent-at-base | `4f93a188b00baaf28c5a6030145b72b7d9b639951f95c294cf08a415f20a20da` |
| `apps/web/src/components/CoordinatorConversationCard.tsx` | absent-at-base | `560021bedc97335c87e33635f46764a2e8dbd91698239016eec94ddb5e62ceec` |
| `apps/web/src/components/SessionRail.css` | `dc095d233fb078c0971d0039f6af417fcb80d996d92cb0e22e7da9bc57a5e460` | `298256542c860064c0bf03610d6ebdd5bcc271b04763c1a63b0e39640f67bde9` |
| `apps/web/src/components/SessionRail.tsx` | `9f2996ae6d641a8b37790a0864ca6e4a0c592157d9be2f974956ee5838c3dd90` | `0d63222eb1524c0c9fb11b3bf09e6ea93544770e4df1d4a42d22866b4510cdc6` |
| `apps/web/src/components/Shell.tsx` | `19ac8294cd4565662e40695d8120972f2882722933818d47d42b45c4d90be0a2` | `d342431e88454980696444915d3a52d1aacfbe80482181a65b070e8c90e433b5` |
| `apps/web/src/components/ToolWorkspace.tsx` | `ce1fdf6640c50658b5579ab6eccab2135a74eaeaddbc7f201ea6900499717f04` | `06b3e98d62607472fdc5f9170c59af21281bdc2b3fc4e22be2f3f282400e50c0` |
| `apps/web/src/components/Transcript.tsx` | `b5f308e7ea7c260e606c219f8e5e8172d50247143f33a4ffe3cdc3f71eb40d13` | `23c4ce734e5a58fad01db7295661b515a3bfae46fd9f448ffb38480bf120e61d` |
| `apps/web/src/components/use-coordinator-conversation.ts` | absent-at-base | `5b3d5448123c8a56265362887b7e58f2c859d7921ba98f0b1ba03735504bc42c` |
| `apps/web/src/gateway/index.ts` | `486838dd81817af4e06f5ed6d463b8165976a924175dcb0dce755141930a3365` | `35984619ea73a07ad61c72dd8bf52bd78bb16010a4688899d34a7ba9848a3f7a` |
| `apps/web/src/gateway/coordinator-conversation-journal.ts` | absent-at-base | `49702571519147245678d87f0d5713718725af6bcd8b17d5e06c4528459f2bbe` |
| `apps/web/src/gateway/coordinator-conversations.ts` | absent-at-base | `785475665b5a0615c573dc3e62400336eda415f24b7cd633ddc95ace80d6e022` |
| `apps/web/src/styles.css` | `a695572c57f88636da89930465d4d3132e2905a667e871246da6d29cfc4b5e37` | `61a9923031fb8af7e117ce4960e70f679ed894bbb0782d411d70c99f6f423642` |
| `apps/web/tests/coordinator-composer-draft.test.mjs` | absent-at-base | `f49cd733420314aeefd89e6a6b5d0c455123dd91ef2783d38cf5cfc723b031fd` |
| `apps/web/tests/coordinator-conversation-controller.test.mjs` | absent-at-base | `0a2c13c5bf57f57db281394bcf57e7d7d7fbe968f157580b3924b18c0818b66e` |
| `apps/web/tests/coordinator-conversations.test.mjs` | absent-at-base | `3ebb8b1fdad611e1ae9f98175f73045b9bb3230f385856bb962bee6e7e68cdfb` |
| `apps/web/tests/coordinator-live-gateway-auth.test.mjs` | absent-at-base | `5b7c90c0ea75cb4b1f3dbe377383712f246589d8476c9800412fb75a6261d3bb` |
