import { AppError } from '../errors/app_error';

/**
 * Research Projects lead/researcher model split. A project's modelPolicy is either `{}` (legacy:
 * every stage uses the research profile's model, passes run from passConfig sequentially) or
 * `{ lead, researcher }`, where each side is a catalog model or `null` (= research profile's model).
 * The lead plans, critiques and writes the final report; researchers run the evidence passes.
 */
export type ModelRef = { providerId: string; modelId: string };
export type ResearchModelPolicy = { lead: ModelRef | null; researcher: ModelRef | null };
export type CatalogRowLike = {
  provider: string; modelId: string; authorized: boolean; available: boolean | 'unknown'; visible?: boolean;
};

const selectable = (rows: CatalogRowLike[]) =>
  rows.filter((row) => row.authorized && row.available !== false && row.visible !== false && row.provider && row.modelId);

/** Numeric parts of a model id, for "newest opus" ordering (claude-opus-5-5 > claude-opus-4-5-20251101). */
const versionKey = (modelId: string) => (modelId.match(/\d+/g) ?? []).map(Number).filter((part) => part < 1000);
function newer(a: string, b: string): number {
  const [x, y] = [versionKey(a), versionKey(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (y[i] ?? -1) - (x[i] ?? -1);
    if (diff) return diff;
  }
  return 0;
}

/**
 * Defaults from the live catalog: lead = newest Anthropic Opus (non-fast) else OpenAI gpt-5.6-sol;
 * researcher = Anthropic claude-haiku-4-5 else OpenAI gpt-5.6-luna. `null` = research profile's model.
 * Mirrored for picker prefill in apps/web/src/components/ToolWorkspace.tsx (defaultResearchModels).
 */
export function defaultResearchModels(rows: CatalogRowLike[]): ResearchModelPolicy {
  const usable = selectable(rows);
  const find = (providerId: string, modelId: string) =>
    usable.some((row) => row.provider === providerId && row.modelId === modelId) ? { providerId, modelId } : null;
  const opus = usable
    .filter((row) => row.provider === 'anthropic' && /^claude-opus-/.test(row.modelId) && !/-fast$/.test(row.modelId))
    .map((row) => row.modelId).sort(newer)[0];
  return {
    lead: opus ? { providerId: 'anthropic', modelId: opus } : find('openai', 'gpt-5.6-sol'),
    researcher: find('anthropic', 'claude-haiku-4-5') ?? find('openai', 'gpt-5.6-luna'),
  };
}

function modelRef(value: unknown, field: string): ModelRef | null {
  if (value === null) return null;
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const providerId = typeof record?.providerId === 'string' ? record.providerId.trim() : '';
  const modelId = typeof record?.modelId === 'string' ? record.modelId.trim() : '';
  if (!providerId || !modelId) throw AppError.badRequest(`${field} must be {providerId, modelId} or null`);
  return { providerId, modelId };
}

/**
 * Validates a create/PATCH modelPolicy against the live catalog. `{}`/undefined stays `{}` (legacy);
 * otherwise an omitted side takes the catalog default and a named model must be selectable.
 */
export async function normalizeModelPolicy(
  value: unknown,
  loadCatalog: () => Promise<CatalogRowLike[]>,
): Promise<Record<string, unknown>> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw AppError.badRequest('modelPolicy must be an object');
  const input = value as Record<string, unknown>;
  if (!('lead' in input) && !('researcher' in input)) return {};
  const catalog = await loadCatalog().catch(() => [] as CatalogRowLike[]);
  const usable = selectable(catalog);
  const defaults = defaultResearchModels(catalog);
  const policy: ResearchModelPolicy = { lead: null, researcher: null };
  for (const side of ['lead', 'researcher'] as const) {
    const ref = input[side] === undefined ? defaults[side] : modelRef(input[side], `modelPolicy.${side}`);
    // ponytail: an unreachable catalog (engine down) accepts well-formed refs; the run itself fails loudly if wrong.
    if (ref && usable.length > 0 && !usable.some((row) => row.provider === ref.providerId && row.modelId === ref.modelId)) {
      throw AppError.badRequest(`modelPolicy.${side} ${ref.providerId}/${ref.modelId} is not an available model`);
    }
    policy[side] = ref;
  }
  return policy;
}

/** The run's frozen policy, or null for legacy runs (no lead/researcher split). */
export function runModelPolicy(snapshot: Record<string, unknown>): ResearchModelPolicy | null {
  const value = snapshot.modelPolicy;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!('lead' in record) && !('researcher' in record)) return null;
  const safe = (side: unknown) => { try { return modelRef(side ?? null, 'modelPolicy'); } catch { return null; } };
  return { lead: safe(record.lead), researcher: safe(record.researcher) };
}

export const modelLabel = (ref: ModelRef | null) => (ref ? `${ref.providerId}/${ref.modelId}` : null);
export const modelOverrideFor = (ref: ModelRef | null) =>
  (ref ? { providerID: ref.providerId, modelID: ref.modelId } : undefined);
