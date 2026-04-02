import { getDb } from '../database/db';
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

export class IntegrationPreferencesRepository {
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

  savePlanningCenterTaskPreferences(
    ownerId: number,
    preferences: PlanningCenterTaskPreferences,
  ): PlanningCenterTaskPreferences {
    const normalized: PlanningCenterTaskPreferences = {
      teamIds: [...new Set(preferences.teamIds.map((value) => value.trim()).filter((value) => value.length > 0))],
      positionNames: [...new Set(preferences.positionNames.map((value) => value.trim()).filter((value) => value.length > 0))],
    };

    getDb()
      .prepare(
        `INSERT INTO integration_preferences (owner_id, provider, key, json_value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(owner_id, provider, key) DO UPDATE SET json_value = excluded.json_value`,
      )
      .run(ownerId, PCO_PROVIDER, PCO_TASK_FILTERS_KEY, JSON.stringify(normalized));

    return normalized;
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

  saveGoogleCalendarPreferences(
    ownerId: number,
    preferences: GoogleCalendarPreferences,
  ): GoogleCalendarPreferences {
    const normalized: GoogleCalendarPreferences = {
      selectedCalendarIds: [
        ...new Set(
          preferences.selectedCalendarIds
              .map((value) => value.trim())
              .filter((value) => value.length > 0),
        ),
      ],
    };

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
