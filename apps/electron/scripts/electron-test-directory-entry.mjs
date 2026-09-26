import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Node 22 treats `node --test test` as a single directory entry point rather
// than recursively discovering files. Keep that integration command useful by
// delegating to the package's maintained, explicit test manifest. The entry
// lives outside test/ so bare `node --test` discovery cannot run it twice.
test('Electron package test manifest', { timeout: 10 * 60 * 1000 }, async () => {
  if (process.env.RHYTHM_TEST_DIRECTORY_PROBE === '1') return
  const environment = { ...process.env }
  delete environment.NODE_TEST_CONTEXT
  const child = spawn('npm', ['test'], { cwd: electronRoot, env: environment, stdio: 'inherit' })
  const outcome = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  if (outcome.code !== 0) {
    throw new Error(`Electron package test manifest failed (${outcome.signal ?? outcome.code})`)
  }
})
