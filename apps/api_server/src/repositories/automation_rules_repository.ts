import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../database/db';
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
  return {
    id: row.id,
    name: row.name,
    source: (row.source ?? 'rhythm') as AutomationRule['source'],
    triggerKey: (row.trigger_key ?? row.trigger_type) as AutomationRule['triggerKey'],
    triggerConfig: row.trigger_config ? JSON.parse(row.trigger_config) : null,
    actionType: row.action_type as AutomationRule['actionType'],
    actionConfig: row.action_config ? JSON.parse(row.action_config) : null,
    enabled: row.enabled === 1,
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
  findAll(userId?: number): AutomationRule[] {
    const rows = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM automation_rules
             WHERE owner_id = ? OR owner_id IS NULL
             ORDER BY created_at ASC`,
          )
          .all(userId)
      : getDb()
          .prepare('SELECT * FROM automation_rules ORDER BY created_at ASC')
          .all()) as AutomationRuleRow[];
    return rows.map(rowToRule);
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

  findById(id: string, userId?: number): AutomationRule {
    const row = (userId != null
      ? getDb()
          .prepare(
            `SELECT * FROM automation_rules
             WHERE id = ? AND (owner_id = ? OR owner_id IS NULL)`,
          )
          .get(id, userId)
      : getDb()
          .prepare('SELECT * FROM automation_rules WHERE id = ?')
          .get(id)) as AutomationRuleRow | undefined;
    if (!row) throw AppError.notFound('AutomationRule');
    return rowToRule(row);
  }

  create(dto: CreateAutomationRuleDto): AutomationRule {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO automation_rules
         (id, name, trigger_type, source, trigger_key, trigger_config, action_type, action_config, enabled, owner_id, source_account_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        dto.enabled !== false ? 1 : 0,
        dto.ownerId ?? null,
        dto.sourceAccountId ?? null,
        now,
        now,
      );
    return this.findById(id, dto.ownerId ?? undefined);
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
             action_type = ?, action_config = ?, enabled = ?, owner_id = ?, source_account_id = ?, updated_at = ?
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

  delete(id: string, userId?: number): void {
    this.findById(id, userId);
    getDb().prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
  }
}
