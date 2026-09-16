import { execFile } from 'node:child_process';
import { mkdir, rm, lstat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function buildAndStageApprovalHelper({ electronRoot, resources }) {
  const arch = process.env.RHYTHM_PACKAGE_ARCH || process.arch;
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(arch) || arch !== process.arch) {
    throw new Error('Approval helper requires a native macOS architecture runner');
  }
  const nativeArch = arch === 'x64' ? 'x86_64' : 'arm64';
  const destination = resolve(resources, 'human-approval/rhythm-approval-signer');
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { force: true });
  // Compile straight into staging; never execute the helper or reuse a prebuilt binary.
  await run('/usr/bin/xcrun', ['swiftc', '-O', '-target', `${nativeArch}-apple-macosx12.0`,
    '-framework', 'Security', '-framework', 'CryptoKit',
    resolve(electronRoot, 'native/HumanApprovalSigner.swift'), '-o', destination]);
  if (!(await lstat(destination)).isFile()) throw new Error('Approval helper must be a regular file');
  await access(destination, constants.X_OK);
  const actual = (await run('/usr/bin/lipo', ['-archs', destination])).stdout.trim();
  if (actual !== nativeArch) throw new Error('Approval helper architecture mismatch');
}
