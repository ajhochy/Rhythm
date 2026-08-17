// post-m1-p7-c4d — produces the real P-256 decision signature apps/api_server/src/security/
// human_approval_security.ts:60-156 verifies.
//
// Two implementations, tried in this order:
//   1. window.rhythmShell.humanApproval (apps/electron/src/human-approval-main-signer.mjs, exposed
//      via preload.cjs) — used whenever running inside Electron. This is the path that actually
//      round-trips against a live server: apps/electron/src/agent-server.mjs spawns api_server
//      itself and injects THIS SAME signer's public key/capability into its environment
//      (mirroring apps/desktop_flutter/lib/app/core/server/api_server_service.dart:46-92,186-283),
//      so a signature produced here verifies against the exact server this app is talking to.
//   2. Web Crypto (SubtleCrypto), self-generated and persisted in IndexedDB/localStorage — the
//      fallback for every context with no Electron main process attached: Vite dev, every
//      Playwright redspec (including this criterion's own post-m1-phase-7-approvals.redspec.ts),
//      and any future non-Electron host. Nothing spawns a server for this path, so nothing
//      synchronizes its key/capability with a live server's HUMAN_APPROVAL_PUBLIC_KEY/
//      HUMAN_APPROVAL_CAPABILITY_SHA256 — an honest, structural gap of running standalone, not a
//      bug. The two things Flutter's native SecKey bridge buys over the Web Crypto path — hardware-
//      backed Secure Enclave binding and a hard non-exportability guarantee — remain open there too.

const DB_NAME = 'rhythm-human-approval';
const STORE_NAME = 'keys';
const KEY_RECORD_ID = 'signing-keypair-v1';
const CAPABILITY_STORAGE_KEY = 'rhythm-human-approval-capability-v1';
// Must match apps/api_server/src/security/human_approval_security.ts:60-73 exactly: same domain
// prefix, same field order, same '\n' join, same '' fallback for a null payloadDigest.
const CANONICAL_PREFIX = 'rhythm-human-approval-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open human-approval key store'));
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error('Key store read failed'));
    });
  } finally { db.close(); }
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error('Key store write failed'));
    });
  } finally { db.close(); }
}

async function getOrCreateKeyPair(): Promise<CryptoKeyPair> {
  const existing = await idbGet<CryptoKeyPair>(STORE_NAME, KEY_RECORD_ID);
  if (existing) return existing;
  // extractable:false on the private key — the closest Web Crypto gets to Flutter's non-exportable
  // SecKey without a Secure Enclave; see the module doc's honest-gap note above.
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  await idbPut(STORE_NAME, KEY_RECORD_ID, pair);
  return pair;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// DER-encodes one big-endian unsigned integer per X.690: strip leading 0x00 bytes, but keep
// exactly one if the high bit is set (otherwise it would read as a negative two's-complement value).
function derInteger(bytes: Uint8Array): number[] {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const trimmed = Array.from(bytes.subarray(start));
  if (trimmed[0]! & 0x80) trimmed.unshift(0);
  return [0x02, trimmed.length, ...trimmed];
}

// Web Crypto's ECDSA output is raw IEEE P1363 (r || s, 32 bytes each for P-256) — never DER. Node's
// crypto.verify (what human_approval_security.ts uses) expects ASN.1 DER, so this conversion is not
// optional: an unconverted signature fails verification even when every other byte is correct.
function p1363ToDer(signature: ArrayBuffer): Uint8Array {
  const bytes = new Uint8Array(signature);
  const r = derInteger(bytes.subarray(0, 32));
  const s = derInteger(bytes.subarray(32, 64));
  const body = [...r, ...s];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function getOrCreateCapability(): Promise<string> {
  const existing = window.localStorage.getItem(CAPABILITY_STORAGE_KEY);
  if (existing) return existing;
  const value = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  window.localStorage.setItem(CAPABILITY_STORAGE_KEY, value);
  return value;
}

// The exact 65-byte uncompressed SEC1 point (0x04 || X || Y) publicKeyFromRawBase64 expects at
// apps/api_server/src/security/human_approval_security.ts:24-46 — exposed for a future enrollment
// flow (registering this renderer's public key with a server), not consumed anywhere yet.
export async function exportPublicKeyRawBase64(): Promise<string> {
  const { publicKey } = await getOrCreateKeyPair();
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return toBase64(new Uint8Array(raw));
}

export interface SignedDecision {
  capability: string;
  signature: string;
}

// Same inline-cast pattern main.tsx already uses for window.rhythmShell.auth/gateway — no ambient
// global .d.ts exists for this bridge, so every consumer declares the slice of the shape it needs.
function electronHumanApprovalBridge() {
  return (window as Window & {
    rhythmShell?: {
      humanApproval?: {
        capability(): Promise<string>;
        signDecision(approvalId: string, status: 'approved' | 'rejected', decisionNonce: string, payloadDigest: string | null): Promise<SignedDecision>;
      };
    };
  }).rhythmShell?.humanApproval;
}

export async function signApprovalDecision(input: {
  approvalId: string;
  status: 'approved' | 'rejected';
  decisionNonce: string;
  payloadDigest: string | null;
}): Promise<SignedDecision> {
  const bridge = electronHumanApprovalBridge();
  if (bridge) return bridge.signDecision(input.approvalId, input.status, input.decisionNonce, input.payloadDigest);

  const canonical = [CANONICAL_PREFIX, input.approvalId, input.status, input.decisionNonce, input.payloadDigest ?? ''].join('\n');
  const { privateKey } = await getOrCreateKeyPair();
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(canonical),
  );
  return { capability: await getOrCreateCapability(), signature: toBase64(p1363ToDer(signature)) };
}
