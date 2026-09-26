import { randomUUID } from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { resolveHermesDesktopArtifact } from './hermes-desktop-artifact.mjs';

const LEDGER_FILE = 'hermes-desktop-updates.json';
const VERSIONS_DIRECTORY = 'hermes-desktop-versions';
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

/** @typedef {{attempts: number, sequence: number, state: 'pending' | 'good' | 'bad', reason?: string}} UpdateRecord */
/** @typedef {{schemaVersion: 1, versions: Record<string, UpdateRecord>}} UpdateLedger */
/** @typedef {{kind: 'dev' | 'factory', root: string} | {kind: 'installed', root: string, sequence: number, version: string}} ArtifactCandidate */

/** @returns {UpdateLedger} */
const emptyLedger = () => ({ schemaVersion: 1, versions: {} });

/** @param {string} root @param {string} target */
function isWithin(root, target) {
  const base = resolve(root);
  const candidate = resolve(target);
  return candidate === base || candidate.startsWith(`${base}${sep}`);
}

/** @param {unknown} value @returns {value is UpdateRecord} */
function validVersionRecord(value) {
  const record = /** @type {any} */ (value);
  return Boolean(record && typeof record === 'object' && !Array.isArray(record)
    && ['pending', 'good', 'bad'].includes(record.state)
    && Number.isSafeInteger(record.sequence) && record.sequence >= 1
    && Number.isSafeInteger(record.attempts) && record.attempts >= 0);
}

/** @param {string} userDataPath @param {typeof fsPromises} fs @returns {Promise<UpdateLedger>} */
async function readLedger(userDataPath, fs) {
  try {
    const parsed = JSON.parse(await fs.readFile(join(userDataPath, LEDGER_FILE), 'utf8'));
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.versions || typeof parsed.versions !== 'object' || Array.isArray(parsed.versions)) return emptyLedger();
    /** @type {Record<string, UpdateRecord>} */
    const versions = {};
    for (const [version, record] of Object.entries(parsed.versions)) {
      if (VERSION.test(version) && validVersionRecord(record)) versions[version] = { ...record };
    }
    return { schemaVersion: 1, versions };
  } catch { return emptyLedger(); }
}

/** @param {string} userDataPath @param {UpdateLedger} ledger @param {typeof fsPromises} fs */
async function writeLedger(userDataPath, ledger, fs) {
  if (!isAbsolute(userDataPath)) throw new Error('Hermes Desktop update userData path must be absolute.');
  await fs.mkdir(userDataPath, { recursive: true });
  const destination = join(userDataPath, LEDGER_FILE);
  const temporary = join(userDataPath, `.${LEDGER_FILE}.${randomUUID()}.tmp`);
  if (!isWithin(userDataPath, destination) || !isWithin(userDataPath, temporary)) throw new Error('Hermes Desktop update ledger escaped userData.');
  await fs.writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, destination);
}

/**
 * Owns the installed-version ledger. Payloads are selected only from records
 * written by the verified local installer; unregistered directories are inert.
 * @param {{userDataPath: string, factoryRoot: string, fs?: typeof fsPromises}} options
 */
export function createHermesDesktopUpdateStore({ userDataPath, factoryRoot, fs = fsPromises }) {
  if (!isAbsolute(userDataPath) || !isAbsolute(factoryRoot)) throw new Error('Hermes Desktop update paths must be absolute.');
  const versionsRoot = join(userDataPath, VERSIONS_DIRECTORY);
  /** @type {Promise<void>} */
  let mutation = Promise.resolve();
  /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
  const mutate = (operation) => {
    const next = mutation.then(operation);
    mutation = next.then(() => undefined, () => undefined);
    return next;
  };
  /** @param {string} version @param {UpdateRecord} record @returns {ArtifactCandidate} */
  const candidateFor = (version, record) => ({
    kind: 'installed',
    root: join(versionsRoot, version),
    sequence: record.sequence,
    version,
  });

  return {
    /** @param {{devOverride?: string, includePending?: boolean}} [options] @returns {Promise<ArtifactCandidate[]>} */
    async getLaunchCandidates(options = {}) {
      const { devOverride, includePending = false } = options;
      await mutation;
      const ledger = await readLedger(userDataPath, fs);
      const installed = Object.entries(ledger.versions)
        .filter(([, record]) => record.state === 'good' || (includePending && record.state === 'pending'))
        .sort((left, right) => right[1].sequence - left[1].sequence)
        .map(([version, record]) => candidateFor(version, record));
      /** @type {ArtifactCandidate[]} */
      const candidates = [
        ...(typeof devOverride === 'string' && isAbsolute(devOverride) ? [{ kind: /** @type {const} */ ('dev'), root: devOverride }] : []),
        ...installed,
        { kind: 'factory', root: factoryRoot },
      ];
      return candidates;
    },
    /** @param {ArtifactCandidate | undefined} candidate */
    async beginLaunch(candidate) {
      if (!candidate || candidate.kind !== 'installed') return true;
      return mutate(async () => {
        const ledger = await readLedger(userDataPath, fs);
        const record = ledger.versions[candidate.version];
        if (!validVersionRecord(record) || record.state === 'bad') return false;
        if (record.state === 'pending' && record.attempts >= 1) {
          ledger.versions[candidate.version] = { ...record, state: 'bad', reason: 'pending-across-two-launches' };
          await writeLedger(userDataPath, ledger, fs);
          return false;
        }
        if (record.state === 'pending') {
          ledger.versions[candidate.version] = { ...record, attempts: record.attempts + 1 };
          await writeLedger(userDataPath, ledger, fs);
        }
        return true;
      });
    },
    /** @param {ArtifactCandidate | undefined} candidate @param {string} [reason] */
    async markBad(candidate, reason = 'launch-failed') {
      if (!candidate || candidate.kind !== 'installed') return;
      await mutate(async () => {
        const ledger = await readLedger(userDataPath, fs);
        const record = ledger.versions[candidate.version];
        if (!validVersionRecord(record)) return;
        ledger.versions[candidate.version] = { ...record, state: 'bad', reason: String(reason).slice(0, 120) };
        await writeLedger(userDataPath, ledger, fs);
      });
    },
    /** @param {ArtifactCandidate | undefined} candidate */
    async markGood(candidate) {
      if (!candidate || candidate.kind !== 'installed') return;
      await mutate(async () => {
        const ledger = await readLedger(userDataPath, fs);
        const record = ledger.versions[candidate.version];
        if (!validVersionRecord(record) || record.state === 'bad') return;
        ledger.versions[candidate.version] = { attempts: record.attempts, sequence: record.sequence, state: 'good' };
        await writeLedger(userDataPath, ledger, fs);
      });
    },
  };
}

/**
 * Stages a local, already-signed update. Network acquisition and native-code
 * signing are intentionally outside this trust boundary.
 * @param {{sourceRoot: string, userDataPath: string, expectedElectronMajor: number, expectedElectronVersion: string,
 * factorySequence?: number, fs?: typeof fsPromises, resolveArtifact?: typeof resolveHermesDesktopArtifact}} options
 */
export async function installHermesDesktopUpdate({
  sourceRoot,
  userDataPath,
  expectedElectronMajor,
  expectedElectronVersion,
  factorySequence = 0,
  fs = fsPromises,
  resolveArtifact = resolveHermesDesktopArtifact,
}) {
  if (!isAbsolute(sourceRoot) || !isAbsolute(userDataPath)) throw new Error('Hermes Desktop update paths must be absolute.');
  const versionsRoot = join(userDataPath, VERSIONS_DIRECTORY);
  await fs.mkdir(versionsRoot, { recursive: true });
  /** @type {string | undefined} */
  let staging = await fs.mkdtemp(join(versionsRoot, '.staging-'));
  try {
    if (!isWithin(userDataPath, staging)) throw new Error('Hermes Desktop update staging escaped userData.');
    await fs.cp(sourceRoot, staging, { recursive: true, errorOnExist: false, force: false, dereference: false });
    const artifact = await resolveArtifact({
      artifactRoot: staging,
      artifactSource: 'installed',
      expectedElectronMajor,
      expectedElectronVersion,
    });
    const { hermesVersion, sequence } = artifact.manifest ?? {};
    if (typeof hermesVersion !== 'string' || !VERSION.test(hermesVersion) || !Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error('Hermes Desktop update manifest version metadata is invalid.');
    }
    const ledger = await readLedger(userDataPath, fs);
    const highestGood = Math.max(factorySequence, 0, ...Object.values(ledger.versions)
      .filter((record) => record.state === 'good')
      .map((record) => record.sequence));
    if (sequence <= highestGood) throw new Error(`Hermes Desktop update replay sequence ${sequence} is not newer than ${highestGood}.`);
    const destination = join(versionsRoot, hermesVersion);
    if (!isWithin(userDataPath, destination)) throw new Error('Hermes Desktop update destination escaped userData.');
    await fs.rename(staging, destination);
    staging = undefined;
    ledger.versions[hermesVersion] = { attempts: 0, sequence, state: 'pending' };
    await writeLedger(userDataPath, ledger, fs);
    return { root: destination, sequence, state: 'pending', version: hermesVersion };
  } finally {
    if (staging) await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}
