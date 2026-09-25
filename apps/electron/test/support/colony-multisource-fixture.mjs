import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

async function digest(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

export async function createMultiSourceFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rhythm-colony-multisource-'))
  const hermesHome = path.join(root, 'hermes')
  const codexHome = path.join(root, 'malformed-codex-home')
  const rhythmDatabase = path.join(root, 'rhythm', 'rhythm.db')
  const opencodeDatabase = path.join(root, 'missing-opencode', 'opencode.db')
  const disabledHome = path.join(root, 'disabled-antigravity')
  await Promise.all([
    fs.mkdir(hermesHome, { recursive: true }),
    fs.mkdir(path.dirname(rhythmDatabase), { recursive: true }),
    fs.mkdir(disabledHome, { recursive: true }),
  ])

  const hermesDatabase = path.join(hermesHome, 'state.db')
  const hermes = new DatabaseSync(hermesDatabase)
  hermes.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, cwd TEXT); INSERT INTO sessions VALUES ('healthy-fixture', 'Healthy synthetic task', '/synthetic/project');")
  hermes.close()

  // An enabled source root that is a file cannot be enumerated and must be diagnosed by name.
  await fs.writeFile(codexHome, 'not a codex home directory\n')

  const rhythm = new DatabaseSync(rhythmDatabase)
  rhythm.exec('CREATE TABLE agent_sessions (id TEXT, agent_kind TEXT, status TEXT, cwd TEXT, name TEXT, created_at TEXT, updated_at TEXT)')
  rhythm.close()
  await fs.chmod(rhythmDatabase, 0o000)

  const disabledSentinel = path.join(disabledHome, 'must-not-open.txt')
  await fs.writeFile(disabledSentinel, 'disabled-source-sentinel\n')

  const stores = [hermesDatabase, codexHome, rhythmDatabase, disabledSentinel]
  await fs.chmod(rhythmDatabase, 0o600)
  const before = Object.fromEntries(await Promise.all(stores.map(async (file) => [file, await digest(file)])))
  const disabledStat = await fs.stat(disabledSentinel)
  await fs.chmod(rhythmDatabase, 0o000)

  return {
    root,
    stores,
    before,
    disabledSentinel,
    disabledStat,
    sources: [
      { id: 'hermes', enabled: true, paths: { home: hermesHome } },
      { id: 'codex', enabled: true, paths: { home: codexHome } },
      { id: 'opencode', enabled: true, paths: { database: opencodeDatabase } },
      { id: 'rhythm', enabled: true, paths: { database: rhythmDatabase } },
      { id: 'antigravity', enabled: false, paths: { home: disabledHome } },
    ],
    async hashesAfter() {
      await fs.chmod(rhythmDatabase, 0o600)
      return Object.fromEntries(await Promise.all(stores.map(async (file) => [file, await digest(file)])))
    },
    async cleanup() {
      await fs.chmod(rhythmDatabase, 0o600).catch(() => {})
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}
