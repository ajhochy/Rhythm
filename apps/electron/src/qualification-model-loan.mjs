import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/;
const unavailable = () => new Error('Qualification model loan unavailable');
/** @typedef {Record<string, any>} JsonObject */
/** @param {string | Buffer} bytes */
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value */
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);

/** @param {string} path @param {{secret?: boolean}} [options] */
function ownedFile(path, { secret = true } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) throw unavailable();
  const st = lstatSync(path);
  if (realpathSync(path) !== path || !st.isFile() || st.isSymbolicLink() || st.nlink !== 1
    || st.uid !== process.getuid?.() || (st.mode & (secret ? 0o077 : 0o022)) !== 0) throw unavailable();
  return st;
}

/** @param {string} root */
function ownedRoot(root) {
  if (typeof root !== 'string' || !root.startsWith('/private/tmp/') || resolve(root) !== root) throw unavailable();
  const st = lstatSync(root);
  if (realpathSync(root) !== root || !st.isDirectory() || st.isSymbolicLink()
    || st.uid !== process.getuid?.() || (st.mode & 0o777) !== 0o700) throw unavailable();
}

/** @param {string} path @param {string} root */
function sourceOutsideFixture(path, root) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path
    || path === root || path.startsWith(`${root}/`)) throw unavailable();
}

/** Read a single canonical, owner-controlled source file without following symlinks. */
/** @param {string} path @param {{secret?: boolean}} [options] */
function safeRead(path, options) {
  const original = ownedFile(path, options);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const final = ownedFile(path, options);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.()
      || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.dev !== original.dev || before.ino !== original.ino
      || before.mode !== original.mode || before.dev !== final.dev || before.ino !== final.ino
      || before.mode !== final.mode || before.size !== final.size || before.mtimeMs !== final.mtimeMs) throw unavailable();
    return bytes;
  } finally { closeSync(fd); }
}

/** @param {Buffer} bytes @returns {JsonObject} */
function parse(bytes) {
  try { const value = JSON.parse(bytes.toString('utf8')); if (value && typeof value === 'object' && !Array.isArray(value)) return value; }
  catch { /* fixed error below */ }
  throw unavailable();
}

/** @param {JsonObject} settings @returns {JsonObject} */
function decisionProjection(settings) {
  const keys = ['backend', 'openaiDecisions', 'timeoutMs', 'remoteDataConsent', 'features', 'routing',
    'tiers', 'tierOverrides', 'excludedModels'];
  /** @type {JsonObject} */
  const result = {};
  for (const key of keys) if (Object.hasOwn(settings, key)) result[key] = settings[key];
  if (result.openaiDecisions) result.openaiDecisions = {
    baseUrl: result.openaiDecisions.baseUrl, model: result.openaiDecisions.model,
  };
  return result;
}

/** @param {JsonObject} settings @returns {JsonObject} */
function gridProjection(settings) {
  const keys = ['version', 'reserve_pct', 'coding_t1_prefer_astra', 'agent_auto_profiles', 'classifier',
    'models', 'routing', 'openrouter_fallback', 'task_type_overrides', 'free_mode'];
  /** @type {JsonObject} */
  const result = {};
  for (const key of keys) if (Object.hasOwn(settings, key)) result[key] = settings[key];
  return result;
}

/** @param {unknown} value */
function assertNoCredentialKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (/(?:key|token|secret|password|credential|authorization|access)/i.test(key)) throw unavailable();
    assertNoCredentialKeys(item);
  }
}

/** Metadata-only selection; never returns either token. */
/** @param {string} sourceAccountsPath */
export function inspectQualificationModelAccounts(sourceAccountsPath) {
  const source = parse(safeRead(sourceAccountsPath));
  if (source.version !== 1 || !Array.isArray(source.accounts) || typeof source.defaultAccountId !== 'string') throw unavailable();
  return { accounts: source.accounts.map((account) => ({ id: account.id, label: account.label,
    status: account.status, expires: account.expires })), defaultAccountId: source.defaultAccountId };
}

/** Metadata-only Anthropic selection; no access or refresh token leaves this function. */
/** @param {string} sourceAccountsPath */
export function inspectQualificationAnthropicAccounts(sourceAccountsPath) {
  const source = parse(safeRead(sourceAccountsPath));
  if (source.version !== 1 || !Array.isArray(source.accounts) || typeof source.defaultAccountId !== 'string') throw unavailable();
  return { accounts: source.accounts.map((account) => ({ id: account.id, label: account.label,
    status: account.status, expires: account.expires })), defaultAccountId: source.defaultAccountId };
}

/** @param {JsonObject} file */
function accountProjection(file) {
  if (file.version !== 1 || !Array.isArray(file.accounts) || file.accounts.length !== 1
    || file.defaultAccountId !== 'qualification-model'
    || Object.keys(file).some((key) => !['version', 'accounts', 'defaultAccountId', 'routing', 'pinned'].includes(key))
    || !file.routing || typeof file.routing !== 'object' || Array.isArray(file.routing)
    || !file.pinned || typeof file.pinned !== 'object' || Array.isArray(file.pinned)
    || Object.values(file.routing).some((id) => id !== 'qualification-model')
    || Object.values(file.pinned).some((pinned) => pinned !== true)) throw unavailable();
  const account = file.accounts[0];
  if (!account || Object.keys(account).some((key) => !['id', 'label', 'access', 'refresh', 'expires', 'status', 'chatgptAccountId'].includes(key))
    || account.id !== 'qualification-model' || account.label !== '[smoke] selected model'
    || typeof account.access !== 'string' || !account.access || account.refresh !== ''
    || account.status !== 'ok' || !Number.isSafeInteger(account.expires)
    || typeof account.chatgptAccountId !== 'string' || !account.chatgptAccountId) throw unavailable();
  return { id: account.id, label: account.label, access: account.access, refresh: account.refresh,
    expires: account.expires, status: account.status, chatgptAccountId: account.chatgptAccountId };
}

/** Optional, explicit fixture-only materialization; no operator file is written. */
/** @param {{manifestPath: string, expectedRevision: string, readFixture: (path: string, revision: string) => {manifest: JsonObject},
 * sourceAccountsPath: string, selectedAccountId: string, sourceDecisionPath: string, reviewedDecision: JsonObject,
 * sourceGridPath: string, reviewedGrid: JsonObject, now?: number}} options */
export function provisionQualificationModelLoan({ manifestPath, expectedRevision, readFixture, sourceAccountsPath, selectedAccountId,
  sourceDecisionPath, reviewedDecision, sourceGridPath, reviewedGrid, now = Date.now() }) {
  if (typeof readFixture !== 'function') throw unavailable();
  const originalManifestBytes = safeRead(manifestPath);
  const validated = readFixture(manifestPath, expectedRevision);
  const manifest = validated?.manifest;
  const root = manifest.fixtureRoot;
  ownedRoot(root);
  if (canonical(parse(originalManifestBytes)) !== canonical(manifest)
    || manifest.sourceRevision !== expectedRevision || manifestPath !== join(root, 'manifest.json')
    || manifest.syntheticActor?.modelLoan
    || typeof selectedAccountId !== 'string' || !selectedAccountId) throw unavailable();
  for (const path of [sourceAccountsPath, sourceDecisionPath, sourceGridPath]) sourceOutsideFixture(path, root);
  const source = parse(safeRead(sourceAccountsPath));
  if (source.version !== 1 || !Array.isArray(source.accounts)) throw unavailable();
  const matches = source.accounts.filter((account) => account.id === selectedAccountId);
  if (matches.length !== 1) throw unavailable();
  const selected = matches[0];
  if (selected.status !== 'ok' || typeof selected.access !== 'string' || !selected.access
    || typeof selected.chatgptAccountId !== 'string' || !selected.chatgptAccountId
    || !Number.isSafeInteger(selected.expires) || selected.expires <= now + 30 * 60_000) throw unavailable();
  const sourceDecision = parse(safeRead(sourceDecisionPath));
  assertNoCredentialKeys(reviewedDecision);
  const reviewed = decisionProjection(reviewedDecision ?? {});
  if (canonical(decisionProjection(sourceDecision)) !== canonical(reviewed)
    || reviewed.backend !== 'openai_decisions' || reviewed.remoteDataConsent !== true
    || reviewed.openaiDecisions?.baseUrl !== 'https://api.openai.com'
    || typeof reviewed.openaiDecisions?.model !== 'string' || !reviewed.openaiDecisions.model
    || typeof sourceDecision.openaiDecisions?.apiKey !== 'string' || !sourceDecision.openaiDecisions.apiKey) throw unavailable();
  assertNoCredentialKeys(reviewed);
  const sourceGrid = parse(safeRead(sourceGridPath, { secret: false }));
  assertNoCredentialKeys(sourceGrid);
  assertNoCredentialKeys(reviewedGrid);
  const grid = gridProjection(reviewedGrid ?? {});
  if (canonical(gridProjection(sourceGrid)) !== canonical(grid)) throw unavailable();
  assertNoCredentialKeys(grid);
  const privateAccount = { id: 'qualification-model', label: '[smoke] selected model', access: selected.access,
    refresh: '', expires: selected.expires, status: 'ok', chatgptAccountId: selected.chatgptAccountId };
  const accountFile = { version: 1, accounts: [privateAccount], defaultAccountId: 'qualification-model', routing: {}, pinned: {} };
  const decisionFile = { version: 1, ...reviewed,
    openaiDecisions: { ...reviewed.openaiDecisions, apiKey: sourceDecision.openaiDecisions.apiKey } };
  const accountPath = join(root, 'openai-accounts.json'), decisionPath = join(root, 'decision-router.json');
  const gridPath = join(root, 'router-grid.json');
  const accountBytes = JSON.stringify(accountFile, null, 2) + '\n';
  const decisionBytes = JSON.stringify(decisionFile, null, 2) + '\n';
  const gridBytes = JSON.stringify(grid, null, 2) + '\n';
  const stopAt = Math.min(now + 10 * 60_000, selected.expires - 20 * 60_000);
  const loan = { accountPath, accountProjectionSha256: digest(canonical(privateAccount)), decisionPath,
    decisionSha256: digest(decisionBytes), gridPath, gridSha256: digest(gridBytes),
    selectorSha256: digest(selectedAccountId), issuedAt: now, expires: selected.expires, stopAt };
  const next = { ...manifest, syntheticActor: { ...manifest.syntheticActor, modelLoan: loan } };
  const created = [], tempManifestPath = `${manifestPath}.loan-${process.pid}`;
  try {
    for (const [path, bytes] of [[accountPath, accountBytes], [decisionPath, decisionBytes], [gridPath, gridBytes]]) {
      writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' }); created.push(path);
    }
    writeFileSync(tempManifestPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    assertQualificationModelLoan(next, { now });
    renameSync(tempManifestPath, manifestPath);
    return { stopAt, expires: selected.expires };
  } catch {
    for (const path of created) rmSync(path, { force: true });
    rmSync(tempManifestPath, { force: true });
    throw unavailable();
  }
}

/** One explicitly selected Anthropic account, frozen without its refresh token. */
/** @param {{manifestPath: string, expectedRevision: string, readFixture: (path: string, revision: string) => {manifest: JsonObject},
 * sourceAccountsPath: string, selectedAccountId: string, now?: number}} options */
export function provisionQualificationAnthropicModelLoan({ manifestPath, expectedRevision, readFixture,
  sourceAccountsPath, selectedAccountId, now = Date.now() }) {
  if (typeof readFixture !== 'function') throw unavailable();
  const originalManifestBytes = safeRead(manifestPath);
  const manifest = readFixture(manifestPath, expectedRevision)?.manifest;
  const root = manifest?.fixtureRoot;
  ownedRoot(root);
  if (canonical(parse(originalManifestBytes)) !== canonical(manifest)
    || manifest.sourceRevision !== expectedRevision || manifestPath !== join(root, 'manifest.json')
    || manifest.syntheticActor?.modelLoan || typeof selectedAccountId !== 'string' || !selectedAccountId) throw unavailable();
  sourceOutsideFixture(sourceAccountsPath, root);
  const source = parse(safeRead(sourceAccountsPath));
  if (source.version !== 1 || !Array.isArray(source.accounts)) throw unavailable();
  const matches = source.accounts.filter((account) => account.id === selectedAccountId);
  if (matches.length !== 1) throw unavailable();
  const selected = matches[0];
  if (selected.status !== 'ok' || typeof selected.access !== 'string' || !selected.access
    || !Number.isSafeInteger(selected.expires) || selected.expires <= now + 30 * 60_000) throw unavailable();
  const privateAccount = { id: 'qualification-model', label: '[smoke] selected model', access: selected.access,
    refresh: '', expires: selected.expires, status: 'ok' };
  const accountFile = { version: 1, accounts: [privateAccount], defaultAccountId: 'qualification-model',
    routing: {}, pinned: {} };
  const accountPath = join(root, 'anthropic-accounts.json');
  const accountBytes = JSON.stringify(accountFile, null, 2) + '\n';
  const stopAt = Math.min(now + 10 * 60_000, selected.expires - 20 * 60_000);
  const loan = { provider: 'anthropic', accountPath, accountProjectionSha256: digest(canonical(privateAccount)),
    selectorSha256: digest(selectedAccountId), issuedAt: now, expires: selected.expires, stopAt };
  const next = { ...manifest, syntheticActor: { ...manifest.syntheticActor, modelLoan: loan } };
  const tempManifestPath = `${manifestPath}.loan-${process.pid}`;
  let createdAccount = false, createdTemp = false;
  try {
    writeFileSync(accountPath, accountBytes, { mode: 0o600, flag: 'wx' });
    createdAccount = true;
    writeFileSync(tempManifestPath, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    createdTemp = true;
    assertQualificationModelLoan(next, { now });
    renameSync(tempManifestPath, manifestPath);
    return { stopAt, expires: selected.expires };
  } catch {
    if (createdAccount) rmSync(accountPath, { force: true });
    if (createdTemp) rmSync(tempManifestPath, { force: true });
    throw unavailable();
  }
}

/** Validate the immutable loan binding and the account's credential projection on every attach/read. */
/** @param {JsonObject} manifest @param {{now?: number}} [options] */
export function assertQualificationModelLoan(manifest, { now = Date.now() } = {}) {
  const loan = manifest?.syntheticActor?.modelLoan;
  if (!loan) return null;
  const root = manifest.fixtureRoot;
  if (loan.provider === 'anthropic') {
    if (loan.accountPath !== join(root, 'anthropic-accounts.json')
      || Object.keys(loan).some((key) => !['provider', 'accountPath', 'accountProjectionSha256',
        'selectorSha256', 'issuedAt', 'expires', 'stopAt'].includes(key))
      || !SHA256.test(loan.selectorSha256) || !SHA256.test(loan.accountProjectionSha256)
      || !Number.isSafeInteger(loan.issuedAt) || !Number.isSafeInteger(loan.expires)
      || !Number.isSafeInteger(loan.stopAt) || loan.issuedAt > now || loan.stopAt <= loan.issuedAt
      || loan.stopAt > loan.issuedAt + 10 * 60_000 || loan.stopAt > loan.expires - 20 * 60_000
      || now >= loan.stopAt) throw unavailable();
    const file = parse(safeRead(loan.accountPath));
    if (file.version !== 1 || !Array.isArray(file.accounts) || file.accounts.length !== 1
      || file.defaultAccountId !== 'qualification-model'
      || Object.keys(file).some((key) => !['version', 'accounts', 'defaultAccountId', 'routing', 'pinned'].includes(key))
      || !file.routing || typeof file.routing !== 'object' || Array.isArray(file.routing)
      || !file.pinned || typeof file.pinned !== 'object' || Array.isArray(file.pinned)
      || Object.values(file.routing).some((id) => id !== 'qualification-model')
      || Object.values(file.pinned).some((pinned) => pinned !== true)) throw unavailable();
    const account = file.accounts[0];
    if (!account || Object.keys(account).some((key) => !['id', 'label', 'access', 'refresh', 'expires', 'status'].includes(key))
      || account.id !== 'qualification-model' || account.label !== '[smoke] selected model'
      || typeof account.access !== 'string' || !account.access || account.refresh !== ''
      || account.status !== 'ok' || account.expires !== loan.expires
      || digest(canonical(account)) !== loan.accountProjectionSha256) throw unavailable();
    return loan;
  }
  if (loan.provider !== undefined) throw unavailable();
  if (loan.accountPath !== join(root, 'openai-accounts.json') || loan.decisionPath !== join(root, 'decision-router.json')
    || loan.gridPath !== join(root, 'router-grid.json') || !SHA256.test(loan.selectorSha256)
    || !SHA256.test(loan.accountProjectionSha256) || !SHA256.test(loan.decisionSha256) || !SHA256.test(loan.gridSha256)
    || !Number.isSafeInteger(loan.issuedAt) || !Number.isSafeInteger(loan.expires) || !Number.isSafeInteger(loan.stopAt)
    || loan.issuedAt > now || loan.stopAt <= loan.issuedAt
    || loan.stopAt > loan.issuedAt + 10 * 60_000 || loan.stopAt > loan.expires - 20 * 60_000
    || now >= loan.stopAt) throw unavailable();
  const account = accountProjection(parse(safeRead(loan.accountPath)));
  if (account.expires !== loan.expires || digest(canonical(account)) !== loan.accountProjectionSha256
    || digest(safeRead(loan.decisionPath)) !== loan.decisionSha256
    || digest(safeRead(loan.gridPath)) !== loan.gridSha256) throw unavailable();
  return loan;
}

/** An app quit is the hard upper bound; validation still denies reads at the deadline. */
/** @param {{manifest: JsonObject, app: {quit: () => void}, setTimer?: typeof setTimeout}} options */
export function armQualificationModelLoanDeadline({ manifest, app, setTimer = setTimeout }) {
  const loan = assertQualificationModelLoan(manifest);
  if (!loan) return null;
  const timer = setTimer(() => app.quit(), Math.max(0, loan.stopAt - Date.now()));
  timer.unref?.();
  return timer;
}
