# Private packaged UI recon: profile dirty switch and schedule deletion

Source: locally signed app at `2b8c0a8ed04218b1cd09a63a18ed955d6719dd0d`, using a synthetic actor and private SQLite fixture. These are observations captured before the checked-in assertions were written. Names and credentials are omitted. The scheduled task had an owned `[smoke]` nonce, was disabled once-only, and was never dispatched.

| Path | Observed UI and network | Persisted readback |
| --- | --- | --- |
| Existing profile draft | `coding-agent` and `secretary` were revision 4. A nonce draft on the fixture-owned `coding-agent` showed “Unsaved changes.” Switching to `secretary` opened the unsaved dialog and left `coding-agent` selected with its draft. Keep editing closed the dialog and retained the draft. | No `/agent-configs` write request. |
| Discard switch | The second switch opened the dialog; Discard selected `secretary` and removed the draft. Explicitly reselecting `coding-agent` showed its original label. | `GET /agent-configs` returned 200. Catalog and SQLite digests matched the initial read. No `/agent-configs` write request. Reload did not reliably preserve the selected profile; explicit reselect showed the original label. |
| Disabled schedule creation and Cancel | The UI created a disabled once-only owned schedule; `POST /agent-schedules` returned 201. The row showed “once · Disabled.” Cancel closed the delete dialog and made zero DELETE requests. | After Cancel: UI row visible; API GET 200; one matching SQLite row; zero run rows. |
| Confirm delete and reload | Confirm sent authorized `DELETE /agent-schedules/{id}` and received 204. Reloaded `GET /agent-schedules` returned 200. | API list omitted the ID; SQLite had zero matching rows and zero run rows; UI had zero matching rows after reload. |

Existing-test triage: **KEEP** `profiles-editor-redesign.spec.ts` for fixture-only dirty-switch behavior, `tools.spec.ts` for fixture-only schedule deletion, `packaged-ai-followon.spec.ts` for discarding a *new* profile draft against a real catalog, and `packaged-ai-private-disabled-schedule.spec.ts` for real disabled create/edit/persistence. None covers the real existing-profile Keep/Discard path or real UI Cancel/Confirm deletion with API and SQLite readback. The two new packaged specs address those gaps.

Confirm against the exact newly signed candidate is still **UNVERIFIED**. Run only via the existing private packaged launcher with `RHYTHM_QUALIFICATION_FIXTURE_MANIFEST` and matching `RHYTHM_FEATURE_EXPECTED_REVISION`. Missing manifest is an explicit failing test. Do not count this recon as a final product pass.


## Independent Confirm

Both checked-in cases pass inside the exact4fda native7-case selection (49.1s): profile draft KeepEditing/Discard with no writes and unchanged API/SQLite; schedule Cancel/Confirm204 and reloadabsence with zero runs. Command/log and ownership cleanup are recorded in `docs/ai/runs/2026-10-20-ai-full-coverage-continuation.md`. These prove the named slices only, not profile runtime capability or schedule execution.
