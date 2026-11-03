import { describe, expect, it } from 'vitest';
import { resolveWebHostConfig } from './web_host';

const configured = {
  RHYTHM_WEB_HOST: '1', RHYTHM_ROLE: 'local', AGENT_LOCAL: 'true',
  RHYTHM_WEB_PUBLIC_ORIGIN: 'https://rhythm.example.ts.net',
  RHYTHM_WEB_OWNER_USER_ID: '1', RHYTHM_WEB_DIST_DIR: '/tmp/built-web-dist',
};

describe('web host fail-closed configuration', () => {
  it('stays off without the opt-in, regardless of other web settings', () => {
    expect(resolveWebHostConfig({ ...configured, RHYTHM_WEB_HOST: undefined })).toBeNull();
  });
  it('accepts exact origins and an explicitly configured owner only', () => {
    expect(resolveWebHostConfig(configured)).toMatchObject({
      origins: ['https://rhythm.example.ts.net'], hosts: ['rhythm.example.ts.net'], ownerUserId: 1,
    });
  });
  it.each([
    { RHYTHM_WEB_HOST: 'true' }, { RHYTHM_ROLE: 'all' }, { RHYTHM_ROLE: 'cloud' },
    { RHYTHM_ROLE: 'relay' }, { AGENT_LOCAL: 'false' },
    { RHYTHM_WEB_OWNER_USER_ID: '' }, { RHYTHM_WEB_OWNER_USER_ID: '0' },
    { RHYTHM_WEB_OWNER_USER_ID: '1x' }, { RHYTHM_WEB_OWNER_USER_ID: '9007199254740992' },
    { RHYTHM_WEB_DIST_DIR: './dist' }, { RHYTHM_WEB_PUBLIC_ORIGIN: '' },
    { RHYTHM_WEB_PUBLIC_ORIGIN: '*' }, { RHYTHM_WEB_PUBLIC_ORIGIN: 'https://rhythm.example.ts.net/' },
    { RHYTHM_WEB_PUBLIC_ORIGIN: 'https://rhythm.example.ts.net/path' },
    { RHYTHM_WEB_PUBLIC_ORIGIN: 'https://user:password@rhythm.example.ts.net' },
  ])('refuses invalid host setup %j (catches permissive opt-in parsing)', (override) => {
    expect(() => resolveWebHostConfig({ ...configured, ...override })).toThrow();
  });
});
