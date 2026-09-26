import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const root = new URL('../../src/', import.meta.url);
const formatter = new URL('timestamps.ts', root);
const component = new URL('components/Timestamp.tsx', root);

test('issue-1565-c1: strict formatter produces local 12-hour labels without accepting sentinel or malformed instants', async () => {
  // Regression caught: Date.parse normalizes invalid dates or treats zoneless time as viewer-local.
  assert.ok(existsSync(formatter), 'shared formatter must exist');
  const { formatTimestamp } = await import(formatter.href);
  const options = { now: new Date('2026-09-24T19:00:00Z'), locale: 'en-US', timeZone: 'America/Los_Angeles' };
  assert.equal(formatTimestamp('2026-09-24T20:01:05Z', options)?.label, '1:01 PM');
  assert.equal(formatTimestamp('2026-09-21T20:01:05Z', options)?.label, 'Sep 21, 1:01 PM');
  assert.equal(formatTimestamp('2025-09-21T20:01:05Z', options)?.label, 'Sep 21, 2025, 1:01 PM');
  assert.equal(formatTimestamp('2026-09-24 20:01:05', options)?.iso, '2026-09-24T20:01:05.000Z');
  assert.equal(formatTimestamp('2026-09-24t20:01:05z', options)?.iso, '2026-09-24T20:01:05.000Z');
  assert.equal(formatTimestamp('2026-09-24T20:01:05+0230', options)?.iso, '2026-09-24T17:31:05.000Z');
  for (const [fraction, millis] of [['1', '100'], ['12', '120'], ['123456', '123']]) {
    assert.equal(formatTimestamp(`2026-09-24T20:01:05.${fraction}Z`, options)?.iso, `2026-09-24T20:01:05.${millis}Z`);
  }
  for (const invalid of [null, 0, 42, NaN, {}, '42', '2026-09-24', '2026-02-29T01:01Z', '2024-02-30T01:01Z', '2026-13-01T01:01Z', '2026-01-01T24:01Z', '2026-01-01T01:60Z', '2026-01-01T01:01:60Z', '2026-01-01T01:01+24:00', '2026-01-01T01:01+01:60', '2026-01-01T01:01Zjunk', '1970-01-01T00:00:00Z', '1970-01-01T01:00:00+01:00']) {
    assert.equal(formatTimestamp(invalid, options), null, String(invalid));
  }
  assert.equal(formatTimestamp('0099-01-01T00:00Z', options)?.iso, '0099-01-01T00:00:00.000Z');
  assert.equal(formatTimestamp('2024-02-29T01:01Z', options)?.iso, '2024-02-29T01:01:00.000Z');
  assert.equal(formatTimestamp('0000-01-01T01:01Z', options)?.iso, '0000-01-01T01:01:00.000Z');
  assert.equal(formatTimestamp('2026-03-08T02:30:00', { ...options, now: new Date('2026-03-08T06:00:00Z') })?.iso, '2026-03-08T02:30:00.000Z', 'skipped LA wall clock is UTC');
  const spring = formatTimestamp('2026-03-08T10:30:05Z', { ...options, now: new Date('2026-03-08T10:00:00Z') });
  assert.equal(spring?.label, '3:30 AM');
  assert.match(spring?.full ?? '', /3:30:05 AM.*PDT/);
  const fallFirst = formatTimestamp('2026-11-01T08:30:05Z', { ...options, now: new Date('2026-11-01T12:00:00Z') });
  const fallSecond = formatTimestamp('2026-11-01T09:30:05Z', { ...options, now: new Date('2026-11-01T12:00:00Z') });
  assert.equal(fallFirst?.label, fallSecond?.label);
  assert.notEqual(fallFirst?.iso, fallSecond?.iso);
  assert.match(fallFirst?.full ?? '', /PDT/);
  assert.match(fallSecond?.full ?? '', /PST/);
  assert.equal(formatTimestamp('2026-09-24T20:01:05Z', { ...options, timeZone: 'Asia/Kolkata' })?.label, '1:31 AM');
  assert.equal(formatTimestamp('2026-09-24T20:01:05Z', { ...options, timeZone: 'America/New_York' })?.label, '4:01 PM');
  assert.throws(() => formatTimestamp('2026-09-24T20:01Z', { ...options, now: new Date(NaN) }));
});

test('issue-1565-c2: Timestamp emits semantic time and non-time fallback', () => {
  // Regression caught: compact-only labels discard full accessible timezone/seconds.
  assert.ok(existsSync(component), 'Timestamp component must exist');
  const source = readFileSync(component, 'utf8');
  assert.match(source, /<time\b/);
  assert.match(source, /dateTime=\{.*iso/);
  assert.match(source, /title=\{.*full/);
  assert.match(source, /aria-hidden/);
  assert.match(source, /Time unavailable/);
});

test('issue-1565-c2: invalid timestamp exposes a scoped fallback hook for muted Messages and Transcript styling', () => {
  // Regression caught: fallback inherits full-strength message text rather than the 8px muted time treatment.
  const source = readFileSync(component, 'utf8');
  assert.match(source, /data-timestamp-fallback/, 'fallback span must expose a dedicated styling hook');
  for (const file of ['components/Transcript.css', 'pages/messages/styles.css']) {
    const text = readFileSync(new URL(file, root), 'utf8');
    assert.match(text, /\[data-timestamp-fallback\]/, `${file} must scope fallback styling`);
  }
});

test('issue-1565-c1: LA host-default timezone agrees with explicit LA and preserves UTC zoneless instant', () => {
  // Regression caught: implicit Date parsing changes zoneless wire time when host TZ changes.
  const code = `import { formatTimestamp } from './src/timestamps.ts'; const now = new Date('2026-09-24T20:00:00Z'); console.log(JSON.stringify([formatTimestamp('2026-09-24T20:01:05', {now})?.label, formatTimestamp('2026-09-24T20:01:05Z', {now, timeZone:'America/Los_Angeles'})?.label]));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('../../', import.meta.url), env: { ...process.env, TZ: 'America/Los_Angeles' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), ['1:01 PM', '1:01 PM']);
});

test('issue-1565-c3: owned displays import the shared Timestamp without migrating date-only inputs', () => {
  // Regression caught: owned screens continue displaying raw createdAt/updatedAt strings.
  for (const file of ['components/Transcript.tsx', 'components/ToolWorkspace.tsx', 'pages/dashboard/LiveArtifactsShell.tsx']) {
    const source = readFileSync(new URL(file, root), 'utf8');
    assert.match(source, /<Timestamp\b/, file);
  }
});

test('issue-1565-c4: AST guard exists for raw display regression', () => {
  // Regression caught: raw timestamp display bypasses semantic markup after migration.
  assert.ok(existsSync(new URL('../timestamp-source-guard.mjs', import.meta.url)));
});

test('issue-1565-c3: reservation wall clocks preserve their calendar hour while zoned instants pass through', async () => {
  // Regression caught: a zoneless 09:00 reservation renders as 02:00 in Los Angeles.
  const { wallClockInstant } = await import(formatter.href);
  assert.equal(typeof wallClockInstant, 'function');
  assert.equal(wallClockInstant('2026-08-12T09:00:00')?.getHours(), 9);
  assert.equal(wallClockInstant('2026-02-30T09:00:00'), null);
  assert.equal(wallClockInstant('2026-08-12T24:00:00'), null);
  assert.equal(wallClockInstant('2026-08-12T09:00:00-07:00')?.toISOString(), '2026-08-12T16:00:00.000Z');
});

test('issue-1565-c3: review queue renders selected timestamps semantically with Unknown fallback', () => {
  // Regression caught: Review Queue details leak raw ISO while neighboring details use Timestamp.
  const source = readFileSync(new URL('components/ToolWorkspace.tsx', root), 'utf8');
  assert.match(source, /<dt>Created<\/dt><dd>\{selected\.createdAt \? <Timestamp value=\{selected\.createdAt\} \/> : 'Unknown'\}<\/dd>/);
  assert.match(source, /<dt>Updated<\/dt><dd>\{selected\.updatedAt \? <Timestamp value=\{selected\.updatedAt\} \/> : 'Unknown'\}<\/dd>/);
});

test('issue-1565-c3: Inspector renders session and share instants through Timestamp', () => {
  const source = readFileSync(new URL('components/Inspector.tsx', root), 'utf8');
  assert.match(source, /<dt>Created<\/dt><dd><Timestamp value=\{selected\.createdAt\} \/><\/dd>/);
  assert.match(source, /<dt>Updated<\/dt><dd><Timestamp value=\{selected\.updatedAt\} \/><\/dd>/);
  assert.match(source, /Expires <Timestamp value=\{share\.expiresAt\} \/>/);
  assert.doesNotMatch(source, /Aug 12 · \{selected\.(?:createdAt|updatedAt)\.slice/);
});

test('issue-1565-c2: valid transcript timestamps retain 11px text while fallback remains 8px', () => {
  const source = readFileSync(new URL('components/Transcript.css', root), 'utf8');
  assert.match(source, /\.transcript \.message time \{ font-size: 11px; \}/);
  assert.match(source, /\.transcript \.message \[data-timestamp-fallback\] \{ font-size: 8px; \}/);
});

test('issue-1565-c3: planner documents date-only UTC pins and uses the shared formatter for live task clocks', () => {
  const source = readFileSync(new URL('pages/planner/index.tsx', root), 'utf8');
  assert.match(source, /date-only planner values; UTC prevents viewer offsets from shifting calendar days/);
  assert.match(source, /formatTimestamp\(task\.startsAt/);
  assert.doesNotMatch(source, /new Intl\.DateTimeFormat\([^\n]+task\.startsAt/);
});

test('issue-1565-c5: automation overview contains no fabricated sync date or provider count', () => {
  const source = readFileSync(new URL('pages/automations/index.tsx', root), 'utf8');
  assert.doesNotMatch(source, /Aug 12 · 15:45/);
  assert.doesNotMatch(source, /<dt>Latest account sync<\/dt>/);
  assert.doesNotMatch(source, /data-testid="automations-provider-count">3/);
});

test('issue-1565-c5: date formatting outside the shared formatter is explicitly date-only or a today label', () => {
  const srcRoot = fileURLToPath(root);
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name) && entry.name !== 'timestamps.ts') files.push(path);
    }
  };
  walk(srcRoot);
  const offenders = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!/new Intl\.DateTimeFormat|\.toLocale(?:Date|Time)String\(/.test(line)) return;
      const context = lines.slice(Math.max(0, index - 3), index + 1).join(' ');
      if (!/(?:date-only|today label)/i.test(context)) offenders.push(`${fileURLToPath(root) === srcRoot ? file.slice(srcRoot.length + 1) : file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
