import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveSigningIdentity,
  resolveSigningIdentityWithRunner,
} from '../scripts/signing-identity.mjs';

const canonical = 'CF6C1EF1525E70E6E3324388A322938977779DB7';
const shortLived = '3964FA133858B20C7A411F98C24FDF51D8EF5A71';
const newest = 'AE031F77788A81B97F4F34B7204F1BD2C54CF4D1';
const commonName = 'Developer ID Application: Aaron Hochhalter (56Q69NYP9H)';
const identities = `
  1) ${canonical} "${commonName}"
  2) ${shortLived} "${commonName}"
  3) ${newest} "${commonName}"
     3 valid identities found
`;

test('1404: ambiguous certificate names require an explicit SHA-1', () => {
  assert.throws(
    () => resolveSigningIdentity(commonName, identities),
    (error) => {
      assert.match(error.message, /ambiguous/i);
      assert.match(error.message, /set APPLE_SIGNING_IDENTITY to a SHA-1/i);
      for (const fingerprint of [canonical, shortLived, newest]) {
        assert.match(error.message, new RegExp(fingerprint));
      }
      return true;
    },
  );
});

test('1404: a present SHA-1 is accepted and an absent SHA-1 fails closed', () => {
  assert.equal(resolveSigningIdentity(canonical, identities), canonical);
  assert.throws(
    () => resolveSigningIdentity('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', identities),
    /identity not found/i,
  );
});

test('1404: a uniquely matching certificate name remains supported', () => {
  const unique = `1) ${canonical} "${commonName}"\n  1 valid identities found`;
  assert.equal(resolveSigningIdentity(commonName, unique), commonName);
});

test('1404: ambiguity stops before any codesign command', async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, args]);
    if (command === 'security') return { stdout: identities, stderr: '' };
    throw new Error(`unexpected command: ${command}`);
  };

  await assert.rejects(
    resolveSigningIdentityWithRunner(commonName, { runner }),
    /ambiguous/i,
  );
  assert.deepEqual(calls, [['security', ['find-identity', '-v', '-p', 'codesigning']]]);
  assert.equal(calls.some(([command]) => command === 'codesign'), false);
});
