import { expect, test } from '@playwright/test';
import { ownsMegaSmokeRow } from './helpers/mega-smoke-ownership';

const marker = 'MEGA-SMOKE-2026-09-18-current-run';

test('cleanup preserves previous runs and unrelated rows mentioning the smoke marker', () => {
  expect(ownsMegaSmokeRow({ id: 1, name: 'MEGA-SMOKE-2026-09-18-previous-run-ROOM' }, marker)).toBe(false);
  expect(ownsMegaSmokeRow({ id: 2, name: 'Existing room', notes: marker }, marker)).toBe(false);
  expect(ownsMegaSmokeRow({ id: 3, name: `${marker}2-ROOM` }, marker)).toBe(false);
});

test('cleanup recognizes only this invocation across the actual row naming fields', () => {
  for (const field of ['name', 'title', 'label']) {
    expect(ownsMegaSmokeRow({ id: 4, [field]: `${marker}-OWNED` }, marker)).toBe(true);
    expect(ownsMegaSmokeRow({ id: 5, [field]: marker }, marker)).toBe(true);
  }
});
