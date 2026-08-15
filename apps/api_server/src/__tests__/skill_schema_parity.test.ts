/**
 * #792 — Dual-DB schema parity guard for the agent_skills sidecar + the
 * agent_skill_versions ledger. Extended by #1113 to also cover
 * agent_capability_gaps, and by the proposals-parity fix (#1113 sibling) to
 * cover agent_org_proposals too (the same drift class caught both tables
 * missing from postgres_bootstrap.ts entirely). Extended by #1053 (OCU-12) to
 * cover org_skills, the new org skill library table.
 *
 * The skills sidecar/measurement-ledger model must keep the SQLite migration
 * (migrations.ts, the engine of the embedded local server) and the Postgres
 * bootstrap DDL (postgres_bootstrap.ts, production) column-for-column identical.
 * A column that lands in only one DB silently 500s production (per the
 * project_postgres_sqlite_schema_drift hazard), so this test FAILS the moment
 * the two diverge.
 *
 * Strategy:
 *  - SQLite truth: run runMigrations() against an in-memory DB and read the
 *    real resulting column set via PRAGMA table_info — this exercises every
 *    guarded ALTER exactly as production would.
 *  - Postgres truth: the bootstrap runs against a live Pool, so we cannot
 *    execute it here. Instead we statically parse postgres_bootstrap.ts source
 *    for the agent_skills / agent_skill_versions CREATE TABLE column lists plus
 *    every `ALTER TABLE <t> ADD COLUMN [IF NOT EXISTS] <col>` against them.
 *  - Compare the two as sorted column-name sets.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { runMigrations } from '../database/migrations';

const TABLES = [
  'agent_skills',
  'agent_skill_versions',
  'agent_capability_gaps',
  'agent_org_proposals',
  'org_skills',
  'agent_config_security_events',
  // W4 — the run-outcome ledger. Both tables are dual-engine; this guard is the
  // only thing standing between an added column and a production-only 500.
  'agent_run_outcomes',
  'agent_run_feedback_events',
  // W6 — the controlled experiment record. W5's agent_org_proposal_retirements
  // sidecar is the counter-example this list exists to stop repeating: it is
  // SQLite-only and still invisible here, so it must not be copied.
  'agent_org_experiments',
] as const;

/** Real SQLite column set after all migrations (incl. guarded ALTERs). */
function sqliteColumns(table: string): string[] {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  const cols = (db.pragma(`table_info(${table})`) as { name: string }[]).map(
    (c) => c.name,
  );
  db.close();
  return cols.sort();
}

/**
 * Statically parse the Postgres bootstrap DDL for a table's column set:
 * the `CREATE TABLE IF NOT EXISTS <table> ( ... )` body plus every
 * `ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col>` elsewhere in the file.
 */
function postgresColumns(source: string, table: string): string[] {
  const cols = new Set<string>();

  // 1) CREATE TABLE body.
  const createRe = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\)\\s*\``,
    'i',
  );
  const createMatch = source.match(createRe);
  if (createMatch) {
    const body = createMatch[1];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim().replace(/,$/, '');
      if (!line || line.startsWith('--')) continue;
      // Skip table-level constraint clauses (none today, but be defensive).
      if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
      const name = line.split(/\s+/)[0];
      if (/^[a-z_][a-z0-9_]*$/i.test(name)) cols.add(name);
    }
  }

  // 2) ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <col>.
  const alterRe = new RegExp(
    `ALTER TABLE ${table} ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)`,
    'gi',
  );
  let m: RegExpExecArray | null;
  while ((m = alterRe.exec(source)) !== null) {
    cols.add(m[1]);
  }

  return [...cols].sort();
}

describe('#792 agent_skills dual-DB schema parity', () => {
  const pgSource = readFileSync(
    join(__dirname, '..', 'database', 'postgres_bootstrap.ts'),
    'utf8',
  );

  for (const table of TABLES) {
    it(`${table} has identical column sets in SQLite and Postgres`, () => {
      const sqlite = sqliteColumns(table);
      const pg = postgresColumns(pgSource, table);

      // Sanity: the parser actually found a non-trivial column set.
      expect(sqlite.length).toBeGreaterThan(5);
      expect(pg.length).toBeGreaterThan(5);

      expect(pg).toEqual(sqlite);
    });
  }

  it('agent_skills carries the #792 sidecar + ledger columns', () => {
    const sqlite = sqliteColumns('agent_skills');
    for (const col of [
      'applied_for_name',
      'base_version',
      'origin_location',
      'is_external',
      'baseline_score',
      'post_score',
      'measure_reason',
    ]) {
      expect(sqlite).toContain(col);
    }
  });

  it('issue-1135 lock state is additive in both SQLite and Postgres agent_configs', () => {
    const sqlite = sqliteColumns('agent_configs');
    const postgres = postgresColumns(pgSource, 'agent_configs');
    for (const col of ['locked', 'disabled_reason', 'locked_at', 'locked_by']) {
      expect(sqlite).toContain(col);
      expect(postgres).toContain(col);
    }
  });

  it('W6-c10: outcome_status is additive in BOTH engines', () => {
    expect(sqliteColumns('agent_org_proposals')).toContain('outcome_status');
    expect(postgresColumns(pgSource, 'agent_org_proposals')).toContain('outcome_status');
  });

  it('W6-c10: the experiment spec-immutability trigger has a behavioural Postgres twin', () => {
    // The parity guard above compares COLUMNS only, so the behaviour gets its
    // own assertion. Postgres cannot be executed here, so the twin is checked
    // statically: same guarded columns, same message text, plus the DELETE
    // block. (Stated limitation: this pins the DDL, not a live Postgres run.)
    for (const guarded of [
      'NEW.baseline_spec_json IS DISTINCT FROM OLD.baseline_spec_json',
      'NEW.candidate_spec_json IS DISTINCT FROM OLD.candidate_spec_json',
      'NEW.assignment_key IS DISTINCT FROM OLD.assignment_key',
      'NEW.stopping_rule_json IS DISTINCT FROM OLD.stopping_rule_json',
      'NEW.max_exposure IS DISTINCT FROM OLD.max_exposure',
    ]) {
      expect(pgSource).toContain(guarded);
    }
    expect(pgSource).toContain('trg_agent_org_experiments_no_delete');
    expect(pgSource).toContain(
      "rhythm_reject_ledger_write('agent org experiment specs are immutable once declared')",
    );
    // Identical wording on both engines.
    const sqliteSource = readFileSync(
      join(__dirname, '..', 'database', 'migrations.ts'),
      'utf8',
    );
    expect(sqliteSource).toContain(
      "RAISE(ABORT, 'agent org experiment specs are immutable once declared')",
    );
  });

  it('issue-798-c7: release CI runs the schema parity guard explicitly', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'desktop_release.yml'),
      'utf8',
    );
    expect(workflow).toContain('skill_schema_parity.test.ts');
  });

  it('resolves the bundled SQLite module path in the fresh-package DB probe', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'desktop_release.yml'),
      'utf8',
    );
    expect(workflow).toContain('require("path").resolve(process.env.BUNDLED_API_SERVER');
  });

  it('keeps the bundled API smoke and mobile gateway on distinct ports', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'desktop_release.yml'),
      'utf8',
    );
    const smokeStep = workflow.match(
      /- name: Smoke-test bundled CLI server[\s\S]*?- name: Smoke memory vault authority/,
    )?.[0];
    expect(smokeStep).toBeDefined();

    const apiPort = smokeStep?.match(/(?:^|\s)PORT=(\d+)\b/)?.[1];
    const mobileGatewayPort = smokeStep?.match(
      /RHYTHM_MOBILE_GATEWAY_PORT=(\d+)\b/,
    )?.[1];
    expect(apiPort).toBe('4002');
    expect(mobileGatewayPort).toBe('4003');
    expect(mobileGatewayPort).not.toBe(apiPort);
  });

  it('requires the signed desktop app to use only its app-scoped keychain group', () => {
    const verifier = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'tools',
        'release',
        'verify_desktop_oauth_build.sh',
      ),
      'utf8',
    );
    const releaseEntitlements = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'apps',
        'desktop_flutter',
        'macos',
        'Runner',
        'Release.entitlements',
      ),
      'utf8',
    );

    const signer = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'tools',
        'release',
        'sign_and_notarize_macos.sh',
      ),
      'utf8',
    );

    expect(releaseEntitlements).toContain('<key>keychain-access-groups</key>');
    // The re-sign must expand BOTH Xcode variables in the keychain group;
    // codesign leaves $(...) literal, which run 30490564260 proved ships as
    // "TEAMID.$(PRODUCT_BUNDLE_IDENTIFIER)" when only the prefix is expanded.
    expect(signer).toContain('s/\\$(AppIdentifierPrefix)/${APPLE_TEAM_ID}./');
    expect(signer).toContain(
      's/\\$(PRODUCT_BUNDLE_IDENTIFIER)/${APP_BUNDLE_ID}/',
    );
    expect(verifier).toContain('require_app_scoped_keychain_group()');
    expect(verifier).toContain(
      'expected_group="${team_identifier}.${bundle_identifier}"',
    );
    expect(verifier).toContain("Print :keychain-access-groups:0");
    expect(verifier).toContain("Print :keychain-access-groups:1");
    expect(verifier).toMatch(/\n  require_app_scoped_keychain_group\n/);
    expect(verifier).not.toContain('reject_entitlement_key "keychain-access-groups"');
    expect(verifier).toContain(
      'reject_entitlement_key "com.apple.security.keychain-access-groups"',
    );

    // v0.18.53 was killed by AMFI at launch: keychain-access-groups is a
    // RESTRICTED entitlement, legal in a Developer ID app only when an
    // embedded Developer ID provisioning profile authorizes it (plus the
    // com.apple.application-identifier entitlement the Data Protection
    // Keychain needs at runtime). Pin the whole chain: the workflow passes
    // the profile secret, the signer embeds it and injects the identifier,
    // and the verifier requires both AND launches the signed app.
    const releaseWorkflow = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '.github',
        'workflows',
        'desktop_release.yml',
      ),
      'utf8',
    );
    expect(releaseWorkflow).toContain(
      'APPLE_PROVISIONING_PROFILE_BASE64: ${{ secrets.APPLE_PROVISIONING_PROFILE_BASE64 }}',
    );
    expect(signer).toContain('APPLE_PROVISIONING_PROFILE_BASE64');
    expect(signer).toContain('Contents/embedded.provisionprofile');
    expect(signer).toContain(
      'Add :com.apple.application-identifier string ${APPLE_TEAM_ID}.${APP_BUNDLE_ID}',
    );
    expect(verifier).toContain('embedded.provisionprofile');
    expect(verifier).toContain('require_application_identifier');
    expect(verifier).toContain('require_launch_smoke');
  });

  it('guards every creative-platform MCP tool in the bundled release', () => {
    const workflow = readFileSync(
      join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'desktop_release.yml'),
      'utf8',
    );
    // PR #1180: CommonJS output may use `foo(server)` or `(0, foo)(server)`.
    expect(workflow).toContain('assert_grep() {');
    expect(workflow).toContain('grep -qE "$pattern" "$file"');
    for (const guard of [
      '9a2d3e4f-5b6c-4d7e-8f9a-1b2c3d4e5f6a',
      "assert_grep 'creative platform tool registration' \"$DEST/dist/index.js\" 'registerCreativePlatformTools\\)?[[:space:]]*\\([[:space:]]*server'",
      "assert_grep 'setup readiness tool registration' \"$DEST/dist/index.js\" 'registerSetupReadinessTool\\)?[[:space:]]*\\([[:space:]]*server'",
      "assert_grep 'org optimizer tool registration' \"$DEST/dist/index.js\" 'registerOrgOptimizerTools\\)?[[:space:]]*\\([[:space:]]*server'",
      'rhythm_list_creative_capabilities',
      'rhythm_install_creative_capability',
      'rhythm_creative_capability_status',
      'rhythm_verify_creative_capability',
      'rhythm_record_design',
      'rhythm_get_setup_readiness',
      'rhythm_run_external_discovery',
    ]) {
      expect(workflow).toContain(guard);
    }
  });
});
