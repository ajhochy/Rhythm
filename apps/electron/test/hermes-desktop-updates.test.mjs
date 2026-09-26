import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const updates = await import('../src/hermes-desktop-updates.mjs').catch(() => ({}))
const { createHermesDesktopUpdateStore, installHermesDesktopUpdate } = updates

const ledgerPath = (userDataPath) => path.join(userDataPath, 'hermes-desktop-updates.json')
const versionRoot = (userDataPath, version) => path.join(userDataPath, 'hermes-desktop-versions', version)

async function writeLedger(userDataPath, versions) {
  await mkdir(userDataPath, { recursive: true })
  await writeFile(ledgerPath(userDataPath), `${JSON.stringify({ schemaVersion: 1, versions }, null, 2)}\n`)
}

test('issue-1570-c-c3: resolves dev override, newest known-good installed artifact, then immutable factory', async () => {
  assert.equal(typeof createHermesDesktopUpdateStore, 'function')
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-updates-'))
  await writeLedger(userDataPath, {
    '0.20.6': { attempts: 0, sequence: 6, state: 'good' },
    '0.20.7': { attempts: 0, sequence: 7, state: 'good' },
    '0.20.8': { attempts: 1, sequence: 8, state: 'bad' },
  })
  const store = createHermesDesktopUpdateStore({ factoryRoot: '/Applications/Rhythm.app/Contents/Resources/hermes-desktop', userDataPath })

  assert.deepEqual(await store.getLaunchCandidates({ devOverride: '/private/tmp/hermes-dev-artifact' }), [
    { kind: 'dev', root: '/private/tmp/hermes-dev-artifact' },
    { kind: 'installed', root: versionRoot(userDataPath, '0.20.7'), sequence: 7, version: '0.20.7' },
    { kind: 'installed', root: versionRoot(userDataPath, '0.20.6'), sequence: 6, version: '0.20.6' },
    { kind: 'factory', root: '/Applications/Rhythm.app/Contents/Resources/hermes-desktop' },
  ])
})

test('issue-1570-c-c2: a pending version is good only after ready and is permanently bad on the second launch', async () => {
  assert.equal(typeof createHermesDesktopUpdateStore, 'function')
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-updates-'))
  await writeLedger(userDataPath, { '0.20.7': { attempts: 0, sequence: 7, state: 'pending' } })
  const firstStore = createHermesDesktopUpdateStore({ factoryRoot: '/factory', userDataPath })
  const firstCandidate = (await firstStore.getLaunchCandidates({ includePending: true })).find((candidate) => candidate.kind === 'installed')
  assert.equal(await firstStore.beginLaunch(firstCandidate), true)
  let ledger = JSON.parse(await readFile(ledgerPath(userDataPath), 'utf8'))
  assert.deepEqual(ledger.versions['0.20.7'], { attempts: 1, sequence: 7, state: 'pending' })

  const secondStore = createHermesDesktopUpdateStore({ factoryRoot: '/factory', userDataPath })
  const secondCandidate = (await secondStore.getLaunchCandidates({ includePending: true })).find((candidate) => candidate.kind === 'installed')
  assert.equal(await secondStore.beginLaunch(secondCandidate), false)
  ledger = JSON.parse(await readFile(ledgerPath(userDataPath), 'utf8'))
  assert.equal(ledger.versions['0.20.7'].state, 'bad')
  assert.equal((await secondStore.getLaunchCandidates()).some((candidate) => candidate.version === '0.20.7'), false)

  await writeLedger(userDataPath, { '0.20.9': { attempts: 0, sequence: 9, state: 'pending' } })
  const readyStore = createHermesDesktopUpdateStore({ factoryRoot: '/factory', userDataPath })
  const readyCandidate = (await readyStore.getLaunchCandidates({ includePending: true })).find((candidate) => candidate.kind === 'installed')
  assert.equal(await readyStore.beginLaunch(readyCandidate), true)
  await readyStore.markGood(readyCandidate)
  ledger = JSON.parse(await readFile(ledgerPath(userDataPath), 'utf8'))
  assert.deepEqual(ledger.versions['0.20.9'], { attempts: 1, sequence: 9, state: 'good' })
})

test('issue-1570-c-c3: install writes only under userData, validates staging, atomically renames, and refuses replay', async () => {
  assert.equal(typeof installHermesDesktopUpdate, 'function')
  const userDataPath = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-updates-'))
  const sourceRoot = await mkdtemp(path.join(tmpdir(), 'rhythm-hermes-source-'))
  const fakeContentsRoot = '/Applications/Rhythm.app/Contents'
  await writeFile(path.join(sourceRoot, 'manifest.json'), '{}')
  const writes = []
  const record = (operation, target) => writes.push({ operation, target: path.resolve(target) })
  const fs = {
    cp: async (source, destination, options) => { record('cp', destination); return (await import('node:fs/promises')).cp(source, destination, options) },
    mkdir: async (target, options) => { record('mkdir', target); return mkdir(target, options) },
    mkdtemp: async (prefix) => { const result = await (await import('node:fs/promises')).mkdtemp(prefix); record('mkdtemp', result); return result },
    readFile,
    rename: async (from, to) => { record('rename-from', from); record('rename-to', to); return (await import('node:fs/promises')).rename(from, to) },
    rm: async (target, options) => { record('rm', target); return (await import('node:fs/promises')).rm(target, options) },
    writeFile: async (target, value, options) => { record('writeFile', target); return writeFile(target, value, options) },
  }
  const resolveArtifact = async ({ artifactRoot }) => ({ root: artifactRoot, manifest: { hermesVersion: '0.20.7', sequence: 7 } })

  const installed = await installHermesDesktopUpdate({
    expectedElectronMajor: 40,
    expectedElectronVersion: '40.10.2',
    factorySequence: 6,
    fs,
    resolveArtifact,
    sourceRoot,
    userDataPath,
  })
  assert.equal(installed.root, versionRoot(userDataPath, '0.20.7'))
  assert.equal(installed.state, 'pending')
  assert.equal(writes.every(({ target }) => target === path.resolve(userDataPath) || target.startsWith(`${path.resolve(userDataPath)}${path.sep}`)), true)
  assert.equal(writes.some(({ target }) => target.startsWith(fakeContentsRoot)), false)
  assert.equal(writes.some(({ operation }) => operation === 'rename-to'), true)
  assert.equal(writes.some(({ operation, target }) => operation === 'rm' && target === path.resolve('/Applications/Rhythm.app/Contents/Resources/hermes-desktop')), false)

  await assert.rejects(
    () => installHermesDesktopUpdate({ expectedElectronMajor: 40, expectedElectronVersion: '40.10.2', factorySequence: 7, fs, resolveArtifact, sourceRoot, userDataPath }),
    /replay|sequence/i,
  )
})
