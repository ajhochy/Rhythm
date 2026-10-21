/** Immutable external skill bytes observed before any candidate runs. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { scanContextContent } from '../security/context_scanner';
import type { OrgEvaluationTargetSnapshot } from './org_evaluation_fixture';

const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
const MAX_BYTES = 256 * 1024;

export interface FrozenExternalSkillSource {
  candidateKind: 'skill';
  skillName: string;
  downloadUrl: string;
  contentSha256: string;
  bodyBase64: string;
}

function parseSourceChange(change: unknown, base: string): {
  skillName: string; downloadUrl: string; contentSha256: string;
} {
  if (!change || typeof change !== 'object' || Array.isArray(change))
    throw Error('External skill source is missing');
  const value = change as Record<string, unknown>;
  if (value.candidateKind !== 'skill' || typeof value.skillName !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.skillName) ||
      typeof value.downloadUrl !== 'string' || typeof value.contentSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(value.contentSha256))
    throw Error('External skill source lacks a pinned name, URL, or digest');
  const allowedBase = new URL(base);
  const source = new URL(value.downloadUrl);
  const basePath = allowedBase.pathname.replace(/\/$/, '');
  const relative = source.pathname.startsWith(`${basePath}/`)
    ? source.pathname.slice(basePath.length + 1) : '';
  const parts = relative.split('/');
  if (source.origin !== allowedBase.origin || source.protocol !== allowedBase.protocol ||
      source.username || source.password || source.search || source.hash || parts.length < 4 ||
      !/^[a-f0-9]{40}$/i.test(parts[2] ?? ''))
    throw Error('External skill source is outside the production commit-pinned allowlist');
  return { skillName: value.skillName, downloadUrl: value.downloadUrl,
    contentSha256: value.contentSha256.toLowerCase() };
}

/** Fetches the same commit-pinned source that the production applier later validates. */
export async function captureExternalSkillSourceAsync(input: {
  change: unknown;
  fetcher?: typeof fetch;
  allowedBase?: string;
}): Promise<FrozenExternalSkillSource> {
  const source = parseSourceChange(input.change,
    input.allowedBase ?? process.env.RHYTHM_SKILLS_DOWNLOAD_BASE ?? 'https://raw.githubusercontent.com');
  const response = await (input.fetcher ?? fetch)(source.downloadUrl,
    { signal: AbortSignal.timeout(8_000) });
  if (!response.ok || !response.body) throw Error(`External skill source unavailable (${response.status})`);
  if (response.url && response.url !== source.downloadUrl)
    throw Error('External skill source redirected away from its pinned URL');
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw Error('External skill source exceeded byte limit');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = Buffer.concat(chunks);
  if (!bytes.length || sha256(bytes) !== source.contentSha256)
    throw Error('External skill source differs from the reviewed digest');
  if (scanContextContent(bytes.toString('utf8'), `adopted skill ${source.skillName}`).blocked)
    throw Error('External skill source failed the production injection scan');
  return { candidateKind: 'skill', ...source, bodyBase64: bytes.toString('base64') };
}

export function externalSkillReceiverInput(input: {
  snapshot: OrgEvaluationTargetSnapshot;
  changeJson: string;
  baseline: boolean;
}): FrozenExternalSkillSource {
  if (input.snapshot.kind !== 'external-adoption' || !input.snapshot.externalSkillSource)
    throw Error('External adoption has no frozen skill source');
  const source = input.snapshot.externalSkillSource;
  const bytes = Buffer.from(source.bodyBase64, 'base64');
  if (sha256(bytes) !== source.contentSha256) throw Error('Frozen external skill bytes changed');
  if (input.baseline) {
    if (input.changeJson !== '{}') throw Error('External adoption baseline change must be empty');
    return source;
  }
  let change: unknown;
  try { change = JSON.parse(input.changeJson); } catch { throw Error('External adoption change is malformed'); }
  const bound = parseSourceChange(change,
    process.env.RHYTHM_SKILLS_DOWNLOAD_BASE ?? 'https://raw.githubusercontent.com');
  if (bound.skillName !== source.skillName || bound.downloadUrl !== source.downloadUrl ||
      bound.contentSha256 !== source.contentSha256 ||
      (change as Record<string, unknown>).agentConfigId !== input.snapshot.targetRef.slice('agent_config:'.length))
    throw Error('External adoption candidate differs from frozen source or target');
  return source;
}

/** A read-only local copy of pinned source bytes for the sandboxed production downloader. */
export async function startExternalSkillReceiverAsync(input: {
  source: FrozenExternalSkillSource;
  token: string;
}): Promise<{
  baseURL: string;
  port: number;
  observations(): Promise<Array<{ path: string; status: number; bodyHash: string | null }>>;
  close(): Promise<void>;
}> {
  const bytes = Buffer.from(input.source.bodyBase64, 'base64');
  if (input.token.length < 32 || sha256(bytes) !== input.source.contentSha256)
    throw Error('Private external skill receiver has invalid source binding');
  const observations: Array<{ path: string; status: number; bodyHash: string | null }> = [];
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const expected = Buffer.from(`Bearer ${input.token}`);
    const actual = Buffer.from(req.headers.authorization ?? '');
    const authorized = expected.length === actual.length && timingSafeEqual(expected, actual);
    const status = req.method !== 'GET' || path !== '/source/SKILL.md' ? 404 : !authorized ? 401 : 200;
    observations.push({ path, status, bodyHash: status === 200 ? input.source.contentSha256 : null });
    res.writeHead(status, status === 200 ? { 'Content-Type': 'text/markdown' } : undefined);
    res.end(status === 200 ? bytes : undefined);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw Error('Private external skill receiver has no port'); }
  return { baseURL: `http://127.0.0.1:${address.port}`, port: address.port,
    observations: async () => observations.map((entry) => ({ ...entry })),
    close: async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

/** Worker-only substitution for the production downloader's exact frozen URL. */
export async function downloadPrivateExternalSkillAsync(requestedUrl: string): Promise<string> {
  if (process.env.RHYTHM_EVALUATION_WORKER !== '1')
    throw Error('Private external skill download requires an evaluation worker');
  const sourceUrl = process.env.RHYTHM_EVALUATION_EXTERNAL_SOURCE_URL;
  const expectedHash = process.env.RHYTHM_EVALUATION_EXTERNAL_SOURCE_SHA256;
  const receiverURL = process.env.RHYTHM_EVALUATION_EXTERNAL_RECEIVER_URL;
  const token = process.env.RHYTHM_EVALUATION_EXTERNAL_RECEIVER_TOKEN;
  if (!sourceUrl || requestedUrl !== sourceUrl || !expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash) ||
      !receiverURL || !token || token.length < 32)
    throw Error('Private external skill download differs from the frozen source');
  const endpoint = new URL(receiverURL);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port ||
      endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)
    throw Error('Private external skill receiver URL is invalid');
  const response = await fetch(`${endpoint.origin}/source/SKILL.md`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || !response.body) throw Error('Private external skill receiver was unavailable');
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw Error('Private external skill download exceeded byte limit');
      chunks.push(Buffer.from(next.value));
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = Buffer.concat(chunks);
  if (sha256(bytes) !== expectedHash) throw Error('Private external skill download changed');
  return bytes.toString('utf8');
}
