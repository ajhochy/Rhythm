import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../config/env';
import { GoogleOAuthService, GOOGLE_AGENT_SCOPES } from '../services/google_oauth_service';

describe('Google step-up scopes', () => {
  let origClientId: string;
  let origClientSecret: string;
  let origRedirectUri: string;

  beforeEach(() => {
    origClientId = env.googleClientId;
    origClientSecret = env.googleClientSecret;
    origRedirectUri = env.googleRedirectUri;
    (env as { googleClientId: string }).googleClientId = 'web-client-id.apps.googleusercontent.com';
    (env as { googleClientSecret: string }).googleClientSecret = 'web-client-secret';
    (env as { googleRedirectUri: string }).googleRedirectUri = 'http://localhost:4000/auth/google/callback';
  });

  afterEach(() => {
    (env as { googleClientId: string }).googleClientId = origClientId;
    (env as { googleClientSecret: string }).googleClientSecret = origClientSecret;
    (env as { googleRedirectUri: string }).googleRedirectUri = origRedirectUri;
  });

  it('agent scope set includes full calendar + gmail read/send', () => {
    expect(GOOGLE_AGENT_SCOPES).toContain('https://www.googleapis.com/auth/calendar');
    expect(GOOGLE_AGENT_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
    expect(GOOGLE_AGENT_SCOPES).toContain('https://www.googleapis.com/auth/gmail.send');
  });

  it('getAuthorizationUrl(scopes) embeds the requested scope set and forces consent', () => {
    const svc = new GoogleOAuthService();
    const url = svc.getAuthorizationUrl({
      sessionToken: 'state-tok',
      forceConsent: true,
      scopes: GOOGLE_AGENT_SCOPES,
    });
    expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/calendar'));
    expect(url).toContain('prompt=consent');
    // must NOT include the readonly variant (we passed the full calendar scope)
    expect(url).not.toContain(encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly'));
  });

  it('getAuthorizationUrl without scopes uses the base scopes (unchanged default)', () => {
    const svc = new GoogleOAuthService();
    const url = svc.getAuthorizationUrl({ sessionToken: 'state-tok', forceConsent: false });
    // base set includes calendar.readonly
    expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly'));
    // base set must NOT include the full calendar scope (only readonly)
    expect(url).not.toContain(encodeURIComponent('https://www.googleapis.com/auth/calendar%20'));
    // base set includes gmail.metadata
    expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/gmail.metadata'));
  });
});
