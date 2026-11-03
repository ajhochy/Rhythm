/** Parent-only exact archive staging. */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveManagedToolArtifactRoot } from '../config/env';
import { inspectImmutableLocalTarball, parseImmutableLocalTarballSource } from './tool_install_artifact';

export function stagePrivateManagedArtifact(input: {
  workerRoot: string; changeJson: string; trustedArtifactRoot?: string;
}): { digest: string; privateArtifactRoot: string } {
  if (!input.workerRoot.startsWith('/private/tmp/')) throw Error('Private tool root is invalid');
  const change = JSON.parse(input.changeJson) as { packageSource?: unknown; toolName?: unknown;
    installMethod?: unknown };
  const digest = parseImmutableLocalTarballSource(change.packageSource);
  if (!digest || typeof change.toolName !== 'string' || change.installMethod !== 'local-tarball')
    throw Error('Private tool artifact is not immutable');
  const source = inspectImmutableLocalTarball(input.trustedArtifactRoot ?? resolveManagedToolArtifactRoot(),
    digest, change.toolName);
  if (!source) throw Error('Immutable tool archive is unavailable');
  const privateArtifactRoot = join(input.workerRoot, 'artifacts');
  mkdirSync(privateArtifactRoot, { recursive: true, mode: 0o700 });
  copyFileSync(source.path, join(privateArtifactRoot, `${digest}.tgz`));
  if (!inspectImmutableLocalTarball(privateArtifactRoot, digest, change.toolName))
    throw Error('Private staged archive did not match pinned digest');
  return { digest, privateArtifactRoot };
}
