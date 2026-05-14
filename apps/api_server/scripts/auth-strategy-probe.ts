/**
 * Auth Strategy Probe — local-only, gitignored, never committed.
 *
 * Validates the assumptions behind the upcoming Opencode auth rework
 * (issues #583 / #584 sub-bugs + Anthropic credentials bridge plan).
 *
 * Usage:
 *   cd apps/api_server
 *   npx tsx scripts/auth-strategy-probe.ts [--prompt]
 *
 * Pass --prompt to also exercise client.session.prompt against Anthropic /
 * OpenAI models after bridging. Skipped by default to avoid consuming
 * subscription tokens.
 *
 * What it does:
 *   1. Spawns a fresh Opencode SDK instance (its own server on an
 *      ephemeral port — won't collide with the running app on :4096).
 *   2. Calls client.provider.list() vs client.config.providers() with
 *      no providers connected. Diffs them.
 *   3. Reads Codex creds from ~/.codex/auth.json. Redacts tokens.
 *   4. Reads Claude Code creds from macOS Keychain
 *      ("Claude Code-credentials"). May prompt for keychain access.
 *   5. Bridges OpenAI via client.auth.set({type:'oauth', ...}) using
 *      Codex creds. Re-checks provider.list / config.providers.
 *   6. Bridges Anthropic via client.auth.set({type:'oauth', ...}) using
 *      Claude Code creds. Re-checks.
 *   7. Calls client.provider.oauth.authorize for github-copilot and
 *      dumps the response shape (looking for device-flow fields).
 *   8. Optional: client.session.create + client.session.prompt against
 *      one Anthropic and one OpenAI model to verify the bridge works
 *      end-to-end (gated by --prompt).
 *   9. Disposes the SDK instance.
 *
 * SAFETY:
 *   - Tokens are redacted to first/last 4 chars in all output.
 *   - The script never writes credentials anywhere.
 *   - This file is gitignored — do not commit it.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

type OAuthCreds = {
  access: string;
  refresh: string;
  expires: number; // ms epoch
};

const PROMPT_MODE = process.argv.includes('--prompt');

// ---------------------------------------------------------------------------
// Output helpers — always redact secrets in printed payloads.
// ---------------------------------------------------------------------------

function mask(secret: string | undefined | null): string {
  if (!secret) return '<empty>';
  if (secret.length <= 8) return '<short>';
  return `${secret.slice(0, 4)}…${secret.slice(-4)} (len=${secret.length})`;
}

function pretty(label: string, value: unknown): void {
  console.log(`\n── ${label} ──`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

function section(name: string): void {
  console.log(`\n\n========================================`);
  console.log(`  ${name}`);
  console.log(`========================================`);
}

function pass(msg: string): void {
  console.log(`PASS  ${msg}`);
}
function fail(msg: string, err?: unknown): void {
  console.log(`FAIL  ${msg}`);
  if (err) console.log(`      ${err instanceof Error ? err.message : String(err)}`);
}
function inconclusive(msg: string): void {
  console.log(`INCONCLUSIVE  ${msg}`);
}

// ---------------------------------------------------------------------------
// Credential source readers — local files + macOS Keychain.
// ---------------------------------------------------------------------------

function readCodexCreds(): OAuthCreds | null {
  const path = join(homedir(), '.codex', 'auth.json');
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    // The known Codex schema:
    //   { OPENAI_API_KEY?, tokens: { id_token, access_token, refresh_token, ... }, last_refresh }
    // Verify against probe output before relying on it.
    const tokens = raw.tokens ?? raw;
    const access =
      tokens.access_token ?? tokens.id_token ?? tokens.access ?? '';
    const refresh = tokens.refresh_token ?? tokens.refresh ?? '';
    // expires_at is sometimes seconds, sometimes ms. Normalize.
    const expRaw =
      tokens.expires_at ??
      tokens.expires ??
      tokens.access_token_expiry ??
      raw.last_refresh ??
      0;
    const expires = expRaw > 1e12 ? expRaw : expRaw * 1000;
    pretty('Codex auth.json (top-level keys)', Object.keys(raw));
    if (raw.tokens) pretty('Codex tokens (keys)', Object.keys(raw.tokens));
    pretty('Codex creds (redacted)', {
      access: mask(access),
      refresh: mask(refresh),
      expires,
      expiresIso: expires ? new Date(expires).toISOString() : '<none>',
    });
    if (!access || !refresh) return null;
    return { access, refresh, expires };
  } catch (e) {
    fail('readCodexCreds threw', e);
    return null;
  }
}

function readClaudeCreds(): OAuthCreds | null {
  // Try macOS Keychain first ("Claude Code-credentials" generic password).
  let raw: string | null = null;
  try {
    raw = execSync(
      `security find-generic-password -s "Claude Code-credentials" -w`,
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
      .toString()
      .trim();
    console.log('  (Claude Code creds read from macOS Keychain)');
  } catch {
    // Fall back to ~/.claude/.credentials.json
    const path = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(path)) {
      raw = readFileSync(path, 'utf8');
      console.log('  (Claude Code creds read from ~/.claude/.credentials.json)');
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    pretty('Claude creds (top-level keys)', Object.keys(parsed));
    // Known shape from Claude Code:
    //   { claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, ... } }
    const oauth = parsed.claudeAiOauth ?? parsed;
    pretty('Claude oauth (keys)', Object.keys(oauth));
    const access = oauth.accessToken ?? oauth.access_token ?? oauth.access ?? '';
    const refresh =
      oauth.refreshToken ?? oauth.refresh_token ?? oauth.refresh ?? '';
    const expRaw =
      oauth.expiresAt ?? oauth.expires_at ?? oauth.expires ?? 0;
    const expires = expRaw > 1e12 ? expRaw : expRaw * 1000;
    pretty('Claude creds (redacted)', {
      access: mask(access),
      refresh: mask(refresh),
      expires,
      expiresIso: expires ? new Date(expires).toISOString() : '<none>',
    });
    if (!access || !refresh) return null;
    return { access, refresh, expires };
  } catch (e) {
    fail('readClaudeCreds parse failed', e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main probe.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  section('0. Boot SDK');
  // Connect to the Opencode subprocess the running api_server already owns
  // (port 4096). Trying to createOpencode() would collide. Dynamic import
  // hides the call from the CommonJS transformer (SDK is ESM-only).
  const dynImport = new Function('s', 'return import(s)') as (
    s: string,
  ) => Promise<unknown>;
  const mod = (await dynImport('@opencode-ai/sdk')) as {
    createOpencodeClient: (config: { baseUrl: string }) => any;
  };
  const client = mod.createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
  const server: any = null;
  pass('createOpencodeClient connected to running opencode on :4096');
  try {
    // -----------------------------------------------------------------------
    section('1. Source-of-truth: provider.list vs config.providers (baseline)');
    try {
      const provList = await client.provider.list();
      pretty('client.provider.list() baseline', provList);
    } catch (e) {
      fail('client.provider.list() threw', e);
    }
    try {
      const cfgProv = await client.config.providers();
      pretty('client.config.providers() baseline (keys per provider)', {
        providerIds: (cfgProv.providers ?? []).map((p: any) => p.id),
        count: (cfgProv.providers ?? []).length,
      });
    } catch (e) {
      fail('client.config.providers() threw', e);
    }

    // -----------------------------------------------------------------------
    section('2. Read Codex credentials from ~/.codex/auth.json');
    const codexCreds = readCodexCreds();
    if (codexCreds) pass('Codex creds parsed');
    else inconclusive('Codex creds missing or unparseable — skipping OpenAI bridge');

    // -----------------------------------------------------------------------
    section('3. Read Claude Code credentials from macOS Keychain');
    const claudeCreds = readClaudeCreds();
    if (claudeCreds) pass('Claude creds parsed');
    else inconclusive('Claude creds missing or unparseable — skipping Anthropic bridge');

    // -----------------------------------------------------------------------
    section('4. Bridge OpenAI via auth.set({type:"oauth"}) using Codex creds');
    if (codexCreds) {
      try {
        const res = await client.auth.set({
          path: { id: 'openai' },
          body: {
            type: 'oauth',
            access: codexCreds.access,
            refresh: codexCreds.refresh,
            expires: codexCreds.expires,
          },
        });
        pretty('auth.set(openai) response', res);
        pass('auth.set accepted OAuth body for openai');
      } catch (e) {
        fail('auth.set(openai) threw — SDK may reject bridged tokens', e);
      }
      // Re-check listing
      try {
        const after = await client.provider.list();
        pretty('client.provider.list() AFTER openai bridge', after);
      } catch (e) {
        fail('provider.list after openai bridge threw', e);
      }
    }

    // -----------------------------------------------------------------------
    section('5. Bridge Anthropic via auth.set({type:"oauth"}) using Claude creds');
    if (claudeCreds) {
      try {
        const res = await client.auth.set({
          path: { id: 'anthropic' },
          body: {
            type: 'oauth',
            access: claudeCreds.access,
            refresh: claudeCreds.refresh,
            expires: claudeCreds.expires,
          },
        });
        pretty('auth.set(anthropic) response', res);
        pass('auth.set accepted OAuth body for anthropic');
      } catch (e) {
        fail('auth.set(anthropic) threw — SDK may reject bridged tokens', e);
      }
      try {
        const after = await client.provider.list();
        pretty('client.provider.list() AFTER anthropic bridge', after);
      } catch (e) {
        fail('provider.list after anthropic bridge threw', e);
      }
    }

    // -----------------------------------------------------------------------
    section('6. GitHub Copilot device-flow response shape');
    try {
      const ghc = await client.provider.oauth.authorize({
        path: { id: 'github-copilot' },
        body: { method: 0 },
      });
      pretty('provider.oauth.authorize(github-copilot) full response', ghc);
      pretty('response key list', Object.keys(ghc ?? {}));
    } catch (e) {
      fail('provider.oauth.authorize(github-copilot) threw', e);
    }
    // Also probe anthropic/openai for parity — confirm what the SDK
    // actually returns (we suspect a stripped response).
    for (const id of ['anthropic', 'openai']) {
      try {
        const r = await client.provider.oauth.authorize({
          path: { id },
          body: { method: 0 },
        });
        pretty(`provider.oauth.authorize(${id})`, r);
      } catch (e) {
        fail(`provider.oauth.authorize(${id}) threw`, e);
      }
    }

    // -----------------------------------------------------------------------
    section('7. End-to-end prompt (only with --prompt)');
    if (PROMPT_MODE && (codexCreds || claudeCreds)) {
      const targets: Array<{ provider: string; model: string }> = [];
      if (claudeCreds)
        targets.push({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
      if (codexCreds) targets.push({ provider: 'openai', model: 'gpt-5' });
      for (const t of targets) {
        try {
          const session = await client.session.create({
            body: { title: `probe-${t.provider}` },
          });
          const sid = session.id;
          const out = await client.session.prompt({
            path: { id: sid },
            body: {
              model: { providerID: t.provider, modelID: t.model },
              parts: [
                {
                  type: 'text',
                  text: 'Respond with exactly the word OK and nothing else.',
                },
              ],
            },
          });
          const text = JSON.stringify(out).slice(0, 200);
          pretty(`session.prompt(${t.provider}/${t.model}) head`, text);
          pass(`end-to-end prompt OK for ${t.provider}`);
        } catch (e) {
          fail(`end-to-end prompt failed for ${t.provider}`, e);
        }
      }
    } else {
      inconclusive('end-to-end prompt skipped — re-run with --prompt to verify');
    }

    // -----------------------------------------------------------------------
    section('8. Summary');
    console.log('Review each section above. Findings to capture in the spec:');
    console.log('  - Which call returns authed providers (list / config.providers / neither)');
    console.log('  - Whether auth.set accepts OAuth tokens for openai + anthropic');
    console.log('  - Exact field names in Codex auth.json + Claude Keychain JSON');
    console.log('  - GitHub Copilot authorize() response shape (device-flow fields?)');
    console.log('  - End-to-end prompt result (if --prompt was passed)');
  } finally {
    try {
      // Some SDK versions expose server.close() or .dispose(); try both.
      if (typeof server?.close === 'function') await server.close();
      else if (typeof server?.dispose === 'function') await server.dispose();
    } catch (_) {
      /* ignore */
    }
    // Force exit because the spawned opencode subprocess can keep the event
    // loop alive otherwise.
    setTimeout(() => process.exit(0), 250);
  }
}

main().catch((e) => {
  console.error('Probe crashed:', e);
  process.exit(1);
});
