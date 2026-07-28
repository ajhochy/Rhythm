import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

const nativeFetch = globalThis.fetch;
const configuredClientId =
  '123456789-rhythm-mobile.apps.googleusercontent.com';
const configuredRedirectUri =
  'com.googleusercontent.apps.123456789-rhythm-mobile:/oauthredirect';
const expectedNonce = 'nonce_abcdefghijklmnopqrstuvwxyz123456';
const validCodeVerifier = 'v'.repeat(64);

type Claims = {
  aud?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  exp?: number | string;
  iss?: string;
  name?: string;
  nonce?: string;
  picture?: string;
  sub?: string;
};

describe('Google mobile OAuth security', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let claims: Claims;
  let tokenResponse: Record<string, unknown>;
  let rejectTokenExchange: boolean;
  let upstreamErrorBody: string;
  let externalRequests: Array<{
    url: string;
    body: URLSearchParams | null;
  }>;
  const originalMobileClientId = env.googleMobileClientId;
  const originalMobileRedirectUri = env.googleMobileRedirectUri;

  beforeEach(async () => {
    env.googleMobileClientId = configuredClientId;
    env.googleMobileRedirectUri = configuredRedirectUri;
    claims = {
      aud: configuredClientId,
      azp: configuredClientId,
      email: 'verified@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3_600,
      iss: 'https://accounts.google.com',
      name: 'Verified Profile',
      nonce: expectedNonce,
      picture: 'https://example.com/verified.png',
      sub: 'verified-google-sub',
    };
    tokenResponse = {
      access_token: 'authoritative-access-token',
      expires_in: 3_600,
      id_token: 'signed-google-id-token',
      token_type: 'Bearer',
    };
    rejectTokenExchange = false;
    upstreamErrorBody = JSON.stringify({ error: 'unauthorized_client' });
    externalRequests = [];

    globalThis.fetch = (async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body ?? ''));
        externalRequests.push({ url, body });
        if (rejectTokenExchange) {
          return new Response(upstreamErrorBody, { status: 400 });
        }
        return Response.json(tokenResponse);
      }
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo?')) {
        externalRequests.push({ url, body: null });
        return Response.json(claims);
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    setDb(db);
    runMigrations(db);
    new UsersRepository().create({
      name: 'Preprovisioned Verified Profile',
      email: 'verified@example.com',
    });
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    globalThis.fetch = nativeFetch;
    env.googleMobileClientId = originalMobileClientId;
    env.googleMobileRedirectUri = originalMobileRedirectUri;
    await closeServer();
    db.close();
  });

  async function exchange(
    body: Record<string, unknown> = {},
  ): Promise<Response> {
    return nativeFetch(`${baseUrl}/auth/google/mobile-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: 'approved-code',
        codeVerifier: validCodeVerifier,
        nonce: expectedNonce,
        ...body,
      }),
    });
  }

  it('uses only pinned client settings and derives the session from authoritative verified claims', async () => {
    const response = await exchange({
      // Hostile legacy fields must have no authority over the exchange.
      clientId: 'foreign-client.apps.googleusercontent.com',
      redirectUri: 'attacker:/callback',
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      sessionToken: string;
      user: { email: string; name: string; photoUrl: string | null };
    };
    expect(result.sessionToken).toEqual(expect.any(String));
    expect(result.user).toMatchObject({
      email: 'verified@example.com',
      name: 'Verified Profile',
      photoUrl: 'https://example.com/verified.png',
    });

    const tokenRequest = externalRequests.find(
      (request) => request.url === 'https://oauth2.googleapis.com/token',
    );
    expect(tokenRequest?.body?.get('client_id')).toBe(configuredClientId);
    expect(tokenRequest?.body?.get('redirect_uri')).toBe(
      configuredRedirectUri,
    );
    expect(tokenRequest?.body?.get('code_verifier')).toBe(validCodeVerifier);
    expect(
      externalRequests.some((request) =>
        request.url.includes('openidconnect.googleapis.com/v1/userinfo'),
      ),
    ).toBe(false);
  });

  it('rejects an unapproved or foreign-client authorization code', async () => {
    rejectTokenExchange = true;
    const response = await exchange({ code: 'foreign-client-code' });

    expect(response.status).toBe(401);
    expect(
      externalRequests[0]?.body?.get('client_id'),
      'even rejected codes must be exchanged only against Rhythm client',
    ).toBe(configuredClientId);
  });

  it.each([
    ['missing client ID', '', configuredRedirectUri],
    [
      'malformed client ID',
      'foreign-client.apps.googleusercontent.com',
      configuredRedirectUri,
    ],
    [
      'mismatched redirect',
      configuredClientId,
      'com.googleusercontent.apps.someone-else:/oauthredirect',
    ],
  ])('rejects %s server configuration before contacting Google', async (
    _label,
    clientId,
    redirectUri,
  ) => {
    env.googleMobileClientId = clientId;
    env.googleMobileRedirectUri = redirectUri;
    const response = await exchange();

    expect(response.status).toBe(400);
    expect(externalRequests).toHaveLength(0);
  });

  it.each([
    ['empty code', { code: '' }],
    ['control characters in code', { code: 'approved\ncode' }],
    ['short verifier', { codeVerifier: 'too-short' }],
    ['malformed nonce', { nonce: 'predictable' }],
  ])('rejects %s before contacting Google', async (_label, patch) => {
    const response = await exchange(patch);
    expect(response.status).toBe(400);
    expect(externalRequests).toHaveLength(0);
  });

  it('does not disclose raw Google token-exchange errors', async () => {
    rejectTokenExchange = true;
    upstreamErrorBody =
      '{"error":"invalid_grant","error_description":"upstream-secret-detail"}';
    const response = await exchange();
    const body = await response.text();

    expect(response.status).toBe(401);
    expect(body).not.toContain('upstream-secret-detail');
    expect(body).not.toContain('invalid_grant');
    expect(body).toContain(
      'Google mobile token exchange rejected the authorization code',
    );
  });

  it.each([
    ['audience', { aud: 'foreign-client.apps.googleusercontent.com' }],
    ['authorized party', { azp: 'foreign-client.apps.googleusercontent.com' }],
    ['nonce', { nonce: 'attacker-controlled-nonce' }],
    ['issuer', { iss: 'https://attacker.example' }],
    ['expiry', { exp: Math.floor(Date.now() / 1000) - 1 }],
    ['verified email', { email_verified: false }],
  ])('rejects a signed token with mismatched %s claims', async (_label, patch) => {
    claims = { ...claims, ...patch };
    const response = await exchange();
    expect(response.status).toBe(401);
  });

  it('requires an ID token before consulting authoritative claims', async () => {
    delete tokenResponse.id_token;
    const response = await exchange();

    expect(response.status).toBe(401);
    expect(
      externalRequests.filter((request) =>
        request.url.startsWith('https://oauth2.googleapis.com/tokeninfo?'),
      ),
    ).toHaveLength(0);
  });
});
