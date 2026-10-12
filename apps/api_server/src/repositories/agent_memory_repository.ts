import { randomUUID } from 'node:crypto';
import { getDb, getPostgresPool } from '../database/db';
import { env } from '../config/env';
import {
  GENERIC_ADMISSION_SQL_FUNCTION,
  isGenericMemoryAdmissionAllowedFields,
} from '../utils/generic_memory_admission';
import {
  deriveMemoryTitle,
  type MemoryStatus,
  type MemoryTrustTier,
} from '../services/memory_note_format';

export interface AgentMemory {
  id: string;
  kind: string;
  content: string;
  /** Derived at read time (see deriveMemoryTitle) — never stored, no schema change. */
  title?: string;
  source: string | null;
  sourceId: string | null;
  tagsJson: string;
  status: MemoryStatus;
  staleAfter: string | null;
  verifiedJson: string;
  sourcesJson: string;
  generatedBy: string | null;
  generatedAt: string | null;
  trustTier: MemoryTrustTier;
  /** Searchable rows are only eligible for automatic prompt injection when true. */
  autoInjectable?: boolean;
  ownerUserId: number | null;
  createdAt: string;
  updatedAt: string;
  lifecycleState?: 'active' | 'stale' | 'deprecated';
  unverifiable?: boolean;
}

export interface AgentMemoryChange {
  id: string;
  memoryId: string;
  memorySourceId: string;
  action: 'verified' | 'deprecated' | 'rollback';
  actor: string;
  changedAt: string;
  priorState: Record<string, unknown>;
  rollbackTarget: string | null;
  sourceContext: Record<string, unknown>;
}

export interface CreateAgentMemoryInput {
  kind?: string;
  content: string;
  source?: string;
  sourceId?: string;
  tagsJson?: string;
  autoInjectable?: boolean;
  ownerUserId?: number;
}

export interface MemorySearchOptions {
  /**
   * Automatic-injection-only lifecycle gate. Ordinary repository callers,
   * including explicit MCP recall, leave this false and see inactive rows.
   */
  activeOnly?: boolean;
  /** Automatic prompt injection only; explicit/on-demand search leaves this false. */
  injectableOnly?: boolean;
  /** YYYY-MM-DD boundary captured at retrieval call time. */
  today?: string;
  /** Generic (non-Dayflow) admission applied before the LIMIT; see MemoryListOptions. */
  genericAdmissionOnly?: boolean;
}

function rowToModel(row: Record<string, unknown>): AgentMemory {
  const status = (row.status as MemoryStatus) ?? 'stable';
  const staleAfter = (row.stale_after as string | null) ?? null;
  const verifiedJson = (row.verified_json as string) ?? '[]';
  const sourcesJson = (row.sources_json as string) ?? '[]';
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: row.id as string,
    kind: (row.kind as string) ?? 'fact',
    content: row.content as string,
    title: deriveMemoryTitle(row.content as string),
    source: (row.source as string | null) ?? null,
    sourceId: (row.source_id as string | null) ?? null,
    tagsJson: (row.tags_json as string) ?? '[]',
    status,
    staleAfter,
    verifiedJson,
    sourcesJson,
    generatedBy: (row.generated_by as string | null) ?? null,
    generatedAt: row.generated_at == null
      ? null
      : typeof row.generated_at === 'string'
        ? row.generated_at
        : (row.generated_at as Date).toISOString(),
    trustTier: (row.trust_tier as MemoryTrustTier) ?? 'unverified',
    autoInjectable: row.auto_injectable === true || row.auto_injectable === 1,
    ownerUserId: (row.owner_user_id as number | null) ?? null,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : (row.created_at as Date).toISOString(),
    updatedAt:
      typeof row.updated_at === 'string'
        ? row.updated_at
        : (row.updated_at as Date).toISOString(),
    lifecycleState: status === 'deprecated'
      ? 'deprecated'
      : staleAfter !== null && staleAfter <= today
        ? 'stale'
        : 'active',
    unverifiable: verifiedJson === '[]' && sourcesJson === '[]',
  };
}

export interface MemoryListOptions {
  offset?: number;
  includeDeprecated?: boolean;
  /**
   * Apply the generic (non-Dayflow) release admission in SQL BEFORE
   * LIMIT/OFFSET, so withheld rows can neither starve a page nor inflate a
   * count. Qualified Dayflow readers never set this and keep the raw path.
   */
  genericAdmissionOnly?: boolean;
}

/**
 * SQLite form of the generic admission: the deterministic scalar registered by
 * `database/db.ts` runs the EXACT decoded-values policy, so membership is
 * decided before any LIMIT/OFFSET/count/search budget. No substring/json_tree
 * approximation exists anywhere.
 */
function genericAdmissionSql(prefix = ''): string {
  return `${GENERIC_ADMISSION_SQL_FUNCTION}(${prefix}source, ${prefix}tags_json, ${prefix}sources_json) = 1`;
}

/**
 * PostgreSQL has no registered scalar (no migration/function is added), so the
 * same policy is applied in JS over ordered, finite batches. If the bound is
 * exhausted before the answer is known the call FAILS with this explicit
 * error: never a partial count presented as exact, never a full-looking empty
 * or short page that silently omits eligible rows.
 */
export const GENERIC_ADMISSION_BATCH_ROWS = 200;
export const GENERIC_ADMISSION_MAX_BATCHES = 25;

export class GenericAdmissionScanIncompleteError extends Error {
  constructor() {
    super(
      `Generic memory admission scan reached its bound of ${GENERIC_ADMISSION_BATCH_ROWS * GENERIC_ADMISSION_MAX_BATCHES} candidates before completing; result withheld as incomplete`,
    );
    this.name = 'GenericAdmissionScanIncompleteError';
  }
}

/** Rows (in the query's own order) that pass admission, skipping `skip`, taking at most `take`. */
async function admittedWindow(
  fetchBatch: (limit: number, offset: number) => Promise<AgentMemory[]>,
  skip: number,
  take: number,
): Promise<AgentMemory[]> {
  const out: AgentMemory[] = [];
  let toSkip = Math.max(0, skip);
  for (let batch = 0; batch < GENERIC_ADMISSION_MAX_BATCHES; batch += 1) {
    const rows = await fetchBatch(GENERIC_ADMISSION_BATCH_ROWS, batch * GENERIC_ADMISSION_BATCH_ROWS);
    for (const row of rows) {
      if (!isGenericMemoryAdmissionAllowedFields(row)) continue;
      if (toSkip > 0) { toSkip -= 1; continue; }
      out.push(row);
      if (out.length >= take) return out;
    }
    if (rows.length < GENERIC_ADMISSION_BATCH_ROWS) return out; // exhausted: answer is exact
  }
  throw new GenericAdmissionScanIncompleteError();
}

/** Renumber `?` placeholders as `$1..$n` for pg (callers never embed a literal `?`). */
function toPgPlaceholders(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function changeRowToModel(row: Record<string, unknown>): AgentMemoryChange {
  return {
    id: row.id as string,
    memoryId: row.memory_id as string,
    memorySourceId: row.memory_source_id as string,
    action: row.action as AgentMemoryChange['action'],
    actor: row.actor as string,
    changedAt: typeof row.changed_at === 'string'
      ? row.changed_at
      : (row.changed_at as Date).toISOString(),
    priorState: JSON.parse(row.prior_state_json as string) as Record<string, unknown>,
    rollbackTarget: (row.rollback_target as string | null) ?? null,
    sourceContext: JSON.parse(
      (row.source_context_json as string | null) ?? '{}',
    ) as Record<string, unknown>,
  };
}

export class AgentMemoryRepository {
  async findLatestChangeBySourceIdAsync(
    memorySourceId: string,
  ): Promise<AgentMemoryChange | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_memory_changes
         WHERE memory_source_id = $1
         ORDER BY changed_at DESC, id DESC LIMIT 1`,
        [memorySourceId],
      );
      return result.rows[0] ? changeRowToModel(result.rows[0]) : null;
    }
    const row = getDb().prepare(
      `SELECT * FROM agent_memory_changes
       WHERE memory_source_id = ?
       ORDER BY changed_at DESC, id DESC LIMIT 1`,
    ).get(memorySourceId) as Record<string, unknown> | undefined;
    return row ? changeRowToModel(row) : null;
  }

  async appendChangeAsync(input: {
    memoryId: string;
    memorySourceId: string;
    action: AgentMemoryChange['action'];
    actor: string;
    changedAt: string;
    priorState: Record<string, unknown>;
    sourceContext: Record<string, unknown>;
  }): Promise<AgentMemoryChange> {
    const id = randomUUID();
    const priorStateJson = JSON.stringify(input.priorState);
    const sourceContextJson = JSON.stringify(input.sourceContext);
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `INSERT INTO agent_memory_changes
           (id, memory_id, memory_source_id, action, actor, changed_at,
            prior_state_json, rollback_target, source_context_json)
         SELECT $1,$2,$3,$4,$5,$6,$7,
                (
                  SELECT previous.id
                    FROM agent_memory_changes previous
                   WHERE previous.memory_source_id = $3
                   ORDER BY previous.changed_at DESC, previous.id DESC
                   LIMIT 1
                ),
                $8
         RETURNING *`,
        [
          id, input.memoryId, input.memorySourceId, input.action, input.actor,
          input.changedAt, priorStateJson, sourceContextJson,
        ],
      );
      return changeRowToModel(result.rows[0]);
    }
    getDb().prepare(
      `INSERT INTO agent_memory_changes
         (id, memory_id, memory_source_id, action, actor, changed_at,
          prior_state_json, rollback_target, source_context_json)
       SELECT ?,?,?,?,?,?,?,
              (
                SELECT previous.id
                  FROM agent_memory_changes previous
                 WHERE previous.memory_source_id = ?
                 ORDER BY previous.changed_at DESC, previous.id DESC
                 LIMIT 1
              ),
              ?`,
    ).run(
      id, input.memoryId, input.memorySourceId, input.action, input.actor,
      input.changedAt, priorStateJson, input.memorySourceId, sourceContextJson,
    );
    const row = getDb().prepare(
      `SELECT * FROM agent_memory_changes WHERE id = ?`,
    ).get(id) as Record<string, unknown>;
    return changeRowToModel(row);
  }

  async listChangesAsync(memoryId: string): Promise<AgentMemoryChange[]> {
    const memory = await this.findByIdAsync(memoryId);
    const sourceId = memory?.sourceId ?? '';
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query(
        `SELECT * FROM agent_memory_changes
         WHERE memory_id = $1 OR memory_source_id = $2
         ORDER BY changed_at ASC, id ASC`,
        [memoryId, sourceId],
      );
      return result.rows.map(changeRowToModel);
    }
    const rows = getDb().prepare(
      `SELECT * FROM agent_memory_changes
       WHERE memory_id = ? OR memory_source_id = ?
       ORDER BY changed_at ASC, id ASC`,
    ).all(memoryId, sourceId) as Record<string, unknown>[];
    return rows.map(changeRowToModel);
  }
  async createAsync(input: CreateAgentMemoryInput): Promise<AgentMemory> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const autoInjectable = input.autoInjectable
      ?? ['fact', 'preference', 'context', 'person', 'project'].includes(input.kind ?? 'fact');

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `INSERT INTO agent_memory
           (id, kind, content, source, source_id, tags_json, auto_injectable,
            owner_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, kind, content, source, source_id, tags_json,
                   status, stale_after, verified_json, sources_json,
                   generated_by, generated_at, trust_tier, auto_injectable,
                   owner_user_id, created_at, updated_at`,
        [
          id, input.kind ?? 'fact', input.content,
          input.source ?? null, input.sourceId ?? null,
          input.tagsJson ?? '[]', autoInjectable,
          input.ownerUserId ?? null, now, now,
        ],
      );
      return rowToModel(r.rows[0]);
    }

    getDb().prepare(`
      INSERT INTO agent_memory
        (id, kind, content, source, source_id, tags_json, auto_injectable,
         owner_user_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.kind ?? 'fact', input.content,
      input.source ?? null, input.sourceId ?? null,
      input.tagsJson ?? '[]', autoInjectable ? 1 : 0,
      input.ownerUserId ?? null, now, now,
    );

    // Sync FTS index
    try {
      const row = getDb().prepare(`SELECT rowid FROM agent_memory WHERE id = ?`).get(id) as { rowid: number } | undefined;
      if (row) {
        getDb().prepare(`INSERT INTO agent_memory_fts(rowid, content, kind, tags_json) VALUES (?,?,?,?)`).run(
          row.rowid, input.content, input.kind ?? 'fact', input.tagsJson ?? '[]',
        );
      }
    } catch {
      // FTS table may not exist on older DBs — non-fatal
    }

    return (await this.findByIdAsync(id))!;
  }

  async findByIdAsync(id: string): Promise<AgentMemory | null> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT id, kind, content, source, source_id, tags_json,
                status, stale_after, verified_json, sources_json,
                generated_by, generated_at, trust_tier, auto_injectable,
                owner_user_id, created_at, updated_at
         FROM agent_memory WHERE id = $1`,
        [id],
      );
      return r.rows.length > 0 ? rowToModel(r.rows[0]) : null;
    }
    const row = getDb().prepare(`
      SELECT id, kind, content, source, source_id, tags_json,
             status, stale_after, verified_json, sources_json,
             generated_by, generated_at, trust_tier, auto_injectable,
             owner_user_id, created_at, updated_at
      FROM agent_memory WHERE id = ?
    `).get(id);
    return row ? rowToModel(row as Record<string, unknown>) : null;
  }

  async searchAsync(
    query: string,
    ownerUserId?: number,
    limit = 20,
    options: MemorySearchOptions = {},
  ): Promise<AgentMemory[]> {
    if (env.dbClient === 'postgres') {
      const params: unknown[] = [query];
      const filters: string[] = [];
      if (ownerUserId != null) {
        params.push(ownerUserId);
        // Own rows plus instance-global (owner-NULL) rows: vault-synced notes
        // carry no owner and must stay retrievable by the machine's user.
        filters.push(`(owner_user_id = $${params.length} OR owner_user_id IS NULL)`);
      }
      if (options.activeOnly) {
        filters.push(`status != 'deprecated'`);
        params.push(options.today ?? new Date().toISOString().slice(0, 10));
        filters.push(`(stale_after IS NULL OR stale_after > $${params.length})`);
      }
      if (options.injectableOnly) {
        filters.push('auto_injectable = TRUE');
      }
      const extraFilters = filters.length > 0
        ? `AND ${filters.join(' AND ')}`
        : '';
      const page = async (pageLimit: number, pageOffset: number): Promise<AgentMemory[]> => {
        const pageParams = [...params, pageLimit, pageOffset];
        const r = await getPostgresPool().query(
          `SELECT id, kind, content, source, source_id, tags_json,
                  status, stale_after, verified_json, sources_json,
                  generated_by, generated_at, trust_tier, auto_injectable,
                  owner_user_id, created_at, updated_at,
                  ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
           FROM agent_memory
           WHERE search_vector @@ plainto_tsquery('english', $1) ${extraFilters}
           ORDER BY rank DESC, id ASC
           LIMIT $${pageParams.length - 1} OFFSET $${pageParams.length}`,
          pageParams,
        );
        return r.rows.map(rowToModel);
      };
      // Hosted: no SQL scalar, so admission runs over ordered finite batches
      // (explicit incomplete error at the bound; see admittedWindow).
      return options.genericAdmissionOnly
        ? admittedWindow(page, 0, limit)
        : page(limit, 0);
    }

    // SQLite: try FTS5 first, fall back to LIKE
    try {
      // Own rows plus instance-global (owner-NULL) rows — see Postgres branch.
      const ownerFilter = ownerUserId != null ? 'AND (m.owner_user_id = ? OR m.owner_user_id IS NULL)' : '';
      const activeFilter = options.activeOnly
        ? `AND m.status != 'deprecated'
           AND (m.stale_after IS NULL OR m.stale_after > ?)`
        : '';
      const injectableFilter = (options.injectableOnly
        ? 'AND m.auto_injectable = 1'
        : '') + (options.genericAdmissionOnly ? ` AND ${genericAdmissionSql('m.')}` : '');
      const params: unknown[] = [query];
      if (ownerUserId != null) params.push(ownerUserId);
      if (options.activeOnly) {
        params.push(options.today ?? new Date().toISOString().slice(0, 10));
      }
      params.push(limit);
      const rows = getDb().prepare(`
        SELECT m.id, m.kind, m.content, m.source, m.source_id, m.tags_json,
               m.status, m.stale_after, m.verified_json, m.sources_json,
               m.generated_by, m.generated_at, m.trust_tier, m.auto_injectable,
               m.owner_user_id, m.created_at, m.updated_at
        FROM agent_memory m
        JOIN agent_memory_fts f ON m.rowid = f.rowid
        WHERE agent_memory_fts MATCH ? ${ownerFilter} ${activeFilter} ${injectableFilter}
        ORDER BY rank
        LIMIT ?
      `).all(...params);
      return (rows as Record<string, unknown>[]).map(rowToModel);
    } catch {
      // FTS unavailable — fall back to LIKE
      const likeQuery = `%${query}%`;
      const ownerFilter = ownerUserId != null ? 'AND (owner_user_id = ? OR owner_user_id IS NULL)' : '';
      const activeFilter = options.activeOnly
        ? `AND status != 'deprecated'
           AND (stale_after IS NULL OR stale_after > ?)`
        : '';
      const injectableFilter = (options.injectableOnly
        ? 'AND auto_injectable = 1'
        : '') + (options.genericAdmissionOnly ? ` AND ${genericAdmissionSql()}` : '');
      const params: unknown[] = [likeQuery];
      if (ownerUserId != null) params.push(ownerUserId);
      if (options.activeOnly) {
        params.push(options.today ?? new Date().toISOString().slice(0, 10));
      }
      params.push(limit);
      const rows = getDb().prepare(
        `SELECT id, kind, content, source, source_id, tags_json,
                status, stale_after, verified_json, sources_json,
                generated_by, generated_at, trust_tier, auto_injectable,
                owner_user_id, created_at, updated_at
         FROM agent_memory
         WHERE content LIKE ? ${ownerFilter} ${activeFilter} ${injectableFilter}
         LIMIT ?`,
      ).all(...params);
      return (rows as Record<string, unknown>[]).map(rowToModel);
    }
  }

  /** Exact source-id lookup; canonical vault rows may be instance-global. */
  async findBySourceIdsAsync(source: string, sourceIds: string[], ownerUserId?: number): Promise<AgentMemory[]> {
    if (sourceIds.length === 0) return [];
    if (env.dbClient === 'postgres') {
      const params: unknown[] = [source, sourceIds];
      const ownerFilter = ownerUserId == null
        ? 'AND owner_user_id IS NULL'
        : source === 'obsidian-memory'
          ? 'AND (owner_user_id = $3 OR owner_user_id IS NULL)'
          : 'AND owner_user_id = $3';
      if (ownerUserId != null) params.push(ownerUserId);
      const r = await getPostgresPool().query(
        `SELECT id, kind, content, source, source_id, tags_json,
                status, stale_after, verified_json, sources_json,
                generated_by, generated_at, trust_tier, auto_injectable,
                owner_user_id, created_at, updated_at
         FROM agent_memory WHERE source = $1 AND source_id = ANY($2::text[]) ${ownerFilter}`,
        params,
      );
      return r.rows.map(rowToModel);
    }

    const placeholders = sourceIds.map(() => '?').join(',');
    const ownerFilter = ownerUserId == null
      ? 'AND owner_user_id IS NULL'
      : source === 'obsidian-memory'
        ? 'AND (owner_user_id = ? OR owner_user_id IS NULL)'
        : 'AND owner_user_id = ?';
    const params: unknown[] = [source, ...sourceIds];
    if (ownerUserId != null) params.push(ownerUserId);
    const rows = getDb().prepare(
      `SELECT id, kind, content, source, source_id, tags_json,
              status, stale_after, verified_json, sources_json,
              generated_by, generated_at, trust_tier, auto_injectable,
              owner_user_id, created_at, updated_at
       FROM agent_memory WHERE source = ? AND source_id IN (${placeholders}) ${ownerFilter}`,
    ).all(...params);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  /**
   * Reclaim a canonical vault projection only after a caller has independently
   * verified its immutable source receipt. Generic startup rebuilds create
   * null-owner rows, so this narrow CAS restores the owner without ever
   * overwriting a foreign owner.
   */
  async claimOwnerForSourceIfNull(source: string, sourceId: string, ownerUserId: number): Promise<boolean> {
    if (source !== 'obsidian-memory' || typeof sourceId !== 'string' || sourceId.length === 0 ||
        sourceId.length > 512 || !Number.isSafeInteger(ownerUserId) || ownerUserId <= 0) {
      throw new Error('Invalid canonical owner claim');
    }
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE agent_memory SET owner_user_id = $3
         WHERE source = $1 AND source_id = $2 AND owner_user_id IS NULL`,
        [source, sourceId, ownerUserId],
      );
      const row = await getPostgresPool().query(
        `SELECT owner_user_id FROM agent_memory WHERE source = $1 AND source_id = $2 LIMIT 1`,
        [source, sourceId],
      );
      return row.rows.length === 1 && row.rows[0].owner_user_id === ownerUserId;
    }
    getDb().prepare(`UPDATE agent_memory SET owner_user_id = ?
      WHERE source = ? AND source_id = ? AND owner_user_id IS NULL`).run(ownerUserId, source, sourceId);
    const row = getDb().prepare(`SELECT owner_user_id FROM agent_memory
      WHERE source = ? AND source_id = ? LIMIT 1`).get(source, sourceId) as { owner_user_id: number | null } | undefined;
    return row?.owner_user_id === ownerUserId;
  }

  /**
   * List order: non-deprecated first, then most recently updated, then id.
   * `includeDeprecated` defaults to true here so internal full-scan callers
   * keep seeing every row; the HTTP list endpoint opts out by default.
   */
  async listAsync(
    ownerUserId?: number,
    kind?: string,
    limit = 50,
    options: MemoryListOptions = {},
  ): Promise<AgentMemory[]> {
    const { where, params } = this._listFilters(
      ownerUserId, kind, options.includeDeprecated ?? true, options.genericAdmissionOnly,
    );
    const order = `ORDER BY CASE WHEN status = 'deprecated' THEN 1 ELSE 0 END,
                   updated_at DESC, id ASC`;
    const columns = `id, kind, content, source, source_id, tags_json,
                status, stale_after, verified_json, sources_json,
                generated_by, generated_at, trust_tier, auto_injectable,
                owner_user_id, created_at, updated_at`;
    if (env.dbClient === 'postgres') {
      const page = async (pageLimit: number, pageOffset: number): Promise<AgentMemory[]> => {
        const r = await getPostgresPool().query(
          toPgPlaceholders(
            `SELECT ${columns} FROM agent_memory ${where} ${order} LIMIT ? OFFSET ?`,
          ),
          [...params, pageLimit, pageOffset],
        );
        return r.rows.map(rowToModel);
      };
      return options.genericAdmissionOnly
        ? admittedWindow(page, Math.max(0, options.offset ?? 0), limit)
        : page(limit, Math.max(0, options.offset ?? 0));
    }
    params.push(limit, Math.max(0, options.offset ?? 0));
    const rows = getDb().prepare(
      `SELECT ${columns} FROM agent_memory ${where} ${order} LIMIT ? OFFSET ?`,
    ).all(...params);
    return (rows as Record<string, unknown>[]).map(rowToModel);
  }

  /** Row counts per kind under the same owner/deprecated filters as listAsync. */
  async countByKindAsync(
    ownerUserId?: number,
    includeDeprecated = true,
    genericAdmissionOnly = false,
  ): Promise<Record<string, number>> {
    const { where, params } = this._listFilters(ownerUserId, undefined, includeDeprecated, genericAdmissionOnly);
    if (env.dbClient === 'postgres' && genericAdmissionOnly) {
      // Exact count of the admitted collection or an explicit incomplete error.
      const counts: Record<string, number> = {};
      let exhausted = false;
      for (let batch = 0; batch < GENERIC_ADMISSION_MAX_BATCHES && !exhausted; batch += 1) {
        const r = await getPostgresPool().query(
          toPgPlaceholders(`SELECT kind, source, tags_json, sources_json FROM agent_memory ${where}
            ORDER BY id ASC LIMIT ? OFFSET ?`),
          [...params, GENERIC_ADMISSION_BATCH_ROWS, batch * GENERIC_ADMISSION_BATCH_ROWS],
        );
        for (const row of r.rows as Array<Record<string, unknown>>) {
          if (!isGenericMemoryAdmissionAllowedFields({
            source: row.source as string | null,
            tagsJson: row.tags_json as string | null,
            sourcesJson: row.sources_json as string | null,
          })) continue;
          counts[String(row.kind)] = (counts[String(row.kind)] ?? 0) + 1;
        }
        exhausted = r.rows.length < GENERIC_ADMISSION_BATCH_ROWS;
      }
      if (!exhausted) throw new GenericAdmissionScanIncompleteError();
      return counts;
    }
    const sql = `SELECT kind, COUNT(*) AS n FROM agent_memory ${where} GROUP BY kind`;
    const rows = env.dbClient === 'postgres'
      ? (await getPostgresPool().query(toPgPlaceholders(sql), params)).rows
      : getDb().prepare(sql).all(...params) as Record<string, unknown>[];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[String(row.kind)] = Number(row.n);
    return counts;
  }

  /** Shared WHERE clause, written with `?` placeholders (Postgres renumbers). */
  private _listFilters(
    ownerUserId: number | undefined,
    kind: string | undefined,
    includeDeprecated: boolean,
    genericAdmissionOnly = false,
  ): { where: string; params: unknown[] } {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (ownerUserId != null) {
      // Vault-synced notes are instance-global (owner NULL). Authenticated
      // readers must see those alongside their own private rows.
      conditions.push('(owner_user_id = ? OR owner_user_id IS NULL)');
      params.push(ownerUserId);
    }
    if (kind) { conditions.push('kind = ?'); params.push(kind); }
    if (!includeDeprecated) conditions.push(`status != 'deprecated'`);
    // SQLite decides membership in SQL via the registered scalar; PostgreSQL
    // applies the same policy in JS over finite batches (see admittedWindow).
    if (genericAdmissionOnly && env.dbClient !== 'postgres') conditions.push(genericAdmissionSql());
    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
      params,
    };
  }

  /**
   * Issue #770 WI6 — mirror-sync upsert keyed on (source, source_id).
   *
   * Idempotent: if a row with the same (source, source_id) already exists it is
   * UPDATED in place (preserving its id and created_at); otherwise a new row is
   * inserted. Returns `true` when a new row was inserted, `false` when an
   * existing row was updated (lets callers count net upserts vs. touches if
   * needed — both count as "upserted" for the sync summary).
   *
   * Keeps the SQLite FTS5 index in sync on both paths.
   */
  async upsertBySourceAsync(input: {
    kind: string;
    content: string;
    source: string;
    sourceId: string;
    tagsJson: string;
    status?: MemoryStatus;
    staleAfter?: string | null;
    verifiedJson?: string;
    sourcesJson?: string;
    generatedBy?: string | null;
    generatedAt?: string | null;
    trustTier?: MemoryTrustTier;
    autoInjectable?: boolean;
    ownerUserId?: number | null;
    /** Note's own dates (frontmatter / file stat); default = now. An existing row keeps its created_at. */
    createdAt?: string;
    updatedAt?: string;
  }): Promise<boolean> {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? input.createdAt ?? now;

    if (env.dbClient === 'postgres') {
      const existing = await getPostgresPool().query(
        `SELECT id FROM agent_memory WHERE source = $1 AND source_id = $2 LIMIT 1`,
        [input.source, input.sourceId],
      );
      if (existing.rows.length > 0) {
        await getPostgresPool().query(
          `UPDATE agent_memory
             SET kind = $1, content = $2, tags_json = $3,
                 status = $4, stale_after = $5, verified_json = $6,
                 sources_json = $7, generated_by = $8, generated_at = $9,
                 trust_tier = $10, auto_injectable = $11, updated_at = $12
           WHERE id = $13`,
          [
            input.kind, input.content, input.tagsJson,
            input.status ?? 'stable', input.staleAfter ?? null,
            input.verifiedJson ?? '[]', input.sourcesJson ?? '[]',
            input.generatedBy ?? null, input.generatedAt ?? null,
            input.trustTier ?? 'unverified', input.autoInjectable ?? false,
            updatedAt, existing.rows[0].id,
          ],
        );
        return false;
      }
      const id = randomUUID();
      await getPostgresPool().query(
        `INSERT INTO agent_memory
           (id, kind, content, source, source_id, tags_json,
            status, stale_after, verified_json, sources_json,
            generated_by, generated_at, trust_tier, auto_injectable,
            owner_user_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id, input.kind, input.content, input.source, input.sourceId,
          input.tagsJson, input.status ?? 'stable', input.staleAfter ?? null,
          input.verifiedJson ?? '[]', input.sourcesJson ?? '[]',
          input.generatedBy ?? null, input.generatedAt ?? null,
          input.trustTier ?? 'unverified', input.autoInjectable ?? false,
          input.ownerUserId ?? null, createdAt, updatedAt,
        ],
      );
      return true;
    }

    const existing = getDb()
      .prepare(`SELECT rowid, id, content, kind, tags_json FROM agent_memory WHERE source = ? AND source_id = ? LIMIT 1`)
      .get(input.source, input.sourceId) as
        | { rowid: number; id: string; content: string; kind: string; tags_json: string }
        | undefined;

    if (existing) {
      // External-content FTS5 requires the OLD column values to delete the
      // index entry; read them BEFORE updating the base row.
      this._ftsDelete(existing.rowid, existing.content, existing.kind, existing.tags_json);
      getDb().prepare(`
        UPDATE agent_memory
           SET kind = ?, content = ?, tags_json = ?,
               status = ?, stale_after = ?, verified_json = ?, sources_json = ?,
               generated_by = ?, generated_at = ?, trust_tier = ?,
               auto_injectable = ?, updated_at = ?
         WHERE id = ?
      `).run(
        input.kind,
        input.content,
        input.tagsJson,
        input.status ?? 'stable',
        input.staleAfter ?? null,
        input.verifiedJson ?? '[]',
        input.sourcesJson ?? '[]',
        input.generatedBy ?? null,
        input.generatedAt ?? null,
        input.trustTier ?? 'unverified',
        input.autoInjectable ? 1 : 0,
        updatedAt,
        existing.id,
      );
      this._ftsInsert(existing.rowid, input.content, input.kind, input.tagsJson);
      return false;
    }

    const id = randomUUID();
    getDb().prepare(`
      INSERT INTO agent_memory
        (id, kind, content, source, source_id, tags_json,
         status, stale_after, verified_json, sources_json,
         generated_by, generated_at, trust_tier, auto_injectable,
         owner_user_id, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.kind, input.content, input.source, input.sourceId,
      input.tagsJson,
      input.status ?? 'stable',
      input.staleAfter ?? null,
      input.verifiedJson ?? '[]',
      input.sourcesJson ?? '[]',
      input.generatedBy ?? null,
      input.generatedAt ?? null,
      input.trustTier ?? 'unverified',
      input.autoInjectable ? 1 : 0,
      input.ownerUserId ?? null,
      createdAt,
      updatedAt,
    );
    const inserted = getDb()
      .prepare(`SELECT rowid FROM agent_memory WHERE id = ?`)
      .get(id) as { rowid: number } | undefined;
    if (inserted) {
      this._ftsInsert(inserted.rowid, input.content, input.kind, input.tagsJson);
    }
    return true;
  }

  /** List the distinct source_id values currently stored for a given source. */
  async listSourceIdsBySourceAsync(source: string): Promise<string[]> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `SELECT source_id FROM agent_memory WHERE source = $1 AND source_id IS NOT NULL`,
        [source],
      );
      return r.rows.map((row) => row.source_id as string);
    }
    const rows = getDb()
      .prepare(`SELECT source_id FROM agent_memory WHERE source = ? AND source_id IS NOT NULL`)
      .all(source) as { source_id: string }[];
    return rows.map((row) => row.source_id);
  }

  /**
   * Tombstone cleanup: delete rows for a given source whose source_id is in the
   * supplied list. Returns the number of rows deleted. Keeps FTS in sync.
   */
  async deleteBySourceAndSourceIdsAsync(source: string, sourceIds: string[]): Promise<number> {
    if (sourceIds.length === 0) return 0;

    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(
        `DELETE FROM agent_memory WHERE source = $1 AND source_id = ANY($2::text[])`,
        [source, sourceIds],
      );
      return r.rowCount ?? 0;
    }

    let deleted = 0;
    const selectStmt = getDb().prepare(
      `SELECT id, rowid, content, kind, tags_json FROM agent_memory WHERE source = ? AND source_id = ?`,
    );
    const deleteStmt = getDb().prepare(`DELETE FROM agent_memory WHERE id = ?`);
    for (const sourceId of sourceIds) {
      const row = selectStmt.get(source, sourceId) as
        | { id: string; rowid: number; content: string; kind: string; tags_json: string }
        | undefined;
      if (!row) continue;
      this._ftsDelete(row.rowid, row.content, row.kind, row.tags_json);
      const r = deleteStmt.run(row.id);
      deleted += r.changes;
    }
    return deleted;
  }

  /**
   * Issue #802 — wipe the entire local SQLite index in one shot.
   *
   * The SQLite `agent_memory` + `agent_memory_fts` store is a DERIVED,
   * DISPOSABLE cache that MemoryIndexService rebuilds from a full vault scan,
   * so a total clear is a legitimate operation. Returns the number of rows
   * removed. Keeps the FTS index consistent by rebuilding it from the (now
   * empty) base table.
   *
   * SQLite-only: the index lives only in SQLite. On Postgres this is a no-op
   * (returns 0). #807 removed the prod/Postgres `agent_memory` store entirely —
   * agent memory is local-vault/SQLite-only now — so the Postgres branches in
   * this repository are inert dead paths the local agent server never reaches.
   */
  async clearAllAsync(): Promise<number> {
    if (env.dbClient === 'postgres') return 0;

    const countRow = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_memory`).get() as
      | { n: number }
      | undefined;
    const before = countRow?.n ?? 0;

    getDb().prepare(`DELETE FROM agent_memory`).run();
    // External-content FTS5: the special 'delete-all' command empties the index
    // without needing each row's old column values.
    try {
      getDb().prepare(`INSERT INTO agent_memory_fts(agent_memory_fts) VALUES ('delete-all')`).run();
    } catch {
      // FTS table may not exist on older DBs — non-fatal.
    }
    return before;
  }

  /**
   * SQLite-only helper: insert an FTS5 index row. External-content FTS5
   * (content='agent_memory') tolerates a plain INSERT with explicit columns.
   */
  private _ftsInsert(rowid: number, content: string, kind: string, tagsJson: string): void {
    try {
      getDb()
        .prepare(`INSERT INTO agent_memory_fts(rowid, content, kind, tags_json) VALUES (?,?,?,?)`)
        .run(rowid, content, kind, tagsJson);
    } catch {
      // FTS table may not exist on older DBs — non-fatal
    }
  }

  /**
   * SQLite-only helper: remove an FTS5 index row. External-content FTS5 does
   * NOT support a plain `DELETE FROM ... WHERE rowid = ?` (it corrupts the
   * index — SQLITE_CORRUPT_VTAB). The supported form is the special 'delete'
   * command, which requires the OLD column values that were indexed.
   */
  private _ftsDelete(rowid: number, content: string, kind: string, tagsJson: string): void {
    try {
      getDb()
        .prepare(
          `INSERT INTO agent_memory_fts(agent_memory_fts, rowid, content, kind, tags_json) VALUES ('delete', ?, ?, ?, ?)`,
        )
        .run(rowid, content, kind, tagsJson);
    } catch {
      // FTS table may not exist on older DBs — non-fatal
    }
  }

  async deleteAsync(id: string): Promise<boolean> {
    if (env.dbClient === 'postgres') {
      const r = await getPostgresPool().query(`DELETE FROM agent_memory WHERE id = $1`, [id]);
      return (r.rowCount ?? 0) > 0;
    }
    const row = getDb().prepare(`SELECT rowid FROM agent_memory WHERE id = ?`).get(id) as { rowid: number } | undefined;
    if (row) {
      try { getDb().prepare(`DELETE FROM agent_memory_fts WHERE rowid = ?`).run(row.rowid); } catch { /* FTS may not exist */ }
    }
    const r = getDb().prepare(`DELETE FROM agent_memory WHERE id = ?`).run(id);
    return r.changes > 0;
  }
}
