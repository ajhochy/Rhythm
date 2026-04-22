import { env } from '../config/env';
import { v4 as uuidv4 } from 'uuid';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  AutomationRule,
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
} from '../models/automation_rule';

interface AutomationRuleRow {
  id: string;
  name: string;
  trigger_type: string;
  source: string | null;
  trigger_key: string | null;
  trigger_config: string | null;
  action_type: string;
  action_config: string | null;
  conditions: string | null;
  enabled: number;
  owner_id: number | null;
  source_account_id: string | null;
  last_evaluated_at: string | null;
  last_matched_at: string | null;
  match_count_last_run: number;
  preview_sample: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRule(row: AutomationRuleRow): AutomationRule {
  const enabled =
    typeof row.enabled === 'boolean' ? row.enabled : row.enabled === 1;

  return {
    id: row.id,
    name: row.name,
    source: (row.source ?? 'rhythm') as AutomationRule['source'],
    triggerKey: (row.trigger_key ?? row.trigger_type) as AutomationRule['triggerKey'],
    triggerConfig: row.trigger_config ? JSON.parse(row.trigger_config) : null,
    actionType: row.action_type as AutomationRule['actionType'],
    actionConfig: row.action_config ? JSON.parse(row.action_config) : null,
    conditions: row.conditions ? JSON.parse(row.conditions) : null,
    enabled,
    ownerId: row.owner_id,
    sourceAccountId: row.source_account_id,
    lastEvaluatedAt: row.last_evaluated_at,
    lastMatchedAt: row.last_matched_at,
    matchCountLastRun: row.match_count_last_run ?? 0,
    previewSample: row.preview_sample ? JSON.parse(row.preview_sample) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationRulesRepository {
  async findAllAsync(userId?: number): Promise<AutomationRule[]> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<AutomationRuleRow>(
              `SELECT * FROM automation_rules
               WHERE owner_id = $1
               ORDER BY created_at ASC`,
              [userId],
            )
          : await getPostgresPool().query<AutomationRuleRow>(
              'SELECT * FROM automation_rules ORDER BY created_at ASC',
            );
      return result.rows.map(rowToRule);
    }
    return this.findAll(userId);
  }

  findAll(userId?: number): AutomationRule[] {
    const rows = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM automation_rules
             WHERE owner_id = ?
             ORDER BY created_at ASC`,
          )
          .all(userId)
      : getDb()
          .prepare('SELECT * FROM automation_rules ORDER BY created_at ASC')
          .all()) as AutomationRuleRow[];
    return rows.map(rowToRule);
  }

  async findEnabledBySourceAsync(
    source: AutomationRule['source'],
  ): Promise<AutomationRule[]> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<AutomationRuleRow>(
        `SELECT * FROM automation_rules
         WHERE enabled = true AND source = $1
         ORDER BY created_at ASC`,
        [source],
      );
      return result.rows.map(rowToRule);
    }
    return this.findEnabledBySource(source);
  }

  findEnabledBySource(source: AutomationRule['source']): AutomationRule[] {
    const rows = getDb()
      .prepare(
        `SELECT * FROM automation_rules
         WHERE enabled = 1 AND source = ?
         ORDER BY created_at ASC`,
      )
      .all(source) as AutomationRuleRow[];
    return rows.map(rowToRule);
  }

  async findByIdAsync(id: string, userId?: number): Promise<AutomationRule> {
    if (env.dbClient === 'postgres') {
      const result =
        userId != null
          ? await getPostgresPool().query<AutomationRuleRow>(
              `SELECT * FROM automation_rules
               WHERE id = $1 AND owner_id = $2`,
              [id, userId],
            )
          : await getPostgresPool().query<AutomationRuleRow>(
              'SELECT * FROM automation_rules WHERE id = $1',
              [id],
            );
      const row = result.rows[0];
      if (!row) throw AppError.notFound('AutomationRule');
      return rowToRule(row);
    }
    return this.findById(id, userId);
  }

  findById(id: string, userId?: number): AutomationRule {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM automation_rules
             WHERE id = ? AND owner_id = ?`,
          )
          .get(id, userId)
      : getDb()
          .prepare('SELECT * FROM automation_rules WHERE id = ?')
          .get(id)) as AutomationRuleRow | undefined;
    if (!row) throw AppError.notFound('AutomationRule');
    return rowToRule(row);
  }

  async createAsync(dto: CreateAutomationRuleDto): Promise<AutomationRule> {
    if (env.dbClient === 'postgres') {
      const id = uuidv4();
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `INSERT INTO automation_rules
         (id, name, trigger_type, source, trigger_key, trigger_config, action_type, action_config, conditions, enabled, owner_id, source_account_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          id,
          dto.name,
          dto.triggerKey,
          dto.source,
          dto.triggerKey,
          dto.triggerConfig ? JSON.stringify(dto.triggerConfig) : null,
          dto.actionType,
          dto.actionConfig ? JSON.stringify(dto.actionConfig) : null,
          dto.conditions ? JSON.stringify(dto.conditions) : null,
          dto.enabled !== false,
          dto.ownerId ?? null,
          dto.sourceAccountId ?? null,
          now,
          now,
        ],
      );
      return this.findByIdAsync(id, dto.ownerId ?? undefined);
    }
    return this.create(dto);
  }

  create(dto: CreateAutomationRuleDto): AutomationRule {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO automation_rules
         (id, name, trigger_type, source, trigger_key, trigger_config, action_type, action_config, conditions, enabled, owner_id, source_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        dto.name,
        dto.triggerKey,
        dto.source,
        dto.triggerKey,
        dto.triggerConfig ? JSON.stringify(dto.triggerConfig) : null,
        dto.actionType,
        dto.actionConfig ? JSON.stringify(dto.actionConfig) : null,
        dto.conditions ? JSON.stringify(dto.conditions) : null,
        dto.enabled !== false ? 1 : 0,
        dto.ownerId ?? null,
        dto.sourceAccountId ?? null,
        now,
        now,
      );
    return this.findById(id, dto.ownerId ?? undefined);
  }

  async updateAsync(
    id: string,
    dto: UpdateAutomationRuleDto,
    userId?: number,
  ): Promise<AutomationRule> {
    if (env.dbClient === 'postgres') {
      const existing = await this.findByIdAsync(id, userId);
      const now = new Date().toISOString();
      await getPostgresPool().query(
        `UPDATE automation_rules
         SET name = $1, trigger_type = $2, source = $3, trigger_key = $4, trigger_config = $5,
             action_type = $6, action_config = $7, conditions = $8, enabled = $9, owner_id = $10, source_account_id = $11, updated_at = $12
         WHERE id = $13`,
        [
          dto.name ?? existing.name,
          dto.triggerKey ?? existing.triggerKey,
          dto.source ?? existing.source,
          dto.triggerKey ?? existing.triggerKey,
          'triggerConfig' in dto
            ? dto.triggerConfig
              ? JSON.stringify(dto.triggerConfig)
              : null
            : existing.triggerConfig
              ? JSON.stringify(existing.triggerConfig)
              : null,
          dto.actionType ?? existing.actionType,
          'actionConfig' in dto
            ? dto.actionConfig
              ? JSON.stringify(dto.actionConfig)
              : null
            : existing.actionConfig
              ? JSON.stringify(existing.actionConfig)
              : null,
          'conditions' in dto
            ? dto.conditions
              ? JSON.stringify(dto.conditions)
              : null
            : existing.conditions
              ? JSON.stringify(existing.conditions)
              : null,
          dto.enabled !== undefined ? dto.enabled : existing.enabled,
          dto.ownerId !== undefined ? dto.ownerId : existing.ownerId,
          dto.sourceAccountId !== undefined
            ? dto.sourceAccountId
            : existing.sourceAccountId,
          now,
          id,
        ],
      );
      return this.findByIdAsync(id, userId);
    }
    return this.update(id, dto, userId);
  }

  update(
    id: string,
    dto: UpdateAutomationRuleDto,
    userId?: number,
  ): AutomationRule {
    const existing = this.findById(id, userId);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE automation_rules
         SET name = ?, trigger_type = ?, source = ?, trigger_key = ?, trigger_config = ?,
             action_type = ?, action_config = ?, conditions = ?, enabled = ?, owner_id = ?, source_account_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        dto.name ?? existing.name,
        dto.triggerKey ?? existing.triggerKey,
        dto.source ?? existing.source,
        dto.triggerKey ?? existing.triggerKey,
        'triggerConfig' in dto
          ? dto.triggerConfig
            ? JSON.stringify(dto.triggerConfig)
            : null
          : existing.triggerConfig
            ? JSON.stringify(existing.triggerConfig)
            : null,
        dto.actionType ?? existing.actionType,
        'actionConfig' in dto
          ? dto.actionConfig
            ? JSON.stringify(dto.actionConfig)
            : null
          : existing.actionConfig
            ? JSON.stringify(existing.actionConfig)
            : null,
        'conditions' in dto
          ? dto.conditions
            ? JSON.stringify(dto.conditions)
            : null
          : existing.conditions
            ? JSON.stringify(existing.conditions)
            : null,
        dto.enabled !== undefined
          ? dto.enabled
            ? 1
            : 0
          : existing.enabled
            ? 1
            : 0,
        dto.ownerId !== undefined ? dto.ownerId : existing.ownerId,
        dto.sourceAccountId !== undefined
          ? dto.sourceAccountId
          : existing.sourceAccountId,
        now,
        id,
      );
    return this.findById(id, userId);
  }

  async updateEvaluationAsync(
    id: string,
    data: {
      lastEvaluatedAt: string;
      lastMatchedAt: string | null;
      matchCountLastRun: number;
      previewSample: Record<string, unknown> | null;
    },
  ): Promise<void> {
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `UPDATE automation_rules
         SET last_evaluated_at = $1, last_matched_at = $2, match_count_last_run = $3, preview_sample = $4, updated_at = $5
         WHERE id = $6`,
        [
          data.lastEvaluatedAt,
          data.lastMatchedAt,
          data.matchCountLastRun,
          data.previewSample ? JSON.stringify(data.previewSample) : null,
          new Date().toISOString(),
          id,
        ],
      );
      return;
    }
    this.updateEvaluation(id, data);
  }

  updateEvaluation(
    id: string,
    data: {
      lastEvaluatedAt: string;
      lastMatchedAt: string | null;
      matchCountLastRun: number;
      previewSample: Record<string, unknown> | null;
    },
  ): void {
    getDb()
      .prepare(
        `UPDATE automation_rules
         SET last_evaluated_at = ?, last_matched_at = ?, match_count_last_run = ?, preview_sample = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        data.lastEvaluatedAt,
        data.lastMatchedAt,
        data.matchCountLastRun,
        data.previewSample ? JSON.stringify(data.previewSample) : null,
        new Date().toISOString(),
        id,
      );
  }

  async deleteAsync(id: string, userId?: number): Promise<void> {
    if (env.dbClient === 'postgres') {
      await this.findByIdAsync(id, userId);
      await getPostgresPool().query('DELETE FROM automation_rules WHERE id = $1', [
        id,
      ]);
      return;
    }
    this.delete(id, userId);
  }

  delete(id: string, userId?: number): void {
    this.findById(id, userId);
    getDb().prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
  }
}
