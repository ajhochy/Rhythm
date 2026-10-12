import { describe, expect, it } from 'vitest';

import { parseDayflowWorkstreamReferenceV1 } from '../contracts/dayflow_workstream_reference_contract';

function reference() {
  return {
    schemaVersion: 1,
    namespace: 'dayflow',
    sourceInstance: 'local-instance',
    sourceId: 'source-1',
    exporterVersion: 'exporter-1',
    normalizerVersion: 'normalizer-1',
    sourceRevision: 'revision-1',
    sourceHash: 'a'.repeat(64),
    canonicalId: 'dayflow:source-1',
    canonicalVersion: 'canonical-1',
    ownerUserId: 811,
    projectId: 'project-1',
    consentGeneration: 'consent-1',
    configurationGeneration: 'configuration-1',
    observedStart: '2026-10-02T10:00:00.000Z',
    observedEnd: '2026-10-02T10:05:00.000Z',
    expiresAt: '2026-10-03T10:00:00.000Z',
    eligibility: 'active',
    appId: 'calendar',
  };
}

describe('Dayflow workstream reference contract', () => {
  it('S3-C09: accepts only bounded metadata identities without source content fields', () => {
    expect(parseDayflowWorkstreamReferenceV1(reference())).toMatchObject({
      canonicalId: 'dayflow:source-1', eligibility: 'active', appId: 'calendar',
    });
    expect(() => parseDayflowWorkstreamReferenceV1({ ...reference(), title: 'not allowed' }))
      .toThrow(/invalid Dayflow reference/);
    expect(() => parseDayflowWorkstreamReferenceV1({ ...reference(), sourceHash: 'not-a-hash' }))
      .toThrow(/invalid Dayflow reference/);
  });

  it('S3-C09: represents pending/deleted eligibility as metadata but never treats it as active', () => {
    expect(parseDayflowWorkstreamReferenceV1({ ...reference(), eligibility: 'pending_delete' }))
      .toMatchObject({ eligibility: 'pending_delete' });
    expect(() => parseDayflowWorkstreamReferenceV1({
      ...reference(), observedEnd: '2026-10-02T09:59:59.000Z',
    })).toThrow(/invalid Dayflow reference/);
  });
});
