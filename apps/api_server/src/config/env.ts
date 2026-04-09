import path from 'path';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  dbPath: process.env.DB_PATH ?? path.join(process.cwd(), 'rhythm.db'),
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleAuthClientId:
    process.env.GOOGLE_AUTH_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
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
};
