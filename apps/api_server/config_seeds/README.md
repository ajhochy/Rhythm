# config_seeds — opencode config assets shipped to every install

These files are the **source of truth** for the opencode/Rhythm config assets that
Rhythm seeds onto disk under `~/.config/opencode/` at boot. They are copied by
`src/services/config_seeds_seeder.ts` (`seedConfigAssets()`), which runs during
api_server startup right after the config-doctor agent-file ensure block in
`server.ts`.

```
config_seeds/
├── skills/
│   └── customize-rhythm/
│       └── SKILL.md      → copied to  <managedSkillsRoot()>/customize-rhythm/SKILL.md
│                            (managedSkillsRoot() == ~/.config/opencode/skills)
└── tools/
    ├── classify.cjs      ┐
    ├── mcp-scan.cjs      │ → copied to  ~/.config/opencode/tools/
    ├── config-doctor.sh  │   (chmod +x on the .cjs/.sh after copy)
    └── package.json      ┘
```

## How seeding works

- **Version-gated.** A `schema_meta` marker (`config_seeds_v1`) records that the
  current revision has been seeded. On a fresh install the marker is absent, so
  everything is copied and the marker is set. Bump the marker key
  (`config_seeds_v2`, …) to force-push a new revision to existing installs — the
  copy OVERWRITES the managed tool/skill files so shipped fixes propagate (this
  mirrors the config-doctor `config_doctor_prompt_vN` runOnce force-push in
  `migrations.ts`).
- **Never fatal.** `seedConfigAssets()` never throws and never blocks startup; a
  failure logs a warning and leaves the marker unset so a later boot retries.
- **Postgres no-op.** Skipped entirely when `env.dbClient === 'postgres'` (these
  assets are local-agent-only, exactly like the skill/obsidian seeders).

## js-yaml (NOT committed here)

The config-doctor classifiers (`classify.cjs` / `mcp-scan.cjs`) prefer a pinned
`js-yaml` under `tools/node_modules/js-yaml`, and fall back to the one inside the
Rhythm app bundle. `node_modules/` is intentionally **not committed** to this
directory. It is provisioned two ways:

- **Release bundle:** `.github/workflows/desktop_release.yml` runs
  `npm install --omit=dev` inside the bundled `config_seeds/tools/` so the shipped
  app carries `tools/node_modules/js-yaml`; the seeder's copy then brings it along.
- **Dev / fallback:** when no bundled `node_modules/js-yaml` is present, the seeder
  does a best-effort `npm install --omit=dev` in the seeded tools dir (non-fatal —
  the classifiers still resolve js-yaml from the app bundle if that fails).

## Editing

Edit the live validated copies under `~/.config/opencode/` first, confirm they
work, then port them here (keeping them free of any hardcoded `/Users/...` path —
the seeder does NO `$HOME` substitution; committed content ships byte-for-byte).
Bump the seeder's `schema_meta` marker so existing installs pick up the change.
