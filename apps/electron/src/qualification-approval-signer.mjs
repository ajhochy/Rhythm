// Test-only approval identity for an exact-build, disposable synthetic actor.
// The API continues to verify the ordinary P-256 signature and capability digest.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function privateOwned(path, mode, directory = false) {
  const stat = lstatSync(path);
  if (realpathSync(path) !== path || stat.isSymbolicLink() || stat.uid !== process.getuid?.()
    || (stat.mode & 0o777) !== mode || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
    throw new Error('qualification approval identity ownership invalid');
  }
}

function readPrivateFile(path) {
  privateOwned(path, 0o600);
  const before = lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd);
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile()
      || opened.nlink !== 1 || opened.uid !== process.getuid?.() || (opened.mode & 0o777) !== 0o600) {
      throw new Error('qualification approval identity changed');
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function boundedDecision(decision) {
  return exactKeys(decision, ['approvalId', 'status', 'decisionNonce', 'payloadDigest'])
    && typeof decision.approvalId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(decision.approvalId)
    && ['approved', 'rejected'].includes(decision.status)
    && typeof decision.decisionNonce === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(decision.decisionNonce)
    && (decision.payloadDigest === null || typeof decision.payloadDigest === 'string' && /^[a-f0-9]{64}$/.test(decision.payloadDigest));
}

/**
 * @param {{manifestPath: string, readAuthority: () => {manifest: any, token: string | null} | null}} options
 * readAuthority must be the Electron exact-build/private-root actor validator. It is invoked
 * before every secret read and must recheck token expiry and the build source revision.
 */
export function createQualificationApprovalSigner({ manifestPath, readAuthority }) {
  const first = readAuthority();
  if (!first?.token || !first.manifest?.syntheticActor?.approvalSigner) {
    throw new Error('qualification approval identity unavailable');
  }
  const firstBytes = readPrivateFile(manifestPath);
  const actor = first.manifest.syntheticActor;
  const root = first.manifest.fixtureRoot;
  const descriptor = actor.approvalSigner;
  if (!exactKeys(descriptor, ['privateKeyPath', 'privateKeySha256', 'capabilityPath', 'capabilitySha256', 'publicKey'])
    || descriptor.privateKeyPath !== join(root, 'approval-signer', 'key.pk8')
    || descriptor.capabilityPath !== join(root, 'approval-signer', 'capability')
    || !/^[a-f0-9]{64}$/.test(descriptor.privateKeySha256)
    || !/^[a-f0-9]{64}$/.test(descriptor.capabilitySha256)
    || typeof descriptor.publicKey !== 'string') {
    throw new Error('qualification approval identity scope invalid');
  }
  const bound = Object.freeze({ ...descriptor });
  const actorExpiry = actor.expiresAt;
  const actorTokenHash = first.manifest.tokenSha256;
  const sourceRevision = first.manifest.sourceRevision;

  function read() {
    const current = readAuthority();
    if (!current?.token || current.manifest?.fixtureRoot !== root
      || current.manifest?.sourceRevision !== sourceRevision
      || current.manifest?.tokenSha256 !== actorTokenHash
      || current.manifest?.syntheticActor?.expiresAt !== actorExpiry
      || Date.parse(actorExpiry) <= Date.now()
      || manifestPath !== join(root, 'manifest.json')
      || resolve(manifestPath) !== manifestPath
      || !readPrivateFile(manifestPath).equals(firstBytes)) {
      throw new Error('qualification approval authority changed');
    }
    privateOwned(root, 0o700, true);
    privateOwned(dirname(bound.privateKeyPath), 0o700, true);
    const keyBytes = readPrivateFile(bound.privateKeyPath);
    const capability = readPrivateFile(bound.capabilityPath).toString('utf8');
    if (sha256(keyBytes) !== bound.privateKeySha256 || sha256(capability) !== bound.capabilitySha256
      || !/^[A-Za-z0-9_-]{43}$/.test(capability)
      || Buffer.from(capability, 'base64url').length !== 32
      || Buffer.from(capability, 'base64url').toString('base64url') !== capability) {
      throw new Error('qualification approval identity changed');
    }
    const privateKey = createPrivateKey({ key: keyBytes, format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      throw new Error('qualification approval identity curve invalid');
    }
    const publicKey = createPublicKey(privateKey);
    const jwk = publicKey.export({ format: 'jwk' });
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
      throw new Error('qualification approval public point invalid');
    }
    const raw = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    const publicPoint = raw.toString('base64');
    if (raw.length !== 65 || publicPoint !== bound.publicKey) throw new Error('qualification approval public point changed');
    return { privateKey, publicKey, capability, publicPoint };
  }

  // Validate eagerly, before any API child can be started with the material.
  read();
  return Object.freeze({
    async capabilityMaterial() {
      const { capability, publicPoint } = read();
      return { humanApprovalPublicKey: publicPoint, humanApprovalCapabilitySha256: sha256(capability) };
    },
    async capability() { return read().capability; },
    async signDecision(decision) {
      if (!boundedDecision(decision)) throw new Error('Invalid approval decision');
      const { privateKey, publicKey, capability } = read();
      const canonical = ['rhythm-human-approval-v1', decision.approvalId, decision.status, decision.decisionNonce, decision.payloadDigest ?? ''].join('\n');
      const message = Buffer.from(canonical, 'utf8');
      const signature = sign('sha256', message, privateKey);
      if (!verify('sha256', message, publicKey, signature)) throw new Error('qualification approval signature invalid');
      return { capability, signature: signature.toString('base64') };
    },
  });
}
