import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

const MAX_URL_LENGTH = 2048;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_MODELS = 1_000;
const ALLOWED_FIELDS = new Set(['providerId', 'name', 'baseURL', 'apiKey']);

export type CustomProviderInput = {
  providerId: string;
  name: string;
  baseURL: string;
  apiKey?: string;
};

export type DiscoveredModel = { id: string; name: string };

export interface CustomProviderRuntime {
  setAuth(providerId: string, apiKey: string): Promise<boolean>;
  removeAuth(providerId: string): Promise<boolean>;
  getGlobalConfig(): Promise<Record<string, unknown> | null>;
  updateGlobalConfig(config: Record<string, unknown>): Promise<boolean>;
  providerSnapshot(): Promise<{
    providers: Array<{ id: string; models: Array<{ id: string }> }>;
  }>;
}

export class CustomProviderError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type ValidatedInput = CustomProviderInput & { endpoint: URL; normalizedBaseURL: string };

function fail(status: number, code: string, message: string): never {
  throw new CustomProviderError(status, code, message);
}

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').map(Number);
}

function isIpv4Local(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  return octets[0] === 127 || octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168);
}

function normalizedIp(address: string): string {
  return address.toLowerCase().replace(/^\[|\]$/g, '');
}

function mappedIpv4(address: string): string | null {
  const ip = normalizedIp(address);
  if (!ip.startsWith('::ffff:')) return null;
  const tail = ip.slice(7);
  if (isIP(tail) === 4) return tail;
  const words = tail.split(':');
  if (words.length !== 2 || words.some((word) => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const value = Number.parseInt(words[0], 16) * 0x10000 + Number.parseInt(words[1], 16);
  return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255].join('.');
}

function isBlockedAddress(address: string): boolean {
  const ip = normalizedIp(address);
  const v4 = parseIpv4(mappedIpv4(ip) ?? ip);
  if (v4) {
    return v4[0] === 0 || v4[0] === 169 && v4[1] === 254 ||
      v4[0] >= 224 ||
      v4.join('.') === '100.100.100.200' || v4.join('.') === '168.63.129.16';
  }
  if (isIP(ip) !== 6) return false;
  return ip === '::' || ip.startsWith('fe8') || ip.startsWith('fe9') ||
    ip.startsWith('fea') || ip.startsWith('feb') || ip === 'fd00:ec2::254';
}

function isIpv6Local(address: string): boolean {
  const ip = normalizedIp(address);
  if (isIP(ip) !== 6 || isBlockedAddress(ip)) return false;
  return ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd');
}

function isLocalAddress(address: string): boolean {
  const ip = normalizedIp(address);
  return !isBlockedAddress(ip) && (isIpv4Local(mappedIpv4(ip) ?? ip) || isIpv6Local(ip));
}

/**
 * Shared endpoint validation (custom providers and the decision-router
 * backend): http(s) only, no credentials/query/fragment, link-local/metadata
 * blocked, plain http only for literal loopback/RFC1918/IPv6-local addresses
 * (plus the `localhost` name when `allowLocalhostName`). Throws CustomProviderError.
 */
export function validateEndpointUrl(baseURL: string, opts: { allowLocalhostName?: boolean } = {}): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(baseURL);
  } catch {
    fail(400, 'unsafe_endpoint', 'Base URL must be a valid HTTP(S) URL without credentials, query parameters, or a fragment.');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    fail(400, 'unsafe_endpoint', 'Base URL must be HTTP(S) without credentials, query parameters, or a fragment. HTTPS is required for public endpoints; HTTP is allowed only for literal loopback or private local IP addresses.');
  }
  const host = normalizedIp(endpoint.hostname);
  if (isBlockedAddress(host)) {
    fail(400, 'unsafe_endpoint', 'Link-local, cloud-metadata, unspecified, multicast, and reserved endpoint addresses are blocked.');
  }
  const localhostName = opts.allowLocalhostName === true && host === 'localhost';
  if (endpoint.protocol === 'http:' && !localhostName && (isIP(host) === 0 || !isLocalAddress(host))) {
    fail(400, 'unsafe_endpoint', 'Public HTTP hostnames and addresses are blocked. Use HTTPS for public endpoints; HTTP is allowed only for literal loopback or RFC1918/IPv6-local addresses.');
  }
  return endpoint;
}

export function validateCustomProviderInput(value: unknown): ValidatedInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(400, 'invalid_request', 'Expected a JSON object with providerId, name, baseURL, and optional apiKey.');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !ALLOWED_FIELDS.has(key))) {
    fail(400, 'invalid_request', 'Unknown fields are not allowed. Use only providerId, name, baseURL, and optional apiKey.');
  }
  if (typeof input.providerId !== 'string' || !/^[a-z0-9][a-z0-9-_]*$/.test(input.providerId)) {
    fail(400, 'invalid_request', 'Provider ID must start with a lowercase letter or digit and contain only lowercase letters, digits, hyphens, or underscores.');
  }
  if (typeof input.name !== 'string' || !input.name.trim()) {
    fail(400, 'invalid_request', 'Provider name is required.');
  }
  if (typeof input.baseURL !== 'string' || input.baseURL.length > MAX_URL_LENGTH) {
    fail(400, 'unsafe_endpoint', `Base URL must be at most ${MAX_URL_LENGTH} characters.`);
  }
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') {
    fail(400, 'invalid_request', 'API key must be a string when provided.');
  }

  const endpoint = validateEndpointUrl(input.baseURL);
  const normalizedBaseURL = endpoint.toString().replace(/\/$/, '');
  return {
    providerId: input.providerId,
    name: input.name.trim(),
    baseURL: input.baseURL,
    ...(input.apiKey?.trim() ? { apiKey: input.apiKey } : {}),
    endpoint,
    normalizedBaseURL,
  };
}

export async function resolveEndpoint(endpoint: URL): Promise<{ address: string; family: 4 | 6 }> {
  const host = normalizedIp(endpoint.hostname);
  if (isIP(host)) return { address: host, family: isIP(host) as 4 | 6 };
  let addresses: Array<{ address: string; family: 4 | 6 }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true }) as Array<{ address: string; family: 4 | 6 }>;
  } catch {
    fail(502, 'provider_unreachable', 'Could not resolve the provider endpoint. Check the Base URL and network connection.');
  }
  if (!addresses.length || addresses.some(({ address }) => isBlockedAddress(address) || isLocalAddress(address))) {
    fail(400, 'unsafe_endpoint', 'Public HTTPS hostnames must resolve only to public addresses; local, link-local, cloud-metadata, and reserved addresses are blocked.');
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

async function readModels(endpoint: URL, apiKey?: string): Promise<unknown> {
  const target = new URL(endpoint.toString());
  target.pathname = `${target.pathname.replace(/\/$/, '')}/models`;
  target.search = '';
  target.hash = '';
  const resolved = await resolveEndpoint(target);

  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, {
      method: 'GET',
      headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      lookup: (_hostname, _options, callback) => callback(null, resolved.address, resolved.family),
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        reject(new CustomProviderError(502, 'provider_redirect', 'Provider redirects are not followed. Enter the final OpenAI-compatible Base URL.'));
        return;
      }
      if (response.statusCode === 401 || response.statusCode === 403) {
        response.resume();
        reject(new CustomProviderError(502, 'provider_auth_failed', 'The provider rejected the API key. Check the key and try again.'));
        return;
      }
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new CustomProviderError(502, 'provider_http_error', 'The provider returned an HTTP error. Check the Base URL and provider availability.'));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy(new CustomProviderError(502, 'provider_invalid_response', 'The provider model response exceeded the 2 MiB safety limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new CustomProviderError(502, 'provider_invalid_response', 'The provider returned invalid JSON instead of an OpenAI-compatible model list.'));
        }
      });
    });
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new CustomProviderError(504, 'provider_timeout', 'The provider did not respond within 5 seconds.')));
    request.on('error', (error) => reject(error instanceof CustomProviderError ? error : new CustomProviderError(502, 'provider_unreachable', 'Could not reach the provider. Check the Base URL and network connection.')));
    request.end();
  });
}

export async function discoverCustomProviderModels(input: ValidatedInput): Promise<DiscoveredModel[]> {
  const body = await readModels(input.endpoint, input.apiKey);
  if (!body || typeof body !== 'object' || !Array.isArray((body as { data?: unknown }).data)) {
    fail(502, 'provider_invalid_response', 'Expected an OpenAI-compatible response shaped as {data:[{id:string}]}.');
  }
  const rows = (body as { data: unknown[] }).data;
  if (rows.some((row) => !row || typeof row !== 'object' || typeof (row as { id?: unknown }).id !== 'string' || !(row as { id: string }).id.trim())) {
    fail(502, 'provider_invalid_response', 'Expected every provider model entry to contain a nonempty string id.');
  }
  return [...new Set(rows.map((row) => (row as { id: string }).id.trim()))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_MODELS)
    .map((id) => ({ id, name: id }));
}

export class CustomProviderService {
  constructor(private readonly runtime: CustomProviderRuntime) {}

  async test(value: unknown) {
    const input = validateCustomProviderInput(value);
    const models = await discoverCustomProviderModels(input);
    return { ok: true as const, providerId: input.providerId, modelCount: models.length, models };
  }

  async save(value: unknown) {
    const input = validateCustomProviderInput(value);
    const models = await discoverCustomProviderModels(input);
    const config = await this.runtime.getGlobalConfig();
    if (!config) fail(502, 'provider_config_unavailable', 'OpenCode global configuration is unavailable. Try again after the local runtime reconnects.');
    const providers = config.provider && typeof config.provider === 'object' && !Array.isArray(config.provider)
      ? config.provider as Record<string, unknown>
      : {};
    if (Object.prototype.hasOwnProperty.call(providers, input.providerId)) {
      fail(409, 'provider_exists', 'That Provider ID already exists. This create-only screen cannot edit or replace providers.');
    }
    const provider = {
      npm: '@ai-sdk/openai-compatible',
      name: input.name,
      options: { baseURL: input.normalizedBaseURL },
      models: Object.fromEntries(models.map((model) => [model.id, { name: model.name }])),
    };

    const authStored = Boolean(input.apiKey);
    if (input.apiKey && !await this.runtime.setAuth(input.providerId, input.apiKey)) {
      fail(502, 'provider_auth_store_failed', 'OpenCode could not store the provider API key. No provider configuration was saved.');
    }
    const updated = await this.runtime.updateGlobalConfig({ provider: { [input.providerId]: provider } }).catch(() => false);
    if (!updated) {
      if (authStored) await this.runtime.removeAuth(input.providerId).catch(() => false);
      fail(502, 'provider_config_update_failed', 'OpenCode rejected the provider configuration. No provider configuration was saved.');
    }

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const snapshot = await this.runtime.providerSnapshot();
        const observedProvider = snapshot.providers.find((entry) => entry.id === input.providerId);
        const observed = new Set(observedProvider?.models.map((model) => model.id) ?? []);
        if (observedProvider && models.every((model) => observed.has(model.id))) {
          return { ok: true as const, providerId: input.providerId, modelCount: models.length };
        }
      } catch {
        // Global config mutation disposes instances; reads may fail until the replacement is ready.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: true as const, pending: true as const, providerId: input.providerId, modelCount: models.length };
  }
}
