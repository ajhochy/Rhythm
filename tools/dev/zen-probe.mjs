#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const zen = 'https://opencode.ai/zen/v1';
const timeout = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
const fail = (error) => error instanceof Error ? error.message : String(error);
const migrations = await readFile(new URL('../../apps/api_server/src/database/migrations.ts', import.meta.url), 'utf8');
const seeded = migrations.slice(migrations.indexOf("'rhythm-setup'"))
  .match(/'opencode',\s*'([^']+)'/)?.[1];
const [servedResponse, catalogResponse] = await Promise.all([
  timeout(`${zen}/models`), timeout('https://models.dev/api.json'),
]);
if (!servedResponse.ok || !catalogResponse.ok) throw new Error(`catalog fetch failed: Zen ${servedResponse.status}, models.dev ${catalogResponse.status}`);
const served = new Set((await servedResponse.json()).data?.map((model) => model.id) ?? []);
const models = (await catalogResponse.json()).opencode?.models ?? {};
const free = Object.entries(models).filter(([, model]) => model.cost?.input === 0 && model.cost?.output === 0);
const details = new Map(free.map(([id, model]) => [id, model]));
const ids = [...new Set([...free.map(([id]) => id).filter((id) => served.has(id)), seeded])];
const rows = new Array(ids.length);
let next = 0;
await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
  while (next < ids.length) {
    const index = next++;
    const id = ids[index];
    const model = details.get(id);
    if (!served.has(id) || !model) {
      rows[index] = { id, status: 'FAIL', reason: 'not served and free', context: model?.limit?.context ?? '', attachment: Boolean(model?.attachment) };
      continue;
    }
    try {
      const response = await timeout(`${zen}/chat/completions`, {
        method: 'POST', headers: { Authorization: 'Bearer public', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, max_tokens: 8, messages: [{ role: 'user', content: 'Reply OK.' }] }),
      });
      const body = await response.json();
      rows[index] = { id, status: Array.isArray(body.choices) ? 'OK' : 'FAIL', reason: Array.isArray(body.choices) ? '' : `HTTP ${response.status}: no choices`, context: model.limit?.context ?? '', attachment: Boolean(model.attachment) };
    } catch (error) {
      rows[index] = { id, status: 'FAIL', reason: fail(error), context: model.limit?.context ?? '', attachment: Boolean(model.attachment) };
    }
  }
}));
console.table(rows);
if (!seeded || rows.find((row) => row.id === seeded)?.status !== 'OK') process.exitCode = 1;
