/**
 * D1.1 (#1426) repair — d1_secret_sanitizer.ts.
 *
 * Seeds a secret into every shape this module claims to catch (bearer
 * token, provider token, JWT, key/password/token assignment, private key
 * block, cookie header, and postgres/mysql/mongodb URLs with userinfo) and
 * proves none survive — both as a plain scalar field and nested inside a
 * JSON blob under a secret-shaped key.
 */
import { describe, expect, it } from 'vitest';

import { sanitizeD1Json, sanitizeD1PlainText } from '../d1_secret_sanitizer';

const SECRET_SAMPLES: { label: string; text: string; mustNotContain: string }[] = [
  {
    label: 'bearer token',
    text: 'Authorization: Bearer abcdefghijklmnopqrstuvwx123456',
    mustNotContain: 'abcdefghijklmnopqrstuvwx123456',
  },
  {
    label: 'openai-shaped provider token',
    text: 'sk-abcdefghijklmnopqrstuvwx',
    mustNotContain: 'sk-abcdefghijklmnopqrstuvwx',
  },
  {
    label: 'github-shaped provider token',
    text: 'ghp_abcdefghijklmnopqrstuvwxyz012345',
    mustNotContain: 'abcdefghijklmnopqrstuvwxyz012345',
  },
  {
    label: 'slack-shaped provider token',
    text: 'xoxb-1234567890-abcdefghij',
    mustNotContain: '1234567890-abcdefghij',
  },
  {
    label: 'aws-shaped provider token',
    text: 'AKIAABCDEFGHIJKLMNOP',
    mustNotContain: 'AKIAABCDEFGHIJKLMNOP',
  },
  {
    label: 'JWT',
    text: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    mustNotContain: 'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  },
  {
    label: 'password assignment',
    text: 'password=hunter2superSecret',
    mustNotContain: 'hunter2superSecret',
  },
  {
    label: 'api key assignment',
    text: 'api_key: mySuperSecretApiKeyValue',
    mustNotContain: 'mySuperSecretApiKeyValue',
  },
  {
    label: 'PEM private key block',
    text: '-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAKCAQ==\n-----END RSA PRIVATE KEY-----',
    mustNotContain: 'MIIBogIBAAKCAQ==',
  },
  {
    label: 'cookie header',
    text: 'Cookie: session=abcdefghijklmnopSECRETSESSION',
    mustNotContain: 'abcdefghijklmnopSECRETSESSION',
  },
  {
    label: 'postgres URL with userinfo',
    text: 'postgres://dbuser:dbSecretPass123@db.internal.example.com:5432/prod',
    mustNotContain: 'dbSecretPass123',
  },
  {
    label: 'mysql URL with userinfo',
    text: 'mysql://root:rootSecretPass@127.0.0.1:3306/app',
    mustNotContain: 'rootSecretPass',
  },
  {
    label: 'mongodb URL with userinfo',
    text: 'mongodb+srv://svc:MongoSecret99@cluster0.mongodb.net/app',
    mustNotContain: 'MongoSecret99',
  },
];

describe('D1 sanitizer (repair) — sanitizeD1PlainText', () => {
  for (const sample of SECRET_SAMPLES) {
    it(`scrubs a ${sample.label} out of a plain field`, () => {
      const out = sanitizeD1PlainText(sample.text);
      expect(out).not.toContain(sample.mustNotContain);
      expect(out).toContain('[redacted]');
    });
  }

  it('passes through null/undefined without throwing', () => {
    expect(sanitizeD1PlainText(null)).toBeNull();
    expect(sanitizeD1PlainText(undefined)).toBeNull();
  });

  it('leaves an ordinary identifier untouched', () => {
    expect(sanitizeD1PlainText('example-tool')).toBe('example-tool');
    expect(sanitizeD1PlainText('npm install')).toBe('npm install');
  });
});

describe('D1 sanitizer (repair) — sanitizeD1Json', () => {
  for (const sample of SECRET_SAMPLES) {
    it(`scrubs a ${sample.label} out of a JSON string leaf`, () => {
      const raw = JSON.stringify({ note: sample.text });
      const out = sanitizeD1Json(raw);
      expect(out).not.toContain(sample.mustNotContain);
    });
  }

  it('redacts every secret-shaped key at every nesting depth, regardless of value shape', () => {
    const raw = JSON.stringify({
      toolName: 'example-tool',
      nested: {
        apiKey: 'plain-value-with-no-known-shape',
        deeper: [{ password: 'anotherPlainValue' }, { access_key: 'yetAnotherPlainValue' }],
      },
      Authorization: 'plain-auth-value',
      client_secret: 'plainClientSecretValue',
      cookie: 'plainCookieValue',
    });
    const out = sanitizeD1Json(raw);
    expect(out).not.toContain('plain-value-with-no-known-shape');
    expect(out).not.toContain('anotherPlainValue');
    expect(out).not.toContain('yetAnotherPlainValue');
    expect(out).not.toContain('plain-auth-value');
    expect(out).not.toContain('plainClientSecretValue');
    expect(out).not.toContain('plainCookieValue');
    expect(out).toContain('example-tool');
    const parsed = JSON.parse(out);
    expect(parsed.nested.apiKey).toBe('[redacted]');
    expect(parsed.nested.deeper[0].password).toBe('[redacted]');
    expect(parsed.nested.deeper[1].access_key).toBe('[redacted]');
  });

  it('scrubs secret shapes inside array-of-string JSON values', () => {
    const raw = JSON.stringify(['sk-abcdefghijklmnopqrstuvwx', 'safe-value']);
    const out = sanitizeD1Json(raw);
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(out).toContain('safe-value');
  });

  it('falls back to plain-text scrubbing when the input is not valid JSON', () => {
    const out = sanitizeD1Json('not json but has sk-abcdefghijklmnopqrstuvwx inside');
    expect(out).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('passes through empty/null/undefined without throwing', () => {
    expect(sanitizeD1Json('')).toBe('');
    expect(sanitizeD1Json(null)).toBe('');
    expect(sanitizeD1Json(undefined)).toBe('');
  });
});
