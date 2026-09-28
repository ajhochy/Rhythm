// Private keys never enter Node. The packaged Security.framework helper owns the identity.
import { spawn } from 'node:child_process';
import { createPublicKey, createHash, verify } from 'node:crypto';
import { userInfo } from 'node:os';
import { resolve } from 'node:path';

// Keep the real account's Keychain under an isolated app HOME, but inherit no app secrets or DYLD knobs.
export function resolveKeychainEnvironment(_env = process.env, userHome = userInfo().homedir) {
  return { HOME: userHome, PATH: '/usr/bin:/bin' };
}

function unavailable() {
  return Object.assign(new Error('Human approval capability unavailable: Secure Enclave helper required'), { code: 'HUMAN_APPROVAL_UNAVAILABLE' });
}

/** @param {unknown} value @param {string[]} keys */
function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** @param {string} value @param {number} min @param {number} max */
function base64(value, min, max) {
  if (typeof value !== 'string' || value.length > 128) throw new Error('Invalid encoding');
  const raw = Buffer.from(value, 'base64');
  if (raw.length < min || raw.length > max || raw.toString('base64') !== value) throw new Error('Invalid encoding');
  return raw;
}

// ponytail: the single-instance main owns creation; serialize it instead of a file-based lock.
let pending = Promise.resolve();
/** @param {Parameters<typeof requestHelper>[0]} request */
function helper(request) {
  const result = pending.then(() => requestHelper(request));
  pending = result.then(() => {}, () => {});
  return result;
}

/** @param {{ operation: string, decision?: { approvalId: string, status: string, decisionNonce: string, payloadDigest: string | null } }} request */
async function requestHelper(request) {
  if (process.platform !== 'darwin' || !process.resourcesPath) throw unavailable();
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > 4096) throw new Error('Invalid approval decision');
  const output = await new Promise((accept, reject) => {
    let settled = false;
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams | undefined} */
    let child;
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.kill('SIGKILL');
      reject(new Error('Human approval helper failed'));
    };
    // First use can display macOS Keychain authorization. Do not kill that prompt after 10s.
    // Signing keeps the short bound; initialization gets a bounded window for user authorization.
    const timer = setTimeout(fail, request.operation === 'capability' ? 120_000 : 10_000);
    try {
      child = spawn(resolve(process.resourcesPath, 'human-approval/rhythm-approval-signer'), [], {
        env: resolveKeychainEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], shell: false,
      });
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.stdout.on('error', fail);
      child.stderr.on('error', fail);
      // Any stderr is a protocol failure. Discard it immediately; never relay native diagnostics.
      child.stderr.on('data', fail);
      child.stdout.on('data', (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > 8192) return fail();
        chunks.push(Buffer.from(chunk));
      });
      child.on('close', (code, signal) => {
        if (settled) return;
        if (code !== 0 || signal) return fail();
        settled = true;
        clearTimeout(timer);
        accept(Buffer.concat(chunks).toString('utf8'));
      });
      child.stdin.end(input);
    } catch { fail(); }
  });
  let result;
  try {
    result = JSON.parse(output);
    if (exactKeys(result, ['available', 'code']) && result.available === false && result.code === 'SECURE_ENCLAVE_UNAVAILABLE') throw unavailable();
    const fields = ['available', 'publicKey', 'capability', ...(request.operation === 'sign' ? ['signature'] : [])];
    if (!exactKeys(result, fields) || result.available !== true) throw new Error('Invalid schema');
    const raw = base64(result.publicKey, 65, 65);
    if (raw[0] !== 4) throw new Error('Invalid point');
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
    if (typeof result.capability !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.capability)
      || Buffer.from(result.capability, 'base64url').toString('base64url') !== result.capability) throw new Error('Invalid capability');
    if (request.decision) {
      const signature = base64(result.signature, 8, 72);
      const d = request.decision;
      const canonical = ['rhythm-human-approval-v1', d.approvalId, d.status, d.decisionNonce, d.payloadDigest ?? ''].join('\n');
      // OpenSSL validates ASN.1 DER and the actual signature, not merely its shape.
      if (!verify('sha256', Buffer.from(canonical, 'utf8'), publicKey, signature)) throw new Error('Invalid signature');
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'HUMAN_APPROVAL_UNAVAILABLE') throw error;
    throw new Error('Human approval helper returned invalid data');
  }
  return result;
}

/** Unchanged API-server registration shape: public point and capability digest only. */
export async function capabilityMaterial() {
  const result = await helper({ operation: 'capability' });
  return { humanApprovalPublicKey: result.publicKey, humanApprovalCapabilitySha256: createHash('sha256').update(result.capability, 'utf8').digest('hex') };
}

export async function capability() {
  return (await helper({ operation: 'capability' })).capability;
}

/** @param {{ approvalId: string, status: 'approved' | 'rejected', decisionNonce: string, payloadDigest: string | null }} decision */
export async function signDecision(decision) {
  if (!exactKeys(decision, ['approvalId', 'status', 'decisionNonce', 'payloadDigest'])
    || typeof decision.approvalId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(decision.approvalId)
    || !['approved', 'rejected'].includes(decision.status)
    || typeof decision.decisionNonce !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(decision.decisionNonce)
    || (decision.payloadDigest !== null && (typeof decision.payloadDigest !== 'string' || !/^[a-f0-9]{64}$/.test(decision.payloadDigest)))) {
    throw new Error('Invalid approval decision');
  }
  const result = await helper({ operation: 'sign', decision });
  return { capability: result.capability, signature: result.signature };
}
