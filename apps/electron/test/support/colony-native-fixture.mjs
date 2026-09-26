import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
export const sourceCommit = 'a'.repeat(40)
export const workerSource = `
process.on('disconnect', () => process.exit(0));
process.on('message', message => {
  if (message.type === 'colony:init') process.send({type:'colony:ready',v:1,product:'colony',documentId:message.documentId,capabilities:['inventory-v1','state-v1','host-intents-v1','state-mark-v1','import-v1'],runtime:{node:process.versions.node,sqlite:true}});
  else if (message.type === 'colony:dispose') process.exit(0);
  else process.send({v:1,documentId:message.documentId,id:message.id,ok:true,result:{version:3,archived:[],updatedAt:0}});
});
`
export async function makeArtifact(root, worker = workerSource) {
  const files = {
    'renderer/index.html': '<!doctype html><title>Synthetic Colony</title><div>Colony</div>',
    'server/embedded-host.mjs': 'export const product = "colony"',
    'server/embedded-preload.cjs': 'module.exports = {}',
    'server/embedded-worker.mjs': worker,
  }
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await fs.writeFile(path.join(root, name), content)
  }
  const manifest = { schemaVersion: 1, product: 'colony', sourceCommit, electronMajor: 40, dirty: false, sourceDirty: false,
    files: { renderer: 'renderer/index.html', host: 'server/embedded-host.mjs', preload: 'server/embedded-preload.cjs', worker: 'server/embedded-worker.mjs' },
    integrity: Object.fromEntries(Object.entries(files).map(([name, value]) => [name, `sha256-${createHash('sha256').update(value).digest('base64')}`])),
  }
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest))
  return manifest
}
