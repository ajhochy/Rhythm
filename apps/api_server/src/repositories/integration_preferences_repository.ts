import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import {
  type GoogleCalendarPreferences,
} from '../models/google_calendar_preferences';
import {
  defaultPlanningCenterTaskPreferences,
  type PlanningCenterTaskPreferences,
} from '../models/planning_center_task_preferences';

interface PreferenceRow {
  owner_id: number | null;
  provider: string;
  key: string;
  json_value: string;
}

const PCO_PROVIDER = 'planning_center';
const PCO_TASK_FILTERS_KEY = 'task_filters';
const GOOGLE_PROVIDER = 'google_calendar';
const GOOGLE_SELECTED_CALENDARS_KEY = 'selected_calendar_ids';

function normalizePlanningCenterTaskPreferences(
  preferences: PlanningCenterTaskPreferences,
): PlanningCenterTaskPreferences {
  return {
    teamIds: [...new Set(preferences.teamIds.map((value) => value.trim()).filter((value) => value.length > 0))],
    positionNames: [...new Set(preferences.positionNames.map((value) => value.trim()).filter((value) => value.length > 0))],
  };
}

function normalizeGoogleCalendarPreferences(
  preferences: GoogleCalendarPreferences,
): GoogleCalendarPreferences {
  return {
    selectedCalendarIds: [
      ...new Set(
        preferences.selectedCalendarIds
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    ],
  };
}

export class IntegrationPreferencesRepository {
  async getPlanningCenterTaskPreferencesAsync(
    ownerId: number,
  ): Promise<PlanningCenterTaskPreferences> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<PreferenceRow>(
        'SELECT * FROM integration_preferences WHERE owner_id = $1 AND provider = $2 AND key = $3 LIMIT 1',
        [ownerId, PCO_PROVIDER, PCO_TASK_FILTERS_KEY],
      );
      const row = result.rows[0];
      if (!row) return defaultPlanningCenterTaskPreferences;
      try {
        const parsed = JSON.parse(row.json_value) as Partial<PlanningCenterTaskPreferences>;
        return {
          teamIds: Array.isArray(parsed.teamIds)
            ? parsed.teamIds.filter((value): value is string => typeof value === 'string')
            : [],
          positionNames: Array.isArray(parsed.positionNames)
            ? parsed.positionNames.filter((value): value is string => typeof value === 'string')
            : [],
        };
      } catch {
        return defaultPlanningCenterTaskPreferences;
      }
    }
    return this.getPlanningCenterTaskPreferences(ownerId);
  }

  getPlanningCenterTaskPreferences(ownerId: number): PlanningCenterTaskPreferences {
    const row = getDb()
      .prepare(
        'SELECT * FROM integration_preferences WHERE owner_id = ? AND provider = ? AND key = ? LIMIT 1',
      )
      .get(ownerId, PCO_PROVIDER, PCO_TASK_FILTERS_KEY) as PreferenceRow | undefined;

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

  async savePlanningCenterTaskPreferencesAsync(
    ownerId: number,
    preferences: PlanningCenterTaskPreferences,
  ): Promise<PlanningCenterTaskPreferences> {
    const normalized = normalizePlanningCenterTaskPreferences(preferences);
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO integration_preferences (owner_id, provider, key, json_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(owner_id, provider, key) DO UPDATE SET json_value = excluded.json_value`,
        [ownerId, PCO_PROVIDER, PCO_TASK_FILTERS_KEY, JSON.stringify(normalized)],
      );
      return normalized;
    }
    return this.savePlanningCenterTaskPreferences(ownerId, preferences);
  }

  savePlanningCenterTaskPreferences(
    ownerId: number,
    preferences: PlanningCenterTaskPreferences,
  ): PlanningCenterTaskPreferences {
    const normalized = normalizePlanningCenterTaskPreferences(preferences);

    getDb()
      .prepare(
        `INSERT INTO integration_preferences (owner_id, provider, key, json_value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id, provider, key) DO UPDATE SET json_value = excluded.json_value`,
      )
      .run(ownerId, PCO_PROVIDER, PCO_TASK_FILTERS_KEY, JSON.stringify(normalized));

    return normalized;
  }

  async getGoogleCalendarPreferencesAsync(
    ownerId: number,
  ): Promise<GoogleCalendarPreferences | null> {
    if (env.dbClient === 'postgres') {
      const result = await getPostgresPool().query<PreferenceRow>(
        'SELECT * FROM integration_preferences WHERE owner_id = $1 AND provider = $2 AND key = $3 LIMIT 1',
        [ownerId, GOOGLE_PROVIDER, GOOGLE_SELECTED_CALENDARS_KEY],
      );
      const row = result.rows[0];
      if (!row) return null;
      try {
        const parsed = JSON.parse(row.json_value) as Partial<GoogleCalendarPreferences>;
        return {
          selectedCalendarIds: Array.isArray(parsed.selectedCalendarIds)
            ? parsed.selectedCalendarIds.filter((value): value is string => typeof value === 'string')
            : [],
        };
      } catch {
        return null;
      }
    }
    return this.getGoogleCalendarPreferences(ownerId);
  }

  getGoogleCalendarPreferences(ownerId: number): GoogleCalendarPreferences | null {
    const row = getDb()
      .prepare(
        'SELECT * FROM integration_preferences WHERE owner_id = ? AND provider = ? AND key = ? LIMIT 1',
      )
      .get(
        ownerId,
        GOOGLE_PROVIDER,
        GOOGLE_SELECTED_CALENDARS_KEY,
      ) as PreferenceRow | undefined;

    if (!row) return null;

    try {
      const parsed = JSON.parse(row.json_value) as Partial<GoogleCalendarPreferences>;
      return {
        selectedCalendarIds: Array.isArray(parsed.selectedCalendarIds)
          ? parsed.selectedCalendarIds.filter(
              (value): value is string => typeof value === 'string',
            )
          : [],
      };
    } catch {
      return null;
    }
  }

  async saveGoogleCalendarPreferencesAsync(
    ownerId: number,
    preferences: GoogleCalendarPreferences,
  ): Promise<GoogleCalendarPreferences> {
    const normalized = normalizeGoogleCalendarPreferences(preferences);
    if (env.dbClient === 'postgres') {
      await getPostgresPool().query(
        `INSERT INTO integration_preferences (owner_id, provider, key, json_value)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT(owner_id, provider, key) DO UPDATE SET json_value = excluded.json_value`,
        [
          ownerId,
          GOOGLE_PROVIDER,
          GOOGLE_SELECTED_CALENDARS_KEY,
          JSON.stringify(normalized),
        ],
      );
      return normalized;
    }
    return this.saveGoogleCalendarPreferences(ownerId, preferences);
  }

  saveGoogleCalendarPreferences(
    ownerId: number,
    preferences: GoogleCalendarPreferences,
  ): GoogleCalendarPreferences {
    const normalized = normalizeGoogleCalendarPreferences(preferences);

    getDb()
      .prepare(
        `INSERT INTO integration_preferences (owner_id, provider, key, json_value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id, provider, key) DO UPDATE SET json_value = excluded.json_value`,
      )
      .run(
        ownerId,
        GOOGLE_PROVIDER,
        GOOGLE_SELECTED_CALENDARS_KEY,
        JSON.stringify(normalized),
      );

    return normalized;
  }
}
