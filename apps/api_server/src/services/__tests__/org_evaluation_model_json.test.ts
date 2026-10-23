import { describe, expect, it } from 'vitest';
import { parseEvaluationModelJson } from '../org_evaluation_model_json';

describe('bounded evaluation model JSON envelope', () => {
  it.each([' {"value":1} ', '\n```json\n{"value":1}\n```\n', '\r\n```\r\n{"value":1}\r\n```\r\n'])(
    'accepts a JSON-only response with optional whole fence', (raw) => {
      expect(parseEvaluationModelJson(raw)).toEqual({ value: 1 });
    },
  );

  it.each([
    'Here is the answer: {"value":1}',
    '```json\n{"value":1}\n``` trailing text',
    '```json\n{"value":1}\n```\n```json\n{"value":2}\n```',
    '```json\n{"value":1}\n```\nExplanation',
    '```json\n{"value":}\n```',
    '{"value":1} trailing text',
    `${' '.repeat(64 * 1024)}{"value":1}`,
  ])('rejects prose, multiple blocks, invalid JSON, or oversized replies', (raw) => {
    expect(() => parseEvaluationModelJson(raw)).toThrow();
  });
});
