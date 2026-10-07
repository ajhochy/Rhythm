import { validateDayflowDesktopArtifact } from './dayflow-desktop-artifact.mjs';

export const DAYFLOW_DESKTOP_CHANNELS = Object.freeze({
  status: 'dayflow-desktop:get-status',
  open: 'dayflow-desktop:open',
});

/**
 * @typedef {object} DayflowCommandResult
 * @property {string} stdout
 * @property {string} stderr
 */

/** @typedef {(command: string, args: string[]) => Promise<DayflowCommandResult>} DayflowCommandExecutor */

/**
 * @typedef {object} DayflowDesktopArtifact
 * @property {string} root
 * @property {string} version
 * @property {string} build
 * @property {string} identifier
 */

/**
 * @typedef {object} DayflowDesktopCandidates
 * @property {string} [installedAppPath]
 * @property {string} [bundledAppPath]
 * @property {string} [arch]
 */

/** @typedef {{ appRoot?: string, targetArch?: string, execute?: DayflowCommandExecutor }} DayflowArtifactValidationOptions */
/** @typedef {(options?: DayflowArtifactValidationOptions) => Promise<DayflowDesktopArtifact>} DayflowArtifactValidator */
/** @typedef {{ status: 'ready', version: string, build: string, identifier: string }} DayflowReadyStatus */
/** @typedef {{ status: 'unavailable', code: string }} DayflowUnavailableStatus */
/** @typedef {{ status: 'unsupported', code: 'UNSUPPORTED_PLATFORM' }} DayflowUnsupportedStatus */
/** @typedef {DayflowReadyStatus | DayflowUnavailableStatus | DayflowUnsupportedStatus} DayflowDesktopStatus */
/** @typedef {{ kind: 'installed' | 'bundled', artifact: DayflowDesktopArtifact } | { kind: 'unsupported' | 'invalid' | 'missing' }} DayflowCandidateResolution */
/** @typedef {{ getStatus: () => Promise<DayflowDesktopStatus>, open: () => Promise<DayflowDesktopStatus> }} DayflowDesktopHost */
/** @typedef {{ candidates?: DayflowDesktopCandidates, platform?: string, execute?: DayflowCommandExecutor, validateArtifact?: DayflowArtifactValidator }} DayflowDesktopHostOptions */
/** @typedef {{ ipcMain: Pick<import('electron').IpcMain, 'handle'>, isTrustedSender: (event: import('electron').IpcMainInvokeEvent) => boolean, host: DayflowDesktopHost }} DayflowDesktopIpcRegistration */

/** @param {string} [code] @returns {DayflowUnavailableStatus} */
const unavailable = (code = 'UNAVAILABLE') => ({ status: 'unavailable', code });
/** @returns {DayflowUnsupportedStatus} */
const unsupported = () => ({ status: 'unsupported', code: 'UNSUPPORTED_PLATFORM' });
/** @param {unknown} value */
const emptyPayload = (value) => value === undefined;

/**
 * A deliberately narrow host-side controller for the independently signed app.
 * Candidates are composed by the trusted Electron main process; renderer input
 * never reaches validation or the process launcher.
 */
/**
 * @param {DayflowDesktopHostOptions} [options]
 * @returns {DayflowDesktopHost}
 */
export function createDayflowDesktopHost({
  candidates = {},
  platform = process.platform,
  execute,
  validateArtifact = validateDayflowDesktopArtifact,
} = {}) {
  if (typeof execute !== 'function') throw new TypeError('Dayflow desktop host requires a command executor');
  if (typeof validateArtifact !== 'function') throw new TypeError('Dayflow desktop host requires an artifact validator');
  const targetArch = candidates.arch ?? process.arch;

  /** @param {string} appRoot @returns {Promise<DayflowDesktopArtifact>} */
  const validate = async (appRoot) => validateArtifact({ appRoot, targetArch, execute });
  /** @returns {Promise<DayflowCandidateResolution>} */
  const resolveCandidate = async () => {
    if (platform !== 'darwin') return { kind: 'unsupported' };
    // Do not fall through after a supplied installed candidate fails validation:
    // a signature failure is a security result, not evidence that it is absent.
    if (candidates.installedAppPath) {
      try { return { kind: 'installed', artifact: await validate(candidates.installedAppPath) }; }
      catch { return { kind: 'invalid' }; }
    }
    if (candidates.bundledAppPath) {
      try { return { kind: 'bundled', artifact: await validate(candidates.bundledAppPath) }; }
      catch { return { kind: 'invalid' }; }
    }
    return { kind: 'missing' };
  };
  /** @param {DayflowDesktopArtifact} artifact @returns {DayflowReadyStatus} */
  const metadata = (artifact) => ({
    status: 'ready',
    version: artifact.version,
    build: artifact.build,
    identifier: artifact.identifier,
  });

  return {
    async getStatus() {
      const candidate = await resolveCandidate();
      if (candidate.kind === 'unsupported') return unsupported();
      if (candidate.kind !== 'installed' && candidate.kind !== 'bundled') return unavailable(candidate.kind === 'invalid' ? 'ARTIFACT_INVALID' : 'APP_NOT_FOUND');
      return metadata(candidate.artifact);
    },
    async open() {
      const candidate = await resolveCandidate();
      if (candidate.kind === 'unsupported') return unsupported();
      if (candidate.kind !== 'installed' && candidate.kind !== 'bundled') return unavailable(candidate.kind === 'invalid' ? 'ARTIFACT_INVALID' : 'APP_NOT_FOUND');
      // The candidate is revalidated immediately before this action. `open -a`
      // focuses an existing app and intentionally never asks LaunchServices to
      // create another instance.
      try { await execute('open', ['-a', candidate.artifact.root]); }
      catch { return unavailable('LAUNCH_FAILED'); }
      return metadata(candidate.artifact);
    },
  };
}

/** Register only empty-payload, trusted-renderer IPC calls. */
/** @param {DayflowDesktopIpcRegistration} registration */
export function registerDayflowDesktopIpc({ ipcMain, isTrustedSender, host }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') throw new TypeError('Dayflow desktop IPC requires ipcMain.handle');
  if (typeof isTrustedSender !== 'function') throw new TypeError('Dayflow desktop IPC requires isTrustedSender');
  if (!host || typeof host.getStatus !== 'function' || typeof host.open !== 'function') throw new TypeError('Dayflow desktop IPC requires host methods');
  const deny = () => unavailable('UNAUTHORIZED');
  ipcMain.handle(DAYFLOW_DESKTOP_CHANNELS.status, async (event, payload) => {
    if (!isTrustedSender(event) || !emptyPayload(payload)) return deny();
    try { return await host.getStatus(); } catch { return unavailable(); }
  });
  ipcMain.handle(DAYFLOW_DESKTOP_CHANNELS.open, async (event, payload) => {
    if (!isTrustedSender(event) || !emptyPayload(payload)) return deny();
    try { return await host.open(); } catch { return unavailable(); }
  });
}
