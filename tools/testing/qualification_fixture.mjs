import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function owned(file, mode, directory = false) {
  const st = lstatSync(file);
  if (realpathSync(file) !== file || st.isSymbolicLink() || st.uid !== process.getuid()
    || (st.mode & 0o777) !== mode || (directory ? !st.isDirectory() : !st.isFile() || st.nlink !== 1))
    throw new Error('Qualification fixture must use private owned canonical files');
}

/** Read only explicit startup authority; never discover or copy an operator profile. */
export function readQualificationFixture(manifestPath, expectedRevision) {
  if (typeof manifestPath !== 'string' || !manifestPath.startsWith('/private/tmp/') || resolve(manifestPath) !== manifestPath)
    throw new Error('Qualification fixture manifest must be canonical private tmp');
  owned(manifestPath, 0o600);
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (m.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(m.sourceRevision) || m.sourceRevision !== expectedRevision
    || !m.fixtureRoot?.startsWith('/private/tmp/') || resolve(m.fixtureRoot) !== m.fixtureRoot
    || manifestPath !== join(m.fixtureRoot, 'manifest.json') || m.dbPath !== join(m.fixtureRoot, 'rhythm.db')
    || !/^[a-f0-9]{64}$/.test(m.tokenSha256) || !Number.isSafeInteger(m.ownerUserId) || m.ownerUserId <= 0
    || m.publicUserSeed?.id !== m.ownerUserId || !m.publicUserSeed.email?.endsWith('.invalid')
    || m.publicUserSeed.googleSub !== `qualification-fixture:${m.ownerId}`
    || m.syntheticActor?.tokenPath !== join(m.fixtureRoot, 'actor-token'))
    throw new Error('Qualification fixture authority binding invalid');
  owned(m.fixtureRoot, 0o700, true);
  const userDataPath = join(m.fixtureRoot, 'electron-user-data');
  owned(userDataPath, 0o700, true);
  owned(m.syntheticActor.tokenPath, 0o600);
  const token = readFileSync(m.syntheticActor.tokenPath, 'utf8');
  const expiresAt = Date.parse(m.syntheticActor.expiresAt);
  if (!/^[a-f0-9]{64}$/.test(token) || createHash('sha256').update(token).digest('hex') !== m.tokenSha256
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 86_400_000)
    throw new Error('Qualification fixture bearer invalid or expired');
  if (existsSync(m.dbPath)) owned(m.dbPath, 0o600);
  if (m.profileSeedPath) {
    if (m.profileSeedPath !== join(m.fixtureRoot, 'profiles.json')) throw new Error('Qualification profile seed escaped fixture');
    owned(m.profileSeedPath, 0o600);
  }
  return { manifest: m, userDataPath };
}

export function createQualificationFixture(sourceRevision) {
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error('Exact source revision required');
  const fixtureRoot = mkdtempSync('/private/tmp/rhythm-ai-fixture-');
  const ownerId = randomUUID();
  const ownerUserId = 1;
  const token = randomBytes(32).toString('hex');
  for (const directory of ['electron-user-data', 'home', 'opencode-config', 'logs']) mkdirSync(join(fixtureRoot, directory), { mode: 0o700 });
  const tokenPath = join(fixtureRoot, 'actor-token');
  writeFileSync(tokenPath, token, { mode: 0o600, flag: 'wx' });
  const profileSeedPath = join(fixtureRoot, 'profiles.json');
  const profiles = ['secretary', 'workflow-orchestrator', 'coding-agent', 'verification-gate'].map(id => ({
    id, revision: 3, label: `[smoke] ${id}`, icon: 'hub', enabled: true, isAgent: true,
    systemPrompt: 'Work only within the explicit disposable qualification workspace. Never send external messages. Ask before commands or edits.',
    allowedMcpsJson: '[]', allowedSkillsJson: '[]', corePermissionsJson: '{"read":"allow","edit":"ask","bash":"ask"}',
    allowedDelegatesJson: '[]', modelProvider: 'openai', modelId: 'gpt-6-luna', ocAgent: id,
    sessionSelectable: true, schedulable: true, reasoningEffort: 'low', autoApproveActions: false,
  }));
  writeFileSync(profileSeedPath, JSON.stringify({ profiles }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  const manifest = { schemaVersion: 1, sourceRevision, fixtureRoot, dbPath: join(fixtureRoot, 'rhythm.db'), ownerId, ownerUserId,
    tokenSha256: createHash('sha256').update(token).digest('hex'), profileSeedPath,
    publicUserSeed: { id: ownerUserId, name: `[smoke] ${ownerId}`, email: `${ownerId}@qualification.invalid`, googleSub: `qualification-fixture:${ownerId}`, timezone: 'UTC' },
    syntheticActor: { tokenPath, expiresAt: new Date(Date.now() + 23 * 3_600_000).toISOString() } };
  const manifestPath = join(fixtureRoot, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  readQualificationFixture(manifestPath, sourceRevision);
  return manifestPath;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.stdout.write(createQualificationFixture(process.argv[2]) + '\n');
