import { env } from '../config/env';
import { getDb, getPostgresPool } from '../database/db';
import { AppError } from '../errors/app_error';

export interface OrgEvaluationSettings {
  tokenLimit: number;
  candidateCount: 2 | 3;
  lookbackDays: 7 | 14;
}
const SETTINGS_ID = 'org_evaluation_settings';
const DEFAULT_SETTINGS: OrgEvaluationSettings = { tokenLimit: 100000, candidateCount: 2, lookbackDays: 7 };

export function validateOrgEvaluationSettings(input: unknown): OrgEvaluationSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw AppError.badRequest('Evaluation settings must be an object');
  const raw = input as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => ['tokenLimit', 'candidateCount', 'lookbackDays'].includes(key))
    || !Number.isSafeInteger(raw.tokenLimit) || Number(raw.tokenLimit) < 1000 || Number(raw.tokenLimit) > 10000000
    || raw.candidateCount !== 2 && raw.candidateCount !== 3
    || Object.hasOwn(raw, 'lookbackDays') && raw.lookbackDays !== 7 && raw.lookbackDays !== 14) {
    throw AppError.badRequest('Choose a whole-run token limit from 1,000 to 10,000,000, two or three candidates, and a 7- or 14-day lookback');
  }
  return { tokenLimit: Number(raw.tokenLimit), candidateCount: raw.candidateCount,
    lookbackDays: Object.hasOwn(raw, 'lookbackDays') ? raw.lookbackDays as 7 | 14 : 7 };
}

export async function getOrgEvaluationSettingsAsync(): Promise<OrgEvaluationSettings> {
  const row = env.dbClient === 'postgres'
    ? (await getPostgresPool().query('SELECT content FROM org_settings WHERE id=$1', [SETTINGS_ID])).rows[0]
    : getDb().prepare('SELECT content FROM org_settings WHERE id=?').get(SETTINGS_ID) as { content: string } | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  try { return validateOrgEvaluationSettings(JSON.parse(row.content)); }
  catch { throw AppError.conflict('Stored evaluation settings are invalid; save a bounded token limit before running a review'); }
}

export async function saveOrgEvaluationSettingsAsync(input: unknown): Promise<OrgEvaluationSettings> {
  const settings = validateOrgEvaluationSettings(input);
  const content = JSON.stringify(settings);
  const updated = new Date().toISOString();
  if (env.dbClient === 'postgres') {
    await getPostgresPool().query('INSERT INTO org_settings(id,content,updated_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content,updated_at=EXCLUDED.updated_at', [SETTINGS_ID, content, updated]);
  } else {
    getDb().prepare('INSERT INTO org_settings(id,content,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at').run(SETTINGS_ID, content, updated);
  }
  return settings;
}
