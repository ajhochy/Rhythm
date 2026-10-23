/**
 * A session row carries an authoritative execution binding only when at least
 * one execution field was actually persisted. Attaching an all-null state to
 * a response masks the engine record's own agent/model fields and lets the
 * client treat "nothing was ever bound" as known state.
 */
export function hasMobileSessionExecutionBinding(session: {
  profileId: string | null;
  providerId: string | null;
  modelId: string | null;
}): boolean {
  // opencodeAgentId is deliberately NOT a binding signal: the repository
  // backfills it from the NOT NULL agent_kind column, so every row carries
  // one whether or not anything was ever bound.
  return Boolean(
    session.profileId ||
    session.providerId ||
    session.modelId,
  );
}

/**
 * The exact current LOCAL primary root, addressed by its server-issued local
 * id when it has no SDK session yet. Unlike the SDK-keyed legacy rule above it
 * accepts no NULL/blank project: owner and project must match exactly, and the
 * independently read primary identity must be this very session.
 */
export function canUpdateMobileLocalPrimaryState(
  session: {
    id: string;
    ownerUserId: number | null;
    projectId: string | null;
    parentSessionId: string | null;
    isSystem: boolean;
    category: string;
    archivedAt: string | null;
  } | null | undefined,
  ownerUserId: number,
  projectId: string,
  primary: { ownerUserId: number; projectId: string; localSessionId: string } | null,
): boolean {
  return Boolean(
    session && primary &&
    session.ownerUserId === ownerUserId && session.projectId === projectId &&
    session.parentSessionId === null && session.isSystem === false && session.category === 'chat' &&
    session.archivedAt === null &&
    primary.localSessionId === session.id && primary.ownerUserId === ownerUserId && primary.projectId === projectId,
  );
}

export type MobileSettingsIdentity = 'local-primary' | 'sdk';

/** Absent selector → `undefined` (legacy semantics); anything not an exact enum value → `null` (400). */
export function parseMobileSettingsIdentity(raw: unknown): MobileSettingsIdentity | undefined | null {
  if (raw === undefined) return undefined;
  return raw === 'local-primary' || raw === 'sdk' ? raw : null;
}

export interface MobileSettingsPatch {
  modelMode?: 'auto' | 'fixed';
  providerId?: string;
  modelId?: string;
  thinkingBudget?: number | null;
  fastMode?: boolean;
}

const SETTINGS_FIELDS = new Set(['modelMode', 'providerId', 'modelId', 'thinkingBudget', 'fastMode']);
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Explicit-selector PATCH body: a nonempty partial subset of the five settings
 * fields. Fixed is exactly mode + a nonempty tuple; Auto is mode only (the
 * stored fallback tuple is preserved); a tuple without a mode is invalid.
 * Omitted fields are never defaulted — the caller writes only what is present.
 */
export function parseMobileSettingsPatch(
  body: unknown,
): { ok: true; patch: MobileSettingsPatch } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'settings body must be an object' };
  }
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined);
  if (keys.length === 0) return { ok: false, message: 'settings body must change at least one field' };
  if (keys.some((key) => !SETTINGS_FIELDS.has(key))) {
    return { ok: false, message: 'only modelMode, providerId, modelId, thinkingBudget and fastMode may be changed' };
  }
  const patch: MobileSettingsPatch = {};
  if (record.modelMode !== undefined) {
    if (record.modelMode !== 'auto' && record.modelMode !== 'fixed') {
      return { ok: false, message: "modelMode must be 'auto' or 'fixed'" };
    }
    patch.modelMode = record.modelMode;
  }
  const hasProvider = record.providerId !== undefined;
  const hasModel = record.modelId !== undefined;
  if (patch.modelMode === 'fixed') {
    if (!nonBlank(record.providerId) || !nonBlank(record.modelId)) {
      return { ok: false, message: 'a fixed model requires a nonempty providerId and modelId' };
    }
    patch.providerId = record.providerId;
    patch.modelId = record.modelId;
  } else if (hasProvider || hasModel) {
    return { ok: false, message: 'providerId/modelId are accepted only with modelMode fixed' };
  }
  if (record.thinkingBudget !== undefined) {
    const budget = record.thinkingBudget;
    if (budget !== null && (typeof budget !== 'number' || !Number.isSafeInteger(budget) || budget < 0)) {
      return { ok: false, message: 'thinkingBudget must be a non-negative integer or null' };
    }
    patch.thinkingBudget = budget as number | null;
  }
  if (record.fastMode !== undefined) {
    if (typeof record.fastMode !== 'boolean') return { ok: false, message: 'fastMode must be a boolean' };
    patch.fastMode = record.fastMode;
  }
  return { ok: true, patch };
}

export function canUpdateMobileSessionState(
  session: {
    ownerUserId: number | null;
    projectId: string | null;
  } | null | undefined,
  ownerUserId: number,
  projectId: string,
): boolean {
  if (!session || session.ownerUserId !== ownerUserId) return false;
  return session.projectId === projectId ||
    session.projectId === null ||
    session.projectId.trim() === '';
}
