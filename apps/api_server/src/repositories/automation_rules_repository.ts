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
  trigger_config: string | null;
  action_type: string;
  action_config: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function rowToRule(row: AutomationRuleRow): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    triggerType: row.trigger_type as AutomationRule['triggerType'],
    triggerConfig: row.trigger_config ? JSON.parse(row.trigger_config) : null,
    actionType: row.action_type as AutomationRule['actionType'],
    actionConfig: row.action_config ? JSON.parse(row.action_config) : null,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AutomationRulesRepository {
  findAll(): AutomationRule[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM automation_rules ORDER BY created_at ASC',
      )
      .all() as AutomationRuleRow[];
    return rows.map(rowToRule);
  }

  findById(id: string): AutomationRule {
    const row = getDb()
      .prepare('SELECT * FROM automation_rules WHERE id = ?')
      .get(id) as AutomationRuleRow | undefined;
    if (!row) throw AppError.notFound('AutomationRule');
    return rowToRule(row);
  }

  create(dto: CreateAutomationRuleDto): AutomationRule {
    const id = uuidv4();
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO automation_rules
         (id, name, trigger_type, trigger_config, action_type, action_config, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        dto.name,
        dto.triggerType,
        dto.triggerConfig ? JSON.stringify(dto.triggerConfig) : null,
        dto.actionType,
        dto.actionConfig ? JSON.stringify(dto.actionConfig) : null,
        dto.enabled !== false ? 1 : 0,
        now,
        now,
      );
    return this.findById(id);
  }

  update(id: string, dto: UpdateAutomationRuleDto): AutomationRule {
    const existing = this.findById(id);
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE automation_rules
         SET name = ?, trigger_type = ?, trigger_config = ?,
             action_type = ?, action_config = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        dto.name ?? existing.name,
        dto.triggerType ?? existing.triggerType,
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
        dto.enabled !== undefined ? (dto.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
        now,
        id,
      );
    return this.findById(id);
  }

  delete(id: string): void {
    this.findById(id); // throws NOT_FOUND if missing
    getDb().prepare('DELETE FROM automation_rules WHERE id = ?').run(id);
  }
}
