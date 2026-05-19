import path from 'path';

export type DbClient = 'sqlite' | 'postgres';

const dbClientValue = (process.env.DB_CLIENT ?? 'sqlite').trim().toLowerCase();

function parseDbClient(value: string): DbClient {
  if (value === 'sqlite' || value === 'postgres') {
    return value;
  }

  throw new Error(
    `Unsupported DB_CLIENT "${value}". Expected "sqlite" or "postgres".`,
  );
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  dbClient: parseDbClient(dbClientValue),
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'rhythm.db'),
  dbHost: process.env.DB_HOST ?? 'localhost',
  dbPort: Number(process.env.DB_PORT ?? 5432),
  dbName: process.env.DB_NAME ?? 'rhythm',
  dbUser: process.env.DB_USER ?? '',
  dbPassword: process.env.DB_PASSWORD ?? '',
  dbSsl: (process.env.DB_SSL ?? 'false').trim().toLowerCase() === 'true',
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientId:
    process.env.GOOGLE_AUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientSecret:
    process.env.GOOGLE_AUTH_CLIENT_SECRET ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ??
    'http://localhost:4000/auth/google/callback',
  pcoApplicationId: process.env.PCO_APPLICATION_ID ?? '',
  pcoSecret: process.env.PCO_SECRET ?? '',
  pcoRedirectUri:
    process.env.PCO_REDIRECT_URI ??
    'http://localhost:4000/auth/planning-center/callback',
  pcoScopes: process.env.PCO_SCOPES ?? 'openid services',
  pcoNeededTaskWindowDays: Number(process.env.PCO_NEEDED_TASK_WINDOW_DAYS ?? 14),
  pcoDeclineTaskWindowDays: Number(
    process.env.PCO_DECLINE_TASK_WINDOW_DAYS ?? 14,
  ),
  pcoSpecialProjectWindowDays: Number(
    process.env.PCO_SPECIAL_PROJECT_WINDOW_DAYS ?? 30,
  ),
  pcoIgnoredServiceTypeKeywords: (process.env.PCO_IGNORED_SERVICE_TYPE_KEYWORDS ??
          'training,rehearsal')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  pcoIncludedPositionKeywords: (process.env.PCO_INCLUDED_POSITION_KEYWORDS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  pcoExcludedPositionKeywords: (process.env.PCO_EXCLUDED_POSITION_KEYWORDS ??
          'nursery,children,helper,volunteer')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  claudeUserId: (() => {
    const raw = process.env.CLAUDE_USER_ID;
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      console.warn(`[env] CLAUDE_USER_ID="${raw}" is not a valid integer — treating as null`);
      return null;
    }
    return parsed;
  })(),
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  emailFromAddress: process.env.EMAIL_FROM_ADDRESS ?? 'Rhythm <onboarding@resend.dev>',
  agentLocal: process.env.AGENT_LOCAL === 'true',
  /** URL of the production Rhythm API to mirror tasks from (agent-local mode only).
   *  Set via PROD_API_URL env var.  When absent, production task mirroring is skipped. */
  prodApiUrl: process.env.PROD_API_URL ?? null,
  /** Bearer token to authenticate against the production API for task mirroring. */
  prodAuthToken: process.env.PROD_AUTH_TOKEN ?? null,
};
