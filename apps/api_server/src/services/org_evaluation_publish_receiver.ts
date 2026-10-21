import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface OrgEvaluationPublishObservation {
  method: string;
  path: string;
  status: number;
  bodyHash?: string;
  contentHash?: string;
}

/** A private, single-skill implementation of the production org-skills HTTP
 * contract. It records bytes actually received from the production applier;
 * receipt events alone never qualify a candidate. */
export async function startOrgEvaluationPublishReceiverAsync(input: {
  expectedSkillName: string;
  action: 'publish' | 'unpublish';
  expectedBodyHash: string;
  token: string;
  initialPublishedBody?: string;
}): Promise<{
  baseURL: string;
  port: number;
  observations(): Promise<{ requests: OrgEvaluationPublishObservation[]; publishedBody: string | null }>;
  close(): Promise<void>;
}> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.expectedSkillName) ||
      !['publish', 'unpublish'].includes(input.action) ||
      (input.action === 'unpublish' && typeof input.initialPublishedBody !== 'string') ||
      (input.action === 'publish' && input.initialPublishedBody !== undefined) ||
      !/^[a-f0-9]{64}$/.test(input.expectedBodyHash) || input.token.length < 32) {
    throw new Error('Invalid private org-skill receiver binding');
  }
  let publishedBody: string | null = input.initialPublishedBody ?? null;
  const requests: OrgEvaluationPublishObservation[] = [];
  const expectedPath = `/org-skills/${encodeURIComponent(input.expectedSkillName)}`;
  const server: Server = createServer(async (req, res) => {
    const method = req.method ?? '';
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const record: OrgEvaluationPublishObservation = { method, path, status: 404 };
    const finish = (status: number, body = '', type?: string): void => {
      record.status = status;
      requests.push(record);
      if (type) res.setHeader('Content-Type', type);
      res.writeHead(status);
      res.end(body);
    };
    if (method === 'GET' && path === '/org-skills/index.json') {
      const skills = publishedBody === null ? [] : [{ name: input.expectedSkillName, files: ['SKILL.md'] }];
      finish(200, JSON.stringify({ skills }), 'application/json');
      return;
    }
    if (method === 'GET' && path === `${expectedPath}/SKILL.md`) {
      if (publishedBody === null) finish(404);
      else { record.contentHash = sha256(publishedBody); finish(200, publishedBody, 'text/markdown'); }
      return;
    }
    if (path !== expectedPath || method !== (input.action === 'publish' ? 'POST' : 'DELETE')) {
      finish(404);
      return;
    }
    const provided = req.headers.authorization ?? '';
    const expected = `Bearer ${input.token}`;
    const providedBytes = Buffer.from(provided);
    const expectedBytes = Buffer.from(expected);
    if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
      finish(401);
      return;
    }
    if (method === 'DELETE') {
      if (publishedBody === null) finish(404);
      else { publishedBody = null; finish(204); }
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 256 * 1024) { finish(413); return; }
      chunks.push(bytes);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    record.bodyHash = sha256(body);
    if (record.bodyHash !== input.expectedBodyHash) { finish(409); return; }
    let parsed: { content?: unknown; published?: unknown };
    try { parsed = JSON.parse(body) as typeof parsed; } catch { finish(400); return; }
    if (typeof parsed.content !== 'string' || !parsed.content.trim() || parsed.published !== true) {
      finish(400);
      return;
    }
    publishedBody = parsed.content;
    record.contentHash = sha256(parsed.content);
    finish(201, JSON.stringify({ name: input.expectedSkillName, content: parsed.content, published: true }), 'application/json');
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
  } catch (error) {
    server.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Private org-skill receiver did not bind a TCP port');
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    port: address.port,
    observations: async () => ({ requests: requests.map((record) => ({ ...record })), publishedBody }),
    close: async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
