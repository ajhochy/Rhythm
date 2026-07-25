/** Informational readiness summary for Rhythm Setup. It never logs secrets,
 * performs network calls, changes configuration, or installs anything. */
const configured = (...keys: string[]) => keys.some((key) => Boolean(process.env[key]?.trim()));

export interface SetupReadiness {
  cloudLoginOrToken: boolean;
  usableModel: boolean;
  rhythmMcp: boolean;
  externalSearch: boolean;
  registryUrl: { configured: boolean; url: string | null };
  planningCenter: boolean;
  gmail: boolean;
}

export function getSetupReadiness(): SetupReadiness {
  const cloudLoginOrToken = configured('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY');
  const registryUrl = process.env.RHYTHM_MCP_REGISTRY_SEARCH_URL?.trim() || null;
  return {
    cloudLoginOrToken,
    usableModel: cloudLoginOrToken,
    rhythmMcp: true,
    externalSearch: Boolean(registryUrl),
    registryUrl: { configured: Boolean(registryUrl), url: registryUrl },
    planningCenter: configured('PCO_APPLICATION_ID', 'PCO_SECRET'),
    gmail: configured('GOOGLE_CLIENT_ID', 'GOOGLE_AUTH_CLIENT_ID'),
  };
}
