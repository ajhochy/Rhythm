import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DayflowSourceError, type DayflowArtifactVerifier, type VerifiedDayflowArtifact } from './cli_source';

export interface TrustedDayflowRelease { bundleId: 'teleportlabs.com.Dayflow'; version: '2.6.0'; build: 133; signingFingerprint: string; helperDigest: string; }
export interface PlatformArtifactValidator { inspect(bundlePath: string, helperPath: string): Promise<{ bundleId: string; version: string; build: number; signingFingerprint: string; helperSignatureValid: boolean; appSignatureValid: boolean }>; }

/** A deliberately tiny adapter around macOS `codesign`, never `security`. */
export interface CodeSignCommandRunner { run(argv: readonly string[]): Promise<{ exitCode: number; stderr: string }>; }

const CODESIGN_ENV = Object.freeze({ PATH: '/usr/bin:/bin', HOME: '/var/empty', TMPDIR: '/var/empty', LANG: 'C', LC_ALL: 'C' });
const boundedCodesignRunner: CodeSignCommandRunner = {
  run(argv) { return new Promise((resolve) => {
    const child = spawn('/usr/bin/codesign', [...argv], { shell: false, env: CODESIGN_ENV, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; let bytes = 0; let settled = false;
    const done = (exitCode: number) => { if (!settled) { settled = true; resolve({ exitCode, stderr }); } };
    const timeout = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* close completes */ } setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* close completes */ } }, 250).unref?.(); }, 3_000);
    timeout.unref?.();
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 16_384) stderr += chunk.toString('utf8'); else { try { child.kill('SIGTERM'); } catch { /* close completes */ } } });
    child.on('error', () => done(1));
    child.on('close', (code) => { clearTimeout(timeout); done(code ?? 1); });
  }); },
};

/**
 * Uses only fixed-argument, read-only `codesign` calls. The injected runner
 * lets tests model signature outcomes; production never receives a grant or
 * invokes the Keychain `security` utility.
 */
export class MacOSCodeSignTool {
  constructor(private readonly runner: CodeSignCommandRunner = boundedCodesignRunner) {}
  async verify(bundlePath: string, helperPath: string): Promise<{ appSignatureValid: boolean; helperSignatureValid: boolean; signingFingerprint: string }> {
    const [app, helper, details] = await Promise.all([
      this.runner.run(['--verify', '--strict', '--verbose=2', bundlePath]),
      this.runner.run(['--verify', '--strict', '--verbose=2', helperPath]),
      this.runner.run(['-d', '--verbose=4', helperPath]),
    ]);
    const fingerprint = /(?:^|\n)CDHash=([A-Fa-f0-9]{40,128})(?:\n|$)/.exec(details.stderr)?.[1]?.toLowerCase() ?? '';
    return { appSignatureValid: app.exitCode === 0, helperSignatureValid: helper.exitCode === 0 && details.exitCode === 0, signingFingerprint: fingerprint };
  }
}

/** Binds a reviewed release manifest to the fixed macOS signature adapter. */
export class MacOSPinnedDayflowValidator implements PlatformArtifactValidator {
  constructor(private readonly manifest: TrustedDayflowRelease, private readonly codesign = new MacOSCodeSignTool()) {}
  async inspect(bundlePath: string, helperPath: string) {
    const result = await this.codesign.verify(bundlePath, helperPath);
    return { bundleId: this.manifest.bundleId, version: this.manifest.version, build: this.manifest.build, signingFingerprint: result.signingFingerprint, helperSignatureValid: result.helperSignatureValid, appSignatureValid: result.appSignatureValid };
  }
}

function hasTrustedReleaseFingerprint(release: TrustedDayflowRelease): boolean {
  return /^[a-f0-9]{40,128}$/i.test(release.signingFingerprint) && /^[a-f0-9]{64}$/i.test(release.helperDigest);
}

/** No subprocesses: platform inspection/signature validation is injected by the host. */
export class PinnedDayflowArtifactVerifier implements DayflowArtifactVerifier {
  constructor(private readonly trusted: TrustedDayflowRelease, private readonly platform: PlatformArtifactValidator) {}
  async verify(bundlePath: string): Promise<VerifiedDayflowArtifact> {
    if (!hasTrustedReleaseFingerprint(this.trusted)) throw new DayflowSourceError('Dayflow selected artifact is not a trusted release.');
    const canonical = realpathSync(bundlePath); const expectedHelper = join(canonical, 'Contents', 'Helpers', 'dayflow'); const helper = realpathSync(expectedHelper);
    if (!canonical.endsWith('.app') || helper !== expectedHelper || relative(canonical, helper).startsWith('..') || !lstatSync(expectedHelper).isFile()) throw new DayflowSourceError('Dayflow selected artifact is invalid.');
    const metadata = await this.platform.inspect(canonical, helper); const digest = createHash('sha256').update(readFileSync(helper)).digest('hex'); const stat = statSync(helper); const identity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    if (!metadata.appSignatureValid || !metadata.helperSignatureValid || metadata.bundleId !== this.trusted.bundleId || metadata.version !== this.trusted.version || metadata.build !== this.trusted.build || metadata.signingFingerprint !== this.trusted.signingFingerprint || digest !== this.trusted.helperDigest) throw new DayflowSourceError('Dayflow selected artifact is not the pinned release.');
    return { executable: helper, canonicalPath: canonical, fileIdentity: identity, digest, bundleId: 'teleportlabs.com.Dayflow', version: '2.6.0', build: 133, signingFingerprint: metadata.signingFingerprint };
  }
}
