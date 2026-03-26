import { getDb } from '../database/db';
import {
  defaultPlanningCenterTaskPreferences,
  type PlanningCenterTaskPreferences,
} from '../models/planning_center_task_preferences';

interface PreferenceRow {
  provider: string;
  key: string;
  json_value: string;
}

const PCO_PROVIDER = 'planning_center';
const PCO_TASK_FILTERS_KEY = 'task_filters';

export class IntegrationPreferencesRepository {
  getPlanningCenterTaskPreferences(): PlanningCenterTaskPreferences {
    const row = getDb()
      .prepare(
        'SELECT * FROM integration_preferences WHERE provider = ? AND key = ? LIMIT 1',
      )
      .get(PCO_PROVIDER, PCO_TASK_FILTERS_KEY) as PreferenceRow | undefined;

    if (!row) return defaultPlanningCenterTaskPreferences;

    try {
      const parsed = JSON.parse(row.json_value) as Partial<PlanningCenterTaskPreferences>;
      return {
        teamIds: Array.isArray(parsed.teamIds)
          ? parsed.teamIds.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
        positionNames: Array.isArray(parsed.positionNames)
          ? parsed.positionNames.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
      };
    } catch {
      return defaultPlanningCenterTaskPreferences;
    }
  }

  savePlanningCenterTaskPreferences(
    preferences: PlanningCenterTaskPreferences,
  ): PlanningCenterTaskPreferences {
    const normalized: PlanningCenterTaskPreferences = {
      teamIds: [...new Set(preferences.teamIds.map((value) => value.trim()).filter((value) => value.length > 0))],
      positionNames: [...new Set(preferences.positionNames.map((value) => value.trim()).filter((value) => value.length > 0))],
    };

    getDb()
      .prepare(
        `INSERT INTO integration_preferences (provider, key, json_value)
         VALUES (?, ?, ?)
         ON CONFLICT(provider, key) DO UPDATE SET json_value = excluded.json_value`,
      )
      .run(PCO_PROVIDER, PCO_TASK_FILTERS_KEY, JSON.stringify(normalized));

    return normalized;
  }
}
