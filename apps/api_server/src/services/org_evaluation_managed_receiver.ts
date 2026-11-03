/** Parent-owned narrow receiver; instantiate in a separate
 * sanitized Node process whose process-global DB points only at copied SQLite. */
import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

interface VerifiedCall { context: { sdkSessionId: string; turnId: string;
  agentName: string; toolCallId: string }; arguments: Record<string, unknown> }
interface PerEngineVerifier {
  verify(value: unknown, toolName: string, now?: number, nonceScope?: string): Promise<VerifiedCall>;
  dispose(): void;
}
interface ManagedToolsPort {
  listForCallAsync(call: VerifiedCall, ownerUserId: number): Promise<unknown>;
  runForCallAsync(call: VerifiedCall, ownerUserId: number): Promise<unknown>;
}
type Observation = { toolName: string; callId: string; responseHash: string; status: 200 | 201 | 403;
  proposalId: string | null; artifactDigest: string | null;
  outputHash: string | null; networkMode: string | null;
  forbiddenArtifactWriteDenied: boolean | null; taintBlocked?: boolean;
  denialReason?: 'not-installed' };
const NAME = { '/managed-tools/list': 'rhythm_list_managed_tools',
  '/managed-tools/run': 'rhythm_run_managed_tool' } as const;

export async function startPrivateManagedToolReceiverAsync(input: {
  token: string;
  /** The SDK session created by the private worker. Set once before first call. */
  expectedSessionId: () => string | null;
  ownerUserId: number;
  verifier: PerEngineVerifier;
  service: ManagedToolsPort;
}): Promise<{ baseURL: string; port: number; observations(): Observation[]; close(): Promise<void> }> {
  if (input.token.length < 32 || !Number.isSafeInteger(input.ownerUserId))
    throw Error('private managed receiver binding invalid');
  const observations: Observation[] = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const taintPath = path === '/agent-approvals/external-content/taint';
    const toolName = taintPath ? NAME['/managed-tools/run'] : NAME[path as keyof typeof NAME];
    if (req.method !== 'POST' || !toolName || req.url !== path) {
      res.writeHead(404).end(); return;
    }
    const expected = Buffer.from(`Bearer ${input.token}`);
    const received = Buffer.from(req.headers.authorization ?? '');
    // Production recordExternalContentTaint sends the signed call in the body
    // without a bearer header; its per-engine signature is verified below.
    if ((!taintPath || received.length !== 0) &&
        (received.length !== expected.length || !timingSafeEqual(received, expected))) {
      res.writeHead(401).end(); return;
    }
    let verifiedCall: VerifiedCall | null = null;
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 65_536) throw Error('request too large');
        chunks.push(bytes);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          !Object.hasOwn(body, 'trustedCall') ||
          (!taintPath && Object.keys(body).length !== 1))
        throw Error('malformed trusted call');
      const call = await input.verifier.verify(body.trustedCall, toolName,
        Date.now(), taintPath ? 'external-content-taint' : toolName);
      verifiedCall = call;
      const session = input.expectedSessionId();
      if (!session || call.context.sdkSessionId !== session) throw Error('wrong private session');
      if (taintPath) {
        if (body.source !== 'managed-tool.run' || typeof body.blocked !== 'boolean' ||
            typeof body.contentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(body.contentDigest) ||
            !body.context || typeof body.context !== 'object' || Array.isArray(body.context) ||
            Object.keys(body.context).length !== 4 ||
            ['sdkSessionId', 'turnId', 'agentName', 'toolCallId'].some((key) =>
              (body.context as Record<string, unknown>)[key] !==
              (call.context as unknown as Record<string, unknown>)[key]))
          throw Error('taint metadata differs from signed managed call');
        const priorRun = observations.find((item) =>
          item.toolName === NAME['/managed-tools/run'] &&
          item.callId === call.context.toolCallId &&
          item.responseHash === body.contentDigest);
        if (!priorRun || observations.some((item) =>
          item.toolName === 'external-content-taint' &&
          item.callId === call.context.toolCallId))
          throw Error('taint must bind one exact prior managed output');
        const { ExternalContentSecurityService } = await import('./external_content_security_service');
        const result = new ExternalContentSecurityService().markTainted({
          context: call.context, source: 'managed-tool.run',
          contentDigest: body.contentDigest, blocked: body.blocked,
          diagnostics: body.diagnostics,
        });
        observations.push({ toolName: 'external-content-taint',
          callId: call.context.toolCallId, responseHash: body.contentDigest,
          status: 201, proposalId: null, artifactDigest: null, outputHash: null,
          networkMode: null, forbiddenArtifactWriteDenied: null,
          taintBlocked: body.blocked });
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(201).end(JSON.stringify(result)); return;
      }
      // The production service must be configured with its own exact private
      // engine active-call callback, copied DB, managed root and Docker runner.
      const result = toolName === NAME['/managed-tools/list']
        ? await input.service.listForCallAsync(call, input.ownerUserId)
        : await input.service.runForCallAsync(call, input.ownerUserId);
      const json = JSON.stringify(result);
      if (Buffer.byteLength(json) > 32_768) throw Error('result too large');
      const record = result && typeof result === 'object' && !Array.isArray(result)
        ? result as Record<string, unknown> : {};
      observations.push({ toolName, callId: call.context.toolCallId,
        responseHash: createHash('sha256').update(json).digest('hex'), status: 200,
        proposalId: typeof record.proposalId === 'string' ? record.proposalId : null,
        artifactDigest: typeof record.artifactDigest === 'string' ? record.artifactDigest : null,
        outputHash: typeof record.output === 'string'
          ? createHash('sha256').update(record.output).digest('hex') : null,
        networkMode: typeof record.networkMode === 'string' ? record.networkMode : null,
        forbiddenArtifactWriteDenied: typeof record.forbiddenArtifactWriteDenied === 'boolean'
          ? record.forbiddenArtifactWriteDenied : null });
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200).end(json);
    } catch (error) {
      const failure = error as { statusCode?: unknown; code?: unknown; message?: unknown };
      if (toolName === NAME['/managed-tools/run'] && verifiedCall &&
          failure.statusCode === 403 && failure.code === 'FORBIDDEN' &&
          failure.message === 'Approved tool installation is unavailable for this agent') {
        observations.push({ toolName, callId: verifiedCall.context.toolCallId,
          responseHash: createHash('sha256').update('not-installed').digest('hex'),
          status: 403, proposalId: typeof verifiedCall.arguments.proposalId === 'string'
            ? verifiedCall.arguments.proposalId : null,
          artifactDigest: null, outputHash: null, networkMode: null,
          forbiddenArtifactWriteDenied: null, denialReason: 'not-installed' });
      }
      // Never disclose verifier or copied DB details to candidate/model.
      res.writeHead(403).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw Error('receiver unavailable'); }
  return { baseURL: `http://127.0.0.1:${address.port}`, port: address.port,
    observations: () => observations.map(item => ({ ...item })),
    close: async () => {
      input.verifier.dispose();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    } };
}
