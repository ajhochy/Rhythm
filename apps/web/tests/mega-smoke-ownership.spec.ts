import { expect, test } from '@playwright/test';
import { ownsMegaSmokeRow, permitsMegaSmokeWrite } from './helpers/mega-smoke-ownership';

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

test('browser write guard accepts only owned creates and exact cleanup paths', () => {
  const base = 'https://api.vcrcapps.com';
  const allowedDeletes = new Set([`${base}/facilities/7`, `${base}/message-threads/7`]);
  const write = (method: string, path: string, body = '') => ({ method, url: `${base}${path}`, body });
  expect(permitsMegaSmokeWrite(write('POST', '/message-threads', JSON.stringify({ title: `${marker}-THREAD` })), marker, allowedDeletes)).toBe(true);
  expect(permitsMegaSmokeWrite(write('POST', '/facilities/7/reservations', JSON.stringify({ title: `${marker}-RESERVATION` })), marker, allowedDeletes)).toBe(true);
  expect(permitsMegaSmokeWrite(write('POST', '/facilities/8/reservations', JSON.stringify({ title: `${marker}-RESERVATION` })), marker, allowedDeletes)).toBe(false);
  expect(permitsMegaSmokeWrite(write('POST', '/message-threads/7/messages', JSON.stringify({ body: `${marker}-MESSAGE` })), marker, allowedDeletes)).toBe(false);
  expect(permitsMegaSmokeWrite(write('POST', '/message-threads', JSON.stringify({ title: 'MEGA-SMOKE-2026-09-18-previous-run-THREAD' })), marker, allowedDeletes)).toBe(false);
  expect(permitsMegaSmokeWrite(write('DELETE', '/message-threads/7'), marker, allowedDeletes)).toBe(true);
  expect(permitsMegaSmokeWrite(write('DELETE', '/automation-rules/7'), marker, allowedDeletes)).toBe(false);
  expect(permitsMegaSmokeWrite(write('PATCH', '/message-threads/7', JSON.stringify({ title: `${marker}-THREAD` })), marker, allowedDeletes)).toBe(false);
});
