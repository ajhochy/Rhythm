import type { ProviderSnapshot } from './opencode_client_service';

const OPENAI_MODELS = ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'] as const;
const GEMINI_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
] as const;

type SnapshotModel = ProviderSnapshot['providers'][number]['models'][number];

function newestAnthropicModels(models: readonly SnapshotModel[]): Set<string> {
  const parsed = models.flatMap((model) => {
    const normalized = model.id.replace(/(\d)\.(\d{1,2})(?=$|-)/, '$1-$2');
    const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(-1m)?$/.exec(normalized);
    return match ? [{
      id: model.id,
      family: match[1],
      major: Number(match[2]),
      minor: Number(match[3] ?? 0),
    }] : [];
  });
  const newest = new Map<string, { major: number; minor: number }>();
  for (const candidate of parsed) {
    const current = newest.get(candidate.family);
    if (
      !current ||
      candidate.major > current.major ||
      (candidate.major === current.major && candidate.minor > current.minor)
    ) {
      newest.set(candidate.family, { major: candidate.major, minor: candidate.minor });
    }
  }
  return new Set(parsed.filter((candidate) => {
    const version = newest.get(candidate.family);
    return version?.major === candidate.major && version.minor === candidate.minor;
  }).map((candidate) => candidate.id));
}

function geminiChatModel(modelId: string): boolean {
  return modelId.startsWith('gemini-') &&
    !/(?:^|-)(?:embedding|image|tts)(?:-|$)/i.test(modelId);
}

function anthropicFamily(modelId: string): string | undefined {
  const normalized = modelId.replace(/(\d)\.(\d{1,2})(?=$|-)/, '$1-$2');
  return /^claude-([a-z]+)-\d+/.exec(normalized)?.[1];
}

export function visibleDirectModelIds(
  providerId: string,
  models: readonly SnapshotModel[],
  opts?: { geminiEntitlementsKnown?: boolean },
): Set<string> {
  if (providerId === 'anthropic') return newestAnthropicModels(models);
  if (providerId === 'github-copilot') {
    const visible = newestAnthropicModels(models.filter((model) =>
      model.id.startsWith('claude-')));
    const approved = new Set<string>([...OPENAI_MODELS, ...GEMINI_MODELS, 'gpt-5-mini']);
    for (const model of models) {
      if (approved.has(model.id)) visible.add(model.id);
    }
    return visible;
  }
  if (providerId === 'google' && opts?.geminiEntitlementsKnown) {
    return new Set(models.filter((model) => geminiChatModel(model.id)).map((model) => model.id));
  }
  const approved = providerId === 'openai'
    ? new Set<string>(OPENAI_MODELS)
    : providerId === 'google'
      ? new Set<string>(GEMINI_MODELS)
      : undefined;
  return approved
    ? new Set(models.filter((model) => approved.has(model.id)).map((model) => model.id))
    : new Set(models.map((model) => model.id));
}

/** Direct cloud models are opt-in; engine presence is necessary but not sufficient. */
export function approvedDirectModel(providerId: string, modelId: string): boolean {
  return visibleDirectModelIds(providerId, [{ id: modelId }]).has(modelId);
}

/** Maps a stale static direct route to the policy-visible model in that family. */
export function preferredVisibleDirectModelId(
  providerId: string,
  preferredModelId: string,
  models: readonly SnapshotModel[],
  opts?: { geminiEntitlementsKnown?: boolean },
): string | undefined {
  const eligible = models.filter(eligibleModel);
  const visible = visibleDirectModelIds(providerId, eligible, opts);
  if (visible.has(preferredModelId)) return preferredModelId;
  const candidates = eligible.filter((model) => visible.has(model.id));
  if (providerId === 'anthropic' || providerId === 'github-copilot') {
    const family = anthropicFamily(preferredModelId);
    if (!family) return undefined;
    const familyCandidates = candidates.filter((model) => anthropicFamily(model.id) === family);
    const wantsLongContext = preferredModelId.endsWith('-1m') || preferredModelId.endsWith(':extended');
    return familyCandidates.find((model) => model.id.endsWith('-1m') === wantsLongContext)?.id ??
      familyCandidates[0]?.id;
  }
  if (providerId === 'openai' && preferredModelId.startsWith('gpt-')) {
    return candidates.find((model) => model.id.startsWith('gpt-'))?.id;
  }
  if (providerId === 'google' && preferredModelId.startsWith('gemini-')) {
    return candidates.find((model) => model.id.startsWith('gemini-'))?.id;
  }
  return undefined;
}

export function eligibleModel(
  model: ProviderSnapshot['providers'][number]['models'][number],
): boolean {
  return model.status !== 'deprecated' &&
    !model.id.endsWith('-fast') &&
    model.capabilities?.input?.text === true &&
    model.capabilities.output?.text === true &&
    model.capabilities.toolcall === true;
}

export type EndpointDisposition = 'local' | 'public' | 'unprobeable' | 'invalid';
export type ProbeInventory = {
  status: 'verified' | 'unverified' | 'blocked';
  models: Set<string>;
};

const probes = new Map<string, { expires: number; result: Promise<ProbeInventory> }>();

export function resetProbeCache(): void {
  probes.clear();
}

function privateLiteral(host: string): boolean {
  if (host === '[::1]') return true;
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const octets = host.split('.').map(Number);
  if (octets.some((part) => part > 255)) return false;
  return octets[0] === 127 ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function safeEndpoint(endpoint: string, trustedEndpoint: string): URL | undefined {
  try {
    const url = new URL(endpoint);
    const trusted = new URL(trustedEndpoint);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username || url.password || trusted.username || trusted.password ||
      url.search || url.hash || trusted.search || trusted.hash ||
      url.origin !== trusted.origin ||
      url.pathname.includes('..') ||
      url.pathname.startsWith('//') ||
      endpoint.includes('\\\\')
    ) return undefined;
    const resolved = new URL(
      `${url.pathname.replace(/\/$/, '')}/models`,
      url.origin,
    );
    if (resolved.origin !== url.origin) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export function providerEndpointDisposition(
  endpoint: string,
  trustedEndpoint: string,
): EndpointDisposition {
  const url = safeEndpoint(endpoint, trustedEndpoint);
  if (!url) {
    try {
      const configured = new URL(endpoint);
      const trusted = new URL(trustedEndpoint);
      if (
        configured.username || configured.password ||
        trusted.username || trusted.password ||
        configured.origin !== trusted.origin ||
        configured.pathname.includes('..') ||
        configured.pathname.startsWith('//') ||
        endpoint.includes('\\\\')
      ) return 'invalid';
      return 'unprobeable';
    } catch {
      // Raw {env:VAR} substitutions cannot be parsed here, but the engine's
      // resolved endpoint is trusted only as evidence to keep the row unknown.
      return /^\{env:[A-Za-z_][A-Za-z0-9_]*\}(?:\/|$)/.test(endpoint) && trustedEndpoint
        ? 'unprobeable'
        : 'invalid';
    }
  }
  if (url.hostname === 'localhost' || privateLiteral(url.hostname)) return 'local';
  // User-configured DNS, Tailscale, .local, and public HTTPS endpoints remain
  // selectable but are never probed by Rhythm.
  return 'public';
}

/** Read-only local model inventory; intentionally never carries auth headers. */
export async function probeDeclaredModelInventory(
  endpoint: string,
  trustedEndpoint: string,
  declared: Set<string>,
): Promise<ProbeInventory> {
  const url = safeEndpoint(endpoint, trustedEndpoint);
  if (!url || providerEndpointDisposition(endpoint, trustedEndpoint) !== 'local') {
    return { status: 'blocked', models: new Set() };
  }
  const target = new URL(`${url.pathname.replace(/\/$/, '')}/models`, url.origin).href;
  const key = `${target}\0${[...declared].sort().join('\0')}`;
  const cached = probes.get(key);
  if (cached && cached.expires > Date.now()) {
    const result = await cached.result;
    return { status: result.status, models: new Set(result.models) };
  }
  if (probes.size >= 8) {
    for (const [name, value] of probes) {
      if (value.expires <= Date.now()) probes.delete(name);
    }
    if (probes.size >= 8) return { status: 'unverified', models: new Set() };
  }
  const result = (async (): Promise<ProbeInventory> => {
    try {
      const response = await fetch(target, {
        signal: AbortSignal.timeout(750),
        redirect: 'manual',
        credentials: 'omit',
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get('content-length') ?? 0) > 1_048_576
      ) return { status: 'unverified', models: new Set() };
      const reader = response.body.getReader();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1_048_576) return { status: 'unverified', models: new Set() };
          chunks.push(value);
        }
      } finally {
        void reader.cancel().catch(() => undefined);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        data?: Array<{ id?: unknown }>;
        models?: Array<{ id?: unknown }>;
      };
      const listed = body.data ?? body.models;
      if (!Array.isArray(listed)) return { status: 'unverified', models: new Set() };
      return {
        status: 'verified',
        models: new Set(
          listed
            .filter((item) => typeof item?.id === 'string' && declared.has(item.id))
            .map((item) => item.id as string),
        ),
      };
    } catch {
      return { status: 'unverified', models: new Set() };
    }
  })();
  const record = { expires: Date.now() + 15_000, result };
  probes.set(key, record);
  const inventory = await result;
  if (inventory.status !== 'verified' || inventory.models.size === 0) {
    record.expires = Date.now() + 5_000;
  }
  return { status: inventory.status, models: new Set(inventory.models) };
}

/** Backward-compatible set-only view used by focused probe tests. */
export async function probeDeclaredModels(
  endpoint: string,
  trustedEndpoint: string,
  declared: Set<string>,
): Promise<Set<string>> {
  return (await probeDeclaredModelInventory(endpoint, trustedEndpoint, declared)).models;
}
