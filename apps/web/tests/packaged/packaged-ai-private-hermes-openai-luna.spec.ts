import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { test as unverified } from '@playwright/test';
import { test as packagedTest, expect, expectedRevision } from './feature-test';
import { readQualificationFixture } from '../../../../tools/testing/qualification_fixture.mjs';
import { inspectHermesPreflight } from './helpers/hermes-private-provider-preflight.mjs';
import { resolveOptionalHermesBackendArtifact } from '../../../electron/src/hermes-backend-artifact.mjs';

const RHYTHM_SOURCE = expectedRevision;
const HERMES_PROVIDER = 'openai-api';
const OFFICIAL_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const PROMPT = 'Reply with exactly the single character 2 and nothing else. Do not use tools.';
const requireFromRhythmApi = createRequire(fileURLToPath(new URL('../../../api_server/package.json', import.meta.url)));
const title = '[private Hermes actual turn] one authorized static OpenAI API Luna turn persists under the exact provider';
const explicitlyOptedIn = process.env.RHYTHM_FEATURE_MODEL === '1'
  && Boolean(process.env.RHYTHM_PACKAGED_APP)
  && process.env.RHYTHM_FEATURE_EXPECTED_REVISION === expectedRevision
  && Boolean(process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST)
  && Boolean(process.env.RHYTHM_HERMES_TURN_RUN_ROOT)
  && Boolean(process.env.RHYTHM_HERMES_TURN_AUDIENCE_GRANT);

type PrivateJson = Record<string, any>;
type ReadOnlySqlite = {
  prepare(sql: string): { all(...params: unknown[]): Array<Record<string, any>>; get(...params: unknown[]): Record<string, any> | undefined };
  close(): void;
};

function ownedFile(path: string, mode = 0o600) {
  const st = lstatSync(path);
  expect(realpathSync(path)).toBe(path);
  expect(st.isSymbolicLink()).toBe(false);
  expect(st.isFile()).toBe(true);
  expect(st.nlink).toBe(1);
  expect(st.uid).toBe(process.getuid?.());
  expect(st.mode & 0o777).toBe(mode);
}

function ownedPrivateDb(path: string, hermesHome: string) {
  const st = lstatSync(path);
  expect(realpathSync(path)).toBe(path);
  expect(path).toBe(join(hermesHome, 'state.db'));
  expect(st.isSymbolicLink()).toBe(false);
  expect(st.isFile()).toBe(true);
  expect(st.nlink).toBe(1);
  expect(st.uid).toBe(process.getuid?.());
  // Hermes creates state.db as 0644; its enclosing 0700 home is the privacy boundary.
  expect(st.mode & 0o022).toBe(0);
}

function hermesIdentity(appPath: string) {
  const resources = join(appPath, 'Contents/Resources');
  const buildIdentity = JSON.parse(readFileSync(join(resources, 'api_server/build-identity.json'), 'utf8'));
  expect(buildIdentity).toMatchObject({ schemaVersion: 1, sourceRevision: RHYTHM_SOURCE });
  const desktopManifestPath = join(resources, 'hermes-desktop/manifest.json');
  const desktopManifestBytes = readFileSync(desktopManifestPath);
  const desktopManifest = JSON.parse(desktopManifestBytes.toString('utf8'));
  expect(desktopManifest).toMatchObject({ product: 'hermes-desktop', dirty: false });
  expect(desktopManifest.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
  const backend = resolveOptionalHermesBackendArtifact(resources);
  expect(backend?.root).toBe(join(resources, 'hermes-backend'));
  const hostPath = join(resources, 'hermes-desktop/electron/embedded-host.mjs');
  const hostBytes = readFileSync(hostPath);
  const hostSha256 = createHash('sha256').update(hostBytes).digest('hex');
  return {
    hermesSourceRevision: desktopManifest.sourceCommit,
    desktopManifestSha256: createHash('sha256').update(desktopManifestBytes).digest('hex'),
    desktopHostSha256: hostSha256,
    backendManifestSha256: createHash('sha256').update(readFileSync(join(resources, 'hermes-backend/manifest.json'))).digest('hex'),
  };
}

function contentText(value: any): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return contentText(JSON.parse(trimmed)); } catch { /* plain text that resembles JSON */ }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(contentText).join('');
  if (!value || typeof value !== 'object') return '';
  if (value.type === 'text' && typeof value.text === 'string') return value.text;
  return Object.values(value).map(contentText).join('');
}

function hasToolActivity(value: any): boolean {
  if (value == null || value === false || value === '') return false;
  if (typeof value === 'string') {
    try { return hasToolActivity(JSON.parse(value)); } catch { return value.trim().length > 0; }
  }
  if (Array.isArray(value)) return value.some(hasToolActivity);
  if (typeof value === 'object') {
    if (['tool_call', 'tool_use', 'function_call'].includes(String(value.type ?? '').toLowerCase())) return true;
    return Object.values(value).some(hasToolActivity);
  }
  return Boolean(value);
}

function hasToolContent(value: any): boolean {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return hasToolContent(JSON.parse(trimmed)); } catch { return false; }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some(hasToolContent);
  if (!value || typeof value !== 'object') return false;
  if (['tool_call', 'tool_use', 'tool_result', 'function_call', 'function'].includes(String(value.type ?? '').toLowerCase())) return true;
  return Object.values(value).some(hasToolContent);
}

async function disableFixtureAutoTitle(desktop: any): Promise<boolean> {
  return await desktop.evaluate(async () => {
    const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string; method?: string; body?: unknown }) => Promise<any> } }).hermesDesktop;
    if (!bridge?.api) throw new Error('Hermes private config API unavailable');
    // The server deep-merges ConfigUpdate.config. Send only this non-secret leaf;
    // never read/round-trip the rest of config.yaml (which may contain secrets).
    const saved = await bridge.api({ path: '/api/config', method: 'PUT', body: {
      config: { auxiliary: { title_generation: { enabled: false } } },
    } });
    if (saved?.ok !== true) return false;
    const current = await bridge.api({ path: '/api/config' });
    return current?.auxiliary?.title_generation?.enabled === false;
  });
}

function readPrivateJson(path: string): { value: PrivateJson; sha256: string } {
  ownedFile(path);
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString('utf8')) as PrivateJson,
    sha256: createHash('sha256').update(bytes).digest('hex') };
}

function writeReceipt(path: string, value: PrivateJson) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
  ownedFile(path);
}

function readGrantedStaticApiKey(manifest: PrivateJson, grant: PrivateJson, manifestSha256: string, hermesHome: string, hermesSourceRevision: string): string {
  const loan = manifest.syntheticActor?.modelLoan;
  const sourcePath = loan?.decisionPath;
  if (!loan || !sourcePath || sourcePath !== join(manifest.fixtureRoot, 'decision-router.json')
    || grant.keySourcePath !== sourcePath || grant.keySourceSha256 !== loan.decisionSha256
    || grant.fixtureManifestSha256 !== manifestSha256 || grant.fixtureRoot !== manifest.fixtureRoot
    || grant.actorOwnerUserId !== manifest.ownerUserId || grant.hermesHome !== hermesHome
    || grant.rhythmSourceRevision !== RHYTHM_SOURCE || grant.rhythmProductRevision !== expectedRevision
    || grant.hermesSourceRevision !== hermesSourceRevision || grant.audience !== 'hermes-static-openai-api'
    || grant.provider !== 'openai-api' || grant.model !== 'gpt-6-luna' || grant.oneTurnMaximum !== 1
    || grant.screenshots !== false || grant.traces !== false || grant.video !== false
    || !Number.isSafeInteger(grant.issuedAt) || !Number.isSafeInteger(grant.stopAt)
    || grant.issuedAt !== loan.issuedAt || grant.stopAt !== loan.stopAt
    || Date.now() < grant.issuedAt || Date.now() >= grant.stopAt
    || grant.stopAt > grant.issuedAt + 10 * 60_000) throw new Error('Hermes static-key audience grant validation failed');

  ownedFile(sourcePath);
  const bytes = readFileSync(sourcePath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== loan.decisionSha256 || digest !== grant.keySourceSha256) {
    bytes.fill(0);
    throw new Error('Hermes static-key source hash validation failed');
  }
  let parsed: PrivateJson;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as PrivateJson;
  } finally {
    bytes.fill(0);
  }
  const key = parsed.openaiDecisions?.apiKey;
  if (typeof key !== 'string' || !key.trim()) throw new Error('authorized static OpenAI API key absent from validated loan');
  parsed.openaiDecisions.apiKey = '';
  return key;
}

async function findOwnedHermesGuest(page: any) {
  await page.goto('rhythm://app/index.html#/hermes');
  const find = () => page.context().browser()!.contexts().flatMap((context: any) => context.pages()).filter((candidate: any) => {
    const url = new URL(candidate.url());
    return url.protocol === 'file:' && url.pathname.endsWith('/hermes-desktop/renderer/index.html')
      && url.searchParams.get('embedded') === '1';
  });
  await expect.poll(() => find().length, { timeout: 60_000, message: 'actual bundled Hermes guest failed to attach' }).toBe(1);
  return find()[0];
}

/** Collect failure-only metadata; never return message text, errors, or credentials. */
async function collectFailureDiagnostics(desktop: any, hermesHome: string, knownSessionId: string) {
  let sessionId = knownSessionId;
  if (!sessionId) {
    try {
      sessionId = await desktop.evaluate(() => {
        const route = decodeURIComponent(window.location.hash.slice(1).split('?')[0]);
        return route.startsWith('/') ? route.slice(1) : '';
      });
    } catch { sessionId = ''; }
  }
  const sessionIdSha256 = /^[A-Za-z0-9_-]{8,128}$/.test(sessionId)
    ? createHash('sha256').update(sessionId).digest('hex')
    : null;
  let apiHistory: PrivateJson = { available: false };
  if (sessionIdSha256) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = desktop.evaluate(async (sid: string) => {
        const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string }) => Promise<any> } }).hermesDesktop;
        const response = await bridge?.api({ path: `/api/sessions/${encodeURIComponent(sid)}/messages?limit=20&order=oldest` });
        const messages = Array.isArray(response?.messages) ? response.messages : [];
        const toolPart = (value: any): boolean => {
          if (value == null || value === false || value === '') return false;
          if (typeof value === 'string') {
            try { return toolPart(JSON.parse(value)); } catch { return false; }
          }
          if (Array.isArray(value)) return value.some(toolPart);
          if (typeof value === 'object') {
            if (['tool_call', 'tool_use', 'tool_result', 'function_call', 'function'].includes(String(value.type ?? '').toLowerCase())) return true;
            return Object.values(value).some(toolPart);
          }
          return false;
        };
        return {
          available: true,
          sessionMatches: response?.session_id === sid,
          messageArrayPresent: Array.isArray(response?.messages),
          paginationReturned: response?.pagination?.returned ?? null,
          rowCount: messages.length,
          rows: messages.map((message: any) => ({
            role: typeof message.role === 'string' ? message.role : 'unknown',
            hasToolActivity: toolPart(message.tool_calls) || Boolean(message.tool_call_id) || toolPart(message.content),
          })),
        };
      }, sessionId);
      apiHistory = await Promise.race([
        pending,
        new Promise<PrivateJson>(resolve => { timer = setTimeout(() => resolve({ available: false, timedOut: true }), 5_000); }),
      ]);
    } catch { apiHistory = { available: false, readFailed: true }; }
    finally { if (timer) clearTimeout(timer); }
  }

  let sqlite: PrivateJson = { available: false, reason: 'session-unavailable' };
  const dbPath = join(hermesHome, 'state.db');
  if (sessionIdSha256 && existsSync(dbPath)) {
    let db: ReadOnlySqlite | undefined;
    try {
      ownedPrivateDb(dbPath, hermesHome);
      const Database = requireFromRhythmApi('better-sqlite3') as new (file: string, options: { readonly: true; fileMustExist: true }) => ReadOnlySqlite;
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
      const session = db.prepare('SELECT model,billing_provider,billing_mode,api_call_count FROM sessions WHERE id=?').get(sessionId);
      const usage = db.prepare('SELECT model,billing_provider,billing_base_url,billing_mode,api_call_count FROM session_model_usage WHERE session_id=? ORDER BY last_seen DESC').all(sessionId);
      const history = db.prepare('SELECT role,tool_calls,tool_call_id,content FROM messages WHERE session_id=? AND active=1 ORDER BY id ASC').all(sessionId);
      sqlite = {
        available: true,
        session: session ? {
          model: typeof session.model === 'string' ? session.model : '',
          provider: typeof session.billing_provider === 'string' ? session.billing_provider : '',
          billingMode: session.billing_mode ?? null,
          apiCallCount: Number(session.api_call_count) || 0,
        } : null,
        usageCount: usage.length,
        usage: usage.map(row => ({
          model: typeof row.model === 'string' ? row.model : '',
          provider: typeof row.billing_provider === 'string' ? row.billing_provider : '',
          officialOpenAiRoute: row.billing_base_url === 'https://api.openai.com/v1',
          billingMode: typeof row.billing_mode === 'string' ? row.billing_mode : '',
          apiCallCount: Number(row.api_call_count) || 0,
        })),
        rowCount: history.length,
        rows: history.map(row => ({
          role: String(row.role),
          hasToolActivity: hasToolActivity(row.tool_calls) || Boolean(row.tool_call_id) || hasToolContent(row.content),
        })),
      };
    } catch { sqlite = { available: false, reason: 'ownership-or-read-check-failed' }; }
    finally { db?.close(); }
  } else if (sessionIdSha256) {
    sqlite = { available: false, reason: 'state-db-not-yet-present' };
  }
  return { sessionIdSha256, apiHistory, sqlite };
}

async function runAuthorizedHermesTurn({ page, packaged }: { page: any; packaged: any }) {
  let runRoot: string | undefined;
  let runRootValidated = false;
  let phase = 'initial-validation';
  let sendAttempted = false;
  let succeeded = false;
  let primaryFailure = false;
  let manifestSha256: string | undefined;
  let hermesHome: string | undefined;
  let desktop: any | undefined;
  let sessionId = '';
  let identityBefore: ReturnType<typeof hermesIdentity> | undefined;
  try {
  expect(expectedRevision).toBe(RHYTHM_SOURCE);
  const manifestPath = process.env.RHYTHM_QUALIFICATION_FIXTURE_MANIFEST;
  const grantPath = process.env.RHYTHM_HERMES_TURN_AUDIENCE_GRANT;
  runRoot = process.env.RHYTHM_HERMES_TURN_RUN_ROOT;
  expect(manifestPath, 'explicit private synthetic fixture manifest is required').toBeTruthy();
  expect(grantPath, 'exact Hermes static-key audience grant is required').toBeTruthy();
  expect(runRoot, 'unique private Hermes turn run root is required').toBeTruthy();
  expect(resolve(runRoot!)).toBe(runRoot);
  expect(runRoot!.startsWith('/private/tmp/')).toBe(true);
  const runStat = lstatSync(runRoot!);
  expect(realpathSync(runRoot!)).toBe(runRoot);
  expect(runStat.isDirectory()).toBe(true);
  expect(runStat.isSymbolicLink()).toBe(false);
  expect(runStat.uid).toBe(process.getuid?.());
  expect(runStat.mode & 0o777).toBe(0o700);
  runRootValidated = true;

  const validated = readQualificationFixture(manifestPath!, expectedRevision);
  phase = 'fixture-validated';
  // The backend's openai-api credential resolver honors OPENAI_BASE_URL.
  // Synthetic fixture env scrubbing removes credentials but intentionally
  // preserves non-secret endpoint configuration, so require this override
  // absent before key materialization and the eventual provider request.
  if (process.env.OPENAI_BASE_URL?.trim()) throw new Error('private run requires OPENAI_BASE_URL to be unset');
  const { value: manifest, sha256: fixtureDigest } = readPrivateJson(manifestPath!);
  manifestSha256 = fixtureDigest;
  expect(validated.manifest.fixtureRoot).toBe(manifest.fixtureRoot);
  const { value: grant } = readPrivateJson(grantPath!);
  expect(manifest).toMatchObject({ schemaVersion: 1, sourceRevision: RHYTHM_SOURCE, ownerUserId: grant.actorOwnerUserId });
  expect(manifestPath).toBe(join(manifest.fixtureRoot, 'manifest.json'));
  const privateHermesHome = join(manifest.fixtureRoot, 'hermes-home');
  hermesHome = privateHermesHome;
  const homeStat = lstatSync(privateHermesHome);
  expect(realpathSync(privateHermesHome)).toBe(privateHermesHome);
  expect(homeStat.isDirectory()).toBe(true);
  expect(homeStat.isSymbolicLink()).toBe(false);
  expect(homeStat.uid).toBe(process.getuid?.());
  expect(homeStat.mode & 0o777).toBe(0o700);
  identityBefore = hermesIdentity(packaged.appPath);
  const hermesSourceRevision = identityBefore.hermesSourceRevision;

  desktop = await findOwnedHermesGuest(page);
  await expect(desktop.getByRole('button', { name: /^Gateway needs setup$/ })).toBeVisible({ timeout: 60_000 });
  const onboarding = desktop.getByRole('heading', { name: "Let's get you setup with Hermes Agent" });
  if (await onboarding.isVisible()) {
    await desktop.getByRole('button', { name: "I'll choose a provider later" }).click();
    await expect(onboarding).toBeHidden();
  }
  await desktop.evaluate(() => { window.location.hash = '#/settings?tab=providers&pview=keys'; });
  await expect.poll(() => desktop.evaluate(() => window.location.hash.includes('tab=providers')
    && [...document.querySelectorAll('body *')].some(el => el.children.length === 0 && el.textContent?.trim() === 'OpenAI API')),
  { timeout: 15_000 }).toBe(true);

  const metadataRun = await inspectHermesPreflight({ desktop, manifest, grant, expected: {
    fixtureManifestSha256: fixtureDigest,
    actorOwnerUserId: grant.actorOwnerUserId,
    rhythmSourceRevision: RHYTHM_SOURCE,
    rhythmProductRevision: expectedRevision,
    hermesSourceRevision,
    hermesHome: privateHermesHome,
    provider: HERMES_PROVIDER,
    model: 'gpt-6-luna',
  }, receiptPath: join(runRoot!, 'preflight.json') });
  expect(metadataRun.observation.keyMetadata.isSet, 'do not overwrite an existing Hermes OpenAI key').toBe(false);
  phase = 'key-eligibility-preflight-complete';
  expect(grant.stopAt - Date.now(), 'at least three minutes must remain before key materialization').toBeGreaterThanOrEqual(180_000);

  // Read the one permitted source only after the complete audience/hash/deadline
  // checks above and after the real backend reports OPENAI_API_KEY unset.
  let key = readGrantedStaticApiKey(manifest, grant, fixtureDigest, privateHermesHome, hermesSourceRevision);
  phase = 'authorized-key-in-memory';
  const keyInput = desktop.locator('input[type="password"][placeholder="Paste OpenAI API key"]');
  try {
    await keyInput.click();
    await keyInput.evaluate((element: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('input value setter unavailable');
      setter.call(element, value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    }, key);
  } catch {
    throw new Error('authorized key could not be entered into the normal Hermes provider field');
  } finally {
    key = '';
  }
  await keyInput.locator('xpath=..').getByRole('button', { name: 'Save', exact: true }).click();
  const readEnvMetadata = () => desktop.evaluate(async () => {
    const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string }) => Promise<any> } }).hermesDesktop;
    const env = await bridge?.api({ path: '/api/env' });
    const row = env?.OPENAI_API_KEY;
    return { isSet: row?.is_set === true, provider: row?.provider ?? '', category: row?.category ?? '' };
  });
  await expect.poll(readEnvMetadata, { timeout: 15_000, message: 'saved OpenAI key metadata did not become visible' })
    .toEqual({ isSet: true, provider: HERMES_PROVIDER, category: 'provider' });
  phase = 'key-saved-through-normal-ui';

  // The pinned Hermes source enables auxiliary.title_generation by default and launches it
  // asynchronously after a new session's first user turn. Disable just this
  // private fixture setting through the supported deep-merge config API so
  // this run exercises exactly one authorized paid inference.
  const titleDisabled = await disableFixtureAutoTitle(desktop);
  expect(titleDisabled, 'private Hermes auto-title setting must be persisted false before the chat').toBe(true);
  phase = 'automatic-title-disabled-in-private-fixture';

  // Use the same normal catalog endpoint as ModelSettings and capture only its
  // safe provider/model metadata. The picker can only offer rows returned here.
  const catalog = await desktop.evaluate(async () => {
    const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string }) => Promise<any> } }).hermesDesktop;
    const result = await bridge?.api({ path: '/api/model/options' });
    const providers = Array.isArray(result?.providers) ? result.providers : [];
    return providers.filter((provider: any) => typeof provider?.slug === 'string')
      .map((provider: any) => ({
        slug: provider.slug,
        name: typeof provider.name === 'string' ? provider.name : '',
        modelIds: Array.isArray(provider.models) ? provider.models.filter((model: unknown) => typeof model === 'string') : [],
      }));
  });
  const catalogProvider = catalog.find((provider: any) => provider.slug === HERMES_PROVIDER);
  if (!catalogProvider || !catalogProvider.modelIds.includes('gpt-6-luna')) {
    writeReceipt(join(runRoot!, 'turn-observation.json'), {
      schemaVersion: 1, observedAt: new Date().toISOString(), phase: 'model-catalog-stop',
      provider: HERMES_PROVIDER, requestedModel: 'gpt-6-luna',
      providerPresent: Boolean(catalogProvider), requestedModelAvailable: Boolean(catalogProvider?.modelIds.includes('gpt-6-luna')),
      listedModelCount: catalogProvider?.modelIds.length ?? 0,
      listedModelIds: catalogProvider?.modelIds ?? [],
      providerNames: catalog.map((provider: any) => provider.name).filter((name: unknown) => typeof name === 'string').slice(0, 100),
      fixtureManifestSha256: manifestSha256, hermesHome,
    });
    throw new Error('granted openai-api/gpt-6-luna is absent from the normal Hermes model catalog; stopped before chat');
  }

  await desktop.evaluate(() => { window.location.hash = '#/settings?tab=config:model'; });
  // ModelSettings source places appliesDesc in a <p> directly inside the
  // normal provider/model <section>; its immediate next sibling <div> is the
  // provider/model/Apply row. The section also contains a separate Reasoning
  // selector row, so scope controls to that exact sibling row.
  const appliesDescription = desktop.getByText(
    'Applies to new sessions. Use the model picker in the composer to hot-swap the active chat.',
    { exact: true },
  );
  await expect(appliesDescription).toHaveCount(1);
  const modelPanel = appliesDescription.locator('xpath=ancestor::section[1]');
  await expect(modelPanel).toHaveCount(1);
  const modelControlRow = appliesDescription.locator('xpath=following-sibling::div[1]');
  await expect(modelControlRow).toHaveCount(1);
  const selectors = modelControlRow.getByRole('combobox');
  await expect(selectors).toHaveCount(2);
  const applyButton = modelControlRow.getByRole('button', { name: 'Apply', exact: true });
  await expect(applyButton).toHaveCount(1);
  await expect(selectors.nth(0)).toBeVisible();
  await selectors.nth(0).click();
  const providerOption = desktop.getByRole('option', { name: catalogProvider.name, exact: true });
  try {
    await expect(providerOption).toBeVisible({ timeout: 3_000 });
  } catch {
    const diagnostic = await desktop.evaluate(() => {
      const description = 'Applies to new sessions. Use the model picker in the composer to hot-swap the active chat.';
      const paragraphs = [...document.querySelectorAll('p')]
        .filter(paragraph => paragraph.textContent?.trim() === description);
      return {
        appliesDescriptionCount: paragraphs.length,
        modelControlRows: paragraphs.map(paragraph => {
          const row = paragraph.nextElementSibling;
          return {
            tagName: row?.tagName ?? null,
            comboboxes: row ? [...row.querySelectorAll('[role="combobox"]')].map(el => el.textContent?.trim() ?? '') : [],
            buttons: row ? [...row.querySelectorAll('button')].map(el => el.textContent?.trim() ?? '') : [],
          };
        }),
        visibleOptions: [...document.querySelectorAll('[role="option"]')]
          .filter(el => (el as HTMLElement).offsetParent !== null)
          .map(el => el.textContent?.trim() ?? '').filter(Boolean).slice(0, 100),
      };
    });
    writeReceipt(join(runRoot!, 'turn-observation.json'), {
      schemaVersion: 1, observedAt: new Date().toISOString(), phase: 'provider-picker-stop',
      provider: HERMES_PROVIDER, requestedProviderLabel: catalogProvider.name,
      modelControlRows: diagnostic.modelControlRows, visibleOptions: diagnostic.visibleOptions,
      fixtureManifestSha256: manifestSha256, hermesHome,
    });
    throw new Error('normal ModelSettings provider picker did not expose the exact catalog label; stopped before chat');
  }
  await providerOption.click();
  await selectors.nth(1).click();
  const targetModel = desktop.getByRole('option', { name: 'gpt-6-luna', exact: true });
  if (!(await targetModel.isVisible().catch(() => false))) {
    const options = await desktop.evaluate(async () => {
      const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string }) => Promise<any> } }).hermesDesktop;
      const result = await bridge?.api({ path: '/api/model/options' });
      const row = result?.providers?.find((provider: any) => provider.slug === 'openai-api');
      const modelIds = Array.isArray(row?.models) ? row.models.filter((model: unknown) => typeof model === 'string') : [];
      return { providerPresent: Boolean(row), modelCount: modelIds.length, modelIds };
    });
    writeReceipt(join(runRoot!, 'turn-observation.json'), {
      schemaVersion: 1, observedAt: new Date().toISOString(), phase: 'model-catalog-stop',
      provider: 'openai-api', requestedModel: 'gpt-6-luna', providerPresent: options.providerPresent,
      requestedModelAvailable: options.modelIds.includes('gpt-6-luna'),
      listedModelCount: options.modelCount, listedModelIds: options.modelIds, modelTurnCount: 0,
      fixtureManifestSha256: manifestSha256, hermesHome,
    });
    throw new Error('granted gpt-6-luna is absent from the normal OpenAI API model picker; stopped before chat');
  }
  await targetModel.click();
  await applyButton.click();
  await expect.poll(() => desktop.evaluate(async () => {
    const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string }) => Promise<any> } }).hermesDesktop;
    const info = await bridge?.api({ path: '/api/model/info' });
      return { provider: info?.provider ?? '', model: info?.model ?? info?.model_name ?? '' };
  }), { message: 'normal Hermes model settings did not persist the exact granted model' })
    .toEqual({ provider: HERMES_PROVIDER, model: 'gpt-6-luna' });
  phase = 'normal-model-selection-verified';

  await desktop.evaluate(() => { window.location.hash = '#/'; });
  const composer = desktop.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeVisible();
  await composer.fill(PROMPT);
  expect(grant.stopAt - Date.now(), 'at least two minutes must remain before the sole send').toBeGreaterThanOrEqual(120_000);
  expect(sendAttempted, 'the grant permits at most one send').toBe(false);
  sendAttempted = true;
  await desktop.getByRole('button', { name: 'Send', exact: true }).click();
  phase = 'single-turn-sent-awaiting-persisted-answer';
  await expect(desktop.locator('[data-role="user"]')).toContainText(PROMPT);
  await expect.poll(() => desktop.locator('[data-role="assistant"]').count(), { timeout: 120_000 }).toBe(1);
  await expect(desktop.locator('[data-role="user"]')).toHaveCount(1);
  const userUiText = await desktop.locator('[data-slot="aui_user-message-text"]').first().evaluate((element: HTMLElement) => (element.textContent ?? '').trim());
  expect(userUiText).toBe(PROMPT);
  const assistantUi = desktop.locator('[data-role="assistant"]').last();
  const assistantTextParts = assistantUi.locator('[data-slot="aui_assistant-message-content"] > .aui-md');
  await expect.poll(() => assistantUi.evaluate((element: HTMLElement) => {
    const content = element.querySelector<HTMLElement>('[data-slot="aui_assistant-message-content"]');
    if (!content || element.getAttribute('data-streaming') === 'true') return false;
    const prose = [...content.querySelectorAll<HTMLElement>(':scope > .aui-md')];
    return prose.length > 0 && prose.some(part => (part.textContent ?? '').trim().length > 0);
  }), { timeout: 120_000 }).toBe(true);
  await expect(assistantUi.locator('[role="alert"]'), 'a completed provider error must not be filtered out as message text').toHaveCount(0);
  // Hermes renders assistant text as direct .aui-md children and tool activity
  // as tool-block parts; never flatten tool panels into the credited answer.
  await expect(assistantTextParts).toHaveCount(1);
  await expect(assistantUi.locator('[data-slot="aui_assistant-message-content"] > [data-slot="tool-block"]'),
    'tool UI must remain visible to the no-tool assertion').toHaveCount(0);
  const uiAssistantText = (await assistantTextParts.allTextContents()).map((text: string) => text.trim()).join('').trim();
  expect(uiAssistantText, 'the authorized literal-echo turn must answer exactly 2').toBe('2');
  const uiAssistantLength = uiAssistantText.length;
  phase = 'assistant-answer-rendered';

  sessionId = await desktop.evaluate(() => {
    const route = decodeURIComponent(window.location.hash.slice(1).split('?')[0]);
    return route.startsWith('/') ? route.slice(1) : '';
  });
  expect(sessionId).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  const apiHistory: { sessionMatches: boolean; messageArrayPresent: boolean; paginationReturned: number | null; rows: Array<{ id: number | null; role: string; text: string; hasToolActivity: boolean }> } = await desktop.evaluate(async (sid: string) => {
    const bridge = (window as Window & { hermesDesktop?: { api: (args: { path: string }) => Promise<any> } }).hermesDesktop;
    const response = await bridge?.api({ path: `/api/sessions/${encodeURIComponent(sid)}/messages?limit=20&order=oldest` });
    const messages = Array.isArray(response?.messages) ? response.messages : [];
    const extractText = (value: any): string => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try { return extractText(JSON.parse(trimmed)); } catch { /* ordinary text */ }
        }
        return value;
      }
      if (Array.isArray(value)) return value.map(extractText).join('');
      if (!value || typeof value !== 'object') return '';
      if (value.type === 'text' && typeof value.text === 'string') return value.text;
      return Object.values(value).map(extractText).join('');
    };
    const hasToolActivity = (value: any): boolean => {
      if (value == null || value === false || value === '') return false;
      if (typeof value === 'string') {
        try { return hasToolActivity(JSON.parse(value)); } catch { return value.trim().length > 0; }
      }
      if (Array.isArray(value)) return value.some(hasToolActivity);
      if (typeof value === 'object') {
        if (['tool_call', 'tool_use', 'tool_result', 'function_call', 'function'].includes(String(value.type ?? '').toLowerCase())) return true;
        return Object.values(value).some(hasToolActivity);
      }
      return Boolean(value);
    };
    const hasToolContent = (value: any): boolean => {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try { return hasToolContent(JSON.parse(trimmed)); } catch { return false; }
        }
        return false;
      }
      if (Array.isArray(value)) return value.some(hasToolContent);
      if (!value || typeof value !== 'object') return false;
      if (['tool_call', 'tool_use', 'tool_result', 'function_call', 'function'].includes(String(value.type ?? '').toLowerCase())) return true;
      return Object.values(value).some(hasToolContent);
    };
    return {
      sessionMatches: response?.session_id === sid,
      messageArrayPresent: Array.isArray(response?.messages),
      paginationReturned: response?.pagination?.returned ?? null,
      rows: messages.map((message: any) => ({
        id: typeof message.id === 'number' ? message.id : null,
        role: message.role,
        text: extractText(message.content).trim(),
        hasToolActivity: hasToolActivity(message.tool_calls) || Boolean(message.tool_call_id) || hasToolContent(message.content),
      })),
    };
      }, sessionId);
  expect(apiHistory.sessionMatches).toBe(true);
  expect(apiHistory.messageArrayPresent).toBe(true);
  expect(apiHistory.paginationReturned).toBe(2);
  expect(apiHistory.rows.map(row => row.role)).toEqual(['user', 'assistant']);
  expect(apiHistory.rows).toHaveLength(2);
  expect(apiHistory.rows[0].text).toBe(PROMPT);
  expect(apiHistory.rows[1].text).toBe(uiAssistantText);
  expect(apiHistory.rows.some(row => row.hasToolActivity)).toBe(false);
  phase = 'api-history-verified';

  const hermesDbPath = join(privateHermesHome, 'state.db');
  ownedPrivateDb(hermesDbPath, privateHermesHome);
  const Database = requireFromRhythmApi('better-sqlite3') as new (file: string, options: { readonly: true; fileMustExist: true }) => ReadOnlySqlite;
  const db = new Database(hermesDbPath, { readonly: true, fileMustExist: true });
  let session: Record<string, any> | undefined;
  let usage: Array<Record<string, any>> = [];
  let history: Array<Record<string, any>> = [];
  try {
    session = db.prepare('SELECT model,billing_provider,billing_mode,api_call_count FROM sessions WHERE id=?').get(sessionId);
    usage = db.prepare('SELECT model,billing_provider,billing_base_url,billing_mode,task,api_call_count FROM session_model_usage WHERE session_id=? ORDER BY last_seen DESC').all(sessionId);
    history = db.prepare('SELECT id,role,content,tool_calls,tool_call_id FROM messages WHERE session_id=? AND active=1 ORDER BY id ASC').all(sessionId);
  } finally {
    db.close();
  }
  expect(session).toMatchObject({ model: 'gpt-6-luna', billing_provider: HERMES_PROVIDER });
  expect(usage, 'the sole user turn must have no extra auxiliary provider calls').toHaveLength(1);
  expect(usage[0]).toMatchObject({ model: 'gpt-6-luna', billing_provider: HERMES_PROVIDER, api_call_count: 1, task: '' });
  if (usage[0].billing_base_url !== OFFICIAL_OPENAI_BASE_URL) {
    throw new Error('persisted main usage did not use the official OpenAI API base URL');
  }
  // billing_mode is a billing classification, not the transport api_mode.
  // Direct paid calls pass None; sessions keeps NULL while the NOT NULL
  // per-model attribution column normalizes that missing classification to ''.
  expect(session?.billing_mode ?? null).toBeNull();
  expect(usage[0].billing_mode).toBe('');
  const dbHistory = history.map(row => ({
    role: String(row.role), text: contentText(row.content).trim(),
    hasToolActivity: hasToolActivity(row.tool_calls) || Boolean(row.tool_call_id) || hasToolContent(row.content),
  }));
  expect(dbHistory.map(row => row.role)).toEqual(['user', 'assistant']);
  expect(dbHistory[0].text).toBe(PROMPT);
  expect(dbHistory[1].text).toBe(uiAssistantText);
  expect(dbHistory.some(row => row.hasToolActivity)).toBe(false);
  phase = 'sqlite-provider-and-history-verified';
  const identityAfter = hermesIdentity(packaged.appPath);
  expect(identityAfter).toEqual(identityBefore);

  const safeReceipt = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    phase: 'one-turn-persisted',
    fixtureManifestSha256: fixtureDigest,
    actorOwnerUserId: manifest.ownerUserId,
    rhythmSourceRevision: RHYTHM_SOURCE,
    rhythmProductRevision: expectedRevision,
    hermesSourceRevision,
    hermesHome: privateHermesHome,
    audience: grant.audience,
    provider: HERMES_PROVIDER,
    model: 'gpt-6-luna',
    modelTurnCount: 1,
    sessionIdSha256: createHash('sha256').update(sessionId).digest('hex'),
    assistantMessageCount: dbHistory.filter(row => row.role === 'assistant').length,
    assistantAnswerSha256: createHash('sha256').update(dbHistory[1].text).digest('hex'),
    userPromptSha256: createHash('sha256').update(dbHistory[0].text).digest('hex'),
    uiAssistantContentLength: uiAssistantLength,
    apiCallCount: Number(usage[0].api_call_count),
    persistedMainUsageRoute: {
      provider: String(usage[0].billing_provider), model: String(usage[0].model),
      baseUrl: OFFICIAL_OPENAI_BASE_URL, sessionBillingMode: session?.billing_mode ?? null,
      usageBillingMode: String(usage[0].billing_mode), task: '',
    },
    hermesIdentity: identityAfter,
    toolCalls: 0,
    screenshots: false,
    traces: false,
    video: false,
  };
  writeReceipt(join(runRoot!, 'turn-observation.json'), safeReceipt);
  phase = 'one-turn-persisted';
  succeeded = true;
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    if (runRoot && runRootValidated && !succeeded) {
      let failureDiagnostics: PrivateJson | null = null;
      if (sendAttempted && desktop && hermesHome) {
        try { failureDiagnostics = await collectFailureDiagnostics(desktop, hermesHome, sessionId); }
        catch { failureDiagnostics = { readFailed: true }; }
      }
      try {
        writeReceipt(join(runRoot, 'failure-observation.json'), {
          schemaVersion: 1,
          observedAt: new Date().toISOString(),
          outcome: 'failed',
          phase,
          maximumPossibleModelTurns: sendAttempted ? 1 : 0,
          sendAttempted,
          fixtureManifestSha256: manifestSha256 ?? null,
          hermesHome: hermesHome ?? null,
          hermesIdentity: identityBefore ?? null,
          failureDiagnostics,
          screenshots: false,
          traces: false,
          video: false,
        });
      } catch {
        // Preserve the behavioral failure; receipt-writing errors must not mask it.
        if (!primaryFailure) throw new Error('could not persist private sanitized failure receipt');
      }
    }
  }
}

if (explicitlyOptedIn) {
  packagedTest(title, runAuthorizedHermesTurn);
} else {
  // Register a failing raw Playwright check before packaged fixtures are used.
  // The broad packaged suite must never open an operator app for this test.
  unverified(title, () => {
    throw new Error('UNVERIFIED: explicit private model opt-in, exact app/build, disposable fixture, audience grant, and run root are required');
  });
}
