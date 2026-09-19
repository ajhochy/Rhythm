import { expect, test } from '@playwright/test';
import { assertCandidateProcessIdentity } from './electron-native-test';

const candidate = '/private/tmp/candidate/Rhythm.app/Contents/MacOS/Rhythm';
const relativeCommand = '501 ./dist/Rhythm.app/Contents/MacOS/Rhythm --interactive-smoke';

test('native attach accepts relative argv0 when the loaded executable is the owned candidate', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    `p35525\nftxt\nn${candidate}\nftxt\nn/usr/lib/dyld\n`,
    candidate,
    501,
  )).not.toThrow();
});

test('native attach rejects a different loaded executable despite a plausible argv0', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    'p35525\nftxt\nn/Applications/Rhythm.app/Contents/MacOS/Rhythm\n',
    candidate,
    501,
  )).toThrow(/owned packaged Rhythm executable/);
});

test('native attach rejects the candidate path when it is only a secondary mapped file', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    `p35525\nftxt\nn/Applications/Rhythm.app/Contents/MacOS/Rhythm\nftxt\nn${candidate}\n`,
    candidate,
    501,
  )).toThrow(/owned packaged Rhythm executable/);
});

test('native attach rejects a different process owner', () => {
  expect(() => assertCandidateProcessIdentity(
    relativeCommand,
    `p35525\nftxt\nn${candidate}\n`,
    candidate,
    502,
  )).toThrow(/owned packaged Rhythm executable/);
});
