const SHA1_PATTERN = /^[a-f0-9]{40}$/i;
const IDENTITY_LINE_PATTERN = /^\s*\d+\)\s+([a-f0-9]{40})\s+"([^"]+)"/gim;

function parseSigningIdentities(output) {
  return [...String(output).matchAll(IDENTITY_LINE_PATTERN)].map((match) => ({
    sha1: match[1].toUpperCase(),
    name: match[2],
  }));
}

export function resolveSigningIdentity(requestedIdentity, findIdentityOutput) {
  const requested = String(requestedIdentity).trim();
  const identities = parseSigningIdentities(findIdentityOutput);

  if (SHA1_PATTERN.test(requested)) {
    const sha1 = requested.toUpperCase();
    if (!identities.some((identity) => identity.sha1 === sha1)) {
      throw new Error(`APPLE_SIGNING_IDENTITY identity not found: ${sha1}`);
    }
    return sha1;
  }

  const matches = identities.filter((identity) => identity.name === requested);
  if (matches.length === 0) {
    throw new Error(`APPLE_SIGNING_IDENTITY identity not found: ${requested}`);
  }
  if (matches.length > 1) {
    const fingerprints = matches.map((identity) => identity.sha1).join(', ');
    throw new Error(
      `APPLE_SIGNING_IDENTITY is ambiguous (${fingerprints}); ` +
        'set APPLE_SIGNING_IDENTITY to a SHA-1 fingerprint',
    );
  }
  return requested;
}

export async function resolveSigningIdentityWithRunner(requestedIdentity, { runner }) {
  const result = await runner('security', ['find-identity', '-v', '-p', 'codesigning']);
  return resolveSigningIdentity(
    requestedIdentity,
    `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  );
}
